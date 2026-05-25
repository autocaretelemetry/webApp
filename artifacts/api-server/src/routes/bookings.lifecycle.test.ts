import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  vehiclesTable,
  serviceCentersTable,
  mechanicsTable,
  bookingsTable,
  bookingEventsTable,
  invoicesTable,
  centerStaffTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task47-life";
const OWNER_EMAIL = `${TAG}-owner@autocare.test`;
const CENTER_EMAIL = `${TAG}-center@autocare.test`;
const OWNER_PHONE = `+99900070001`;
const CENTER_PHONE = `+99900080001`;
const PLATE = `${TAG}-VHX`;
const PASSWORD = "test-password-1234";
const START_MILEAGE = 42_000;

let ownerCookie: string;
let centerCookie: string;
let vehicleId: string;
let serviceCenterId: string;
let mechanicId: string;

async function loginCookie(email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  expect(res.status, `login ${email} failed: ${res.text}`).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  return arr
    .filter(Boolean)
    .map((c: string) => c.split(";")[0])
    .join("; ");
}

async function cleanup() {
  const emails = [OWNER_EMAIL, CENTER_EMAIL];
  const vehIds = (
    await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.ownerPhone, OWNER_PHONE))
  ).map((r) => r.id);
  if (vehIds.length > 0) {
    const bRows = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(inArray(bookingsTable.vehicleId, vehIds));
    const bIds = bRows.map((r) => r.id);
    if (bIds.length > 0) {
      await db
        .update(bookingsTable)
        .set({ invoiceId: null })
        .where(inArray(bookingsTable.id, bIds));
      await db.delete(invoicesTable).where(inArray(invoicesTable.bookingId, bIds));
      await db
        .delete(bookingEventsTable)
        .where(inArray(bookingEventsTable.bookingId, bIds));
      await db.delete(bookingsTable).where(inArray(bookingsTable.id, bIds));
    }
    await db.delete(vehiclesTable).where(inArray(vehiclesTable.id, vehIds));
  }
  const centerIds = (
    await db
      .select({ id: serviceCentersTable.id })
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.phone, CENTER_PHONE))
  ).map((r) => r.id);
  if (centerIds.length > 0) {
    await db
      .delete(mechanicsTable)
      .where(inArray(mechanicsTable.serviceCenterId, centerIds));
    await db
      .delete(centerStaffTable)
      .where(inArray(centerStaffTable.centerId, centerIds));
    await db
      .delete(serviceCentersTable)
      .where(inArray(serviceCentersTable.id, centerIds));
  }
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
}

beforeAll(async () => {
  await cleanup();

  await db.insert(usersTable).values({
    email: OWNER_EMAIL.toLowerCase(),
    passwordHash: hashPassword(PASSWORD),
    name: "Lifecycle Owner",
    role: "owner",
    phone: OWNER_PHONE,
    active: true,
    approvalStatus: "approved",
    kycStatus: "verified",
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
  });
  const [centerUser] = await db
    .insert(usersTable)
    .values({
      email: CENTER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "Lifecycle Center Staff",
      role: "center",
      phone: CENTER_PHONE,
      active: true,
      approvalStatus: "approved",
      kycStatus: "verified",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    })
    .returning({ id: usersTable.id });

  const [vehicle] = await db
    .insert(vehiclesTable)
    .values({
      ownerName: "Lifecycle Owner",
      ownerPhone: OWNER_PHONE,
      brand: "TestBrand",
      model: "TestModel",
      year: 2022,
      color: "Red",
      plateNumber: PLATE,
      mileage: START_MILEAGE,
    })
    .returning({ id: vehiclesTable.id });
  vehicleId = vehicle!.id;

  const [center] = await db
    .insert(serviceCentersTable)
    .values({
      name: `${TAG} Center`,
      address: "1 Lifecycle Ave",
      phone: CENTER_PHONE,
    })
    .returning({ id: serviceCentersTable.id });
  serviceCenterId = center!.id;

  await db.insert(centerStaffTable).values({
    centerId: serviceCenterId,
    userId: centerUser!.id,
    name: "Lifecycle Center Staff",
    email: CENTER_EMAIL.toLowerCase(),
    role: "manager",
    active: true,
  });

  const [mechanic] = await db
    .insert(mechanicsTable)
    .values({
      serviceCenterId,
      name: "Lifecycle Mechanic",
      specialization: "general",
      yearsExperience: 5,
    })
    .returning({ id: mechanicsTable.id });
  mechanicId = mechanic!.id;

  ownerCookie = await loginCookie(OWNER_EMAIL);
  centerCookie = await loginCookie(CENTER_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

describe("Service booking lifecycle — happy path", () => {
  it("walks request → accept → assign mechanic → in_progress → invoice → approve → pay → completed", async () => {
    // 1. Owner creates a booking.
    const createRes = await request(app)
      .post("/api/bookings")
      .set("Cookie", ownerCookie)
      .send({
        vehicleId,
        serviceCenterId,
        serviceType: "oil_change",
        description: "Routine service",
      });
    expect(createRes.status, createRes.text).toBe(201);
    const bookingId: string = createRes.body.id;
    expect(createRes.body.status).toBe("requested");

    // 2. Center accepts the request.
    const acceptRes = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", centerCookie)
      .send({ status: "accepted" });
    expect(acceptRes.status, acceptRes.text).toBe(200);
    expect(acceptRes.body.status).toBe("accepted");

    // 3. Center cannot start work before assigning a mechanic.
    const tooEarly = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", centerCookie)
      .send({ status: "in_progress" });
    expect(tooEarly.status).toBe(409);

    // 4. Center assigns a mechanic.
    const assignRes = await request(app)
      .post(`/api/bookings/${bookingId}/assign-mechanic`)
      .set("Cookie", centerCookie)
      .send({ mechanicId });
    expect(assignRes.status, assignRes.text).toBe(200);
    expect(assignRes.body.mechanicId).toBe(mechanicId);

    // 5. Now starting work succeeds.
    const startRes = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", centerCookie)
      .send({ status: "in_progress" });
    expect(startRes.status, startRes.text).toBe(200);
    expect(startRes.body.status).toBe("in_progress");

    // 6. Center issues an invoice (transitions booking → awaiting_approval).
    const invoiceRes = await request(app)
      .post(`/api/bookings/${bookingId}/invoice`)
      .set("Cookie", centerCookie)
      .send({
        items: [
          { kind: "labor", description: "Oil change labor", quantity: 1, unitPrice: 60 },
          { kind: "part", description: "Filter", quantity: 1, unitPrice: 20 },
        ],
        taxRate: 0.1,
      });
    expect(invoiceRes.status, invoiceRes.text).toBe(201);
    const invoiceId: string = invoiceRes.body.id;
    expect(invoiceRes.body.status).toBe("pending_approval");
    expect(invoiceRes.body.total).toBeCloseTo(88, 2); // 80 + 10% tax

    const [bookingAfterInvoice] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(bookingAfterInvoice?.status).toBe("awaiting_approval");
    expect(bookingAfterInvoice?.invoiceId).toBe(invoiceId);

    // 7. Center cannot approve the invoice; only the owner can.
    const centerApprove = await request(app)
      .post(`/api/invoices/${invoiceId}/approve`)
      .set("Cookie", centerCookie);
    expect(centerApprove.status).toBe(403);

    // 8. Owner approves the invoice (booking → approved).
    const approveRes = await request(app)
      .post(`/api/invoices/${invoiceId}/approve`)
      .set("Cookie", ownerCookie);
    expect(approveRes.status, approveRes.text).toBe(200);
    expect(approveRes.body.status).toBe("approved");

    const [bookingAfterApprove] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(bookingAfterApprove?.status).toBe("approved");

    // 9. Owner pays the invoice. In production this goes through PaySwitch
    //    (POST /payments/payswitch/service-invoices/:id then async callback);
    //    here we simulate the callback's terminal effect by invoking
    //    closeInvoiceAsPaid directly, which is exactly what the callback
    //    handler does on a successful charge.
    const { closeInvoiceAsPaid } = await import("./invoices");
    const fakeReq = { log: { warn: () => {} } } as unknown as Parameters<typeof closeInvoiceAsPaid>[0];
    const paid = await closeInvoiceAsPaid(
      fakeReq,
      invoiceId,
      "online",
      "Owner",
      "Payment received — job marked complete",
    );
    expect(paid.status).toBe("paid");

    const [finalBooking] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(finalBooking?.status).toBe("completed");
    expect(finalBooking?.completedAt).toBeTruthy();

    const [vehicleRow] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, vehicleId));
    expect(vehicleRow?.lastServicedAt).toBeTruthy();
    expect(vehicleRow?.lastServicedMileage).toBe(START_MILEAGE);
  });
});

describe("Service booking lifecycle — invalid transitions return 409", () => {
  let bookingId: string;

  beforeAll(async () => {
    const [row] = await db
      .insert(bookingsTable)
      .values({
        vehicleId,
        serviceCenterId,
        serviceType: "oil_change",
        description: "Invalid-transition fixture",
        status: "requested",
      })
      .returning({ id: bookingsTable.id });
    bookingId = row!.id;
  });

  it("rejects requested → completed (state-machine skip)", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", centerCookie)
      .send({ status: "completed" });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Cannot transition/i);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    expect(row?.status).toBe("requested");
  });

  it("rejects requested → in_progress (must be accepted first)", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", centerCookie)
      .send({ status: "in_progress" });
    expect(res.status).toBe(409);
  });

  it("rejects requested → approved", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", centerCookie)
      .send({ status: "approved" });
    expect(res.status).toBe(409);
  });

  it("rejects invoice creation when booking is not in_progress", async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/invoice`)
      .set("Cookie", centerCookie)
      .send({
        items: [{ kind: "labor", description: "x", quantity: 1, unitPrice: 1 }],
        taxRate: 0,
      });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/in progress/i);
  });

  it("rejects owner trying to drive status transitions", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingId}/status`)
      .set("Cookie", ownerCookie)
      .send({ status: "accepted" });
    expect(res.status).toBe(403);
  });
});
