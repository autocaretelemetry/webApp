import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db,
  usersTable,
  paymentTransactionsTable,
  notificationsTable,
} from "@workspace/db";
import { hashPassword } from "../lib/auth";
import {
  maybeAlertStuckPayments,
  countStalePendingPayments,
} from "./paymentStuckAlerts";

const TAG = "task103-psa";
const ADMIN_EMAIL = `${TAG}-admin@autocare.test`;
const ADMIN_PHONE = "+99900103001";
const SUPER_EMAIL = `${TAG}-super@autocare.test`;
const SUPER_PHONE = "+99900103002";

// Stable, unique transaction_id prefix so we never collide with real rows.
const TXN_PREFIX = "task103psa";

async function cleanupTxns() {
  await db
    .delete(paymentTransactionsTable)
    .where(like(paymentTransactionsTable.transactionId, `${TXN_PREFIX}%`));
}

async function cleanupNotifs() {
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.kind, "payment_stuck"),
        like(notificationsTable.dedupeKey, "payment_stuck:%"),
        inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
      ),
    );
}

async function cleanup() {
  await cleanupTxns();
  await cleanupNotifs();
  await db
    .delete(usersTable)
    .where(inArray(usersTable.email, [ADMIN_EMAIL, SUPER_EMAIL]));
}

async function seedUser(opts: {
  email: string;
  phone: string;
  role: "admin" | "super_admin";
  name: string;
}) {
  await db.insert(usersTable).values({
    email: opts.email.toLowerCase(),
    passwordHash: hashPassword("test-password-1234"),
    name: opts.name,
    role: opts.role,
    phone: opts.phone,
    active: true,
    approvalStatus: "approved",
    kycStatus: "verified",
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
  });
}

async function insertPending(opts: { n: number; createdAt: Date }) {
  for (let i = 0; i < opts.n; i++) {
    await db.insert(paymentTransactionsTable).values({
      provider: "payswitch",
      transactionId: `${TXN_PREFIX}${Date.now()}-${i}-${Math.random().toString(36).slice(2, 8)}`,
      purpose: "service_invoice",
      amount: 1000,
      email: "buyer@autocare.test",
      description: "stuck test charge",
      status: "pending",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      createdAt: opts.createdAt,
    });
  }
}

beforeAll(async () => {
  await cleanup();
  await seedUser({ email: ADMIN_EMAIL, phone: ADMIN_PHONE, role: "admin", name: "Admin" });
  await seedUser({ email: SUPER_EMAIL, phone: SUPER_PHONE, role: "super_admin", name: "Super" });
});

afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await cleanupTxns();
  await cleanupNotifs();
  vi.unstubAllEnvs();
  // No SENDGRID key → sendEmail returns {ok:false}, so emailsSent stays 0
  // without any network call.
  vi.stubEnv("SENDGRID_API_KEY", "");
  vi.stubEnv("REMINDER_ALERT_EMAILS", "stuck-alerts@autocare.test");
  vi.stubEnv("PAYMENT_STUCK_ALERT_THRESHOLD", "3");
  vi.stubEnv("PAYMENT_STUCK_UNREACHABLE_STREAK", "5");
});

describe("countStalePendingPayments", () => {
  it("counts only pending rows older than the cutoff", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await insertPending({ n: 4, createdAt: old });
    // a fresh one that should NOT count against a 10-min cutoff
    await insertPending({ n: 1, createdAt: new Date() });
    const count = await countStalePendingPayments(10 * 60 * 1000);
    expect(count).toBeGreaterThanOrEqual(4);
  });
});

describe("maybeAlertStuckPayments", () => {
  it("does not alert when the backlog is below threshold and verifications are reachable", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await insertPending({ n: 2, createdAt: old });
    // Threshold is 3, so 2 stuck rows + 0 unreachable should not trip.
    // Bump threshold high enough that pre-existing dev rows don't trip it.
    vi.stubEnv("PAYMENT_STUCK_ALERT_THRESHOLD", String(1_000_000));
    const r = await maybeAlertStuckPayments({
      staleAfterMs: 10 * 60 * 1000,
      unreachable: 0,
    });
    expect(r.triggered).toBe(false);
    expect(r.notificationsCreated).toBe(0);
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payment_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    expect(notifs.length).toBe(0);
  });

  it("alerts every super_admin (not plain admins) when the stuck count crosses the threshold, deduped per day", async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await insertPending({ n: 4, createdAt: old });

    const first = await maybeAlertStuckPayments({
      staleAfterMs: 10 * 60 * 1000,
      unreachable: 0,
    });
    expect(first.triggered).toBe(true);
    expect(first.stuckCount).toBeGreaterThanOrEqual(4);

    const afterFirst = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payment_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    // Only the super_admin gets an in-app notification; the plain admin does not.
    expect(afterFirst.map((n) => n.ownerPhone)).toEqual([SUPER_PHONE]);

    // Second sweep the same UTC day is a dedupe no-op (no new notification).
    const second = await maybeAlertStuckPayments({
      staleAfterMs: 10 * 60 * 1000,
      unreachable: 0,
    });
    expect(second.triggered).toBe(true);
    expect(second.notificationsCreated).toBe(0);
    const afterSecond = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payment_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    expect(afterSecond.length).toBe(1);
  });

  it("alerts on the unreachable streak even when the backlog is small", async () => {
    // No stuck rows; bump count threshold sky-high so only the streak can trip.
    vi.stubEnv("PAYMENT_STUCK_ALERT_THRESHOLD", String(1_000_000));
    vi.stubEnv("PAYMENT_STUCK_UNREACHABLE_STREAK", "5");
    const r = await maybeAlertStuckPayments({
      staleAfterMs: 10 * 60 * 1000,
      unreachable: 5,
    });
    expect(r.triggered).toBe(true);
    expect(r.notificationsCreated).toBe(1);
  });
});
