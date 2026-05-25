import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  serviceCentersTable,
  vendorsTable,
  centerStaffTable,
  vendorStaffTable,
  sellerPayoutsTable,
  commissionLedgerTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";
import { createPayoutForSale, disburseToSeller } from "../lib/payouts";

const TAG = "task93-po";
const STAFF_EMAIL = `${TAG}-staff@autocare.test`;
const STRANGER_EMAIL = `${TAG}-stranger@autocare.test`;
const VENDOR_STAFF_EMAIL = `${TAG}-vstaff@autocare.test`;
const ADMIN_EMAIL = `${TAG}-admin@autocare.test`;
const STAFF_PHONE = "+99900094001";
const STRANGER_PHONE = "+99900094002";
const VENDOR_STAFF_PHONE = "+99900094003";
const ADMIN_PHONE = "+99900094004";
const CENTER_PHONE = "+99900094010";
const VENDOR_PHONE = "+99900094011";
const PASSWORD = "test-password-1234";

async function seedUser(opts: {
  email: string;
  phone: string;
  role: "owner" | "center" | "vendor" | "admin";
  name: string;
}) {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: opts.email.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: opts.name,
      role: opts.role,
      phone: opts.phone,
      active: true,
      approvalStatus: "approved",
      kycStatus: "verified",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });
  return row!.id;
}

async function loginCookie(email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  expect(res.status, `login ${email}: ${res.text}`).toBe(200);
  const set = res.headers["set-cookie"];
  const arr = Array.isArray(set) ? set : [set];
  return arr.filter(Boolean).map((c: string) => c.split(";")[0]).join("; ");
}

let staffUserId: string;
let strangerUserId: string;
let vendorStaffUserId: string;
let adminUserId: string;
let centerId: string;
let vendorId: string;
let cookieStaff: string;
let cookieStranger: string;
let cookieVendorStaff: string;
let cookieAdmin: string;

const fakeSaleId = "11111111-1111-1111-1111-111111111111";
const fakeSaleId2 = "22222222-2222-2222-2222-222222222222";
const fakeSaleId3 = "33333333-3333-3333-3333-333333333333";

async function cleanup() {
  await db
    .delete(sellerPayoutsTable)
    .where(inArray(sellerPayoutsTable.saleId, [fakeSaleId, fakeSaleId2, fakeSaleId3]));
  await db
    .delete(commissionLedgerTable)
    .where(inArray(commissionLedgerTable.saleId, [fakeSaleId, fakeSaleId2, fakeSaleId3]));
  const centers = await db
    .select({ id: serviceCentersTable.id })
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.phone, CENTER_PHONE));
  if (centers.length) {
    await db
      .delete(centerStaffTable)
      .where(inArray(centerStaffTable.centerId, centers.map((c) => c.id)));
    await db
      .delete(serviceCentersTable)
      .where(inArray(serviceCentersTable.id, centers.map((c) => c.id)));
  }
  const vendors = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.phone, VENDOR_PHONE));
  if (vendors.length) {
    await db
      .delete(vendorStaffTable)
      .where(inArray(vendorStaffTable.vendorId, vendors.map((v) => v.id)));
    await db
      .delete(vendorsTable)
      .where(inArray(vendorsTable.id, vendors.map((v) => v.id)));
  }
  await db
    .delete(usersTable)
    .where(
      inArray(usersTable.email, [
        STAFF_EMAIL,
        STRANGER_EMAIL,
        VENDOR_STAFF_EMAIL,
        ADMIN_EMAIL,
      ]),
    );
}

beforeAll(async () => {
  await cleanup();
  staffUserId = await seedUser({
    email: STAFF_EMAIL,
    phone: STAFF_PHONE,
    role: "center",
    name: "Center Staff",
  });
  strangerUserId = await seedUser({
    email: STRANGER_EMAIL,
    phone: STRANGER_PHONE,
    role: "owner",
    name: "Stranger",
  });
  vendorStaffUserId = await seedUser({
    email: VENDOR_STAFF_EMAIL,
    phone: VENDOR_STAFF_PHONE,
    role: "vendor",
    name: "Vendor Staff",
  });
  adminUserId = await seedUser({
    email: ADMIN_EMAIL,
    phone: ADMIN_PHONE,
    role: "admin",
    name: "Admin",
  });
  void strangerUserId;
  void adminUserId;

  const [center] = await db
    .insert(serviceCentersTable)
    .values({
      name: `${TAG} Center`,
      address: "1 Test Ave",
      phone: CENTER_PHONE,
      payoutAccount: {
        kind: "bank",
        accountName: "Center A",
        accountNumber: "1234567890",
        bank: "Test Bank",
      },
    })
    .returning();
  centerId = center!.id;
  await db.insert(centerStaffTable).values({
    centerId,
    userId: staffUserId,
    name: "Center Staff",
    email: STAFF_EMAIL.toLowerCase(),
    role: "manager",
    active: true,
  });

  const [vendor] = await db
    .insert(vendorsTable)
    .values({ name: `${TAG} Vendor`, address: "x", phone: VENDOR_PHONE })
    .returning();
  vendorId = vendor!.id;
  await db.insert(vendorStaffTable).values({
    vendorId,
    userId: vendorStaffUserId,
    name: "Vendor Staff",
    email: VENDOR_STAFF_EMAIL.toLowerCase(),
    role: "manager",
    active: true,
  });

  cookieStaff = await loginCookie(STAFF_EMAIL);
  cookieStranger = await loginCookie(STRANGER_EMAIL);
  cookieVendorStaff = await loginCookie(VENDOR_STAFF_EMAIL);
  cookieAdmin = await loginCookie(ADMIN_EMAIL);
});

afterAll(async () => {
  await cleanup();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

beforeEach(async () => {
  // Clean payouts/commissions written by previous tests so each one starts
  // from a clean slate without colliding on the unique (saleKind, saleId).
  await db
    .delete(sellerPayoutsTable)
    .where(inArray(sellerPayoutsTable.saleId, [fakeSaleId, fakeSaleId2, fakeSaleId3]));
  await db
    .delete(commissionLedgerTable)
    .where(inArray(commissionLedgerTable.saleId, [fakeSaleId, fakeSaleId2, fakeSaleId3]));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// ----------------------------- createPayoutForSale -----------------------------

describe("createPayoutForSale", () => {
  it("is idempotent on (saleKind, saleId)", async () => {
    // Disable disbursement so the auto-fired async call no-ops.
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "");
    const args = {
      saleKind: "service_invoice" as const,
      saleId: fakeSaleId,
      sellerKind: "service_center" as const,
      sellerId: centerId,
      sellerName: "Test Center",
      grossAmount: 100,
    };
    await createPayoutForSale(args);
    await createPayoutForSale(args);
    await createPayoutForSale(args);
    const rows = await db
      .select()
      .from(sellerPayoutsTable)
      .where(eq(sellerPayoutsTable.saleId, fakeSaleId));
    expect(rows).toHaveLength(1);
    expect(rows[0].sellerKind).toBe("service_center");
    expect(rows[0].grossAmount).toBe(100);
  });

  it("marks needs_account when seller has no payout destination", async () => {
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "");
    // Vendor in this test seed has no payoutAccount.
    await createPayoutForSale({
      saleKind: "parts_order",
      saleId: fakeSaleId2,
      sellerKind: "vendor",
      sellerId: vendorId,
      sellerName: "Test Vendor",
      grossAmount: 50,
    });
    const [row] = await db
      .select()
      .from(sellerPayoutsTable)
      .where(eq(sellerPayoutsTable.saleId, fakeSaleId2));
    expect(row.status).toBe("needs_account");
    expect(row.account).toBeNull();
  });

  it("snapshots the destination at create time and starts as pending when account is on file", async () => {
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "");
    await createPayoutForSale({
      saleKind: "service_invoice",
      saleId: fakeSaleId3,
      sellerKind: "service_center",
      sellerId: centerId,
      sellerName: "Test Center",
      grossAmount: 200,
    });
    const [row] = await db
      .select()
      .from(sellerPayoutsTable)
      .where(eq(sellerPayoutsTable.saleId, fakeSaleId3));
    expect(row.status).toBe("pending");
    expect(row.account?.kind).toBe("bank");
    expect(row.account?.accountNumber).toBe("1234567890");
  });
});

// ----------------------------- disburseToSeller -----------------------------

describe("disburseToSeller", () => {
  it("flips status to paid on PaySwitch code=000", async () => {
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "u");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "k");
    vi.stubEnv("PAYSWITCH_MERCHANT_ID", "m");
    const [row] = await db
      .insert(sellerPayoutsTable)
      .values({
        saleKind: "service_invoice",
        saleId: fakeSaleId,
        sellerKind: "service_center",
        sellerId: centerId,
        sellerName: "Center",
        grossAmount: 100,
        commissionAmount: 0,
        netAmount: 100,
        account: {
          kind: "bank",
          accountName: "Center A",
          accountNumber: "1234567890",
          bank: "Test Bank",
        },
        status: "pending",
      })
      .returning();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "000", status: "approved" }), { status: 200 }),
    );
    const result = await disburseToSeller(row.id);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result?.status).toBe("paid");
    expect(result?.reference).toMatch(/^\d{12}$/);
    expect(result?.attempts).toBe(1);
  });

  it("flips status to failed on provider non-success", async () => {
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "u");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "k");
    vi.stubEnv("PAYSWITCH_MERCHANT_ID", "m");
    const [row] = await db
      .insert(sellerPayoutsTable)
      .values({
        saleKind: "service_invoice",
        saleId: fakeSaleId,
        sellerKind: "service_center",
        sellerId: centerId,
        sellerName: "Center",
        grossAmount: 100,
        commissionAmount: 0,
        netAmount: 100,
        account: {
          kind: "bank",
          accountName: "Center A",
          accountNumber: "1234567890",
          bank: "Test Bank",
        },
        status: "pending",
      })
      .returning();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "F03", reason: "bad account" }), { status: 200 }),
    );
    const result = await disburseToSeller(row.id);
    expect(result?.status).toBe("failed");
    expect(result?.lastError).toBe("bad account");
  });

  it("no-ops when payout is already paid", async () => {
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "u");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "k");
    vi.stubEnv("PAYSWITCH_MERCHANT_ID", "m");
    const [row] = await db
      .insert(sellerPayoutsTable)
      .values({
        saleKind: "service_invoice",
        saleId: fakeSaleId,
        sellerKind: "service_center",
        sellerId: centerId,
        sellerName: "Center",
        grossAmount: 100,
        commissionAmount: 0,
        netAmount: 100,
        account: {
          kind: "bank",
          accountName: "Center A",
          accountNumber: "1234567890",
          bank: "Test Bank",
        },
        status: "paid",
      })
      .returning();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await disburseToSeller(row.id);
    expect(result?.status).toBe("paid");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("leaves pending and bumps attempts when disbursement is not configured", async () => {
    vi.stubEnv("PAYSWITCH_DISBURSE_API_USER", "");
    vi.stubEnv("PAYSWITCH_DISBURSE_API_KEY", "");
    const [row] = await db
      .insert(sellerPayoutsTable)
      .values({
        saleKind: "service_invoice",
        saleId: fakeSaleId,
        sellerKind: "service_center",
        sellerId: centerId,
        sellerName: "Center",
        grossAmount: 100,
        commissionAmount: 0,
        netAmount: 100,
        account: {
          kind: "bank",
          accountName: "Center A",
          accountNumber: "1234567890",
          bank: "Test Bank",
        },
        status: "pending",
      })
      .returning();
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const result = await disburseToSeller(row.id);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result?.status).toBe("pending");
    expect(result?.attempts).toBe(1);
    expect(result?.lastError).toContain("not configured");
  });
});

// ----------------------------- GET payout-account auth -----------------------------

describe("GET payout-account routes", () => {
  it("GET /service-centers/:id/payout-account 403 for non-staff", async () => {
    const res = await request(app)
      .get(`/api/service-centers/${centerId}/payout-account`)
      .set("Cookie", cookieStranger);
    expect(res.status).toBe(403);
  });

  it("GET /service-centers/:id/payout-account 200 for assigned center staff", async () => {
    const res = await request(app)
      .get(`/api/service-centers/${centerId}/payout-account`)
      .set("Cookie", cookieStaff);
    expect(res.status, res.text).toBe(200);
    expect(res.body.payoutAccount?.accountNumber).toBe("1234567890");
  });

  it("GET /service-centers/:id/payout-account 200 for platform admin", async () => {
    const res = await request(app)
      .get(`/api/service-centers/${centerId}/payout-account`)
      .set("Cookie", cookieAdmin);
    expect(res.status).toBe(200);
  });

  it("GET /vendors/:id/payout-account 403 for non-staff", async () => {
    const res = await request(app)
      .get(`/api/vendors/${vendorId}/payout-account`)
      .set("Cookie", cookieStranger);
    expect(res.status).toBe(403);
  });

  it("GET /vendors/:id/payout-account 200 for assigned vendor staff", async () => {
    const res = await request(app)
      .get(`/api/vendors/${vendorId}/payout-account`)
      .set("Cookie", cookieVendorStaff);
    expect(res.status, res.text).toBe(200);
  });

  it("GET /me/payout-account 401 without auth", async () => {
    const res = await request(app).get(`/api/me/payout-account`);
    expect(res.status).toBe(401);
  });
});
