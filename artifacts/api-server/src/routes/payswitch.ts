import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
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
import {
  generateTxnId,
  initiateCheckout,
  payswitchConfigured,
  publicOrigin,
} from "../lib/payswitch";
import { recordCommission } from "../lib/commissions";
import {
  createPayoutForSale,
  resolveServiceInvoiceSeller,
  resolvePartsOrderSeller,
  resolveRentalBookingSeller,
} from "../lib/payouts";
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

// ---------------------- Callback dispatcher ----------------------

/**
 * PaySwitch redirects the customer's browser here after they finish paying.
 * No auth — mounted before `requireKycVerified`. Dispatches by `purpose`
 * to the matching success/failure handler. Always 302s back into the app.
 */
router.get("/payments/payswitch/callback", async (req, res): Promise<void> => {
  const qTxn = (req.query["txn"] ?? req.query["transaction_id"]) as string | undefined;
  const code = (req.query["code"] as string | undefined) ?? "";
  const status = ((req.query["status"] as string | undefined) ?? "").toLowerCase();
  const reason = (req.query["reason"] as string | undefined) ?? "";

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
  const success = code === "000" && status === "successful";
  if (!success) {
    await handleFailure(txn, code, reason || status || "declined");
    res.redirect(txn.failureRedirect);
    return;
  }
  // Idempotency: run the domain mutation FIRST, then CAS the txn from
  // pending → successful with `where status='pending'`. If the handler
  // throws we leave the txn in `pending` so a retry callback (or operator
  // re-trigger) can replay it. The CAS guards against concurrent callbacks
  // double-flipping the status — domain handlers are written to short-
  // circuit when the sale is already in its post-payment state, so a duped
  // run is safe in the rare case both racers slip past the early
  // status check above.
  try {
    await handleSuccess(req, txn);
  } catch (err) {
    req.log.error({ err, txn: txn.id, purpose: txn.purpose }, "callback success handler threw");
    res.redirect(
      `/billing/result?status=failed&purpose=${encodeURIComponent(txn.purpose)}&reason=settlement_failed`,
    );
    return;
  }
  const flipped = await db
    .update(paymentTransactionsTable)
    .set({
      status: "successful",
      providerCode: code,
      providerReason: reason || "approved",
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
    req.log.info({ txn: txn.id }, "callback CAS lost — another worker already settled this txn");
  }
  res.redirect(txn.successRedirect);
});

async function handleFailure(
  txn: typeof paymentTransactionsTable.$inferSelect,
  code: string,
  reason: string,
): Promise<void> {
  await db
    .update(paymentTransactionsTable)
    .set({
      status: "failed",
      providerCode: code || null,
      providerReason: reason,
      completedAt: new Date(),
    })
    .where(eq(paymentTransactionsTable.id, txn.id));
  if (txn.purpose === "subscription" && txn.purposeRef) {
    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subscriptionsTable.id, txn.purposeRef));
  }
  // Sale records (invoice, order, rental booking) intentionally stay in
  // their pre-payment state so the buyer can retry.
}

async function handleSuccess(
  req: Request,
  txn: typeof paymentTransactionsTable.$inferSelect,
): Promise<void> {
  if (!txn.purposeRef) return;

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
      req,
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

export default router;
