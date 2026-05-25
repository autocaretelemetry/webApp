import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  vehiclesTable,
  serviceCentersTable,
  vendorsTable,
  partsTable,
  organizationsTable,
  organizationMembersTable,
  bookingsTable,
  invoicesTable,
  ordersTable,
  orderItemsTable,
  centerStaffTable,
  subscriptionPlansTable,
  subscriptionsTable,
  paymentTransactionsTable,
  rentalCarsTable,
  rentalBookingsTable,
  sellerPayoutsTable,
  commissionLedgerTable,
} from "@workspace/db";

// IMPORTANT: mock the PaySwitch HTTP client BEFORE importing the app/router.
vi.mock("../lib/payswitch", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/payswitch")>("../lib/payswitch");
  return {
    ...actual,
    payswitchConfigured: () => true,
    initiateCheckout: vi.fn(),
    checkTransactionStatus: vi.fn(),
  };
});

import app from "../app";
import { hashPassword } from "../lib/auth";
import * as ps from "../lib/payswitch";

const initiateCheckoutMock = ps.initiateCheckout as unknown as Mock;
const checkTransactionStatusMock = ps.checkTransactionStatus as unknown as Mock;

const TAG = "task93-ps";
const OWNER_EMAIL = `${TAG}-owner@autocare.test`;
const STRANGER_EMAIL = `${TAG}-stranger@autocare.test`;
const CENTER_STAFF_EMAIL = `${TAG}-center@autocare.test`;
const RENTER_EMAIL = `${TAG}-renter@autocare.test`;
const ADMIN_EMAIL = `${TAG}-admin@autocare.test`;
const ORG_ADMIN_EMAIL = `${TAG}-orgadmin@autocare.test`;
const ORG_FINANCE_EMAIL = `${TAG}-orgfin@autocare.test`;
const ORG_DRIVER_EMAIL = `${TAG}-orgdrv@autocare.test`;
const OWNER_PHONE = "+99900093001";
const STRANGER_PHONE = "+99900093002";
const CENTER_STAFF_PHONE = "+99900093003";
const RENTER_PHONE = "+99900093004";
const ADMIN_PHONE = "+99900093005";
const ORG_ADMIN_PHONE = "+99900093006";
const ORG_FINANCE_PHONE = "+99900093007";
const ORG_DRIVER_PHONE = "+99900093008";
const CENTER_PHONE = "+99900093010";
const VENDOR_PHONE = "+99900093011";
const PASSWORD = "test-password-1234";

async function seedUser(opts: {
  email: string;
  phone: string;
  role: "owner" | "center" | "renter" | "admin";
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

let ownerId: string;
let strangerId: string;
let centerStaffId: string;
let renterId: string;
let adminId: string;
let orgAdminId: string;
let orgFinanceId: string;
let orgDriverId: string;
let orgId: string;
let orgPlanId: string;
let centerId: string;
let vendorId: string;
let vehicleId: string;
let bookingId: string;
let invoiceId: string;
let invoiceNotApprovedId: string;
let orderProposedId: string;
let orderPlacedId: string;
let partId: string;
let planId: string;
let rentalCarId: string;
let rentalBookingId: string;
let rentalBookingPaidId: string;
let cookieOwner: string;
let cookieStranger: string;
let cookieCenterStaff: string;
let cookieRenter: string;
let cookieAdmin: string;
let cookieOrgAdmin: string;
let cookieOrgFinance: string;
let cookieOrgDriver: string;

async function cleanup() {
  const emails = [
    OWNER_EMAIL,
    STRANGER_EMAIL,
    CENTER_STAFF_EMAIL,
    RENTER_EMAIL,
    ADMIN_EMAIL,
    ORG_ADMIN_EMAIL,
    ORG_FINANCE_EMAIL,
    ORG_DRIVER_EMAIL,
  ];
  // Organizations seeded for this test (org members cascade via FK).
  const orgs = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(eq(organizationsTable.slug, `${TAG}-org`));
  if (orgs.length) {
    const orgIds = orgs.map((o) => o.id);
    await db
      .delete(subscriptionsTable)
      .where(inArray(subscriptionsTable.subscriberId, orgIds));
    await db.delete(organizationsTable).where(inArray(organizationsTable.id, orgIds));
  }
  await db
    .delete(subscriptionPlansTable)
    .where(inArray(subscriptionPlansTable.name, [`${TAG} Owner Plan`, `${TAG} Org Plan`]));
  // Cascade-ish: payments + payouts + commissions referencing our test ids.
  await db
    .delete(paymentTransactionsTable)
    .where(inArray(paymentTransactionsTable.email, emails));
  // Sale rows: rental bookings -> rental cars; orders+items; invoices; bookings;
  // vehicles; subscriptions; plans; centers; vendors; parts.
  const cars = await db
    .select({ id: rentalCarsTable.id })
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.ownerPhone, OWNER_PHONE));
  const carIds = cars.map((c) => c.id);
  if (carIds.length) {
    const rbs = await db
      .select({ id: rentalBookingsTable.id })
      .from(rentalBookingsTable)
      .where(inArray(rentalBookingsTable.carId, carIds));
    const rbIds = rbs.map((r) => r.id);
    if (rbIds.length) {
      await db
        .delete(sellerPayoutsTable)
        .where(inArray(sellerPayoutsTable.saleId, rbIds));
      await db
        .delete(commissionLedgerTable)
        .where(inArray(commissionLedgerTable.saleId, rbIds));
      await db.delete(rentalBookingsTable).where(inArray(rentalBookingsTable.id, rbIds));
    }
    await db.delete(rentalCarsTable).where(inArray(rentalCarsTable.id, carIds));
  }
  const vehicles = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(eq(vehiclesTable.ownerPhone, OWNER_PHONE));
  const vIds = vehicles.map((v) => v.id);
  if (vIds.length) {
    const bks = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(inArray(bookingsTable.vehicleId, vIds));
    const bIds = bks.map((b) => b.id);
    if (bIds.length) {
      const invs = await db
        .select({ id: invoicesTable.id })
        .from(invoicesTable)
        .where(inArray(invoicesTable.bookingId, bIds));
      const invIds = invs.map((i) => i.id);
      if (invIds.length) {
        await db
          .delete(sellerPayoutsTable)
          .where(inArray(sellerPayoutsTable.saleId, invIds));
        await db
          .delete(commissionLedgerTable)
          .where(inArray(commissionLedgerTable.saleId, invIds));
        await db.delete(invoicesTable).where(inArray(invoicesTable.id, invIds));
      }
      const orders = await db
        .select({ id: ordersTable.id })
        .from(ordersTable)
        .where(inArray(ordersTable.bookingId, bIds));
      const oIds = orders.map((o) => o.id);
      if (oIds.length) {
        await db.delete(orderItemsTable).where(inArray(orderItemsTable.orderId, oIds));
        await db.delete(ordersTable).where(inArray(ordersTable.id, oIds));
      }
      await db.delete(bookingsTable).where(inArray(bookingsTable.id, bIds));
    }
    await db.delete(vehiclesTable).where(inArray(vehiclesTable.id, vIds));
  }
  const centers = await db
    .select({ id: serviceCentersTable.id })
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.phone, CENTER_PHONE));
  const cIds = centers.map((c) => c.id);
  if (cIds.length) {
    await db.delete(centerStaffTable).where(inArray(centerStaffTable.centerId, cIds));
    await db.delete(serviceCentersTable).where(inArray(serviceCentersTable.id, cIds));
  }
  const vendors = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.phone, VENDOR_PHONE));
  const venIds = vendors.map((v) => v.id);
  if (venIds.length) {
    await db.delete(partsTable).where(inArray(partsTable.vendorId, venIds));
    await db.delete(vendorsTable).where(inArray(vendorsTable.id, venIds));
  }
  // Subscriptions tied to our phone/centerId (centerId already deleted above
  // via cascade where applicable). Owner-subscription by phone:
  await db
    .delete(subscriptionsTable)
    .where(inArray(subscriptionsTable.subscriberId, [OWNER_PHONE]));
  await db
    .delete(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.name, `${TAG} Owner Plan`));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
}

beforeAll(async () => {
  await cleanup();

  ownerId = await seedUser({ email: OWNER_EMAIL, phone: OWNER_PHONE, role: "owner", name: "Owner" });
  strangerId = await seedUser({
    email: STRANGER_EMAIL,
    phone: STRANGER_PHONE,
    role: "owner",
    name: "Stranger",
  });
  centerStaffId = await seedUser({
    email: CENTER_STAFF_EMAIL,
    phone: CENTER_STAFF_PHONE,
    role: "center",
    name: "Center Staff",
  });
  renterId = await seedUser({
    email: RENTER_EMAIL,
    phone: RENTER_PHONE,
    role: "renter",
    name: "Renter",
  });
  adminId = await seedUser({ email: ADMIN_EMAIL, phone: ADMIN_PHONE, role: "admin", name: "Admin" });
  // Org membership is keyed by phone, not by user.role, so any base role is fine.
  orgAdminId = await seedUser({
    email: ORG_ADMIN_EMAIL,
    phone: ORG_ADMIN_PHONE,
    role: "owner",
    name: "Org Admin",
  });
  orgFinanceId = await seedUser({
    email: ORG_FINANCE_EMAIL,
    phone: ORG_FINANCE_PHONE,
    role: "owner",
    name: "Org Finance",
  });
  orgDriverId = await seedUser({
    email: ORG_DRIVER_EMAIL,
    phone: ORG_DRIVER_PHONE,
    role: "owner",
    name: "Org Driver",
  });
  void ownerId;
  void strangerId;
  void renterId;
  void adminId;
  void orgAdminId;
  void orgFinanceId;
  void orgDriverId;

  const [org] = await db
    .insert(organizationsTable)
    .values({
      name: `${TAG} Org`,
      slug: `${TAG}-org`,
      contactName: "Org Admin",
      contactPhone: ORG_ADMIN_PHONE,
    })
    .returning();
  orgId = org!.id;
  await db.insert(organizationMembersTable).values([
    { organizationId: orgId, phone: ORG_ADMIN_PHONE, name: "Org Admin", role: "admin" },
    { organizationId: orgId, phone: ORG_FINANCE_PHONE, name: "Org Finance", role: "finance" },
    { organizationId: orgId, phone: ORG_DRIVER_PHONE, name: "Org Driver", role: "driver" },
  ]);

  const [orgPlan] = await db
    .insert(subscriptionPlansTable)
    .values({
      name: `${TAG} Org Plan`,
      audience: "organization",
      priceMonthly: 250,
      features: [],
      active: true,
    })
    .returning();
  orgPlanId = orgPlan!.id;

  const [center] = await db
    .insert(serviceCentersTable)
    .values({ name: `${TAG} Center`, address: "1 Test Ave", phone: CENTER_PHONE })
    .returning();
  centerId = center!.id;

  await db.insert(centerStaffTable).values({
    centerId,
    userId: centerStaffId,
    name: "Center Staff",
    email: CENTER_STAFF_EMAIL.toLowerCase(),
    role: "manager",
    active: true,
  });

  const [vendor] = await db
    .insert(vendorsTable)
    .values({ name: `${TAG} Vendor`, address: "x", phone: VENDOR_PHONE })
    .returning();
  vendorId = vendor!.id;

  const [part] = await db
    .insert(partsTable)
    .values({
      vendorId,
      name: "Test Brake Pad",
      description: "x",
      category: "brakes",
      brand: "B",
      sku: `${TAG}-SKU-1`,
      price: 50,
      stock: 100,
    })
    .returning();
  partId = part!.id;

  const [veh] = await db
    .insert(vehiclesTable)
    .values({
      ownerName: "Owner",
      ownerPhone: OWNER_PHONE,
      brand: "B",
      model: "M",
      year: 2022,
      color: "Red",
      plateNumber: `${TAG}-V1`,
      mileage: 1000,
    })
    .returning();
  vehicleId = veh!.id;

  const [bk] = await db
    .insert(bookingsTable)
    .values({
      vehicleId,
      serviceCenterId: centerId,
      serviceType: "oil_change",
      description: "x",
      status: "in_progress",
    })
    .returning();
  bookingId = bk!.id;

  const [inv] = await db
    .insert(invoicesTable)
    .values({
      bookingId,
      items: [{ kind: "labor", description: "labor", quantity: 1, unitPrice: 50 }],
      laborTotal: 50,
      partsTotal: 0,
      tax: 0,
      total: 50,
      status: "approved",
    })
    .returning();
  invoiceId = inv!.id;

  const [inv2] = await db
    .insert(invoicesTable)
    .values({
      bookingId,
      items: [{ kind: "labor", description: "labor", quantity: 1, unitPrice: 25 }],
      laborTotal: 25,
      partsTotal: 0,
      tax: 0,
      total: 25,
      status: "pending_approval",
    })
    .returning();
  invoiceNotApprovedId = inv2!.id;

  const [propOrder] = await db
    .insert(ordersTable)
    .values({
      vendorId,
      bookingId,
      buyerKind: "owner",
      buyerName: "Owner",
      buyerPhone: OWNER_PHONE,
      shippingAddress: "1 Owner St",
      status: "proposed",
      itemsTotal: 50,
      shippingFee: 0,
      total: 50,
      paymentStatus: "unpaid",
    })
    .returning();
  orderProposedId = propOrder!.id;
  await db.insert(orderItemsTable).values({
    orderId: orderProposedId,
    partId,
    snapshot: { partId, name: "Test Brake Pad", sku: `${TAG}-SKU-1`, unitPrice: 50, quantity: 1, imageUrl: null },
    quantity: 1,
    unitPrice: 50,
    lineTotal: 50,
  });

  const [placedOrder] = await db
    .insert(ordersTable)
    .values({
      vendorId,
      bookingId,
      buyerKind: "owner",
      buyerName: "Owner",
      buyerPhone: OWNER_PHONE,
      shippingAddress: "1 Owner St",
      status: "placed",
      itemsTotal: 50,
      shippingFee: 0,
      total: 50,
      paymentStatus: "unpaid",
      centerPayAuthorized: true,
    })
    .returning();
  orderPlacedId = placedOrder!.id;

  const [plan] = await db
    .insert(subscriptionPlansTable)
    .values({
      name: `${TAG} Owner Plan`,
      audience: "owner",
      priceMonthly: 100,
      features: [],
      active: true,
    })
    .returning();
  planId = plan!.id;

  const [car] = await db
    .insert(rentalCarsTable)
    .values({
      ownerKind: "individual",
      ownerName: "Owner",
      ownerPhone: OWNER_PHONE,
      brand: "B",
      model: "M",
      year: 2023,
      color: "Blue",
      plateNumber: `${TAG}-RC`,
      transmission: "automatic",
      dailyRate: 100,
      city: "Accra",
      pickupAddress: "1 Pickup",
      rentalModes: ["self_drive"],
      status: "approved",
    })
    .returning();
  rentalCarId = car!.id;

  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000);
  const [rb] = await db
    .insert(rentalBookingsTable)
    .values({
      carId: rentalCarId,
      renterName: "Renter",
      renterPhone: RENTER_PHONE,
      startDate,
      endDate,
      days: 1,
      dailyRate: 100,
      total: 100,
      status: "awaiting_payment",
      paymentStatus: "unpaid",
    })
    .returning();
  rentalBookingId = rb!.id;

  const [rbPaid] = await db
    .insert(rentalBookingsTable)
    .values({
      carId: rentalCarId,
      renterName: "Renter",
      renterPhone: RENTER_PHONE,
      startDate,
      endDate,
      days: 1,
      dailyRate: 100,
      total: 100,
      status: "confirmed",
      paymentStatus: "paid",
    })
    .returning();
  rentalBookingPaidId = rbPaid!.id;

  cookieOwner = await loginCookie(OWNER_EMAIL);
  cookieStranger = await loginCookie(STRANGER_EMAIL);
  cookieCenterStaff = await loginCookie(CENTER_STAFF_EMAIL);
  cookieRenter = await loginCookie(RENTER_EMAIL);
  cookieAdmin = await loginCookie(ADMIN_EMAIL);
  cookieOrgAdmin = await loginCookie(ORG_ADMIN_EMAIL);
  cookieOrgFinance = await loginCookie(ORG_FINANCE_EMAIL);
  cookieOrgDriver = await loginCookie(ORG_DRIVER_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

beforeEach(() => {
  initiateCheckoutMock.mockReset();
  checkTransactionStatusMock.mockReset();
  initiateCheckoutMock.mockResolvedValue({
    ok: true,
    checkoutUrl: "https://provider.example/checkout/abc",
    raw: {},
  });
});

afterEach(async () => {
  // Drop any payment_transactions rows created during the test so subsequent
  // tests start clean. Done by purpose+purposeRef belonging to our seeded sales.
  const refs = [
    invoiceId,
    invoiceNotApprovedId,
    orderProposedId,
    orderPlacedId,
    rentalBookingId,
    rentalBookingPaidId,
  ];
  await db
    .delete(paymentTransactionsTable)
    .where(inArray(paymentTransactionsTable.purposeRef, refs));
  // Subscription created in tests: clean up by owner phone subscriberId.
  await db
    .delete(subscriptionsTable)
    .where(eq(subscriptionsTable.subscriberId, OWNER_PHONE));
  // Reset sale-state side effects so the next test sees fresh data.
  await db
    .update(invoicesTable)
    .set({ status: "approved", paidAt: null, paymentMethod: null })
    .where(eq(invoicesTable.id, invoiceId));
  await db
    .update(bookingsTable)
    .set({ status: "in_progress", completedAt: null })
    .where(eq(bookingsTable.id, bookingId));
  await db
    .update(rentalBookingsTable)
    .set({
      status: "awaiting_payment",
      paymentStatus: "unpaid",
      paymentMethod: null,
      paidAt: null,
      confirmedAt: null,
    })
    .where(eq(rentalBookingsTable.id, rentalBookingId));
  await db
    .delete(sellerPayoutsTable)
    .where(inArray(sellerPayoutsTable.saleId, refs));
  await db
    .delete(commissionLedgerTable)
    .where(inArray(commissionLedgerTable.saleId, refs));
});

// ----------------------------- INIT ENDPOINTS -----------------------------

describe("POST /payments/payswitch/subscriptions (init)", () => {
  it("401 without auth", async () => {
    const res = await request(app).post("/api/payments/payswitch/subscriptions").send({
      planId,
      subscriberKind: "owner",
      subscriberId: OWNER_PHONE,
    });
    expect(res.status).toBe(401);
  });

  it("403 when subscribing for someone else's owner phone", async () => {
    const res = await request(app)
      .post("/api/payments/payswitch/subscriptions")
      .set("Cookie", cookieStranger)
      .send({ planId, subscriberKind: "owner", subscriberId: OWNER_PHONE });
    expect(res.status).toBe(403);
  });

  it("201 + pending payment_transactions row + checkout URL for own subscription", async () => {
    const res = await request(app)
      .post("/api/payments/payswitch/subscriptions")
      .set("Cookie", cookieOwner)
      .send({ planId, subscriberKind: "owner", subscriberId: OWNER_PHONE });
    expect(res.status, res.text).toBe(201);
    expect(res.body.checkoutUrl).toBe("https://provider.example/checkout/abc");
    expect(res.body.transactionId).toMatch(/^\d{12}$/);
    expect(res.body.subscriptionId).toBeDefined();
    const [txn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.transactionId, res.body.transactionId));
    expect(txn.status).toBe("pending");
    expect(txn.purpose).toBe("subscription");
    expect(txn.amount).toBe(10000); // 100 GHS in pesewas
    expect(txn.successRedirect).toContain("status=success");
    expect(txn.successRedirect).toContain("purpose=subscription");
    expect(txn.failureRedirect).toContain("status=failed");
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, res.body.subscriptionId));
    expect(sub.status).toBe("pending_payment");
  });

  it("201 when an org admin subscribes for their organization", async () => {
    const res = await request(app)
      .post("/api/payments/payswitch/subscriptions")
      .set("Cookie", cookieOrgAdmin)
      .send({ planId: orgPlanId, subscriberKind: "organization", subscriberId: orgId });
    expect(res.status, res.text).toBe(201);
    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, res.body.subscriptionId));
    expect(sub.subscriberKind).toBe("organization");
    expect(sub.subscriberId).toBe(orgId);
    expect(sub.status).toBe("pending_payment");
  });

  it("201 when an org finance member subscribes for their organization", async () => {
    const res = await request(app)
      .post("/api/payments/payswitch/subscriptions")
      .set("Cookie", cookieOrgFinance)
      .send({ planId: orgPlanId, subscriberKind: "organization", subscriberId: orgId });
    expect(res.status, res.text).toBe(201);
  });

  it("403 when a non-privileged org member (driver) tries to subscribe", async () => {
    const res = await request(app)
      .post("/api/payments/payswitch/subscriptions")
      .set("Cookie", cookieOrgDriver)
      .send({ planId: orgPlanId, subscriberKind: "organization", subscriberId: orgId });
    expect(res.status).toBe(403);
  });

  it("403 when a non-member tries to subscribe for the organization", async () => {
    const res = await request(app)
      .post("/api/payments/payswitch/subscriptions")
      .set("Cookie", cookieStranger)
      .send({ planId: orgPlanId, subscriberKind: "organization", subscriberId: orgId });
    expect(res.status).toBe(403);
  });
});

describe("POST /payments/payswitch/service-invoices/:invoiceId (init)", () => {
  it("404 for unknown invoice", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/service-invoices/00000000-0000-0000-0000-000000000000`)
      .set("Cookie", cookieOwner);
    expect(res.status).toBe(404);
  });

  it("409 when invoice is not approved", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/service-invoices/${invoiceNotApprovedId}`)
      .set("Cookie", cookieOwner);
    expect(res.status).toBe(409);
  });

  it("403 when caller is not the vehicle owner", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/service-invoices/${invoiceId}`)
      .set("Cookie", cookieStranger);
    expect(res.status).toBe(403);
  });

  it("201 + pending row for vehicle owner", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/service-invoices/${invoiceId}`)
      .set("Cookie", cookieOwner);
    expect(res.status, res.text).toBe(201);
    const [txn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.transactionId, res.body.transactionId));
    expect(txn.purpose).toBe("service_invoice");
    expect(txn.purposeRef).toBe(invoiceId);
    expect(txn.amount).toBe(5000);
    expect(txn.status).toBe("pending");
  });

  it("201 for platform admin even without phone match", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/service-invoices/${invoiceId}`)
      .set("Cookie", cookieAdmin);
    expect(res.status, res.text).toBe(201);
  });
});

describe("POST /payments/payswitch/parts-orders/:id/approve-and-pay (init)", () => {
  it("403 when caller is not the vehicle owner", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/parts-orders/${orderProposedId}/approve-and-pay`)
      .set("Cookie", cookieStranger);
    expect(res.status).toBe(403);
  });

  it("409 when order is not in proposed state", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/parts-orders/${orderPlacedId}/approve-and-pay`)
      .set("Cookie", cookieOwner);
    expect(res.status).toBe(409);
  });

  it("201 + pending row for vehicle owner", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/parts-orders/${orderProposedId}/approve-and-pay`)
      .set("Cookie", cookieOwner);
    expect(res.status, res.text).toBe(201);
    const [txn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.transactionId, res.body.transactionId));
    expect(txn.purpose).toBe("parts_order_approve");
    expect(txn.purposeRef).toBe(orderProposedId);
  });
});

describe("POST /payments/payswitch/parts-orders/:id/center-pay (init)", () => {
  it("403 when caller is not center staff for the booking's center", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/parts-orders/${orderPlacedId}/center-pay`)
      .set("Cookie", cookieOwner);
    expect(res.status).toBe(403);
  });

  it("409 when order isn't ready for center settlement", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/parts-orders/${orderProposedId}/center-pay`)
      .set("Cookie", cookieCenterStaff);
    expect(res.status).toBe(409);
  });

  it("201 + pending row for center staff on an authorized order", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/parts-orders/${orderPlacedId}/center-pay`)
      .set("Cookie", cookieCenterStaff);
    expect(res.status, res.text).toBe(201);
    const [txn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.transactionId, res.body.transactionId));
    expect(txn.purpose).toBe("parts_order_center_pay");
    expect(txn.purposeRef).toBe(orderPlacedId);
  });
});

describe("POST /payments/payswitch/rental-bookings/:id (init)", () => {
  it("403 when caller is not the renter", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/rental-bookings/${rentalBookingId}`)
      .set("Cookie", cookieStranger);
    expect(res.status).toBe(403);
  });

  it("409 when booking is already paid", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/rental-bookings/${rentalBookingPaidId}`)
      .set("Cookie", cookieRenter);
    expect(res.status).toBe(409);
  });

  it("201 + pending row for the renter", async () => {
    const res = await request(app)
      .post(`/api/payments/payswitch/rental-bookings/${rentalBookingId}`)
      .set("Cookie", cookieRenter);
    expect(res.status, res.text).toBe(201);
    const [txn] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.transactionId, res.body.transactionId));
    expect(txn.purpose).toBe("rental_booking");
    expect(txn.purposeRef).toBe(rentalBookingId);
    expect(txn.amount).toBe(10000);
  });
});

// ----------------------------- CALLBACK DISPATCHER -----------------------------

async function seedPendingTxn(opts: {
  purpose: string;
  purposeRef: string | null;
  amountPesewas: number;
}) {
  const txnId = `${Date.now()}`.slice(-12).padStart(12, "0");
  const [row] = await db
    .insert(paymentTransactionsTable)
    .values({
      provider: "payswitch",
      transactionId: txnId,
      purpose: opts.purpose,
      purposeRef: opts.purposeRef,
      amount: opts.amountPesewas,
      email: OWNER_EMAIL,
      phone: OWNER_PHONE,
      description: "test",
      status: "pending",
      successRedirect: "/billing/result?status=success",
      failureRedirect: "/billing/result?status=failed",
      initiatedByUserId: ownerId,
    })
    .returning();
  return row;
}

describe("GET /payments/payswitch/callback", () => {
  it("redirects to missing_transaction when ?txn is absent", async () => {
    const res = await request(app).get("/api/payments/payswitch/callback");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("missing_transaction");
  });

  it("redirects to unknown_transaction for an unknown txn id", async () => {
    const res = await request(app).get("/api/payments/payswitch/callback?txn=999999999999");
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("unknown_transaction");
  });

  it("short-circuits to successRedirect when txn is already successful", async () => {
    const txn = await seedPendingTxn({
      purpose: "service_invoice",
      purposeRef: invoiceId,
      amountPesewas: 5000,
    });
    await db
      .update(paymentTransactionsTable)
      .set({ status: "successful" })
      .where(eq(paymentTransactionsTable.id, txn.id));
    const res = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(txn.successRedirect);
    expect(checkTransactionStatusMock).not.toHaveBeenCalled();
  });

  it("verified success: closes the invoice, flips the txn to successful, redirects success", async () => {
    const txn = await seedPendingTxn({
      purpose: "service_invoice",
      purposeRef: invoiceId,
      amountPesewas: 5000,
    });
    checkTransactionStatusMock.mockResolvedValue({
      ok: true,
      reachable: true,
      code: "000",
      status: "approved",
      reason: "ok",
      amountPesewas: 5000,
      raw: {},
    });
    const res = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(txn.successRedirect);
    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txn.id));
    expect(after.status).toBe("successful");
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(inv.status).toBe("paid");
    expect(inv.paymentMethod).toBe("online");
    const [bk] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, bookingId));
    expect(bk.status).toBe("completed");
  });

  it("verified terminal failure: marks txn failed and rolls back the subscription", async () => {
    // Seed a pending_payment subscription + a pending txn for it.
    const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        subscriberKind: "owner",
        subscriberId: OWNER_PHONE,
        subscriberName: "Owner",
        planId,
        status: "pending_payment",
        currentPeriodEnd: periodEnd,
      })
      .returning();
    const txn = await seedPendingTxn({
      purpose: "subscription",
      purposeRef: sub.id,
      amountPesewas: 10000,
    });
    checkTransactionStatusMock.mockResolvedValue({
      ok: false,
      reachable: true,
      code: "101",
      status: "declined",
      reason: "insufficient funds",
      amountPesewas: 10000,
      raw: {},
    });
    const res = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(txn.failureRedirect);
    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txn.id));
    expect(after.status).toBe("failed");
    const [subAfter] = await db
      .select()
      .from(subscriptionsTable)
      .where(eq(subscriptionsTable.id, sub.id));
    expect(subAfter.status).toBe("cancelled");
  });

  it("amount mismatch: refuses to settle, marks failed", async () => {
    const txn = await seedPendingTxn({
      purpose: "service_invoice",
      purposeRef: invoiceId,
      amountPesewas: 5000,
    });
    checkTransactionStatusMock.mockResolvedValue({
      ok: true,
      reachable: true,
      code: "000",
      status: "approved",
      reason: "ok",
      amountPesewas: 1, // off by a lot
      raw: {},
    });
    const res = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(txn.failureRedirect);
    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txn.id));
    expect(after.status).toBe("failed");
    expect(after.providerReason).toContain("amount_mismatch");
    const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
    expect(inv.status).toBe("approved"); // not closed
  });

  it("duplicate callback short-circuits after first settlement (no second handler run)", async () => {
    const txn = await seedPendingTxn({
      purpose: "service_invoice",
      purposeRef: invoiceId,
      amountPesewas: 5000,
    });
    checkTransactionStatusMock.mockResolvedValue({
      ok: true,
      reachable: true,
      code: "000",
      status: "approved",
      reason: "ok",
      amountPesewas: 5000,
      raw: {},
    });
    await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(checkTransactionStatusMock).toHaveBeenCalledTimes(1);
    // Second call should detect status='successful' and skip verification.
    const res2 = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res2.status).toBe(302);
    expect(res2.headers.location).toBe(txn.successRedirect);
    expect(checkTransactionStatusMock).toHaveBeenCalledTimes(1);
  });

  it("handler failure: leaves txn pending and redirects with settlement_failed", async () => {
    // The order is already in 'placed' state, so approveProposalAndReserveStock
    // throws HttpError(409). The callback's try/catch must redirect to failed
    // without flipping the txn out of 'pending'.
    const txn = await seedPendingTxn({
      purpose: "parts_order_approve",
      purposeRef: orderPlacedId,
      amountPesewas: 5000,
    });
    checkTransactionStatusMock.mockResolvedValue({
      ok: true,
      reachable: true,
      code: "000",
      status: "approved",
      reason: "ok",
      amountPesewas: 5000,
      raw: {},
    });
    const res = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("status=failed");
    expect(res.headers.location).toContain("reason=settlement_failed");
    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txn.id));
    expect(after.status).toBe("pending");
  });

  it("non-terminal provider status leaves txn pending and redirects pending", async () => {
    const txn = await seedPendingTxn({
      purpose: "service_invoice",
      purposeRef: invoiceId,
      amountPesewas: 5000,
    });
    checkTransactionStatusMock.mockResolvedValue({
      ok: false,
      reachable: true,
      code: "",
      status: "pending",
      reason: "in progress",
      amountPesewas: 5000,
      raw: {},
    });
    const res = await request(app).get(`/api/payments/payswitch/callback?txn=${txn.transactionId}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain("status=pending");
    const [after] = await db
      .select()
      .from(paymentTransactionsTable)
      .where(eq(paymentTransactionsTable.id, txn.id));
    expect(after.status).toBe("pending");
  });
});

