import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db,
  usersTable,
  sellerPayoutsTable,
  notificationsTable,
} from "@workspace/db";
import { hashPassword } from "../lib/auth";
import { runPayoutStuckAlerts, findStuckPayouts } from "./payoutAlerts";

const TAG = "task100-pa";
const ADMIN_EMAIL = `${TAG}-admin@autocare.test`;
const ADMIN_PHONE = "+99900100001";
const SUPER_EMAIL = `${TAG}-super@autocare.test`;
const SUPER_PHONE = "+99900100002";
const OWNER_EMAIL = `${TAG}-owner@autocare.test`;
const OWNER_PHONE = "+99900100003";

const SALE_IDS = [
  "aaaa1000-0000-0000-0000-000000000001",
  "aaaa1000-0000-0000-0000-000000000002",
  "aaaa1000-0000-0000-0000-000000000003",
  "aaaa1000-0000-0000-0000-000000000004",
] as const;

async function cleanup() {
  await db
    .delete(sellerPayoutsTable)
    .where(inArray(sellerPayoutsTable.saleId, SALE_IDS as unknown as string[]));
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.kind, "payout_stuck"),
        like(notificationsTable.dedupeKey, "payout_stuck:%"),
        inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
      ),
    );
  await db
    .delete(usersTable)
    .where(inArray(usersTable.email, [ADMIN_EMAIL, SUPER_EMAIL, OWNER_EMAIL]));
}

async function seedUser(opts: {
  email: string;
  phone: string;
  role: "admin" | "super_admin" | "owner";
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

beforeAll(async () => {
  await cleanup();
  await seedUser({ email: ADMIN_EMAIL, phone: ADMIN_PHONE, role: "admin", name: "Admin" });
  await seedUser({ email: SUPER_EMAIL, phone: SUPER_PHONE, role: "super_admin", name: "Super" });
  await seedUser({ email: OWNER_EMAIL, phone: OWNER_PHONE, role: "owner", name: "Owner" });
});

afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  await db
    .delete(sellerPayoutsTable)
    .where(inArray(sellerPayoutsTable.saleId, SALE_IDS as unknown as string[]));
  await db
    .delete(notificationsTable)
    .where(
      and(
        eq(notificationsTable.kind, "payout_stuck"),
        like(notificationsTable.dedupeKey, "payout_stuck:%"),
        inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
      ),
    );
  vi.unstubAllEnvs();
  // Disable email sends (no SENDGRID key set) so emailsSent stays 0 without
  // network calls; sendEmail returns {ok:false, reason:"not_configured"}.
  vi.stubEnv("SENDGRID_API_KEY", "");
  // Pin alert recipients so we don't depend on whoever else is in the db.
  vi.stubEnv("PAYOUT_ALERT_EMAILS", "stuck-alerts@autocare.test");
  // 1ms threshold so freshly inserted rows count as stuck.
  vi.stubEnv("PAYOUT_STUCK_THRESHOLD_MS", "1");
});

async function insertPayout(opts: {
  saleId: string;
  status: "needs_account" | "pending" | "failed" | "paid";
  lastError?: string | null;
  createdAt?: Date;
}) {
  const [row] = await db
    .insert(sellerPayoutsTable)
    .values({
      saleKind: "service_invoice",
      saleId: opts.saleId,
      sellerKind: "service_center",
      sellerId: "center-stub",
      sellerName: "Stub Center",
      grossAmount: 100,
      commissionAmount: 10,
      netAmount: 90,
      status: opts.status,
      lastError: opts.lastError ?? null,
      ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
    })
    .returning();
  return row!;
}

describe("findStuckPayouts", () => {
  it("includes needs_account / pending / failed older than the threshold and excludes paid", async () => {
    const old = new Date(Date.now() - 1000 * 60 * 60);
    await insertPayout({ saleId: SALE_IDS[0]!, status: "needs_account", createdAt: old });
    await insertPayout({ saleId: SALE_IDS[1]!, status: "failed", lastError: "bank rejected", createdAt: old });
    await insertPayout({ saleId: SALE_IDS[2]!, status: "pending", createdAt: old });
    await insertPayout({ saleId: SALE_IDS[3]!, status: "paid", createdAt: old });

    const rows = await findStuckPayouts(1);
    const ids = rows.map((r) => r.saleId);
    expect(ids).toEqual(expect.arrayContaining([SALE_IDS[0], SALE_IDS[1], SALE_IDS[2]]));
    expect(ids).not.toContain(SALE_IDS[3]);
  });
});

describe("runPayoutStuckAlerts", () => {
  it("creates one notification per admin per stuck payout per day, and is idempotent on a second run", async () => {
    const old = new Date(Date.now() - 1000 * 60 * 60);
    await insertPayout({ saleId: SALE_IDS[0]!, status: "needs_account", createdAt: old });
    await insertPayout({ saleId: SALE_IDS[1]!, status: "failed", lastError: "bad acct", createdAt: old });

    const first = await runPayoutStuckAlerts();
    expect(first.stuck).toBeGreaterThanOrEqual(2);
    // Newly alerted today should be exactly the rows we inserted (other
    // stale stuck rows in the db may also count, but ours are guaranteed
    // present). Notifications written for our rows × admin phones.
    const writtenForOurRows = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payout_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    // 2 payouts × 2 admins = 4
    expect(writtenForOurRows.length).toBe(4);

    const second = await runPayoutStuckAlerts();
    // dedupe per (phone, dedupeKey) blocks new inserts for the same UTC day
    const writtenAfter = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payout_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    expect(writtenAfter.length).toBe(4);
    expect(second.newlyAlerted).toBe(0);
  });

  it("returns zero counts and writes nothing when there are no stuck rows", async () => {
    // No payouts inserted; bump threshold so any pre-existing stale rows
    // in the dev db don't satisfy the cutoff.
    vi.stubEnv("PAYOUT_STUCK_THRESHOLD_MS", String(365 * 24 * 60 * 60 * 1000));
    const before = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payout_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    const result = await runPayoutStuckAlerts();
    const after = await db
      .select()
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.kind, "payout_stuck"),
          inArray(notificationsTable.ownerPhone, [ADMIN_PHONE, SUPER_PHONE]),
        ),
      );
    expect(result.stuck).toBe(0);
    expect(result.notificationsCreated).toBe(0);
    expect(result.newlyAlerted).toBe(0);
    expect(after.length).toBe(before.length);
  });
});
