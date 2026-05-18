import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql, gte } from "drizzle-orm";
import {
  db,
  vendorsTable,
  partsTable,
  ordersTable,
  orderItemsTable,
  type OrderItemSnapshot,
} from "@workspace/db";
import {
  ListOrdersQueryParams,
  CreateOrderBody,
  GetOrderParams,
  UpdateOrderStatusParams,
  UpdateOrderStatusBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function hydrate(orders: (typeof ordersTable.$inferSelect)[]) {
  if (orders.length === 0) return [];
  const vendorIds = [...new Set(orders.map((o) => o.vendorId))];
  const orderIds = orders.map((o) => o.id);
  const [vendors, lineCounts] = await Promise.all([
    db.select().from(vendorsTable).where(inArray(vendorsTable.id, vendorIds)),
    db
      .select({
        orderId: orderItemsTable.orderId,
        n: sql<number>`sum(${orderItemsTable.quantity})`,
      })
      .from(orderItemsTable)
      .where(inArray(orderItemsTable.orderId, orderIds))
      .groupBy(orderItemsTable.orderId),
  ]);
  const vmap = new Map(vendors.map((v) => [v.id, v]));
  const cmap = new Map(lineCounts.map((c) => [c.orderId, Number(c.n)]));
  return orders.map((o) => ({
    ...o,
    vendor: vmap.get(o.vendorId) ?? null,
    itemsCount: cmap.get(o.id) ?? 0,
  }));
}

router.get("/orders", async (req, res): Promise<void> => {
  const q = ListOrdersQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.vendorId) conditions.push(eq(ordersTable.vendorId, q.data.vendorId));
  if (q.data.buyerName) conditions.push(eq(ordersTable.buyerName, q.data.buyerName));
  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(ordersTable)
          .where(and(...conditions))
          .orderBy(desc(ordersTable.placedAt))
      : await db.select().from(ordersTable).orderBy(desc(ordersTable.placedAt));
  res.json(await hydrate(rows));
});

router.post("/orders", async (req, res): Promise<void> => {
  const parsed = CreateOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, parsed.data.vendorId));
  if (!vendor) {
    res.status(400).json({ error: "Vendor not found" });
    return;
  }

  // Aggregate duplicate partIds so a buyer can't bypass stock checks via duplicate lines.
  const aggregated = new Map<string, number>();
  for (const item of parsed.data.items) {
    aggregated.set(item.partId, (aggregated.get(item.partId) ?? 0) + item.quantity);
  }
  const items = [...aggregated.entries()].map(([partId, quantity]) => ({ partId, quantity }));
  const partIds = items.map((i) => i.partId);

  try {
    const result = await db.transaction(async (tx) => {
      const parts = await tx
        .select()
        .from(partsTable)
        .where(inArray(partsTable.id, partIds));
      const partMap = new Map(parts.map((p) => [p.id, p]));

      for (const item of items) {
        const part = partMap.get(item.partId);
        if (!part) throw new HttpError(400, `Part ${item.partId} not found`);
        if (part.vendorId !== parsed.data.vendorId) {
          throw new HttpError(
            400,
            `Part ${part.name} is not sold by this vendor — orders cannot span multiple vendors`,
          );
        }
        if (!part.active) throw new HttpError(409, `Part ${part.name} is not available`);
      }

      // Conditional, atomic stock decrement. If another transaction won the race,
      // the WHERE clause returns 0 rows and we abort with 409.
      for (const item of items) {
        const part = partMap.get(item.partId)!;
        const updated = await tx
          .update(partsTable)
          .set({ stock: sql`${partsTable.stock} - ${item.quantity}` })
          .where(
            and(eq(partsTable.id, item.partId), gte(partsTable.stock, item.quantity)),
          )
          .returning({ id: partsTable.id });
        if (updated.length === 0) {
          throw new HttpError(409, `Insufficient stock for ${part.name}`);
        }
      }

      const itemsTotal = items.reduce(
        (sum, item) => sum + partMap.get(item.partId)!.price * item.quantity,
        0,
      );
      const shippingFee = itemsTotal > 200 ? 0 : 12;
      const total = +(itemsTotal + shippingFee).toFixed(2);

      const [order] = await tx
        .insert(ordersTable)
        .values({
          vendorId: parsed.data.vendorId,
          buyerKind: parsed.data.buyerKind,
          buyerName: parsed.data.buyerName,
          buyerPhone: parsed.data.buyerPhone,
          shippingAddress: parsed.data.shippingAddress,
          notes: parsed.data.notes ?? null,
          itemsTotal: +itemsTotal.toFixed(2),
          shippingFee,
          total,
        })
        .returning();

      const lineValues = items.map((item) => {
        const part = partMap.get(item.partId)!;
        const snapshot: OrderItemSnapshot = {
          partId: part.id,
          name: part.name,
          sku: part.sku,
          unitPrice: part.price,
          quantity: item.quantity,
          imageUrl: part.imageUrl,
        };
        return {
          orderId: order.id,
          partId: part.id,
          snapshot,
          quantity: item.quantity,
          unitPrice: part.price,
          lineTotal: +(part.price * item.quantity).toFixed(2),
        };
      });
      const lines = await tx.insert(orderItemsTable).values(lineValues).returning();
      return { order, lines };
    });

    const [hydrated] = await hydrate([result.order]);
    res.status(201).json({ ...hydrated, items: result.lines });
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/orders/:orderId", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [order] = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.id, params.data.orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return;
  }
  const lines = await db
    .select()
    .from(orderItemsTable)
    .where(eq(orderItemsTable.orderId, order.id));
  const [hydrated] = await hydrate([order]);
  res.json({ ...hydrated, items: lines });
});

router.patch("/orders/:orderId/status", async (req, res): Promise<void> => {
  const params = UpdateOrderStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateOrderStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const allowed: Record<string, string[]> = {
    placed: ["confirmed", "cancelled"],
    confirmed: ["shipped", "cancelled"],
    shipped: ["delivered"],
    delivered: [],
    cancelled: [],
  };
  const next = parsed.data.status;

  try {
    const row = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(ordersTable)
        .where(eq(ordersTable.id, params.data.orderId));
      if (!current) throw new HttpError(404, "Order not found");

      if (!allowed[current.status]?.includes(next)) {
        throw new HttpError(
          409,
          `Cannot transition order from "${current.status}" to "${next}"`,
        );
      }

      const updates: Partial<typeof ordersTable.$inferInsert> = { status: next };
      if (next === "confirmed") updates.confirmedAt = new Date();
      if (next === "shipped") {
        updates.shippedAt = new Date();
        if (parsed.data.trackingCode) updates.trackingCode = parsed.data.trackingCode;
      }
      if (next === "delivered") updates.deliveredAt = new Date();
      if (next === "cancelled") updates.cancelledAt = new Date();

      // Status-guarded update: if another transaction beat us to it, returns 0 rows.
      const updated = await tx
        .update(ordersTable)
        .set(updates)
        .where(and(eq(ordersTable.id, current.id), eq(ordersTable.status, current.status)))
        .returning();
      if (updated.length === 0) {
        throw new HttpError(409, "Order status changed concurrently, please retry");
      }

      // Restore stock atomically only after the status update succeeded, so we
      // can't double-restore on racing cancels.
      if (next === "cancelled") {
        const lines = await tx
          .select()
          .from(orderItemsTable)
          .where(eq(orderItemsTable.orderId, current.id));
        for (const line of lines) {
          await tx
            .update(partsTable)
            .set({ stock: sql`${partsTable.stock} + ${line.quantity}` })
            .where(eq(partsTable.id, line.partId));
        }
      }

      return updated[0];
    });

    const [hydrated] = await hydrate([row]);
    res.json(hydrated);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/dashboard/vendor/:vendorId", async (req, res): Promise<void> => {
  const vendorId = req.params.vendorId;
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }

  const allParts = await db
    .select()
    .from(partsTable)
    .where(eq(partsTable.vendorId, vendorId));
  const partsCount = allParts.length;
  const lowStockCount = allParts.filter((p) => p.active && p.stock <= 5).length;

  const allOrders = await db
    .select()
    .from(ordersTable)
    .where(eq(ordersTable.vendorId, vendorId));
  const openOrders = allOrders.filter(
    (o) => o.status === "placed" || o.status === "confirmed" || o.status === "shipped",
  ).length;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthOrders = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.vendorId, vendorId),
        gte(ordersTable.placedAt, startOfMonth),
      ),
    );
  const revenueThisMonth = monthOrders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total, 0);

  const breakdown = new Map<string, number>();
  for (const o of allOrders) breakdown.set(o.status, (breakdown.get(o.status) ?? 0) + 1);

  res.json({
    vendorId,
    partsCount,
    lowStockCount,
    openOrders,
    revenueThisMonth: +revenueThisMonth.toFixed(2),
    statusBreakdown: [...breakdown.entries()].map(([status, count]) => ({
      status,
      count,
    })),
  });
});

export default router;
