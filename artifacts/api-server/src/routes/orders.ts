import { Router, type IRouter, type Request, type Response } from "express";
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
  organizationsTable,
  organizationMembersTable,
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
import { authorizeServiceBooking, getCallerCenterIds } from "./bookings";

const router: IRouter = Router();

router.use(requireAuth);

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const FINANCE_LEVEL_ORG_ROLES = new Set(["admin", "finance"]);

/**
 * For org-attached vehicles, an org admin/finance member (or a manager/driver
 * with `canCheckoutDirectly`) acts as the "owner" for parts approval/payment
 * decisions even though `vehicles.ownerPhone` belongs to a single applicant.
 * Returns true when the signed-in user qualifies for the given organization.
 */
async function callerActsAsOrgOwner(req: Request, orgId: string): Promise<boolean> {
  const role = req.user?.role;
  if (role === "admin" || role === "super_admin") return true;
  const phone = req.user?.phone;
  if (!phone) return false;
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
  if (!org) return false;
  const [member] = await db
    .select()
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, orgId),
        eq(organizationMembersTable.phone, phone),
      ),
    );
  if (!member) return false;
  if (FINANCE_LEVEL_ORG_ROLES.has(member.role)) return true;
  if (!org.requireFinanceApproval) return true;
  return member.canCheckoutDirectly;
}

async function hydrate(orders: (typeof ordersTable.$inferSelect)[]) {
  if (orders.length === 0) return [];
  const vendorIds = [
    ...new Set(orders.map((o) => o.vendorId).filter((v): v is string => !!v)),
  ];
  const sellerCenterIds = [
    ...new Set(
      orders.map((o) => o.sellerCenterId).filter((v): v is string => !!v),
    ),
  ];
  const mechanicIds = [...new Set(orders.map((o) => o.mechanicId).filter((v): v is string => !!v))];
  const agentIds = [...new Set(orders.map((o) => o.deliveryAgentId).filter((v): v is string => !!v))];
  const bookingIds = [...new Set(orders.map((o) => o.bookingId).filter((v): v is string => !!v))];
  const addressIds = [...new Set(orders.map((o) => o.shippingAddressId).filter((v): v is string => !!v))];
  const orderIds = orders.map((o) => o.id);

  const [vendors, sellerCenters, lineCounts, mechanics, agents, bookings, addresses] = await Promise.all([
    vendorIds.length
      ? db.select().from(vendorsTable).where(inArray(vendorsTable.id, vendorIds))
      : Promise.resolve([] as (typeof vendorsTable.$inferSelect)[]),
    sellerCenterIds.length
      ? db
          .select()
          .from(serviceCentersTable)
          .where(inArray(serviceCentersTable.id, sellerCenterIds))
      : Promise.resolve([] as (typeof serviceCentersTable.$inferSelect)[]),
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
  const scmap = new Map(sellerCenters.map((c) => [c.id, c]));
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
    vendor: o.vendorId ? (vmap.get(o.vendorId) ?? null) : null,
    sellerCenter: o.sellerCenterId ? (scmap.get(o.sellerCenterId) ?? null) : null,
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
  if (q.data.mine) {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!req.user.phone) {
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

  // Exactly one seller hint may be set in the body. Server still re-derives
  // the seller from the parts and cross-checks below.
  const bodyVendorId = parsed.data.vendorId ?? null;
  const bodyCenterId = parsed.data.sellerCenterId ?? null;
  if (bodyVendorId && bodyCenterId) {
    res.status(400).json({
      error: "Provide either vendorId or sellerCenterId, not both.",
    });
    return;
  }
  if (!bodyVendorId && !bodyCenterId) {
    res.status(400).json({ error: "vendorId or sellerCenterId is required." });
    return;
  }

  const isProposal = !!(parsed.data.bookingId && parsed.data.mechanicId);

  if (!isProposal && (!req.user || !req.user.phone)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

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

      // Derive seller from the parts themselves.
      const derivedVendorIds = new Set<string>();
      const derivedCenterIds = new Set<string>();
      for (const item of items) {
        const part = partMap.get(item.partId);
        if (!part) throw new HttpError(400, `Part ${item.partId} not found`);
        if (!part.active) throw new HttpError(409, `Part ${part.name} is not available`);
        if (part.vendorId) derivedVendorIds.add(part.vendorId);
        if (part.centerId) derivedCenterIds.add(part.centerId);
        if (!isProposal && part.stock < item.quantity) {
          throw new HttpError(409, `Insufficient stock for ${part.name}`);
        }
      }
      if (derivedVendorIds.size > 0 && derivedCenterIds.size > 0) {
        throw new HttpError(
          400,
          "An order can't mix vendor parts and service-center parts.",
        );
      }
      if (derivedVendorIds.size > 1 || derivedCenterIds.size > 1) {
        throw new HttpError(
          400,
          "An order can't span multiple sellers.",
        );
      }
      const derivedVendorId = [...derivedVendorIds][0] ?? null;
      const derivedCenterId = [...derivedCenterIds][0] ?? null;

      // Cross-check body hint against the derived seller — they must agree.
      if (bodyVendorId && bodyVendorId !== derivedVendorId) {
        throw new HttpError(
          400,
          "vendorId does not match the parts in this order.",
        );
      }
      if (bodyCenterId && bodyCenterId !== derivedCenterId) {
        throw new HttpError(
          400,
          "sellerCenterId does not match the parts in this order.",
        );
      }

      const isCenterSourced = !!derivedCenterId;

      // For center-sourced proposals the mechanic must belong to the same
      // center that sells the part (otherwise the parts aren't "on hand").
      if (isProposal && isCenterSourced && mechanic && derivedCenterId !== mechanic.serviceCenterId) {
        throw new HttpError(
          400,
          "Center-shop parts must come from the same service center handling the job.",
        );
      }

      // Validate vendor exists (for vendor orders) — keeps the legacy 400 path.
      if (derivedVendorId) {
        const [vendor] = await tx
          .select({ id: vendorsTable.id })
          .from(vendorsTable)
          .where(eq(vendorsTable.id, derivedVendorId));
        if (!vendor) throw new HttpError(400, "Vendor not found");
      }
      if (derivedCenterId) {
        const [center] = await tx
          .select({ id: serviceCentersTable.id })
          .from(serviceCentersTable)
          .where(eq(serviceCentersTable.id, derivedCenterId));
        if (!center) throw new HttpError(400, "Service center not found");
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
      // Center-sourced orders are picked up at the center — no shipping fee.
      const shippingFee = isCenterSourced ? 0 : itemsTotal > 200 ? 0 : 12;
      const total = +(itemsTotal + shippingFee).toFixed(2);
      const now = new Date();

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

      // Center-sourced direct-buy orders ship from / pickup at the seller center;
      // proposals always ship to the mechanic's center.
      let centerForAddress: typeof serviceCentersTable.$inferSelect | null = null;
      if (isCenterSourced) {
        const [c] = await tx
          .select()
          .from(serviceCentersTable)
          .where(eq(serviceCentersTable.id, derivedCenterId!));
        centerForAddress = c ?? null;
      }
      const fallbackCenter = isProposal ? mechanicCenter : centerForAddress;
      const shippingAddress =
        (isProposal || isCenterSourced) && fallbackCenter
          ? fallbackCenter.address
          : parsed.data.shippingAddress;
      const deliveryCity =
        parsed.data.deliveryCity ??
        ((isProposal || isCenterSourced) && fallbackCenter ? fallbackCenter.city : "");
      const deliveryRegion =
        parsed.data.deliveryRegion ??
        ((isProposal || isCenterSourced) && fallbackCenter ? fallbackCenter.region : "");

      const buyerName = isProposal
        ? (bookingVehicle?.ownerName ?? "")
        : (req.user!.name ?? "");
      const buyerPhone = isProposal
        ? (bookingVehicle?.ownerPhone ?? "")
        : (req.user!.phone ?? "");

      // Direct buys of center-shop parts auto-deliver immediately since the
      // parts are already at the center (no shipping/delivery hop).
      const autoDeliverNow = !isProposal && isCenterSourced;

      const [order] = await tx
        .insert(ordersTable)
        .values({
          vendorId: derivedVendorId,
          sellerCenterId: derivedCenterId,
          fulfillmentKind: isCenterSourced ? "on_hand" : "delivery",
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
          status: isProposal ? "proposed" : autoDeliverNow ? "delivered" : "placed",
          proposedAt: isProposal ? now : null,
          placedAt: now,
          confirmedAt: autoDeliverNow ? now : null,
          shippedAt: autoDeliverNow ? now : null,
          deliveredAt: autoDeliverNow ? now : null,
          itemsTotal: +itemsTotal.toFixed(2),
          shippingFee,
          total,
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

    void booking;
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

      const updated = await tx
        .update(ordersTable)
        .set(updates)
        .where(and(eq(ordersTable.id, current.id), eq(ordersTable.status, current.status)))
        .returning();
      if (updated.length === 0) {
        throw new HttpError(409, "Order status changed concurrently, please retry");
      }

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
 * placed, stamps approval + payment fields, and atomically reserves stock.
 * For center-sourced (on_hand) proposals also auto-stamps the delivered
 * lifecycle since the parts are already at the center.
 */
async function approveProposalAndReserveStock(
  orderId: string,
  options: {
    paymentStatus: "paid_by_owner" | "paid_by_center" | "unpaid";
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
    const isCenterSourced = current.fulfillmentKind === "on_hand";
    const paidNow =
      options.paymentStatus === "paid_by_owner" ||
      options.paymentStatus === "paid_by_center";
    const updated = await tx
      .update(ordersTable)
      .set({
        status: isCenterSourced ? "delivered" : "placed",
        approvedAt: now,
        placedAt: now,
        confirmedAt: isCenterSourced ? now : null,
        shippedAt: isCenterSourced ? now : null,
        deliveredAt: isCenterSourced ? now : null,
        paymentStatus: options.paymentStatus,
        centerPayAuthorized: options.centerPayAuthorized,
        paidAt: paidNow ? now : null,
        paidByUserId: paidNow ? options.paidByUserId : null,
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
 * Guard for proposal-payment endpoints. Returns the proposal order + the
 * resolved booking relationship, or null after sending an error response.
 * For org-attached vehicles, an org admin/finance member (or a member with
 * canCheckoutDirectly) is treated as "owner".
 */
async function authorizeProposalAction(
  req: Request,
  res: Response,
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
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  // We can't reuse authorizeServiceBooking here because its 403 path runs
  // before we ever get a chance to promote an org admin/finance member to
  // "owner" — that would block the fleet approval flow. Replicate the same
  // checks inline, adding org-owner promotion as an additional acceptance.
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, order.bookingId));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, booking.vehicleId));
  if (!vehicle) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  const role = req.user.role;
  let rel: "owner" | "center" | "admin" | null = null;
  if (role === "admin" || role === "super_admin") {
    rel = "admin";
  } else {
    const userPhone = (req.user.phone ?? "").trim();
    if (userPhone && vehicle.ownerPhone && userPhone === vehicle.ownerPhone.trim()) {
      rel = "owner";
    } else if (vehicle.organizationId) {
      const orgOwner = await callerActsAsOrgOwner(req, vehicle.organizationId);
      if (orgOwner) rel = "owner";
    }
    if (!rel) {
      const centerIds = await getCallerCenterIds(req);
      if (centerIds.includes(booking.serviceCenterId)) rel = "center";
    }
  }
  if (!rel) {
    res.status(403).json({ error: "You don't have access to this order." });
    return null;
  }
  if (rel !== "admin" && rel !== requiredRelationship) {
    res.status(403).json({
      error:
        requiredRelationship === "owner"
          ? "Only the vehicle owner (or an authorized fleet finance member) can approve this parts request."
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
    // For center-sourced orders, the center is the seller — there's nothing
    // to authorize the center to "pay to a vendor". We instead stamp
    // paid_by_center directly so the cost rolls into the booking invoice.
    const isCenterSourced = guard.order.fulfillmentKind === "on_hand";
    const row = await approveProposalAndReserveStock(guard.order.id, {
      paymentStatus: isCenterSourced ? "paid_by_center" : "unpaid",
      centerPayAuthorized: !isCenterSourced,
      paidByUserId: isCenterSourced ? (req.user?.id ?? null) : null,
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
