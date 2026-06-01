import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray, like } from "drizzle-orm";
import {
  db,
  usersTable,
  subscriptionPlansTable,
  subscriptionsTable,
  subscriptionPaymentsTable,
  paymentTransactionsTable,
  notificationsTable,
} from "@workspace/db";
import { hashPassword } from "../lib/auth";

// ---- Mock the PaySwitch HTTP client. ----
// The webhook route (routes/payswitch.ts) and the reconciler
// (lib/paymentReconciler.ts) both call `checkTransactionStatus` from
// `../lib/payswitch`. Stubbing that module here lets us drive the
// dispatcher through every outcome (verified-paid, verified-failed,
// amount-mismatch, unreachable) without hitting TheTeller.
const mockCheck = vi.fn();
vi.mock("../lib/payswitch", async () => {
  const actual = await vi.importActual<typeof import("../lib/payswitch")>(
    "../lib/payswitch",
  );
  return {
    ...actual,
    payswitchConfigured: () => true,
    checkTransactionStatus: (txnId: string) => mockCheck(txnId),
  };
});

// Imported AFTER vi.mock so the mocked module is what the app sees.
const { default: app } = await import("../app");
const { reconcilePendingPayments } = await import("../lib/paymentReconciler");

const TAG = "task98-pay";
const SUPER_EMAIL = `${TAG}-super@autocare.test`;
const OWNER_EMAIL = `${TAG}-owner-user@autocare.test`;
const ADMIN_EMAIL = `${TAG}-admin-user@autocare.test`;
const PASSWORD = "test-password-1234";

let planId: string;
let superUserId: string;
let ownerUserId: string;
let adminUserId: string;

async function loginCookie(email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  expect(res.status, `login ${email}: ${res.text}`).toBe(200);
  const set = res.headers["set-cookie"];
  return Array.isArray(set) ? set.join("; ") : String(set ?? "");
}

const BUYER_PHONE = `${TAG}-buyer-0241112222`;

async function cleanup(): Promise<void> {
  await db
    .delete(notificationsTable)
    .where(eq(notificationsTable.ownerPhone, BUYER_PHONE));
  // Bare (non-subscription) txns this suite seeds carry our TAG prefix in
  // transactionId and have no sale link, so the subscription-scoped sweep below
  // never reaches them. Delete by prefix first or the unique transactionId
  // constraint trips on the next run.
  await db
    .delete(paymentTransactionsTable)
    .where(like(paymentTransactionsTable.transactionId, `${TAG}-%`));
  const txnRows = await db
    .select({ id: paymentTransactionsTable.id, ref: paymentTransactionsTable.purposeRef })
    .from(paymentTransactionsTable)
    .where(eq(paymentTransactionsTable.purpose, "subscription"));
  const ourSubIds = (
    await db
      .select({ id: subscriptionsTable.id })
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.subscriberId, `${TAG}-owner`))
  ).map((r) => r.id);
  if (ourSubIds.length > 0) {
    await db
      .delete(subscriptionPaymentsTable)
      .where(inArray(subscriptionPaymentsTable.subscriptionId, ourSubIds));
    const refTxnIds = txnRows.filter((t) => ourSubIds.includes(t.ref ?? "")).map((t) => t.id);
    if (refTxnIds.length > 0) {
      await db
        .delete(paymentTransactionsTable)
        .where(inArray(paymentTransactionsTable.id, refTxnIds));
    }
    await db.delete(subscriptionsTable).where(inArray(subscriptionsTable.id, ourSubIds));
  }
  await db
    .delete(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.name, `${TAG}-plan`));
  await db
    .delete(usersTable)
    .where(
      inArray(usersTable.email, [
        SUPER_EMAIL.toLowerCase(),
        OWNER_EMAIL.toLowerCase(),
        ADMIN_EMAIL.toLowerCase(),
      ]),
    );
}

beforeAll(async () => {
  await cleanup();

  const [plan] = await db
    .insert(subscriptionPlansTable)
    .values({
      name: `${TAG}-plan`,
      audience: "owner",
      priceMonthly: 50,
      features: ["test"],
    })
    .returning({ id: subscriptionPlansTable.id });
  planId = plan!.id;

  const [su] = await db
    .insert(usersTable)
    .values({
      email: SUPER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "T98 Super",
      role: "super_admin",
      approvalStatus: "approved",
      kycStatus: "verified",
    })
    .returning({ id: usersTable.id });
  superUserId = su!.id;

  const [owner] = await db
    .insert(usersTable)
    .values({
      email: OWNER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "T98 Owner User",
      role: "owner",
      approvalStatus: "approved",
      kycStatus: "verified",
    })
    .returning({ id: usersTable.id });
  ownerUserId = owner!.id;

  const [admin] = await db
    .insert(usersTable)
    .values({
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "T98 Admin User",
      role: "admin",
      approvalStatus: "approved",
      kycStatus: "verified",
    })
    .returning({ id: usersTable.id });
  adminUserId = admin!.id;
});

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  mockCheck.mockReset();
});

/** Insert one pending subscription + its pending payment_transactions row. */
async function seedPendingTxn(opts: {
  amountPesewas: number;
  createdAt?: Date;
  txnSuffix: string;
}): Promise<{ subId: string; txnRowId: string; transactionId: string }> {
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const [sub] = await db
    .insert(subscriptionsTable)
    .values({
      subscriberKind: "owner",
      subscriberId: `${TAG}-owner`,
      subscriberName: "T98 Owner",
      planId,
      status: "pending_payment",
      currentPeriodEnd: periodEnd,
    })
    .returning({ id: subscriptionsTable.id });
  const transactionId = `${TAG}-${opts.txnSuffix}`.slice(0, 24);
  const [txn] = await db
    .insert(paymentTransactionsTable)
    .values({
      provider: "payswitch",
      transactionId,
      purpose: "subscription",
      purposeRef: sub!.id,
      amount: opts.amountPesewas,
      email: SUPER_EMAIL.toLowerCase(),
      description: "test charge",
      status: "pending",
      initiatedByUserId: superUserId,
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning({ id: paymentTransactionsTable.id });
  return { subId: sub!.id, txnRowId: txn!.id, transactionId };
}

/** Insert one standalone pending payment_transactions row (no sale link). */
async function seedBarePendingTxn(opts: {
  txnSuffix: string;
  status?: string;
  phone?: string | null;
}): Promise<{ txnRowId: string; transactionId: string }> {
  const transactionId = `${TAG}-${opts.txnSuffix}`.slice(0, 24);
  const [txn] = await db
    .insert(paymentTransactionsTable)
    .values({
      provider: "payswitch",
      transactionId,
      purpose: "service_invoice",
      purposeRef: null,
      amount: 5000,
      email: SUPER_EMAIL.toLowerCase(),
      phone: opts.phone ?? null,
      description: "bare test charge",
      status: opts.status ?? "pending",
      initiatedByUserId: superUserId,
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed&purpose=service_invoice",
    })
    .returning({ id: paymentTransactionsTable.id });
  return { txnRowId: txn!.id, transactionId };
}

describe("admin mark-failed — operator terminally fails a stuck charge", () => {
  it("flips a pending txn to failed with a manual_fail audit note (super-admin only)", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId, transactionId } = await seedBarePendingTxn({ txnSuffix: "mf-ok" });

    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", superCookie)
      .send({ note: "Customer abandoned checkout" });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ outcome: { kind: "failed" } });
    expect(res.body.payment.status).toBe("failed");

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("failed");
    expect(after?.providerReason ?? "").toMatch(/^manual_fail:/);
    expect(after?.providerReason ?? "").toContain("Customer abandoned checkout");
    expect(after?.completedAt).toBeTruthy();

    // Provider must never be contacted for a manual fail.
    expect(mockCheck).not.toHaveBeenCalled();

    // Idempotent on replay: already-settled short-circuit, status unchanged.
    const replay = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", superCookie)
      .send({});
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      outcome: { kind: "already_settled", status: "failed" },
    });
    void transactionId;
  });

  it("notifies the buyer (in-app) that the cancelled charge can be retried, once", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId } = await seedBarePendingTxn({
      txnSuffix: "mf-notify",
      phone: BUYER_PHONE,
    });

    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", superCookie)
      .send({ note: "Stuck — provider unreachable" });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ outcome: { kind: "failed" } });

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `payment_given_up:${txnRowId}`));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]?.ownerPhone).toBe(BUYER_PHONE);
    expect(notifs[0]?.kind).toBe("payment_cancelled");
    expect(notifs[0]?.body ?? "").toMatch(/retry/i);

    // Replay is an already-settled no-op: no duplicate buyer notification.
    const replay = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", superCookie)
      .send({});
    expect(replay.body).toMatchObject({
      outcome: { kind: "already_settled", status: "failed" },
    });
    const after = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.dedupeKey, `payment_given_up:${txnRowId}`));
    expect(after).toHaveLength(1);
  });

  it("refuses to fail an already-successful charge (409)", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId } = await seedBarePendingTxn({
      txnSuffix: "mf-paid",
      status: "successful",
    });
    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", superCookie)
      .send({});
    expect(res.status).toBe(409);

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("successful");
  });

  it("rejects a non-admin caller with 403", async () => {
    const ownerCookie = await loginCookie(OWNER_EMAIL);
    const { txnRowId } = await seedBarePendingTxn({ txnSuffix: "mf-403" });
    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", ownerCookie)
      .send({});
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("pending");
    void ownerUserId;
  });

  it("rejects a plain admin (non-super) caller with 403", async () => {
    const adminCookie = await loginCookie(ADMIN_EMAIL);
    const { txnRowId } = await seedBarePendingTxn({ txnSuffix: "mf-admin-403" });
    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/mark-failed`)
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(403);

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("pending");
    void adminUserId;
  });
});

function approvedStatus(amountPesewas: number) {
  return {
    ok: true,
    reachable: true,
    code: "000",
    status: "approved",
    reason: "Approved",
    amountPesewas,
    raw: null,
  };
}

/** Insert one standalone manually-failed payment_transactions row. */
async function seedManuallyFailedTxn(opts: {
  txnSuffix: string;
}): Promise<{ txnRowId: string; transactionId: string }> {
  const transactionId = `${TAG}-${opts.txnSuffix}`.slice(0, 24);
  const [txn] = await db
    .insert(paymentTransactionsTable)
    .values({
      provider: "payswitch",
      transactionId,
      purpose: "service_invoice",
      purposeRef: null,
      amount: 5000,
      email: SUPER_EMAIL.toLowerCase(),
      description: "manually failed test charge",
      status: "failed",
      providerCode: "manual",
      providerReason: "manual_fail: wrong charge (by op)",
      completedAt: new Date(),
      manualFailById: superUserId,
      manualFailByEmail: SUPER_EMAIL.toLowerCase(),
      manualFailNote: "wrong charge",
      manualFailAt: new Date(),
      initiatedByUserId: superUserId,
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
    })
    .returning({ id: paymentTransactionsTable.id });
  return { txnRowId: txn!.id, transactionId };
}

describe("admin reopen — undo an operator-forced fail", () => {
  it("resets a manually-failed charge to pending and clears the audit columns when still unsettled", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId } = await seedManuallyFailedTxn({ txnSuffix: "ro-ok" });
    // Provider reachable but reports the charge as NOT paid (declined).
    mockCheck.mockResolvedValue({
      ok: false,
      reachable: true,
      code: "101",
      status: "declined",
      reason: "Declined",
      amountPesewas: null,
      raw: null,
    });

    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/reopen`)
      .set("Cookie", superCookie)
      .send({});
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ outcome: { kind: "reopened" } });
    expect(res.body.payment.status).toBe("pending");

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("pending");
    expect(after?.completedAt).toBeNull();
    expect(after?.providerReason).toBeNull();
    expect(after?.providerCode).toBeNull();
    expect(after?.manualFailById).toBeNull();
    expect(after?.manualFailByEmail).toBeNull();
    expect(after?.manualFailNote).toBeNull();
    expect(after?.manualFailAt).toBeNull();
  });

  it("refuses to reopen a charge the provider reports as settled (409)", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId } = await seedManuallyFailedTxn({ txnSuffix: "ro-paid" });
    mockCheck.mockResolvedValue(approvedStatus(5000));

    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/reopen`)
      .set("Cookie", superCookie)
      .send({});
    expect(res.status).toBe(409);

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    // Untouched — still failed with its audit intact.
    expect(after?.status).toBe("failed");
    expect(after?.manualFailById).toBe(superUserId);
  });

  it("refuses to reopen when the provider is unreachable (409)", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId } = await seedManuallyFailedTxn({ txnSuffix: "ro-unr" });
    mockCheck.mockResolvedValue({
      ok: false,
      reachable: false,
      code: "",
      status: "network_error",
      reason: "boom",
      amountPesewas: null,
      raw: null,
    });

    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/reopen`)
      .set("Cookie", superCookie)
      .send({});
    expect(res.status).toBe(409);

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("failed");
  });

  it("refuses to reopen a genuine provider-reported failure (not manual) with 409", async () => {
    const superCookie = await loginCookie(SUPER_EMAIL);
    const { txnRowId } = await seedBarePendingTxn({
      txnSuffix: "ro-prov",
      status: "failed",
    });
    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/reopen`)
      .set("Cookie", superCookie)
      .send({});
    expect(res.status).toBe(409);
    // Provider must never be contacted — we bail before verification.
    expect(mockCheck).not.toHaveBeenCalled();

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("failed");
  });

  it("rejects a non-super-admin caller with 403", async () => {
    const adminCookie = await loginCookie(ADMIN_EMAIL);
    const { txnRowId } = await seedManuallyFailedTxn({ txnSuffix: "ro-403" });
    const res = await request(app)
      .post(`/api/admin/payments/${txnRowId}/reopen`)
      .set("Cookie", adminCookie)
      .send({});
    expect(res.status).toBe(403);
    expect(mockCheck).not.toHaveBeenCalled();

    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(after?.status).toBe("failed");
  });
});

describe("payswitch webhook — re-verifies and settles", () => {
  it("settles a pending txn from {transaction_id} only and is idempotent on replay", async () => {
    const { subId, txnRowId, transactionId } = await seedPendingTxn({
      amountPesewas: 5000,
      txnSuffix: "wh-ok",
    });
    mockCheck.mockResolvedValue(approvedStatus(5000));

    const res = await request(app)
      .post("/api/payments/payswitch/webhook")
      .send({ transaction_id: transactionId });
    expect(res.status, res.text).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outcome: "settled" });
    expect(mockCheck).toHaveBeenCalledWith(transactionId);

    const [txnAfter] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(txnAfter?.status).toBe("successful");

    const [subAfter] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subId));
    expect(subAfter?.status).toBe("active");

    const payments1 = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.subscriptionId, subId));
    expect(payments1).toHaveLength(1);

    // Replay: webhook must short-circuit and NOT insert a second payment row.
    mockCheck.mockClear();
    const replay = await request(app)
      .post("/api/payments/payswitch/webhook")
      .send({ transaction_id: transactionId });
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({
      ok: true,
      outcome: "already_settled",
      status: "successful",
    });
    // Already-settled path must NOT re-call the provider.
    expect(mockCheck).not.toHaveBeenCalled();

    const payments2 = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.subscriptionId, subId));
    expect(payments2).toHaveLength(1);
  });

  it("marks the txn failed and leaves the sale in its pre-payment state when amount mismatches", async () => {
    const { subId, txnRowId, transactionId } = await seedPendingTxn({
      amountPesewas: 5000,
      txnSuffix: "wh-mm",
    });
    // Provider reports a DIFFERENT amount — must refuse settlement.
    mockCheck.mockResolvedValue(approvedStatus(4999));

    const res = await request(app)
      .post("/api/payments/payswitch/webhook")
      .send({ transaction_id: transactionId });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, outcome: "amount_mismatch" });

    const [txnAfter] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txnRowId));
    expect(txnAfter?.status).toBe("failed");
    expect(txnAfter?.providerReason ?? "").toMatch(/amount_mismatch/);

    const [subAfter] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, subId));
    // Subscriptions hit handleFailure → cancelled; sale is NOT flipped to active.
    expect(subAfter?.status).not.toBe("active");

    const payments = await db
      .select()
      .from(subscriptionPaymentsTable)
      .where(eq(subscriptionPaymentsTable.subscriptionId, subId));
    expect(payments).toHaveLength(0);
  });
});

describe("paymentReconciler — sweeps stuck pending charges", () => {
  it("settles stale rows, leaves fresh rows untouched, and leaves unreachable rows pending", async () => {
    const elevenMinAgo = new Date(Date.now() - 11 * 60 * 1000);

    // (a) Stale + provider says "paid" → must settle.
    const stale = await seedPendingTxn({
      amountPesewas: 5000,
      txnSuffix: "rec-stale",
      createdAt: elevenMinAgo,
    });
    // (b) Fresh (younger than stale threshold) → must be skipped entirely.
    const fresh = await seedPendingTxn({
      amountPesewas: 5000,
      txnSuffix: "rec-fresh",
    });
    // (c) Stale + provider unreachable → must stay pending.
    const unreachable = await seedPendingTxn({
      amountPesewas: 5000,
      txnSuffix: "rec-unr",
      createdAt: elevenMinAgo,
    });

    mockCheck.mockImplementation(async (txnId: string) => {
      if (txnId === stale.transactionId) return approvedStatus(5000);
      if (txnId === unreachable.transactionId) {
        return {
          ok: false,
          reachable: false,
          code: "",
          status: "network_error",
          reason: "boom",
          amountPesewas: null,
          raw: null,
        };
      }
      throw new Error(`reconciler called provider for unexpected txn: ${txnId}`);
    });

    const result = await reconcilePendingPayments({
      staleAfterMs: 10 * 60 * 1000,
    });

    // Only the two stale rows are eligible; the fresh one is filtered out
    // by the SQL window before checkTransactionStatus is ever invoked.
    expect(result.checked).toBe(2);
    expect(result.settled).toBe(1);
    expect(result.unreachable).toBe(1);

    const [staleTxn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, stale.txnRowId));
    expect(staleTxn?.status).toBe("successful");
    const [staleSub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, stale.subId));
    expect(staleSub?.status).toBe("active");

    const [freshTxn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, fresh.txnRowId));
    expect(freshTxn?.status).toBe("pending");
    // Provider must NOT have been called for the fresh row.
    const calledTxns = mockCheck.mock.calls.map((c) => c[0]);
    expect(calledTxns).not.toContain(fresh.transactionId);

    const [unrTxn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, unreachable.txnRowId));
    expect(unrTxn?.status).toBe("pending");
    const [unrSub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, unreachable.subId));
    expect(unrSub?.status).toBe("pending_payment");
  });
});
