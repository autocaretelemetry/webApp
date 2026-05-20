import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  vehiclesTable,
  serviceCentersTable,
  bookingsTable,
  invoicesTable,
  centerStaffTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task41-iso";
const OWNER_A_EMAIL = `${TAG}-owner-a@autocare.test`;
const OWNER_B_EMAIL = `${TAG}-owner-b@autocare.test`;
const CENTER_A_EMAIL = `${TAG}-center-a@autocare.test`;
const CENTER_B_EMAIL = `${TAG}-center-b@autocare.test`;
const OWNER_A_PHONE = `+99900030001`;
const OWNER_B_PHONE = `+99900030002`;
const CENTER_A_PHONE = `+99900040001`;
const CENTER_B_PHONE = `+99900040002`;
const PASSWORD = "test-password-1234";

async function seedUser(opts: {
  email: string;
  phone: string;
  role: "owner" | "center";
  name: string;
}): Promise<string> {
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

async function seedVehicle(opts: {
  ownerName: string;
  ownerPhone: string;
  plate: string;
}): Promise<string> {
  const [row] = await db
    .insert(vehiclesTable)
    .values({
      ownerName: opts.ownerName,
      ownerPhone: opts.ownerPhone,
      brand: "TestBrand",
      model: "TestModel",
      year: 2022,
      color: "Black",
      plateNumber: opts.plate,
      mileage: 1000,
    })
    .returning({ id: vehiclesTable.id });
  return row!.id;
}

async function seedCenter(opts: { name: string; phone: string }): Promise<string> {
  const [row] = await db
    .insert(serviceCentersTable)
    .values({
      name: opts.name,
      address: "1 Test Ave",
      phone: opts.phone,
    })
    .returning({ id: serviceCentersTable.id });
  return row!.id;
}

async function seedStaff(opts: {
  centerId: string;
  userId: string;
  email: string;
  name: string;
}): Promise<void> {
  await db.insert(centerStaffTable).values({
    centerId: opts.centerId,
    userId: opts.userId,
    name: opts.name,
    email: opts.email.toLowerCase(),
    role: "manager",
    active: true,
  });
}

async function seedBooking(opts: {
  vehicleId: string;
  serviceCenterId: string;
  status?:
    | "requested"
    | "accepted"
    | "in_progress"
    | "awaiting_approval"
    | "approved"
    | "completed"
    | "cancelled";
}): Promise<string> {
  const [row] = await db
    .insert(bookingsTable)
    .values({
      vehicleId: opts.vehicleId,
      serviceCenterId: opts.serviceCenterId,
      serviceType: "oil_change",
      description: "Routine service",
      status: opts.status ?? "requested",
    })
    .returning({ id: bookingsTable.id });
  return row!.id;
}

async function seedInvoice(opts: { bookingId: string }): Promise<string> {
  const [row] = await db
    .insert(invoicesTable)
    .values({
      bookingId: opts.bookingId,
      items: [{ kind: "labor", description: "Oil change", quantity: 1, unitPrice: 50 }],
      laborTotal: 50,
      partsTotal: 0,
      tax: 0,
      total: 50,
      status: "pending_approval",
    })
    .returning({ id: invoicesTable.id });
  return row!.id;
}

async function loginCookie(email: string): Promise<string> {
  const res = await request(app)
    .post("/api/auth/login")
    .send({ email, password: PASSWORD });
  expect(res.status, `login ${email} failed: ${res.text}`).toBe(200);
  const setCookie = res.headers["set-cookie"];
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  const cookie = arr
    .filter(Boolean)
    .map((c: string) => c.split(";")[0])
    .join("; ");
  expect(cookie).toMatch(/autocare_session=/);
  return cookie;
}

let ownerAId: string;
let ownerBId: string;
let centerAUserId: string;
let centerBUserId: string;
let vehicleAId: string;
let vehicleBId: string;
let centerAId: string;
let centerBId: string;
let bookingAId: string; // owner A's car at center A
let bookingBId: string; // owner B's car at center B
let invoiceAId: string;
let invoiceBId: string;
let cookieOwnerA: string;
let cookieCenterA: string;

async function cleanup() {
  const tagEmails = [OWNER_A_EMAIL, OWNER_B_EMAIL, CENTER_A_EMAIL, CENTER_B_EMAIL];
  const tagPhones = [OWNER_A_PHONE, OWNER_B_PHONE];
  const tagCenterPhones = [CENTER_A_PHONE, CENTER_B_PHONE];

  // Drop invoices before bookings (FK), bookings before vehicles/centers.
  const vehicleIds = (
    await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(inArray(vehiclesTable.ownerPhone, tagPhones))
  ).map((r) => r.id);
  const centerIds = (
    await db
      .select({ id: serviceCentersTable.id })
      .from(serviceCentersTable)
      .where(inArray(serviceCentersTable.phone, tagCenterPhones))
  ).map((r) => r.id);
  if (vehicleIds.length > 0) {
    const bookingRows = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(inArray(bookingsTable.vehicleId, vehicleIds));
    const bIds = bookingRows.map((r) => r.id);
    if (bIds.length > 0) {
      await db.delete(invoicesTable).where(inArray(invoicesTable.bookingId, bIds));
      await db.delete(bookingsTable).where(inArray(bookingsTable.id, bIds));
    }
    await db.delete(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds));
  }
  if (centerIds.length > 0) {
    // Center staff cascades on center delete, but be explicit for clarity.
    await db.delete(centerStaffTable).where(inArray(centerStaffTable.centerId, centerIds));
    await db.delete(serviceCentersTable).where(inArray(serviceCentersTable.id, centerIds));
  }
  await db.delete(usersTable).where(inArray(usersTable.email, tagEmails));
}

beforeAll(async () => {
  await cleanup();

  const ownerAUserId = await seedUser({
    email: OWNER_A_EMAIL,
    phone: OWNER_A_PHONE,
    role: "owner",
    name: "Owner A",
  });
  const ownerBUserId = await seedUser({
    email: OWNER_B_EMAIL,
    phone: OWNER_B_PHONE,
    role: "owner",
    name: "Owner B",
  });
  ownerAId = ownerAUserId;
  ownerBId = ownerBUserId;
  void ownerAId;
  void ownerBId;
  centerAUserId = await seedUser({
    email: CENTER_A_EMAIL,
    phone: CENTER_A_PHONE,
    role: "center",
    name: "Center A Staff",
  });
  centerBUserId = await seedUser({
    email: CENTER_B_EMAIL,
    phone: CENTER_B_PHONE,
    role: "center",
    name: "Center B Staff",
  });
  void centerBUserId;

  vehicleAId = await seedVehicle({
    ownerName: "Owner A",
    ownerPhone: OWNER_A_PHONE,
    plate: `${TAG}-VA`,
  });
  vehicleBId = await seedVehicle({
    ownerName: "Owner B",
    ownerPhone: OWNER_B_PHONE,
    plate: `${TAG}-VB`,
  });

  centerAId = await seedCenter({ name: `${TAG} Center A`, phone: CENTER_A_PHONE });
  centerBId = await seedCenter({ name: `${TAG} Center B`, phone: CENTER_B_PHONE });

  await seedStaff({
    centerId: centerAId,
    userId: centerAUserId,
    email: CENTER_A_EMAIL,
    name: "Center A Staff",
  });
  await seedStaff({
    centerId: centerBId,
    userId: centerBUserId,
    email: CENTER_B_EMAIL,
    name: "Center B Staff",
  });

  bookingAId = await seedBooking({ vehicleId: vehicleAId, serviceCenterId: centerAId });
  bookingBId = await seedBooking({ vehicleId: vehicleBId, serviceCenterId: centerBId });

  invoiceAId = await seedInvoice({ bookingId: bookingAId });
  invoiceBId = await seedInvoice({ bookingId: bookingBId });

  cookieOwnerA = await loginCookie(OWNER_A_EMAIL);
  cookieCenterA = await loginCookie(CENTER_A_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

describe("Service booking access isolation — owner cannot reach other owners' bookings", () => {
  it("403s when owner A reads owner B's booking", async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingBId}`)
      .set("Cookie", cookieOwnerA);
    expect(res.status).toBe(403);
  });

  it("403s when owner A tries to PATCH owner B's booking status", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingBId}/status`)
      .set("Cookie", cookieOwnerA)
      .send({ status: "cancelled" });
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingBId));
    expect(row?.status).toBe("requested");
  });

  it("403s when owner A tries to assign a mechanic on owner B's booking", async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingBId}/assign-mechanic`)
      .set("Cookie", cookieOwnerA)
      .send({ mechanicId: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(403);
  });

  it("403s when owner A tries to approve owner B's invoice", async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceBId}/approve`)
      .set("Cookie", cookieOwnerA);
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceBId));
    expect(row?.status).toBe("pending_approval");
  });

  it("403s when owner A tries to pay owner B's invoice", async () => {
    const res = await request(app)
      .post(`/api/invoices/${invoiceBId}/pay`)
      .set("Cookie", cookieOwnerA);
    expect(res.status).toBe(403);
  });

  it("403s when owner A fetches owner B's invoice directly", async () => {
    const res = await request(app)
      .get(`/api/invoices/${invoiceBId}`)
      .set("Cookie", cookieOwnerA);
    expect(res.status).toBe(403);
  });

  it("scopes GET /bookings to owner A's bookings only", async () => {
    const res = await request(app)
      .get(`/api/bookings`)
      .set("Cookie", cookieOwnerA);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(bookingAId);
    expect(ids).not.toContain(bookingBId);
  });
});

describe("Service booking access isolation — service center cannot reach other centers' work", () => {
  it("403s when center A reads center B's booking", async () => {
    const res = await request(app)
      .get(`/api/bookings/${bookingBId}`)
      .set("Cookie", cookieCenterA);
    expect(res.status).toBe(403);
  });

  it("403s when center A tries to PATCH center B's booking status", async () => {
    const res = await request(app)
      .patch(`/api/bookings/${bookingBId}/status`)
      .set("Cookie", cookieCenterA)
      .send({ status: "accepted" });
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingBId));
    expect(row?.status).toBe("requested");
  });

  it("403s when center A tries to issue an invoice on center B's booking", async () => {
    const res = await request(app)
      .post(`/api/bookings/${bookingBId}/invoice`)
      .set("Cookie", cookieCenterA)
      .send({
        items: [{ kind: "labor", description: "x", quantity: 1, unitPrice: 1 }],
        taxRate: 0,
      });
    expect(res.status).toBe(403);
  });

  it("403s when center A fetches an invoice from center B's queue", async () => {
    const res = await request(app)
      .get(`/api/invoices/${invoiceBId}`)
      .set("Cookie", cookieCenterA);
    expect(res.status).toBe(403);
  });

  it("scopes GET /bookings queue to center A's bookings only", async () => {
    const res = await request(app)
      .get(`/api/bookings`)
      .set("Cookie", cookieCenterA);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(bookingAId);
    expect(ids).not.toContain(bookingBId);
  });
});
