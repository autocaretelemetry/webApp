import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  rentalCarsTable,
  rentalBookingsTable,
  renterProfilesTable,
  tripLocationsTable,
  rentalIncidentsTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task56-rtrk";
const OWNER_EMAIL = `${TAG}-owner@autocare.test`;
const RENTER_EMAIL = `${TAG}-renter@autocare.test`;
const ADMIN_EMAIL = `${TAG}-admin@autocare.test`;
const OWNER_PHONE = `+99900560001`;
const RENTER_PHONE = `+99900560002`;
const ADMIN_PHONE = `+99900560003`;
const PLATE = `${TAG}-CAR`;
const PASSWORD = "test-password-1234";

let ownerCookie: string;
let renterCookie: string;
let adminCookie: string;
let carId: string;
let renterProfileId: string;

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
  const emails = [OWNER_EMAIL, RENTER_EMAIL, ADMIN_EMAIL];
  const phones = [OWNER_PHONE, RENTER_PHONE, ADMIN_PHONE];

  const carRows = await db
    .select({ id: rentalCarsTable.id })
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.ownerPhone, OWNER_PHONE));
  const carIds = carRows.map((r) => r.id);
  if (carIds.length > 0) {
    const bRows = await db
      .select({ id: rentalBookingsTable.id })
      .from(rentalBookingsTable)
      .where(inArray(rentalBookingsTable.carId, carIds));
    const bIds = bRows.map((r) => r.id);
    if (bIds.length > 0) {
      await db
        .delete(rentalIncidentsTable)
        .where(inArray(rentalIncidentsTable.bookingId, bIds));
      await db
        .delete(tripLocationsTable)
        .where(inArray(tripLocationsTable.bookingId, bIds));
      await db
        .delete(rentalBookingsTable)
        .where(inArray(rentalBookingsTable.id, bIds));
    }
    await db.delete(rentalCarsTable).where(inArray(rentalCarsTable.id, carIds));
  }
  await db
    .delete(renterProfilesTable)
    .where(inArray(renterProfilesTable.phone, phones));
  await db.delete(usersTable).where(inArray(usersTable.email, emails));
}

beforeAll(async () => {
  await cleanup();

  await db.insert(usersTable).values([
    {
      email: OWNER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "Tracking Owner",
      role: "owner",
      phone: OWNER_PHONE,
      active: true,
      approvalStatus: "approved",
      kycStatus: "verified",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
    {
      email: RENTER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "Tracking Renter",
      role: "renter",
      phone: RENTER_PHONE,
      active: true,
      approvalStatus: "approved",
      kycStatus: "verified",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
    {
      email: ADMIN_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "Tracking Admin",
      role: "admin",
      phone: ADMIN_PHONE,
      active: true,
      approvalStatus: "approved",
      kycStatus: "verified",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  ]);

  const [renterProfile] = await db
    .insert(renterProfilesTable)
    .values({
      name: "Tracking Renter",
      phone: RENTER_PHONE,
      email: RENTER_EMAIL,
      kycStatus: "verified",
      driverLicenseNumber: "DL-TRACK-1",
    })
    .returning({ id: renterProfilesTable.id });
  renterProfileId = renterProfile!.id;

  const [car] = await db
    .insert(rentalCarsTable)
    .values({
      ownerKind: "user",
      ownerName: "Tracking Owner",
      ownerPhone: OWNER_PHONE,
      brand: "TrackBrand",
      model: "TrackModel",
      year: 2024,
      color: "Red",
      plateNumber: PLATE,
      transmission: "automatic",
      seats: 5,
      fuelType: "petrol",
      dailyRate: 100,
      city: "Accra",
      pickupAddress: "1 Tracking Rd",
      status: "approved",
      active: true,
      rentalModes: ["self_drive"],
    })
    .returning({ id: rentalCarsTable.id });
  carId = car!.id;

  ownerCookie = await loginCookie(OWNER_EMAIL);
  renterCookie = await loginCookie(RENTER_EMAIL);
  adminCookie = await loginCookie(ADMIN_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

async function makeBooking(
  status: "confirmed" | "active" | "completed" | "cancelled",
  offsetDays = 1,
): Promise<string> {
  const start = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(rentalBookingsTable)
    .values({
      carId,
      renterId: renterProfileId,
      renterName: "Tracking Renter",
      renterPhone: RENTER_PHONE,
      startDate: start,
      endDate: end,
      days: 2,
      dailyRate: 100,
      total: 200,
      status,
      renterSignatureName: "Tracking Renter",
      renterSignedAt: new Date(),
      ownerSignatureName: "Tracking Owner",
      ownerSignedAt: new Date(),
      paymentMethod: "online",
      paymentStatus: "paid",
      paidAt: new Date(),
      confirmedAt: new Date(),
      ...(status === "active" || status === "completed"
        ? { startedAt: new Date() }
        : {}),
      ...(status === "completed" ? { completedAt: new Date() } : {}),
    })
    .returning({ id: rentalBookingsTable.id });
  return row!.id;
}

describe("POST /rental-bookings/:id/locations — FSM gating", () => {
  it("accepts a ping when the booking is confirmed", async () => {
    const bookingId = await makeBooking("confirmed", 40);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/locations`)
      .set("Cookie", renterCookie)
      .send({ lat: 5.55, lng: -0.2 });
    expect(res.status, res.text).toBe(201);
    expect(res.body.bookingId).toBe(bookingId);
    expect(res.body.lat).toBeCloseTo(5.55, 3);
  });

  it("accepts a ping when the booking is active", async () => {
    const bookingId = await makeBooking("active", 50);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/locations`)
      .set("Cookie", renterCookie)
      .send({ lat: 5.56, lng: -0.21 });
    expect(res.status, res.text).toBe(201);
  });

  it("rejects a ping with 400 when the booking is completed", async () => {
    const bookingId = await makeBooking("completed", 60);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/locations`)
      .set("Cookie", renterCookie)
      .send({ lat: 5.57, lng: -0.22 });
    expect(res.status, res.text).toBe(400);
    expect(res.body.error).toMatch(/state/i);

    const pings = await db
      .select()
      .from(tripLocationsTable)
      .where(eq(tripLocationsTable.bookingId, bookingId));
    expect(pings).toHaveLength(0);
  });

  it("rejects a ping with 400 when the booking is cancelled", async () => {
    const bookingId = await makeBooking("cancelled", 70);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/locations`)
      .set("Cookie", renterCookie)
      .send({ lat: 5.58, lng: -0.23 });
    expect(res.status, res.text).toBe(400);
  });
});

describe("POST /rental-bookings/:id/incidents — reportedBy derivation + GPS side-effect", () => {
  it("derives reportedBy=renter and ignores a spoofed body value", async () => {
    const bookingId = await makeBooking("active", 80);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", renterCookie)
      .send({ kind: "breakdown", reportedBy: "admin", notes: "flat tire" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.reportedBy).toBe("renter");
    expect(res.body.status).toBe("open");
  });

  it("derives reportedBy=owner when the car owner reports", async () => {
    const bookingId = await makeBooking("active", 90);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", ownerCookie)
      .send({ kind: "accident", reportedBy: "renter", notes: "fender bender" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.reportedBy).toBe("owner");
  });

  it("derives reportedBy=admin when a platform admin reports", async () => {
    const bookingId = await makeBooking("active", 100);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", adminCookie)
      .send({ kind: "sos", reportedBy: "renter", notes: "manual triage" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.reportedBy).toBe("admin");
  });

  it("persists a trip_locations row and lastKnown* when lat/lng are supplied", async () => {
    const bookingId = await makeBooking("active", 110);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", renterCookie)
      .send({
        kind: "theft",
        reportedBy: "renter",
        notes: "car missing",
        lat: 5.61,
        lng: -0.21,
        accuracy: 12.4,
      });
    expect(res.status, res.text).toBe(201);
    expect(res.body.lastKnownLat).toBeCloseTo(5.61, 3);
    expect(res.body.lastKnownLng).toBeCloseTo(-0.21, 3);
    expect(res.body.lastKnownAt).toBeTruthy();

    const pings = await db
      .select()
      .from(tripLocationsTable)
      .where(eq(tripLocationsTable.bookingId, bookingId));
    expect(pings).toHaveLength(1);
    expect(pings[0]!.lat).toBeCloseTo(5.61, 3);
    expect(pings[0]!.lng).toBeCloseTo(-0.21, 3);
    expect(pings[0]!.source).toBe("device");
    expect(pings[0]!.accuracyMeters).toBe(12);
  });

  it("falls back to the most recent ping when lat/lng are omitted", async () => {
    const bookingId = await makeBooking("active", 120);
    // Seed a prior ping.
    await db.insert(tripLocationsTable).values({
      bookingId,
      lat: 5.7,
      lng: -0.3,
      source: "device",
    });

    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", renterCookie)
      .send({ kind: "breakdown", reportedBy: "renter", notes: "stalled" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.lastKnownLat).toBeCloseTo(5.7, 3);
    expect(res.body.lastKnownLng).toBeCloseTo(-0.3, 3);

    // No NEW location row was created beyond the seeded one.
    const pings = await db
      .select()
      .from(tripLocationsTable)
      .where(eq(tripLocationsTable.bookingId, bookingId));
    expect(pings).toHaveLength(1);
  });

  it("uses source=owner on the synthesized ping when the owner reports", async () => {
    const bookingId = await makeBooking("active", 130);
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", ownerCookie)
      .send({
        kind: "accident",
        reportedBy: "owner",
        notes: "I witnessed it",
        lat: 5.62,
        lng: -0.22,
      });
    expect(res.status, res.text).toBe(201);
    const pings = await db
      .select()
      .from(tripLocationsTable)
      .where(eq(tripLocationsTable.bookingId, bookingId));
    expect(pings).toHaveLength(1);
    expect(pings[0]!.source).toBe("owner");
  });
});

describe("PATCH /rental-incidents/:id — admin-only resolve flow", () => {
  let bookingId: string;
  let incidentId: string;

  beforeAll(async () => {
    bookingId = await makeBooking("active", 140);
    const [row] = await db
      .insert(rentalIncidentsTable)
      .values({
        bookingId,
        kind: "breakdown",
        reportedBy: "renter",
        notes: "needs triage",
      })
      .returning({ id: rentalIncidentsTable.id });
    incidentId = row!.id;
  });

  it("blocks non-admin renters with 403 (requireAdmin)", async () => {
    const res = await request(app)
      .patch(`/api/rental-incidents/${incidentId}`)
      .set("Cookie", renterCookie)
      .send({ status: "resolved" });
    expect(res.status).toBe(403);

    const [unchanged] = await db
      .select()
      .from(rentalIncidentsTable)
      .where(eq(rentalIncidentsTable.id, incidentId));
    expect(unchanged?.status).toBe("open");
    expect(unchanged?.resolvedAt).toBeNull();
  });

  it("blocks the car owner with 403 as well", async () => {
    const res = await request(app)
      .patch(`/api/rental-incidents/${incidentId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "resolved" });
    expect(res.status).toBe(403);
  });

  it("lets an admin flip status to resolved and stamps resolvedAt", async () => {
    const before = Date.now();
    const res = await request(app)
      .patch(`/api/rental-incidents/${incidentId}`)
      .set("Cookie", adminCookie)
      .send({ status: "resolved", adminNotes: "towed and closed" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("resolved");
    expect(res.body.adminNotes).toBe("towed and closed");
    expect(res.body.resolvedAt).toBeTruthy();
    const stampedAt = new Date(res.body.resolvedAt).getTime();
    expect(stampedAt).toBeGreaterThanOrEqual(before - 1000);

    const [row] = await db
      .select()
      .from(rentalIncidentsTable)
      .where(eq(rentalIncidentsTable.id, incidentId));
    expect(row?.status).toBe("resolved");
    expect(row?.resolvedAt).toBeTruthy();
  });

  it("does not set resolvedAt when status is investigating", async () => {
    const [open] = await db
      .insert(rentalIncidentsTable)
      .values({
        bookingId,
        kind: "sos",
        reportedBy: "renter",
        notes: "still triaging",
      })
      .returning({ id: rentalIncidentsTable.id });

    const res = await request(app)
      .patch(`/api/rental-incidents/${open!.id}`)
      .set("Cookie", adminCookie)
      .send({ status: "investigating" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("investigating");
    expect(res.body.resolvedAt).toBeNull();
  });
});
