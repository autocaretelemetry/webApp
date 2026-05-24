import { Router, type IRouter } from "express";
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
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import {
  generateTxnId,
  initiateCheckout,
  payswitchConfigured,
  publicOrigin,
} from "../lib/payswitch";

const router: IRouter = Router();

const InitSubscriptionBody = z.object({
  planId: z.string().uuid(),
  subscriberKind: z.enum(["owner", "center", "vendor", "organization"]),
  subscriberId: z.string().min(1),
});

/**
 * Verify the caller is allowed to subscribe on behalf of the given subscriber.
 * Admins and super admins can subscribe for anyone (back-office support).
 * Otherwise, the caller must own / staff / admin-or-finance the entity.
 */
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

  // organization
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

/**
 * Start a PaySwitch checkout for a subscription. Returns a `checkoutUrl` that
 * the browser must redirect to. Subscription rows are created in
 * `pending_payment` state and only flipped to `active` once the provider
 * callback confirms `code === "000"`.
 */
/**
 * Returns the subscriber identities the calling user is allowed to manage.
 * Drives the self-service Subscription page so it doesn't have to second-guess
 * which centerId/vendorId/orgId belongs to the signed-in user.
 */
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
    .select({
      id: serviceCentersTable.id,
      name: serviceCentersTable.name,
    })
    .from(centerStaffTable)
    .innerJoin(serviceCentersTable, eq(serviceCentersTable.id, centerStaffTable.centerId))
    .where(and(eq(centerStaffTable.userId, user.id), eq(centerStaffTable.active, true)));
  for (const c of centerRows) {
    opts.push({ kind: "center", subscriberId: c.id, name: c.name });
  }
  const vendorRows = await db
    .select({
      id: vendorsTable.id,
      name: vendorsTable.name,
    })
    .from(vendorStaffTable)
    .innerJoin(vendorsTable, eq(vendorsTable.id, vendorStaffTable.vendorId))
    .where(and(eq(vendorStaffTable.userId, user.id), eq(vendorStaffTable.active, true)));
  for (const v of vendorRows) {
    opts.push({ kind: "vendor", subscriberId: v.id, name: v.name });
  }
  if (user.phone) {
    const orgRows = await db
      .select({
        id: organizationsTable.id,
        name: organizationsTable.name,
        role: organizationMembersTable.role,
      })
      .from(organizationMembersTable)
      .innerJoin(
        organizationsTable,
        eq(organizationsTable.id, organizationMembersTable.organizationId),
      )
      .where(eq(organizationMembersTable.phone, user.phone));
    for (const o of orgRows) {
      if (o.role === "admin" || o.role === "finance") {
        opts.push({ kind: "organization", subscriberId: o.id, name: o.name });
      }
    }
  }
  res.json({ options: opts });
});

router.post("/payments/payswitch/subscriptions", requireAuth, async (req, res): Promise<void> => {
  if (!payswitchConfigured()) {
    res.status(503).json({ error: "PaySwitch is not configured on this server." });
    return;
  }
  const parsed = InitSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = req.user!;
  if (!user.email) {
    res.status(400).json({ error: "Your account is missing an email for the payment receipt." });
    return;
  }
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

  // Plan prices are stored in cedis. PaySwitch wants pesewas.
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

  const txnId = generateTxnId();
  const origin = publicOrigin();
  const successRedirect = `/billing/result?status=success&subscription=${sub.id}`;
  const failureRedirect = `/billing/result?status=failed&subscription=${sub.id}`;
  const redirectUrl = `${origin}/api/payments/payswitch/callback?txn=${txnId}`;

  const [txn] = await db
    .insert(paymentTransactionsTable)
    .values({
      provider: "payswitch",
      transactionId: txnId,
      purpose: "subscription",
      purposeRef: sub.id,
      amount: amountPesewas,
      email: user.email,
      phone: user.phone ?? null,
      description: `${plan.name} subscription — ${auth.name}`,
      status: "pending",
      initiatedByUserId: user.id,
      successRedirect,
      failureRedirect,
    })
    .returning();

  const result = await initiateCheckout({
    amountPesewas,
    transactionId: txnId,
    description: txn.description,
    email: user.email,
    redirectUrl,
    customerName: auth.name,
  });

  if (!result.ok) {
    await db
      .update(paymentTransactionsTable)
      .set({
        status: "failed",
        providerReason: result.reason,
        completedAt: new Date(),
      })
      .where(eq(paymentTransactionsTable.id, txn.id));
    await db
      .update(subscriptionsTable)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(eq(subscriptionsTable.id, sub.id));
    req.log.warn({ reason: result.reason, raw: result.raw }, "payswitch initiate failed");
    res.status(502).json({ error: result.reason });
    return;
  }

  await db
    .update(paymentTransactionsTable)
    .set({ checkoutUrl: result.checkoutUrl })
    .where(eq(paymentTransactionsTable.id, txn.id));

  res.status(201).json({
    checkoutUrl: result.checkoutUrl,
    transactionId: txnId,
    subscriptionId: sub.id,
  });
});

/**
 * PaySwitch redirects the customer's browser here after they finish paying.
 * Query string: `code` (000 = success), `status`, `reason`, `transaction_id`
 * (we also tag our own `txn` for safety). Always 302s back to the web app.
 *
 * Intentionally has NO auth — the callback is hit by the customer's browser
 * carrying their session cookie, but also by users whose KYC isn't verified
 * (subscriptions can be purchased before/around KYC). The mount order in
 * `routes/index.ts` puts this BEFORE the global `requireKycVerified` gate.
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
  // Idempotency — if we've already settled, just redirect.
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
    await db
      .update(paymentTransactionsTable)
      .set({
        status: "failed",
        providerCode: code || null,
        providerReason: reason || status || "declined",
        completedAt: new Date(),
      })
      .where(eq(paymentTransactionsTable.id, txn.id));
    if (txn.purpose === "subscription" && txn.purposeRef) {
      await db
        .update(subscriptionsTable)
        .set({ status: "cancelled", cancelledAt: new Date() })
        .where(eq(subscriptionsTable.id, txn.purposeRef));
    }
    res.redirect(txn.failureRedirect);
    return;
  }

  await db
    .update(paymentTransactionsTable)
    .set({
      status: "successful",
      providerCode: code,
      providerReason: reason || "approved",
      completedAt: new Date(),
    })
    .where(eq(paymentTransactionsTable.id, txn.id));

  if (txn.purpose === "subscription" && txn.purposeRef) {
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
  }

  res.redirect(txn.successRedirect);
});

export default router;
