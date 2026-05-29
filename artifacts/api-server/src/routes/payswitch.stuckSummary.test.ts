import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, paymentTransactionsTable } from "@workspace/db";
import app from "../app";
import { hashPassword, signSessionToken } from "../lib/auth";

const TAG = "stuck-summary";
const SUPER_EMAIL = `${TAG}-super@autocare.test`;
const OWNER_EMAIL = `${TAG}-owner@autocare.test`;
const PASSWORD = "test-password-1234";

const STALE_MS = 10 * 60 * 1000;

let superCookie: string;
let ownerCookie: string;
const txnIds = [
  `${TAG}-stale-1`,
  `${TAG}-stale-2`,
  `${TAG}-fresh`,
  `${TAG}-ok`,
  `${TAG}-failed`,
];

async function seedUser(email: string, role: string): Promise<string> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: role,
      role: role as never,
      approvalStatus: "approved",
      kycStatus: "verified",
    })
    .returning({ id: usersTable.id });
  return row!.id;
}

async function cleanup(): Promise<void> {
  await db
    .delete(paymentTransactionsTable)
    .where(inArray(paymentTransactionsTable.transactionId, txnIds));
  await db
    .delete(usersTable)
    .where(
      inArray(usersTable.email, [
        SUPER_EMAIL.toLowerCase(),
        OWNER_EMAIL.toLowerCase(),
      ]),
    );
}

beforeAll(async () => {
  await cleanup();
  const superId = await seedUser(SUPER_EMAIL, "super_admin");
  const ownerId = await seedUser(OWNER_EMAIL, "owner");
  superCookie = `autocare_session=${signSessionToken(superId)}`;
  ownerCookie = `autocare_session=${signSessionToken(ownerId)}`;

  const stale = new Date(Date.now() - STALE_MS - 60_000);
  const fresh = new Date();
  await db.insert(paymentTransactionsTable).values([
    {
      provider: "payswitch",
      transactionId: txnIds[0]!,
      purpose: "subscription",
      amount: 5000,
      email: OWNER_EMAIL.toLowerCase(),
      description: "stale pending 1",
      status: "pending",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      createdAt: stale,
    },
    {
      provider: "payswitch",
      transactionId: txnIds[1]!,
      purpose: "subscription",
      amount: 5000,
      email: OWNER_EMAIL.toLowerCase(),
      description: "stale pending 2",
      status: "pending",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      createdAt: stale,
    },
    {
      provider: "payswitch",
      transactionId: txnIds[2]!,
      purpose: "subscription",
      amount: 5000,
      email: OWNER_EMAIL.toLowerCase(),
      description: "fresh pending — must not count",
      status: "pending",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      createdAt: fresh,
    },
    {
      provider: "payswitch",
      transactionId: txnIds[3]!,
      purpose: "subscription",
      amount: 5000,
      email: OWNER_EMAIL.toLowerCase(),
      description: "old but successful — must not count",
      status: "successful",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      createdAt: stale,
    },
    {
      provider: "payswitch",
      transactionId: txnIds[4]!,
      purpose: "subscription",
      amount: 5000,
      email: OWNER_EMAIL.toLowerCase(),
      description: "old but failed — must not count",
      status: "failed",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      createdAt: stale,
    },
  ]);
});

afterAll(async () => {
  await cleanup();
});

describe("GET /admin/payments/stuck-summary", () => {
  it("rejects unauthenticated callers", async () => {
    const res = await request(app).get("/api/admin/payments/stuck-summary");
    expect(res.status).toBe(401);
  });

  it("rejects non-super-admins", async () => {
    const res = await request(app)
      .get("/api/admin/payments/stuck-summary")
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(403);
  });

  it("counts only payswitch 'pending' rows older than the stale cutoff", async () => {
    const res = await request(app)
      .get("/api/admin/payments/stuck-summary")
      .set("Cookie", superCookie);
    expect(res.status, res.text).toBe(200);
    // Our two seeded stale-pending rows must be counted; the fresh-pending,
    // successful and failed rows must not. Other suites may leave their own
    // stale-pending rows, so assert "at least our two" rather than equality.
    expect(res.body.stuckCount).toBeGreaterThanOrEqual(2);
    expect(typeof res.body.threshold).toBe("number");
    expect(res.body.threshold).toBeGreaterThanOrEqual(1);
    expect(res.body.staleAfterMs).toBe(STALE_MS);
  });
});
