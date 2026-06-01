import { Router, type IRouter, type Request, type Response } from "express";
import type { Logger } from "pino";
import { z } from "zod";
import { eq, and, desc, like } from "drizzle-orm";
import {
  db,
  subscriptionPlansTable,
  subscriptionsTable,
  subscriptionPaymentsTable,
  paymentTransactionsTable,
  serviceCentersTable,
  vendorsTable,
  organizationsTable,
  organizationMembersTable,
  centerStaffTable,
  vendorStaffTable,
  invoicesTable,
  bookingsTable,
  ordersTable,
  rentalBookingsTable,
  rentalCarsTable,
  vehiclesTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import {
  generateTxnId,
  checkTransactionStatus,
  initiateCheckout,
  payswitchConfigured,
  publicOrigin,
  type StatusCheckResult,
} from "../lib/payswitch";
import { recordCommission } from "../lib/commissions";
import { createOwnerNotification } from "../lib/notify";
import { sendEmail, paymentGivenUpEmail } from "../lib/email";
import {
  createPayoutForSale,
  resolveServiceInvoiceSeller,
  resolvePartsOrderSeller,
  resolveRentalBookingSeller,
} from "../lib/payouts";
import {
  countStalePendingPayments,
  stuckCountThreshold,
} from "../lib/paymentStuckAlerts";
import { closeInvoiceAsPaid } from "./invoices";
import {
  approveProposalAndReserveStock,
  recordPartsOrderCommission,
  authorizeProposalAction,
} from "./orders";

const router: IRouter = Router();

// ---------------------- Subscriber options + auth helpers ----------------------

const InitSubscriptionBody = z.object({
  planId: z.string().uuid(),
  subscriberKind: z.enum(["owner", "center", "vendor", "organization"]),
  subscriberId: z.string().min(1),
});

async function authorizeSubscriber(
  callerPhone: string | null,
  callerUserId: string,
  callerRole: string,
  kind: "owner" | "center" | "vendor" | "organization",
  subscriberId: string,
): Promise<{ ok: true; name: string } | { ok: false; status: number; error: string }> {
  if (callerRole === "admin" || callerRole === "super_admin") {
    if (kind === "owner") return { ok: true, name: subscriberId };
    if (kind === "center") {
      const [c] = await db
        .select()
        .from(serviceCentersTable)
        .where(eq(serviceCentersTable.id, subscriberId));
      if (!c) return { ok: false, status: 404, error: "Service center not found" };
      return { ok: true, name: c.name };
    }
    if (kind === "vendor") {
      const [v] = await db
        .select()
        .from(vendorsTable)
        .where(eq(vendorsTable.id, subscriberId));
      if (!v) return { ok: false, status: 404, error: "Vendor not found" };
      return { ok: true, name: v.name };
    }
    const [o] = await db
      .select()
      .from(organizationsTable)
      .where(eq(organizationsTable.id, subscriberId));
    if (!o) return { ok: false, status: 404, error: "Organization not found" };
    return { ok: true, name: o.name };
  }

  if (kind === "owner") {
    if (!callerPhone || subscriberId !== callerPhone) {
      return { ok: false, status: 403, error: "You can only subscribe for your own account." };
    }
    return { ok: true, name: callerPhone };
  }

  if (kind === "center") {
    const [staff] = await db
      .select()
      .from(centerStaffTable)
      .where(
        and(
          eq(centerStaffTable.userId, callerUserId),
          eq(centerStaffTable.centerId, subscriberId),
          eq(centerStaffTable.active, true),
        ),
      );
    if (!staff) {
      return { ok: false, status: 403, error: "You don't have access to this service center." };
    }
    const [c] = await db
      .select()
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, subscriberId));
    if (!c) return { ok: false, status: 404, error: "Service center not found" };
    return { ok: true, name: c.name };
  }

  if (kind === "vendor") {
    const [staff] = await db
      .select()
      .from(vendorStaffTable)
      .where(
        and(
          eq(vendorStaffTable.userId, callerUserId),
          eq(vendorStaffTable.vendorId, subscriberId),
          eq(vendorStaffTable.active, true),
        ),
      );
    if (!staff) {
      return { ok: false, status: 403, error: "You don't have access to this vendor." };
    }
    const [v] = await db
      .select()
      .from(vendorsTable)
      .where(eq(vendorsTable.id, subscriberId));
    if (!v) return { ok: false, status: 404, error: "Vendor not found" };
    return { ok: true, name: v.name };
  }

  if (!callerPhone) {
    return { ok: false, status: 403, error: "Phone not on file; cannot verify org membership." };
  }
  const [mem] = await db
    .select()
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, subscriberId),
        eq(organizationMembersTable.phone, callerPhone),
      ),
    );
  if (!mem || (mem.role !== "admin" && mem.role !== "finance")) {
    return {
      ok: false,
      status: 403,
      error: "Only org admins or finance members can manage the org subscription.",
    };
  }
  const [o] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, subscriberId));
  if (!o) return { ok: false, status: 404, error: "Organization not found" };
  return { ok: true, name: o.name };
}

router.get("/me/subscriber-options", requireAuth, async (req, res): Promise<void> => {
  const user = req.user!;
  type Opt = {
    kind: "owner" | "center" | "vendor" | "organization";
    subscriberId: string;
    name: string;
  };
  const opts: Opt[] = [];
  if (user.phone) {
    opts.push({ kind: "owner", subscriberId: user.phone, name: user.name ?? user.phone });
  }
  const centerRows = await db
    .select({ id: serviceCentersTable.id, name: serviceCentersTable.name })
    .from(centerStaffTable)
    .innerJoin(serviceCentersTable, eq(serviceCentersTable.id, centerStaffTable.centerId))
    .where(and(eq(centerStaffTable.userId, user.id), eq(centerStaffTable.active, true)));
  const centerIds = new Set<string>();
  for (const c of centerRows) {
    opts.push({ kind: "center", subscriberId: c.id, name: c.name });
    centerIds.add(c.id);
  }
  if (user.phone) {
    const centerByPhone = await db
      .select({ id: serviceCentersTable.id, name: serviceCentersTable.name })
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.phone, user.phone));
    for (const c of centerByPhone) {
      if (!centerIds.has(c.id)) {
        opts.push({ kind: "center", subscriberId: c.id, name: c.name });
        centerIds.add(c.id);
      }
    }
  }
  const vendorRows = await db
    .select({ id: vendorsTable.id, name: vendorsTable.name })
    .from(vendorStaffTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, vendorStaffTable.vendorId))
    .where(and(eq(vendorStaffTable.userId, user.id), eq(vendorStaffTable.active, true)));
  const vendorIds = new Set<string>();
  for (const v of vendorRows) {
    opts.push({ kind: "vendor", subscriberId: v.id, name: v.name });
    vendorIds.add(v.id);
  }
  if (user.phone) {
    const vendorByPhone = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.phone, user.phone));
    for (const v of vendorByPhone) {
      if (!vendorIds.has(v.id)) {
        opts.push({ kind: "vendor", subscriberId: v.id, name: v.name });
        vendorIds.add(v.id);
      }
    }
  }
  if (user.phone) {
    const orgRows = await db
      .select({
        id: organizationsTable.id,
        name: organizationsTable.name,
        role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(organizationsTable, eq(organizationsTable.id, organizationMembersTable.organizationId))
      .where(eq(organizationMembersTable.phone, user.phone));
    for (const o of orgRows) {
      if (o.role === "admin" || o.role === "finance") {
        opts.push({ kind: "organization", subscriberId: o.id, name: o.name });
      }
    }
  }
  const preferred: Opt["kind"] | null =
    user.role === "vendor" || user.role === "vendor_staff"
      ? "vendor"
      : user.role === "center" || user.role === "center_staff"
        ? "center"
        : user.role === "fleet"
          ? "organization"
          : user.role === "owner"
            ? "owner"
            : null;
  if (preferred) {
    opts.sort((a, b) => {
      if (a.kind === preferred && b.kind !== preferred) return -1;
      if (b.kind === preferred && a.kind !== preferred) return 1;
      return 0;
    });
  }
  res.json({ options: opts });
});

// ---------------------- Shared init helper ----------------------

interface InitArgs {
  user: NonNullable<Request["user"]>;
  amountPesewas: number;
  purpose: string;
  purposeRef: string;
  description: string;
  customerName?: string;
  successRedirect: string;
  failureRedirect: string;
}

/**
 * Shared scaffolding for every "pay a sale" endpoint. Inserts the
 * payment_transactions row in `pending`, calls TheTeller, and returns the
 * checkout URL the browser must be redirected to. On provider failure we
 * mark the txn failed and return a 502 — callers should NOT mutate the
 * underlying sale (it stays awaiting_payment so the user can retry).
 */
async function initPaySwitchCheckout(
  args: InitArgs,
): Promise<{ ok: true; checkoutUrl: string; transactionId: string } | { ok: false; status: number; error: string }> {
  if (!payswitchConfigured()) {
    return { ok: false, status: 503, error: "PaySwitch is not configured on this server." };
  }
  if (!args.user.email) {
    return { ok: false, status: 400, error: "Your account is missing an email for the payment receipt." };
  }
  if (!Number.isFinite(args.amountPesewas) || args.amountPesewas <= 0) {
    return { ok: false, status: 400, error: "Sale amount is not configured." };
  }
  const txnId = generateTxnId();
  const origin = publicOrigin();
  const redirectUrl = `${origin}/api/payments/payswitch/callback?txn=${txnId}`;
  const [txn] = await db
    .insert(paymentTransactionsTable)
    .values({
      provider: "payswitch",
      transactionId: txnId,
      purpose: args.purpose,
      purposeRef: args.purposeRef,
      amount: args.amountPesewas,
      email: args.user.email,
      phone: args.user.phone ?? null,
      description: args.description,
      status: "pending",
      initiatedByUserId: args.user.id,
      successRedirect: args.successRedirect,
      failureRedirect: args.failureRedirect,
    })
    .returning();
  const result = await initiateCheckout({
    amountPesewas: args.amountPesewas,
    transactionId: txnId,
    description: args.description,
    email: args.user.email,
    redirectUrl,
    ...(args.customerName ? { customerName: args.customerName } : {}),
  });
  if (!result.ok) {
    await db
      .update(paymentTransactionsTable)
      .set({ status: "failed", providerReason: result.reason, completedAt: new Date() })
      .where(eq(paymentTransactionsTable.id, txn.id));
    return { ok: false, status: 502, error: result.reason };
  }
  await db
    .update(paymentTransactionsTable)
    .set({ checkoutUrl: result.checkoutUrl })
    .where(eq(paymentTransactionsTable.id, txn.id));
  return { ok: true, checkoutUrl: result.checkoutUrl, transactionId: txnId };
}

// ---------------------- Subscriptions (existing) ----------------------

router.post("/payments/payswitch/subscriptions", requireAuth, async (req, res): Promise<void> => {
  const parsed = InitSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = req.user!;
  const [plan] = await db
    .select()
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, parsed.data.planId));
  if (!plan || !plan.active) {
    res.status(404).json({ error: "Plan not found or archived" });
    return;
  }
  if (plan.audience !== parsed.data.subscriberKind) {
    res.status(400).json({
      error: `Plan "${plan.name}" is for ${plan.audience}s, not ${parsed.data.subscriberKind}s.`,
    });
    return;
  }
  if (!Number.isFinite(plan.priceMonthly) || plan.priceMonthly <= 0) {
    res.status(400).json({ error: "Plan price is not configured." });
    return;
  }
  const auth = await authorizeSubscriber(
    user.phone ?? null,
    user.id,
    user.role,
    parsed.data.subscriberKind,
    parsed.data.subscriberId,
  );
  if (!auth.ok) {
    res.status(auth.status).json({ error: auth.error });
    return;
  }
  const amountPesewas = Math.round(plan.priceMonthly * 100);
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const [sub] = await db
    .insert(subscriptionsTable)
    .values({
      subscriberKind: parsed.data.subscriberKind,
      subscriberId: parsed.data.subscriberId,
      subscriberName: auth.name,
      planId: plan.id,
      status: "pending_payment",
      currentPeriodEnd: periodEnd,
    })
    .returning();
  const init = await initPaySwitchCheckout({
    user,
    amountPesewas,
    purpose: "subscription",
    purposeRef: sub.id,
    description: `${plan.name} subscription — ${auth.name}`,
    customerName: auth.name,
    successRedirect: `/billing/result?status=success&purpose=subscription&subscription=${sub.id}`,
    failureRedirect: `/billing/result?status=failed&purpose=subscription&subscription=${sub.id}`,
  });
  if (!init.ok) {
    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subscriptionsTable.id, sub.id));
    res.status(init.status).json({ error: init.error });
    return;
  }
  res.status(201).json({
    checkoutUrl: init.checkoutUrl,
    transactionId: init.transactionId,
    subscriptionId: sub.id,
  });
});

// ---------------------- Service invoice ----------------------

const InvoiceIdParam = z.object({ invoiceId: z.string().uuid() });

router.post(
  "/payments/payswitch/service-invoices/:invoiceId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = InvoiceIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = req.user!;
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, params.data.invoiceId));
    if (!inv) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (inv.status !== "approved") {
      res.status(409).json({
        error: `Only approved invoices can be paid (current status: ${inv.status})`,
      });
      return;
    }
    const [bk] = await db
      .select({ id: bookingsTable.id, vehicleId: bookingsTable.vehicleId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, inv.bookingId));
    if (!bk) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    const [veh] = await db
      .select({ ownerPhone: vehiclesTable.ownerPhone })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, bk.vehicleId));
    const callerPhone = (user.phone ?? "").trim();
    const isOwner = !!callerPhone && veh?.ownerPhone?.trim() === callerPhone;
    if (!isOwner && user.role !== "admin" && user.role !== "super_admin") {
      res.status(403).json({ error: "Only the vehicle owner can pay this invoice." });
      return;
    }
    const init = await initPaySwitchCheckout({
      user,
      amountPesewas: Math.round(inv.total * 100),
      purpose: "service_invoice",
      purposeRef: inv.id,
      description: `Service invoice ${inv.id.slice(0, 8)} — ${user.name ?? user.email}`,
      ...(user.name ? { customerName: user.name } : {}),
      successRedirect: `/billing/result?status=success&purpose=service_invoice&invoice=${inv.id}&booking=${inv.bookingId}`,
      failureRedirect: `/billing/result?status=failed&purpose=service_invoice&invoice=${inv.id}&booking=${inv.bookingId}`,
    });
    if (!init.ok) {
      res.status(init.status).json({ error: init.error });
      return;
    }
    res.status(201).json({ checkoutUrl: init.checkoutUrl, transactionId: init.transactionId });
  },
);

// ---------------------- Parts proposal: approve-and-pay ----------------------

const OrderIdParam = z.object({ orderId: z.string().uuid() });

async function authorizeOrderBuyer(
  req: Request,
  res: Response,
  orderId: string,
): Promise<typeof ordersTable.$inferSelect | null> {
  const user = req.user!;
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) {
    res.status(404).json({ error: "Order not found" });
    return null;
  }
  if (user.role === "admin" || user.role === "super_admin") return order;
  const callerPhone = (user.phone ?? "").trim();
  if (!callerPhone || order.buyerPhone.trim() !== callerPhone) {
    res.status(403).json({ error: "You don't have access to this order." });
    return null;
  }
  return order;
}

router.post(
  "/payments/payswitch/parts-orders/:orderId/approve-and-pay",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = OrderIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = req.user!;
    // Reuse the same auth helper as the legacy /orders/:id/approve-and-pay
    // route — it accepts the vehicle owner, platform admins, *and* org
    // admin/finance (or canCheckoutDirectly members) when the vehicle is
    // org-attached. Without this, fleet approval through PaySwitch breaks.
    const guard = await authorizeProposalAction(req, res, params.data.orderId, "owner");
    if (!guard) return;
    const order = guard.order;
    if (order.status !== "proposed") {
      res.status(409).json({
        error: `Only proposed orders can be approved (current status: ${order.status})`,
      });
      return;
    }
    const init = await initPaySwitchCheckout({
      user,
      amountPesewas: Math.round(order.total * 100),
      purpose: "parts_order_approve",
      purposeRef: order.id,
      description: `Parts order ${order.id.slice(0, 8)} — owner pays vendor`,
      ...(user.name ? { customerName: user.name } : {}),
      successRedirect: `/billing/result?status=success&purpose=parts_order&order=${order.id}`,
      failureRedirect: `/billing/result?status=failed&purpose=parts_order&order=${order.id}`,
    });
    if (!init.ok) {
      res.status(init.status).json({ error: init.error });
      return;
    }
    res.status(201).json({ checkoutUrl: init.checkoutUrl, transactionId: init.transactionId });
  },
);

// ---------------------- Direct-buy parts order (non-proposal) ----------------------

router.post(
  "/payments/payswitch/parts-orders/:orderId/direct-buy",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = OrderIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = req.user!;
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    // Only direct buys (no bookingId) sit in awaiting_payment. Proposals
    // have their own approve-and-pay / center-pay init paths.
    if (order.bookingId) {
      res.status(409).json({ error: "Use approve-and-pay for mechanic-proposed orders." });
      return;
    }
    if (order.status !== "awaiting_payment") {
      res.status(409).json({
        error: `Only orders awaiting payment can be paid (current status: ${order.status})`,
      });
      return;
    }
    if (user.role !== "admin" && user.role !== "super_admin") {
      const callerPhone = (user.phone ?? "").trim();
      if (!callerPhone || order.buyerPhone.trim() !== callerPhone) {
        res.status(403).json({ error: "Only the buyer can pay for this order." });
        return;
      }
    }
    const init = await initPaySwitchCheckout({
      user,
      amountPesewas: Math.round(order.total * 100),
      purpose: "parts_order_direct_buy",
      purposeRef: order.id,
      description: `Parts order ${order.id.slice(0, 8)} — direct buy`,
      ...(user.name ? { customerName: user.name } : {}),
      successRedirect: `/billing/result?status=success&purpose=parts_order&order=${order.id}`,
      failureRedirect: `/billing/result?status=failed&purpose=parts_order&order=${order.id}`,
    });
    if (!init.ok) {
      res.status(init.status).json({ error: init.error });
      return;
    }
    res.status(201).json({ checkoutUrl: init.checkoutUrl, transactionId: init.transactionId });
  },
);

// ---------------------- Parts proposal: center settles with vendor ----------------------

router.post(
  "/payments/payswitch/parts-orders/:orderId/center-pay",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = OrderIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = req.user!;
    const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, params.data.orderId));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (!order.centerPayAuthorized || order.paymentStatus !== "unpaid" || !order.vendorId) {
      res.status(409).json({
        error: "This order isn't ready for center settlement.",
      });
      return;
    }
    // Caller must be center staff for the booking's center, or admin.
    if (user.role !== "admin" && user.role !== "super_admin") {
      if (!order.bookingId) {
        res.status(403).json({ error: "Order has no associated booking." });
        return;
      }
      const [booking] = await db
        .select({ centerId: bookingsTable.serviceCenterId })
        .from(bookingsTable)
        .where(eq(bookingsTable.id, order.bookingId));
      if (!booking) {
        res.status(404).json({ error: "Booking not found" });
        return;
      }
      const [staff] = await db
        .select()
        .from(centerStaffTable)
        .where(
          and(
            eq(centerStaffTable.userId, user.id),
            eq(centerStaffTable.centerId, booking.centerId),
            eq(centerStaffTable.active, true),
          ),
        );
      if (!staff) {
        res.status(403).json({ error: "Only center staff can settle this parts order." });
        return;
      }
    }
    const init = await initPaySwitchCheckout({
      user,
      amountPesewas: Math.round(order.total * 100),
      purpose: "parts_order_center_pay",
      purposeRef: order.id,
      description: `Center settlement for order ${order.id.slice(0, 8)}`,
      ...(user.name ? { customerName: user.name } : {}),
      successRedirect: `/billing/result?status=success&purpose=parts_order&order=${order.id}`,
      failureRedirect: `/billing/result?status=failed&purpose=parts_order&order=${order.id}`,
    });
    if (!init.ok) {
      res.status(init.status).json({ error: init.error });
      return;
    }
    res.status(201).json({ checkoutUrl: init.checkoutUrl, transactionId: init.transactionId });
  },
);

// ---------------------- Rental booking ----------------------

const RentalIdParam = z.object({ rentalBookingId: z.string().uuid() });

router.post(
  "/payments/payswitch/rental-bookings/:rentalBookingId",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = RentalIdParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const user = req.user!;
    const [bk] = await db
      .select()
      .from(rentalBookingsTable)
      .where(eq(rentalBookingsTable.id, params.data.rentalBookingId));
    if (!bk) {
      res.status(404).json({ error: "Rental booking not found" });
      return;
    }
    if (bk.status !== "awaiting_payment" || bk.paymentStatus === "paid") {
      res.status(409).json({
        error: `This booking isn't ready for payment (status: ${bk.status}, payment: ${bk.paymentStatus}).`,
      });
      return;
    }
    const callerPhone = (user.phone ?? "").trim();
    if (
      user.role !== "admin" &&
      user.role !== "super_admin" &&
      (!callerPhone || bk.renterPhone.trim() !== callerPhone)
    ) {
      res.status(403).json({ error: "Only the renter can pay for this booking." });
      return;
    }
    const init = await initPaySwitchCheckout({
      user,
      amountPesewas: Math.round(bk.total * 100),
      purpose: "rental_booking",
      purposeRef: bk.id,
      description: `Rental booking ${bk.id.slice(0, 8)} — ${bk.renterName}`,
      customerName: bk.renterName,
      successRedirect: `/billing/result?status=success&purpose=rental_booking&rental=${bk.id}`,
      failureRedirect: `/billing/result?status=failed&purpose=rental_booking&rental=${bk.id}`,
    });
    if (!init.ok) {
      res.status(init.status).json({ error: init.error });
      return;
    }
    res.status(201).json({ checkoutUrl: init.checkoutUrl, transactionId: init.transactionId });
  },
);

// ---------------------- Settlement dispatcher ----------------------

/**
 * Outcome of attempting to settle a transaction against a verified provider
 * status. Used by the browser callback, the server-to-server webhook, and
 * the reconciler job — all three share the same dispatcher so the rules
 * for what counts as settled / failed / still-in-flight live in one place.
 */
export type SettleOutcome =
  | { kind: "settled" }
  | { kind: "already_settled"; status: "successful" | "failed" }
  | { kind: "failed"; code: string; reason: string }
  | { kind: "amount_mismatch"; reason: string }
  | { kind: "pending"; reason: string }
  | { kind: "in_progress"; reason: string }
  | { kind: "handler_error"; reason: string };

const TERMINAL_FAILURE_STATUSES = new Set([
  "failed",
  "declined",
  "cancelled",
  "canceled",
  "expired",
  "reversed",
  "refunded",
  "voided",
]);
const NON_TERMINAL_STATUSES = new Set([
  "",
  "pending",
  "processing",
  "in_progress",
  "initiated",
]);

/**
 * Given a payment_transactions row and a verified provider status, apply
 * the right domain mutation (or none, if the charge isn't settled). All
 * three settlement entry points — browser callback, webhook, reconciler —
 * call this. Idempotency: CAS-updates the txn from pending → successful,
 * and domain handlers short-circuit when the sale is already in its post-
 * payment state.
 */
type ManualFailAudit = {
  byId: string;
  byEmail: string | null;
  note: string | null;
  at: Date;
};

export async function settleVerifiedTransaction(
  txn: typeof paymentTransactionsTable.$inferSelect,
  verified: StatusCheckResult,
  log: Logger,
  manualFail?: ManualFailAudit,
): Promise<SettleOutcome> {
  if (txn.status === "successful" || txn.status === "failed") {
    return { kind: "already_settled", status: txn.status };
  }
  // (1) Verification unreachable. Leave pending for a later retry.
  if (!verified.reachable) {
    log.warn(
      { txn: txn.id, providerStatus: verified.status, providerReason: verified.reason },
      "payswitch verification unreachable; leaving txn pending",
    );
    return { kind: "pending", reason: "verification_unavailable" };
  }
  // (2) Verified, but not paid. Distinguish in-flight from terminal failure.
  if (!verified.ok) {
    const isTerminal =
      TERMINAL_FAILURE_STATUSES.has(verified.status) ||
      (verified.code !== "" &&
        verified.code !== "000" &&
        !NON_TERMINAL_STATUSES.has(verified.status));
    if (!isTerminal) {
      log.info(
        { txn: txn.id, providerStatus: verified.status, providerCode: verified.code },
        "payswitch verification reports non-terminal status; leaving txn pending",
      );
      return {
        kind: "in_progress",
        reason: verified.status || "payment_in_progress",
      };
    }
    const reason = verified.reason || verified.status || "declined";
    log.info(
      { txn: txn.id, providerStatus: verified.status, providerCode: verified.code },
      "payswitch verification reports terminal failure",
    );
    // Only operator-forced fails (the admin mark-failed queue) notify the
    // buyer: a real PaySwitch decline already bounced them to the failure page
    // in real time, but an operator giving up on a stuck charge happens out of
    // band so the buyer would otherwise never learn they can retry. The
    // presence of the audit object is the canonical operator-forced marker.
    await handleFailure(txn, verified.code, reason, manualFail, {
      notifyBuyer: !!manualFail,
    });
    return { kind: "failed", code: verified.code, reason };
  }
  // (3) Verified paid. Defence-in-depth amount check.
  if (
    verified.amountPesewas !== null &&
    Number.isFinite(verified.amountPesewas) &&
    verified.amountPesewas !== txn.amount
  ) {
    const reason = `amount_mismatch: expected ${txn.amount}, got ${verified.amountPesewas}`;
    log.warn(
      { txn: txn.id, expected: txn.amount, verifiedAmount: verified.amountPesewas },
      "payswitch verification amount mismatch — refusing to settle",
    );
    await handleFailure(txn, verified.code, reason);
    return { kind: "amount_mismatch", reason };
  }
  // (4) Verified paid. Run domain mutation FIRST, then CAS the txn.
  try {
    await handleSuccess(log, txn);
  } catch (err) {
    log.error(
      { err, txn: txn.id, purpose: txn.purpose },
      "payswitch settlement domain handler threw",
    );
    return { kind: "handler_error", reason: "settlement_failed" };
  }
  const flipped = await db
    .update(paymentTransactionsTable)
    .set({
      status: "successful",
      providerCode: verified.code,
      providerReason: verified.reason || "approved",
      completedAt: new Date(),
    })
    .where(
      and(
        eq(paymentTransactionsTable.id, txn.id),
        eq(paymentTransactionsTable.status, "pending"),
      ),
    )
    .returning({ id: paymentTransactionsTable.id });
  if (flipped.length === 0) {
    log.info(
      { txn: txn.id },
      "payswitch settlement CAS lost — another worker already settled this txn",
    );
  }
  return { kind: "settled" };
}

// ---------------------- Callback dispatcher ----------------------

/**
 * PaySwitch redirects the customer's browser here after they finish paying.
 * No auth — mounted before `requireKycVerified`. Always 302s back into the app.
 * The query string is untrusted; the server-to-server status check is the
 * single source of truth.
 */
router.get("/payments/payswitch/callback", async (req, res): Promise<void> => {
  const qTxn = (req.query["txn"] ?? req.query["transaction_id"]) as string | undefined;

  if (!qTxn) {
    res.redirect("/billing/result?status=failed&reason=missing_transaction");
    return;
  }
  const [txn] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.transactionId, qTxn));
  if (!txn) {
    res.redirect("/billing/result?status=failed&reason=unknown_transaction");
    return;
  }
  if (txn.status === "successful") {
    res.redirect(txn.successRedirect);
    return;
  }
  if (txn.status === "failed") {
    res.redirect(txn.failureRedirect);
    return;
  }
  const verified = await checkTransactionStatus(qTxn);
  const outcome = await settleVerifiedTransaction(txn, verified, req.log);
  const purposeParam = encodeURIComponent(txn.purpose);
  switch (outcome.kind) {
    case "settled":
    case "already_settled":
      res.redirect(txn.successRedirect);
      return;
    case "failed":
    case "amount_mismatch":
      res.redirect(txn.failureRedirect);
      return;
    case "pending":
    case "in_progress":
      res.redirect(
        `/billing/result?status=pending&purpose=${purposeParam}&reason=${encodeURIComponent(outcome.reason)}`,
      );
      return;
    case "handler_error":
      res.redirect(
        `/billing/result?status=failed&purpose=${purposeParam}&reason=${encodeURIComponent(outcome.reason)}`,
      );
      return;
  }
});

// ---------------------- Webhook (server-to-server) ----------------------

/**
 * PaySwitch's status-notification webhook. Public (the provider has no way
 * to authenticate to us); we ignore everything in the body except the
 * transaction id and ALWAYS re-verify server-to-server against
 * `/v1.1/users/transactions/:id/status` before settling. Replies 200 even
 * for unknown / non-terminal events so PaySwitch doesn't keep retrying;
 * the response body carries a short outcome string for the provider log.
 */
router.post("/payments/payswitch/webhook", async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const candidate =
    (typeof body["transaction_id"] === "string" && body["transaction_id"]) ||
    (typeof body["transactionId"] === "string" && (body["transactionId"] as string)) ||
    (typeof body["txn"] === "string" && (body["txn"] as string)) ||
    (typeof req.query["txn"] === "string" && (req.query["txn"] as string)) ||
    (typeof req.query["transaction_id"] === "string" &&
      (req.query["transaction_id"] as string)) ||
    null;
  if (!candidate) {
    req.log.warn({ body }, "payswitch webhook missing transaction_id");
    res.status(200).json({ ok: false, reason: "missing_transaction_id" });
    return;
  }
  const [txn] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.transactionId, candidate));
  if (!txn) {
    req.log.warn({ candidate }, "payswitch webhook for unknown transaction");
    res.status(200).json({ ok: false, reason: "unknown_transaction" });
    return;
  }
  if (txn.status === "successful" || txn.status === "failed") {
    res.status(200).json({ ok: true, outcome: "already_settled", status: txn.status });
    return;
  }
  const verified = await checkTransactionStatus(candidate);
  const outcome = await settleVerifiedTransaction(txn, verified, req.log);
  res.status(200).json({ ok: true, outcome: outcome.kind });
});

/** Human-friendly label for the kind of sale a charge was paying for. */
function saleLabelForPurpose(purpose: string): string {
  switch (purpose) {
    case "subscription":
      return "subscription";
    case "service_invoice":
      return "service invoice";
    case "rental_booking":
      return "rental booking";
    case "parts_order_approve":
    case "parts_order_direct_buy":
    case "parts_order_center_pay":
      return "parts order";
    default:
      return "payment";
  }
}

/**
 * Tell the buyer that a stuck charge was given up on (terminally failed by an
 * operator) so they know they can retry. Best-effort: an in-app notification
 * keyed on the buyer's phone plus an email to the address captured at checkout.
 * Never throws — a notification failure must not break settlement.
 */
async function notifyBuyerPaymentGivenUp(
  txn: typeof paymentTransactionsTable.$inferSelect,
): Promise<void> {
  const label = saleLabelForPurpose(txn.purpose);
  const retryUrl = `${publicOrigin()}${txn.failureRedirect}`;
  const title = "Payment cancelled";
  const body = `Your ${label} payment of GHS ${(txn.amount / 100).toFixed(
    2,
  )} was cancelled because it never completed. No money was taken — you can retry it.`;

  if (txn.phone) {
    try {
      await createOwnerNotification({
        ownerPhone: txn.phone,
        kind: "payment_cancelled",
        title,
        body,
        dedupeKey: `payment_given_up:${txn.id}`,
        url: txn.failureRedirect,
      });
    } catch (err) {
      logger.warn(
        { err, txn: txn.id },
        "failed to create payment-cancelled in-app notification for buyer",
      );
    }
  }

  if (txn.email) {
    try {
      await sendEmail({
        to: txn.email,
        ...paymentGivenUpEmail({
          saleLabel: label,
          amount: txn.amount / 100,
          retryUrl,
        }),
      });
    } catch (err) {
      logger.warn(
        { err, txn: txn.id },
        "failed to send payment-cancelled email to buyer",
      );
    }
  }
}

async function handleFailure(
  txn: typeof paymentTransactionsTable.$inferSelect,
  code: string,
  reason: string,
  manualFail?: ManualFailAudit,
  opts?: { notifyBuyer?: boolean },
): Promise<void> {
  // CAS the flip on `status='pending'` so a manual mark-failed (or a slow
  // terminal-failure verification) can never clobber a charge a concurrent
  // worker already settled as `successful`. If the CAS loses we skip the
  // downstream subscription cancellation too. When the fail is operator-forced
  // we stamp the audit columns in the SAME CAS, so the who/when/note is only
  // recorded when THIS call actually won the flip (perfectly idempotent against
  // a concurrent real settlement).
  const flipped = await db
    .update(paymentTransactionsTable)
    .set({
      status: "failed",
      providerCode: code || null,
      providerReason: reason,
      completedAt: new Date(),
      ...(manualFail
        ? {
            manualFailById: manualFail.byId,
            manualFailByEmail: manualFail.byEmail,
            manualFailNote: manualFail.note,
            manualFailAt: manualFail.at,
          }
        : {}),
    })
    .where(
      and(
        eq(paymentTransactionsTable.id, txn.id),
        eq(paymentTransactionsTable.status, "pending"),
      ),
    )
    .returning({ id: paymentTransactionsTable.id });
  if (flipped.length === 0) return;
  if (txn.purpose === "subscription" && txn.purposeRef) {
    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subscriptionsTable.id, txn.purposeRef));
  }
  // Sale records (invoice, order, rental booking) intentionally stay in
  // their pre-payment state so the buyer can retry. When an operator gives up
  // on a stuck charge the buyer would otherwise never learn the checkout was
  // abandoned, so tell them they can retry. Only fires once: the CAS above
  // guarantees we got here exactly once per txn (idempotent on replay).
  if (opts?.notifyBuyer) {
    await notifyBuyerPaymentGivenUp(txn);
  }
}

async function handleSuccess(
  log: Logger,
  txn: typeof paymentTransactionsTable.$inferSelect,
): Promise<void> {
  if (!txn.purposeRef) return;

  // closeInvoiceAsPaid takes a Request only for its `.log` field (used by a
  // fire-and-forget WhatsApp alert). Synthesize a minimal stand-in so the
  // webhook and reconciler — which have no Request — can call it too.
  const reqShim = { log } as unknown as Request;

  if (txn.purpose === "subscription") {
    const [sub] = await db
      .update(subscriptionsTable)
      .set({ status: "active", cancelledAt: null })
      .where(eq(subscriptionsTable.id, txn.purposeRef))
      .returning();
    if (sub) {
      await db.insert(subscriptionPaymentsTable).values({
        subscriptionId: sub.id,
        amount: txn.amount / 100,
        paidAt: new Date(),
      });
    }
    return;
  }

  if (txn.purpose === "service_invoice") {
    await closeInvoiceAsPaid(
      reqShim,
      txn.purposeRef,
      "online",
      "Owner",
      "Payment received — job marked complete",
    );
    const seller = await resolveServiceInvoiceSeller(txn.purposeRef);
    if (seller) await createPayoutForSale(seller);
    return;
  }

  if (txn.purpose === "parts_order_approve") {
    const row = await approveProposalAndReserveStock(txn.purposeRef, {
      paymentStatus: "paid_by_owner",
      centerPayAuthorized: false,
      paidByUserId: txn.initiatedByUserId,
    });
    await recordPartsOrderCommission(row);
    const seller = await resolvePartsOrderSeller(row.id);
    if (seller) await createPayoutForSale(seller);
    return;
  }

  if (txn.purpose === "parts_order_direct_buy") {
    // Flip the order from awaiting_payment → delivered (center-shop, on-hand)
    // or placed (vendor, needs fulfilment) and stamp paid_by_owner. Stock is
    // already reserved at order creation, so payment success just settles.
    const [existing] = await db.select().from(ordersTable).where(eq(ordersTable.id, txn.purposeRef));
    if (!existing) return;
    if (existing.status !== "awaiting_payment") {
      // Idempotency: already settled by a previous callback.
      return;
    }
    const isCenterSourced = !!existing.sellerCenterId;
    const now = new Date();
    const [updated] = await db
      .update(ordersTable)
      .set({
        status: isCenterSourced ? "delivered" : "placed",
        paymentStatus: "paid_by_owner",
        paidAt: now,
        paidByUserId: txn.initiatedByUserId,
        ...(isCenterSourced
          ? { confirmedAt: now, shippedAt: now, deliveredAt: now }
          : {}),
      })
      .where(
        and(
          eq(ordersTable.id, existing.id),
          eq(ordersTable.status, "awaiting_payment"),
        ),
      )
      .returning();
    if (updated) {
      await recordPartsOrderCommission(updated);
      const seller = await resolvePartsOrderSeller(updated.id);
      if (seller) await createPayoutForSale(seller);
    }
    return;
  }

  if (txn.purpose === "parts_order_center_pay") {
    const [updated] = await db
      .update(ordersTable)
      .set({
        paymentStatus: "paid_by_center",
        paidAt: new Date(),
        paidByUserId: txn.initiatedByUserId,
      })
      .where(eq(ordersTable.id, txn.purposeRef))
      .returning();
    if (updated) {
      await recordPartsOrderCommission(updated);
      const seller = await resolvePartsOrderSeller(updated.id);
      if (seller) await createPayoutForSale(seller);
    }
    return;
  }

  if (txn.purpose === "rental_booking") {
    const now = new Date();
    const [bk] = await db
      .update(rentalBookingsTable)
      .set({
        paymentStatus: "paid",
        paymentMethod: "online",
        paidAt: now,
        status: "confirmed",
        confirmedAt: now,
      })
      .where(eq(rentalBookingsTable.id, txn.purposeRef))
      .returning();
    if (bk) {
      const [car] = await db
        .select({ ownerPhone: rentalCarsTable.ownerPhone })
        .from(rentalCarsTable)
        .where(eq(rentalCarsTable.id, bk.carId));
      if (car?.ownerPhone) {
        await recordCommission({
          saleKind: "rental_booking",
          saleId: bk.id,
          sellerKind: "owner",
          sellerId: car.ownerPhone,
          grossAmount: bk.total,
        });
      }
      const seller = await resolveRentalBookingSeller(bk.id);
      if (seller) await createPayoutForSale(seller);
    }
    return;
  }
}

// ---------------------- Super-admin payment-transactions queue ----------------------

function requireSuperAdminPayments(req: Request, res: Response): boolean {
  const user = req.user!;
  if (user.role !== "super_admin") {
    res.status(403).json({ error: "Super-admin only." });
    return false;
  }
  return true;
}

const AdminPaymentsQuery = z.object({
  status: z.enum(["pending", "successful", "failed", "amount_mismatch"]).optional(),
});

/**
 * Lists recent payment_transactions rows for the super-admin triage queue.
 * `status=amount_mismatch` is a derived filter: rows are `status=failed` with
 * a `providerReason` starting with `amount_mismatch:` (the marker the
 * settlement dispatcher writes when the provider-reported amount didn't
 * match what we charged).
 */
router.get("/admin/payments", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdminPayments(req, res)) return;
  const parsed = AdminPaymentsQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const filter = parsed.data.status;
  const where =
    filter === "amount_mismatch"
      ? and(
          eq(paymentTransactionsTable.status, "failed"),
          like(paymentTransactionsTable.providerReason, "amount_mismatch:%"),
        )
      : filter
        ? eq(paymentTransactionsTable.status, filter)
        : undefined;
  const rows = await (where
    ? db.select().from(paymentTransactionsTable).where(where)
    : db.select().from(paymentTransactionsTable))
    .orderBy(desc(paymentTransactionsTable.createdAt))
    .limit(200);
  res.json({ payswitchConfigured: payswitchConfigured(), payments: rows });
});

/**
 * Live health summary for the payments queue. Returns the true backlog of
 * `pending` charges older than the reconciler's stale cutoff (independent of
 * the per-tick limit) plus the alert threshold, so the page can render the
 * same "stuck payments — likely PaySwitch outage" banner the background
 * `maybeAlertStuckPayments` sweep pages super admins about.
 */
router.get(
  "/admin/payments/stuck-summary",
  requireAuth,
  async (req, res): Promise<void> => {
    if (!requireSuperAdminPayments(req, res)) return;
    const staleAfterMs = Number(
      process.env["PAYMENT_RECONCILE_STALE_AFTER_MS"] ?? 10 * 60 * 1000,
    );
    const stuckCount = await countStalePendingPayments(staleAfterMs);
    res.json({
      stuckCount,
      threshold: stuckCountThreshold(),
      staleAfterMs,
    });
  },
);

/**
 * Re-runs verification + the shared settlement dispatcher for a single
 * payment_transactions row. Mirrors what the reconciler does on its tick,
 * but for one specific txn the super admin clicks on.
 */
router.post("/admin/payments/:txnId/recheck", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdminPayments(req, res)) return;
  const id = z.string().uuid().safeParse(req.params["txnId"]);
  if (!id.success) {
    res.status(400).json({ error: "Invalid transaction id" });
    return;
  }
  const [txn] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.id, id.data));
  if (!txn) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if (!payswitchConfigured()) {
    res.status(409).json({ error: "PaySwitch credentials not configured." });
    return;
  }
  const verified = await checkTransactionStatus(txn.transactionId);
  const outcome = await settleVerifiedTransaction(txn, verified, req.log);
  const [fresh] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.id, txn.id));
  res.json({
    outcome,
    verified: {
      reachable: verified.reachable,
      code: verified.code,
      status: verified.status,
      reason: verified.reason,
      amountPesewas: verified.amountPesewas,
    },
    payment: fresh ?? txn,
  });
});

const MarkFailedBody = z.object({
  note: z.string().trim().max(500).optional(),
});

/**
 * Terminally fail a charge that PaySwitch will never settle (e.g. the buyer
 * abandoned the checkout and the transaction is stuck `pending` with the
 * provider unreachable). Super-admin only. Rather than poke the database
 * directly we synthesize an operator-forced terminal status and run it
 * through the same `settleVerifiedTransaction` dispatcher as the reconciler
 * and browser callback, so the txn-status CAS keeps this idempotent against
 * a concurrent real settlement: if a callback/webhook flips the charge to
 * `successful` first, the dispatcher short-circuits and this is a no-op. The
 * operator's audit note is stored on `providerReason` behind a `manual_fail:`
 * marker.
 */
router.post("/admin/payments/:txnId/mark-failed", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdminPayments(req, res)) return;
  const id = z.string().uuid().safeParse(req.params["txnId"]);
  if (!id.success) {
    res.status(400).json({ error: "Invalid transaction id" });
    return;
  }
  const parsed = MarkFailedBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [txn] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.id, id.data));
  if (!txn) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if (txn.status === "successful") {
    res.status(409).json({
      error: "This charge already settled successfully and cannot be marked failed.",
    });
    return;
  }
  const user = req.user!;
  const note = parsed.data.note?.trim() || null;
  const reason = `manual_fail: ${note || "Marked failed by operator"} (by ${user.email ?? user.id})`;
  const manualFail: ManualFailAudit = {
    byId: user.id,
    byEmail: user.email ?? null,
    note,
    at: new Date(),
  };
  const verified: StatusCheckResult = {
    ok: false,
    reachable: true,
    // A status in TERMINAL_FAILURE_STATUSES so the dispatcher treats this as
    // a settled failure (not in-flight) and routes through handleFailure.
    status: "cancelled",
    code: "manual",
    reason,
    amountPesewas: null,
    raw: { manual: true, markedByUserId: user.id },
  };
  req.log.warn(
    { txn: txn.id, by: user.id, note: note ?? null },
    "admin manually marking payment transaction failed",
  );
  const outcome = await settleVerifiedTransaction(txn, verified, req.log, manualFail);
  const [fresh] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.id, txn.id));
  res.json({ outcome, payment: fresh ?? txn });
});

/**
 * Undo an operator-forced "Mark failed" on a payment transaction. Super-admin
 * only — closes the loop on the manual-fail workflow when the wrong charge was
 * failed. Re-verifies with PaySwitch FIRST and only resets the row to `pending`
 * (clearing the manual-fail audit columns) when the provider still reports the
 * charge as unsettled. Refuses when PaySwitch reports the charge as settled
 * (the operator should Re-check to settle it instead) or when the provider is
 * unreachable (we can't confirm it's safe to reopen). Only rows that were
 * manually failed can be reopened — a genuine provider-reported failure is left
 * untouched. The flip is CAS-guarded on `status='failed'` so a concurrent
 * settlement can't be clobbered.
 */
router.post("/admin/payments/:txnId/reopen", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdminPayments(req, res)) return;
  const id = z.string().uuid().safeParse(req.params["txnId"]);
  if (!id.success) {
    res.status(400).json({ error: "Invalid transaction id" });
    return;
  }
  const [txn] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.id, id.data));
  if (!txn) {
    res.status(404).json({ error: "Transaction not found" });
    return;
  }
  if (!payswitchConfigured()) {
    res.status(409).json({ error: "PaySwitch credentials not configured." });
    return;
  }
  // Reopen is strictly the inverse of mark-failed: only a charge an operator
  // forced to `failed` is eligible. Detect via the dedicated audit columns,
  // falling back to the legacy `manual_fail:` providerReason marker.
  const wasManuallyFailed =
    txn.status === "failed" &&
    (!!txn.manualFailAt ||
      !!txn.manualFailById ||
      !!txn.manualFailByEmail ||
      (txn.providerReason ?? "").startsWith("manual_fail:"));
  if (!wasManuallyFailed) {
    res.status(409).json({
      error:
        "Only a manually-failed charge can be reopened. This transaction wasn't failed by an operator.",
    });
    return;
  }
  const verified = await checkTransactionStatus(txn.transactionId);
  if (!verified.reachable) {
    res.status(409).json({
      error: "Couldn't reach PaySwitch to verify this charge — try again shortly.",
    });
    return;
  }
  // Refuse to reopen anything the provider reports as actually settled; the
  // operator should Re-check now to settle it rather than reset it to pending.
  if (verified.ok) {
    res.status(409).json({
      error:
        "PaySwitch reports this charge as settled — it can't be reopened. Use Re-check now to settle it instead.",
    });
    return;
  }
  const user = req.user!;
  req.log.warn(
    {
      txn: txn.id,
      by: user.id,
      priorManualFail: {
        byId: txn.manualFailById,
        byEmail: txn.manualFailByEmail,
        note: txn.manualFailNote,
        at: txn.manualFailAt,
      },
      providerStatus: verified.status,
      providerCode: verified.code,
    },
    "admin reopening a manually-failed payment transaction back to pending",
  );
  const reopened = await db
    .update(paymentTransactionsTable)
    .set({
      status: "pending",
      providerCode: null,
      providerReason: null,
      completedAt: null,
      manualFailById: null,
      manualFailByEmail: null,
      manualFailNote: null,
      manualFailAt: null,
    })
    .where(
      and(
        eq(paymentTransactionsTable.id, txn.id),
        eq(paymentTransactionsTable.status, "failed"),
      ),
    )
    .returning({ id: paymentTransactionsTable.id });
  if (reopened.length === 0) {
    res.status(409).json({
      error: "This charge is no longer failed — it may have settled in the meantime.",
    });
    return;
  }
  const [fresh] = await db
    .select()
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.id, txn.id));
  res.json({
    outcome: { kind: "reopened" },
    verified: {
      reachable: verified.reachable,
      code: verified.code,
      status: verified.status,
      reason: verified.reason,
      amountPesewas: verified.amountPesewas,
    },
    payment: fresh ?? txn,
  });
});

export default router;
