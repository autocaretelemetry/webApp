import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  subscriptionPlansTable,
  subscriptionsTable,
  subscriptionPaymentsTable,
  paymentTransactionsTable,
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
const PASSWORD = "test-password-1234";

let planId: string;
let superUserId: string;

async function cleanup(): Promise<void> {
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
  await db.delete(usersTable).where(eq(usersTable.email, SUPER_EMAIL.toLowerCase()));
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
