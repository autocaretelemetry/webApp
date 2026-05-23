import { Router, type IRouter } from "express";
import { and, desc, eq, inArray, sql, gte } from "drizzle-orm";
import {
  db,
  vendorsTable,
  partsTable,
  ordersTable,
  orderItemsTable,
  bookingsTable,
  mechanicsTable,
  vehiclesTable,
  deliveryAgentsTable,
  serviceCentersTable,
  userAddressesTable,
  type OrderItemSnapshot,
} from "@workspace/db";
import {
  ListOrdersQueryParams,
  CreateOrderBody,
  GetOrderParams,
  UpdateOrderStatusParams,
  UpdateOrderStatusBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { authorizeServiceBooking } from "./bookings";

const router: IRouter = Router();

// Orders carry buyer PII and stock-mutation power. The legacy per-handler
// 401 checks (see POST /orders for proposals vs direct buys) were
// inconsistent — gate the entire router so a forgotten check can't open
// up a new endpoint. Per-handler role/relationship checks remain.
router.use(requireAuth);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function hydrate(orders: (typeof ordersTable.$inferSelect)[]) {
  if (orders.length === 0) return [];
  const vendorIds = [...new Set(orders.map((o) => o.vendorId))];
  const mechanicIds = [...new Set(orders.map((o) => o.mechanicId).filter((v): v is string => !!v))];
  const agentIds = [...new Set(orders.map((o) => o.deliveryAgentId).filter((v): v is string => !!v))];
  const bookingIds = [...new Set(orders.map((o) => o.bookingId).filter((v): v is string => !!v))];
  const addressIds = [...new Set(orders.map((o) => o.shippingAddressId).filter((v): v is string => !!v))];
  const orderIds = orders.map((o) => o.id);

  const [vendors, lineCounts, mechanics, agents, bookings, addresses] = await Promise.all([
    db.select().from(vendorsTable).where(inArray(vendorsTable.id, vendorIds)),
    db
      .select({
        orderId: orderItemsTable.orderId,
        n: sql<number>`sum(${orderItemsTable.quantity})`,
      })
      .from(orderItemsTable)
      .where(inArray(orderItemsTable.orderId, orderIds))
      .groupBy(orderItemsTable.orderId),
    mechanicIds.length
      ? db.select().from(mechanicsTable).where(inArray(mechanicsTable.id, mechanicIds))
      : Promise.resolve([] as (typeof mechanicsTable.$inferSelect)[]),
    agentIds.length
      ? db.select().from(deliveryAgentsTable).where(inArray(deliveryAgentsTable.id, agentIds))
      : Promise.resolve([] as (typeof deliveryAgentsTable.$inferSelect)[]),
    bookingIds.length
      ? db
          .select({
            id: bookingsTable.id,
            serviceType: bookingsTable.serviceType,
            status: bookingsTable.status,
            brand: vehiclesTable.brand,
            model: vehiclesTable.model,
            year: vehiclesTable.year,
          })
          .from(bookingsTable)
          .innerJoin(vehiclesTable, eq(vehiclesTable.id, bookingsTable.vehicleId))
          .where(inArray(bookingsTable.id, bookingIds))
      : Promise.resolve([] as Array<{
          id: string;
          serviceType: string;
          status: string;
          brand: string;
          model: string;
          year: number;
        }>),
    addressIds.length
      ? db
          .select({ id: userAddressesTable.id, label: userAddressesTable.label })
          .from(userAddressesTable)
          .where(inArray(userAddressesTable.id, addressIds))
      : Promise.resolve([] as Array<{ id: string; label: string }>),
  ]);

  const vmap = new Map(vendors.map((v) => [v.id, v]));
  const cmap = new Map(lineCounts.map((c) => [c.orderId, Number(c.n)]));
  const mmap = new Map(mechanics.map((m) => [m.id, m]));
  const amap = new Map(agents.map((a) => [a.id, a]));
  const admap = new Map(addresses.map((a) => [a.id, a.label]));
  const bmap = new Map(
    bookings.map((b) => [
      b.id,
      {
        id: b.id,
        serviceType: b.serviceType,
        status: b.status,
        vehicleLabel: `${b.brand} ${b.model} (${b.year})`,
      },
    ]),
  );

  return orders.map((o) => ({
    ...o,
    vendor: vmap.get(o.vendorId) ?? null,
    mechanic: o.mechanicId ? (mmap.get(o.mechanicId) ?? null) : null,
    deliveryAgent: o.deliveryAgentId ? (amap.get(o.deliveryAgentId) ?? null) : null,
    bookingSummary: o.bookingId ? (bmap.get(o.bookingId) ?? null) : null,
    shippingAddressLabel: o.shippingAddressId
      ? (admap.get(o.shippingAddressId) ?? null)
      : null,
    itemsCount: cmap.get(o.id) ?? 0,
  }));
}

router.get("/orders", async (req, res): Promise<void> => {
  const q = ListOrdersQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  // `mine=true` is the auth-scoped buyer filter — replaces the legacy
  // `buyerName` string lookup so two real users with the same display name
  // never see each other's orders. Identity comes from the session phone,
  // never the request body.
  if (q.data.mine) {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!req.user.phone) {
      // No phone on the account => no orders could have been placed under it.
      res.json([]);
      return;
    }
  }
  const conditions = [];
  if (q.data.vendorId) conditions.push(eq(ordersTable.vendorId, q.data.vendorId));
  if (q.data.buyerName) conditions.push(eq(ordersTable.buyerName, q.data.buyerName));
  if (q.data.mine && req.user?.phone) {
    conditions.push(eq(ordersTable.buyerPhone, req.user.phone));
  }
  if (q.data.bookingId) conditions.push(eq(ordersTable.bookingId, q.data.bookingId));
  if (q.data.mechanicId) conditions.push(eq(ordersTable.mechanicId, q.data.mechanicId));
  if (q.data.deliveryAgentId)
    conditions.push(eq(ordersTable.deliveryAgentId, q.data.deliveryAgentId));
  if (q.data.status) conditions.push(eq(ordersTable.status, q.data.status));

  const baseQuery = db.select().from(ordersTable);
  const rows =
    conditions.length > 0
      ? await baseQuery.where(and(...conditions)).orderBy(desc(ordersTable.placedAt))
      : await baseQuery.orderBy(desc(ordersTable.placedAt));
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

  // Mechanic-proposed orders skip the stock decrement until the owner approves.
  const isProposal = !!(parsed.data.bookingId && parsed.data.mechanicId);

  // Direct-buy orders must be placed by a signed-in user — buyer identity
  // (name + phone) is derived from the session, never the request body, so a
  // signed-in user can't spoof someone else's name+phone (which would also
  // make the order disappear from their own `mine=true` listing).
  if (!isProposal && (!req.user || !req.user.phone)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  // If a proposal, resolve the mechanic + their service center to derive the ship-to address.
  let mechanicCenter: typeof serviceCentersTable.$inferSelect | null = null;
  let mechanic: typeof mechanicsTable.$inferSelect | null = null;
  let booking: typeof bookingsTable.$inferSelect | null = null;
  let bookingVehicle: typeof vehiclesTable.$inferSelect | null = null;
  if (isProposal) {
    const [m] = await db
      .select()
      .from(mechanicsTable)
      .where(eq(mechanicsTable.id, parsed.data.mechanicId!));
    if (!m) {
      res.status(400).json({ error: "Mechanic not found" });
      return;
    }
    mechanic = m;
    const [b] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, parsed.data.bookingId!));
    if (!b) {
      res.status(400).json({ error: "Booking not found" });
      return;
    }
    // Proposals are only legal while work is actively underway, and the
    // mechanic on the proposal must be the one assigned to the booking
    // (and therefore implicitly belong to its service center).
    if (b.status !== "in_progress") {
      res.status(409).json({
        error: "Parts can only be proposed while the booking is in progress",
      });
      return;
    }
    if (!b.mechanicId || b.mechanicId !== m.id) {
      res.status(403).json({
        error: "Only the mechanic assigned to this booking can propose parts",
      });
      return;
    }
    if (m.serviceCenterId !== b.serviceCenterId) {
      res.status(403).json({
        error: "Mechanic does not belong to the booking's service center",
      });
      return;
    }
    booking = b;
    const [c] = await db
      .select()
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, m.serviceCenterId));
    mechanicCenter = c ?? null;
    // Proposal buyer identity comes from the booking's vehicle owner, not
    // the request body — the mechanic placing the proposal can't impersonate
    // a different owner.
    const [v] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, b.vehicleId));
    if (!v) {
      res.status(400).json({ error: "Vehicle not found" });
      return;
    }
    bookingVehicle = v;
  } else if (parsed.data.bookingId || parsed.data.mechanicId) {
    // Half-specified link is never valid — both must be present for a proposal,
    // and neither is allowed for a direct buy.
    res.status(400).json({
      error: "bookingId and mechanicId must be provided together to propose parts for a job",
    });
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
        if (!isProposal && part.stock < item.quantity) {
          throw new HttpError(409, `Insufficient stock for ${part.name}`);
        }
      }

      // Stock is reserved only when the order actually goes live (direct buy now,
      // proposal at the owner-approval step).
      if (!isProposal) {
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
      }

      const itemsTotal = items.reduce(
        (sum, item) => sum + partMap.get(item.partId)!.price * item.quantity,
        0,
      );
      const shippingFee = itemsTotal > 200 ? 0 : 12;
      const total = +(itemsTotal + shippingFee).toFixed(2);
      const now = new Date();

      // For direct buys, if the buyer picked a saved address book entry,
      // confirm it belongs to the authenticated user before persisting the
      // FK — never trust an id from the body alone. Proposals always ship
      // to the booking's service center, so any incoming id is ignored.
      let shippingAddressId: string | null = null;
      if (!isProposal && parsed.data.shippingAddressId && req.user) {
        const [owned] = await tx
          .select({ id: userAddressesTable.id })
          .from(userAddressesTable)
          .where(
            and(
              eq(userAddressesTable.id, parsed.data.shippingAddressId),
              eq(userAddressesTable.userId, req.user.id),
            ),
          );
        if (owned) shippingAddressId = owned.id;
      }

      const shippingAddress =
        isProposal && mechanicCenter ? mechanicCenter.address : parsed.data.shippingAddress;
      const deliveryCity =
        parsed.data.deliveryCity ?? (isProposal && mechanicCenter ? mechanicCenter.city : "");
      const deliveryRegion =
        parsed.data.deliveryRegion ?? (isProposal && mechanicCenter ? mechanicCenter.region : "");

      // Buyer identity is server-derived, never trusted from the body:
      //  - proposal: comes from the booking's vehicle owner
      //  - direct buy: comes from the authenticated session
      const buyerName = isProposal
        ? (bookingVehicle?.ownerName ?? "")
        : (req.user!.name ?? "");
      const buyerPhone = isProposal
        ? (bookingVehicle?.ownerPhone ?? "")
        : (req.user!.phone ?? "");

      const [order] = await tx
        .insert(ordersTable)
        .values({
          vendorId: parsed.data.vendorId,
          bookingId: parsed.data.bookingId ?? null,
          mechanicId: parsed.data.mechanicId ?? null,
          buyerKind: parsed.data.buyerKind,
          buyerName,
          buyerPhone,
          shippingAddress,
          shippingAddressId,
          deliveryCity,
          deliveryRegion,
          notes: parsed.data.notes ?? null,
          status: isProposal ? "proposed" : "placed",
          proposedAt: isProposal ? now : null,
          placedAt: now,
          itemsTotal: +itemsTotal.toFixed(2),
          shippingFee,
          total,
          // Direct buys are implicitly paid by the buyer at checkout; proposals
          // start unpaid and get resolved at the owner-approval step.
          paymentStatus: isProposal ? "unpaid" : "paid_by_owner",
          paidAt: isProposal ? null : now,
          paidByUserId: isProposal ? null : (req.user?.id ?? null),
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

    void booking; // touched for narrow typing only
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
  // Allowed transitions. The legacy "proposed → placed" path is gone — the
  // owner now picks a payment route (approve-and-pay OR authorize-center-pay)
  // via the dedicated endpoints below, which both flip status to "placed"
  // alongside the payment decision. Rejection still flows through here.
  const allowed: Record<string, string[]> = {
    proposed: ["cancelled"],
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

      // confirmed → shipped requires a delivery agent assignment.
      if (current.status === "confirmed" && next === "shipped") {
        const agentId = parsed.data.deliveryAgentId ?? current.deliveryAgentId;
        if (!agentId) {
          throw new HttpError(400, "A delivery agent must be assigned before shipping");
        }
        const [agent] = await tx
          .select()
          .from(deliveryAgentsTable)
          .where(eq(deliveryAgentsTable.id, agentId));
        if (!agent || !agent.active) {
          throw new HttpError(400, "Delivery agent not available");
        }
      }

      const now = new Date();
      const updates: Partial<typeof ordersTable.$inferInsert> = { status: next };
      if (next === "confirmed") updates.confirmedAt = now;
      if (next === "shipped") {
        updates.shippedAt = now;
        if (parsed.data.trackingCode) updates.trackingCode = parsed.data.trackingCode;
        if (parsed.data.deliveryAgentId) updates.deliveryAgentId = parsed.data.deliveryAgentId;
      }
      if (next === "delivered") updates.deliveredAt = now;
      if (next === "cancelled") {
        updates.cancelledAt = now;
        if (current.status === "proposed") updates.rejectedAt = now;
      }

      // Status-guarded update: if another transaction beat us to it, returns 0 rows.
      const updated = await tx
        .update(ordersTable)
        .set(updates)
        .where(and(eq(ordersTable.id, current.id), eq(ordersTable.status, current.status)))
        .returning();
      if (updated.length === 0) {
        throw new HttpError(409, "Order status changed concurrently, please retry");
      }

      // Restore stock only for orders that were stock-reserved (not proposals).
      if (next === "cancelled" && current.status !== "proposed") {
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

      // Delivered → bump the assigned agent's completedDeliveries counter.
      if (next === "delivered" && current.deliveryAgentId) {
        await tx
          .update(deliveryAgentsTable)
          .set({
            completedDeliveries: sql`${deliveryAgentsTable.completedDeliveries} + 1`,
          })
          .where(eq(deliveryAgentsTable.id, current.deliveryAgentId));
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

/**
 * Shared transition used by both owner-pay paths: marks a proposed order as
 * placed, stamps approval + payment fields, and atomically reserves stock
 * (rolling back the whole transition if any line is short). The caller has
 * already verified the booking relationship and the order/booking pairing.
 */
async function approveProposalAndReserveStock(
  orderId: string,
  options: {
    paymentStatus: "paid_by_owner" | "unpaid";
    centerPayAuthorized: boolean;
    paidByUserId: string | null;
  },
): Promise<typeof ordersTable.$inferSelect> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(ordersTable)
      .where(eq(ordersTable.id, orderId));
    if (!current) throw new HttpError(404, "Order not found");
    if (current.status !== "proposed") {
      throw new HttpError(
        409,
        `Only proposed orders can be approved (current status: ${current.status})`,
      );
    }
    const now = new Date();
    const updated = await tx
      .update(ordersTable)
      .set({
        status: "placed",
        approvedAt: now,
        placedAt: now,
        paymentStatus: options.paymentStatus,
        centerPayAuthorized: options.centerPayAuthorized,
        paidAt: options.paymentStatus === "paid_by_owner" ? now : null,
        paidByUserId: options.paymentStatus === "paid_by_owner" ? options.paidByUserId : null,
      })
      .where(and(eq(ordersTable.id, current.id), eq(ordersTable.status, "proposed")))
      .returning();
    if (updated.length === 0) {
      throw new HttpError(409, "Order status changed concurrently, please retry");
    }

    const lines = await tx
      .select()
      .from(orderItemsTable)
      .where(eq(orderItemsTable.orderId, current.id));
    for (const line of lines) {
      const dec = await tx
        .update(partsTable)
        .set({ stock: sql`${partsTable.stock} - ${line.quantity}` })
        .where(and(eq(partsTable.id, line.partId), gte(partsTable.stock, line.quantity)))
        .returning({ id: partsTable.id });
      if (dec.length === 0) {
        throw new HttpError(
          409,
          `Insufficient stock for ${line.snapshot.name} — owner cannot approve this proposal`,
        );
      }
    }
    return updated[0];
  });
}

/**
 * Guard for the three new proposal-payment endpoints. Returns the proposal
 * order + the resolved booking relationship, or null after sending an error
 * response. `requiredRelationship` lets the caller restrict to owner vs center.
 */
async function authorizeProposalAction(
  req: Parameters<typeof authorizeServiceBooking>[0],
  res: Parameters<typeof authorizeServiceBooking>[1],
  orderId: string,
  requiredRelationship: "owner" | "center",
): Promise<{
  order: typeof ordersTable.$inferSelect;
  relationship: "owner" | "center" | "admin";
} | null> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return null;
  }
  if (!order.bookingId) {
    res.status(409).json({ error: "This action only applies to mechanic-proposed parts orders" });
    return null;
  }
  const access = await authorizeServiceBooking(req, res, order.bookingId);
  if (!access) return null;
  const rel = access.relationship;
  if (rel !== "admin" && rel !== requiredRelationship) {
    res.status(403).json({
      error:
        requiredRelationship === "owner"
          ? "Only the vehicle owner can approve this parts request."
          : "Only the service center handling this job can settle this parts order.",
    });
    return null;
  }
  return { order, relationship: rel };
}

router.post("/orders/:orderId/approve-and-pay", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const guard = await authorizeProposalAction(req, res, params.data.orderId, "owner");
    if (!guard) return;
    const row = await approveProposalAndReserveStock(guard.order.id, {
      paymentStatus: "paid_by_owner",
      centerPayAuthorized: false,
      paidByUserId: req.user?.id ?? null,
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

router.post("/orders/:orderId/authorize-center-pay", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const guard = await authorizeProposalAction(req, res, params.data.orderId, "owner");
    if (!guard) return;
    const row = await approveProposalAndReserveStock(guard.order.id, {
      paymentStatus: "unpaid",
      centerPayAuthorized: true,
      paidByUserId: null,
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

router.post("/orders/:orderId/center-pay", async (req, res): Promise<void> => {
  const params = GetOrderParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  try {
    const guard = await authorizeProposalAction(req, res, params.data.orderId, "center");
    if (!guard) return;
    const current = guard.order;
    if (!current.centerPayAuthorized) {
      res.status(409).json({
        error:
          "The vehicle owner has not authorized the service center to pay for this order.",
      });
      return;
    }
    if (current.paymentStatus !== "unpaid") {
      res.status(409).json({
        error: `This order is already settled (payment status: ${current.paymentStatus}).`,
      });
      return;
    }
    if (current.status === "cancelled") {
      res.status(409).json({ error: "Cannot settle a cancelled order." });
      return;
    }
    const now = new Date();
    const [row] = await db
      .update(ordersTable)
      .set({
        paymentStatus: "paid_by_center",
        paidAt: now,
        paidByUserId: req.user?.id ?? null,
      })
      .where(
        and(
          eq(ordersTable.id, current.id),
          eq(ordersTable.paymentStatus, "unpaid"),
        ),
      )
      .returning();
    if (!row) {
      res.status(409).json({ error: "Order payment changed concurrently, please retry" });
      return;
    }
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
    .filter((o) => o.status !== "cancelled" && o.status !== "proposed")
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
