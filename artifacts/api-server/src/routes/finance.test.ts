import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  paymentTransactionsTable,
  sellerPayoutsTable,
  commissionLedgerTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword, signSessionToken } from "../lib/auth";

const TAG = "finance-summary";
const SUPER_EMAIL = `${TAG}-super@autocare.test`;
const PASSWORD = "test-password-1234";

let superUserId: string;
let superCookie: string;
const txnIds = [
  `${TAG}-tx-1`,
  `${TAG}-tx-2`,
  `${TAG}-tx-3`,
  `${TAG}-tx-sub`,
];
const saleIds: string[] = [];

async function seedSuper(): Promise<string> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: SUPER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "Super",
      role: "super_admin",
      approvalStatus: "approved",
      kycStatus: "verified",
    })
    .returning({ id: usersTable.id });
  return row.id;
}

beforeAll(async () => {
  superUserId = await seedSuper();
  superCookie = `autocare_session=${signSessionToken(superUserId)}`;

  // Insert 3 successful charges across the three sale kinds + 1
  // subscription that must NOT count toward GMV.
  const now = new Date();
  await db.insert(paymentTransactionsTable).values([
    {
      transactionId: txnIds[0]!,
      purpose: "service_invoice",
      amount: 12000, // 120 cedis
      email: SUPER_EMAIL,
      description: "service",
      status: "successful",
      successRedirect: "/",
      failureRedirect: "/",
      completedAt: now,
    },
    {
      transactionId: txnIds[1]!,
      purpose: "parts_order_approve_and_pay",
      amount: 5000, // 50 cedis
      email: SUPER_EMAIL,
      description: "parts",
      status: "successful",
      successRedirect: "/",
      failureRedirect: "/",
      completedAt: now,
    },
    {
      transactionId: txnIds[2]!,
      purpose: "rental_booking",
      amount: 30000, // 300 cedis
      email: SUPER_EMAIL,
      description: "rental",
      status: "successful",
      successRedirect: "/",
      failureRedirect: "/",
      completedAt: now,
    },
    {
      transactionId: txnIds[3]!,
      purpose: "subscription",
      amount: 9999,
      email: SUPER_EMAIL,
      description: "subscription",
      status: "successful",
      successRedirect: "/",
      failureRedirect: "/",
      completedAt: now,
    },
  ]);
});

afterAll(async () => {
  await db
    .delete(paymentTransactionsTable)
    .where(inArray(paymentTransactionsTable.transactionId, txnIds));
  if (saleIds.length) {
    await db
      .delete(sellerPayoutsTable)
      .where(inArray(sellerPayoutsTable.saleId, saleIds));
    await db
      .delete(commissionLedgerTable)
      .where(inArray(commissionLedgerTable.saleId, saleIds));
  }
  await db.delete(usersTable).where(eq(usersTable.id, superUserId));
});

describe("GET /admin/finance-summary", () => {
  it("rejects non super-admin callers", async () => {
    const res = await request(app).get("/api/admin/finance-summary");
    expect(res.status).toBe(401);
  });

  it("returns aggregations with internally consistent GMV totals", async () => {
    const res = await request(app)
      .get("/api/admin/finance-summary?days=30")
      .set("Cookie", superCookie);
    expect(res.status).toBe(200);
    const body = res.body as {
      windowDays: number;
      gmv: {
        byDay: Array<{ date: string; total: number }>;
        byKind: Array<{ kind: string; gross: number; count: number }>;
        windowTotal: number;
      };
    };
    expect(body.windowDays).toBe(30);
    // 30 day buckets densified, regardless of activity.
    expect(body.gmv.byDay).toHaveLength(30);

    // GMV windowTotal must equal the sum of the day series — this is the
    // bug the reviewer caught: misaligned window vs bucket range used to
    // drop today's rows from byDay while leaving them in byKind.
    const daySum = body.gmv.byDay.reduce((s, d) => s + d.total, 0);
    expect(daySum).toBeCloseTo(body.gmv.windowTotal, 6);

    // And the per-kind total must match the same windowTotal (subscription
    // excluded). Our seed contributes 120 + 50 + 300 = 470 cedis above
    // whatever ambient data the test DB already has.
    const kindSum = body.gmv.byKind.reduce((s, k) => s + k.gross, 0);
    expect(kindSum).toBeCloseTo(body.gmv.windowTotal, 6);

    // Subscription purpose must not have leaked into any sale-kind bucket.
    for (const k of body.gmv.byKind) {
      expect(["service_invoice", "parts_order", "rental_booking"]).toContain(k.kind);
    }
  });

  it("rejects garbage day values with 400", async () => {
    const res = await request(app)
      .get("/api/admin/finance-summary?days=not-a-number")
      .set("Cookie", superCookie);
    expect(res.status).toBe(400);
  });
});
