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

const TAG = "task52-rlife";
const OWNER_EMAIL = `${TAG}-owner@autocare.test`;
const RENTER_EMAIL = `${TAG}-renter@autocare.test`;
const OTHER_RENTER_EMAIL = `${TAG}-other@autocare.test`;
const OWNER_PHONE = `+99900090001`;
const RENTER_PHONE = `+99900090002`;
const OTHER_RENTER_PHONE = `+99900090003`;
const PLATE = `${TAG}-CAR`;
const PASSWORD = "test-password-1234";

let ownerCookie: string;
let renterCookie: string;
let otherRenterCookie: string;
let carId: string;
let renterProfileId: string;
let otherRenterProfileId: string;

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
  const emails = [OWNER_EMAIL, RENTER_EMAIL, OTHER_RENTER_EMAIL];
  const phones = [OWNER_PHONE, RENTER_PHONE, OTHER_RENTER_PHONE];

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
      name: "Rental Owner",
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
      name: "Rental Renter",
      role: "renter",
      phone: RENTER_PHONE,
      active: true,
      approvalStatus: "approved",
      kycStatus: "verified",
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
    {
      email: OTHER_RENTER_EMAIL.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: "Other Renter",
      role: "renter",
      phone: OTHER_RENTER_PHONE,
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
      name: "Rental Renter",
      phone: RENTER_PHONE,
      email: RENTER_EMAIL,
      kycStatus: "verified",
      driverLicenseNumber: "DL-LIFECYCLE-1",
    })
    .returning({ id: renterProfilesTable.id });
  renterProfileId = renterProfile!.id;

  const [otherProfile] = await db
    .insert(renterProfilesTable)
    .values({
      name: "Other Renter",
      phone: OTHER_RENTER_PHONE,
      email: OTHER_RENTER_EMAIL,
      kycStatus: "verified",
    })
    .returning({ id: renterProfilesTable.id });
  otherRenterProfileId = otherProfile!.id;
  void otherRenterProfileId;

  const [car] = await db
    .insert(rentalCarsTable)
    .values({
      ownerKind: "user",
      ownerName: "Rental Owner",
      ownerPhone: OWNER_PHONE,
      brand: "TestBrand",
      model: "TestModel",
      year: 2023,
      color: "Blue",
      plateNumber: PLATE,
      transmission: "automatic",
      seats: 5,
      fuelType: "petrol",
      dailyRate: 150,
      city: "Accra",
      pickupAddress: "1 Lifecycle Rd",
      status: "approved",
      active: true,
      rentalModes: ["self_drive"],
    })
    .returning({ id: rentalCarsTable.id });
  carId = car!.id;

  ownerCookie = await loginCookie(OWNER_EMAIL);
  renterCookie = await loginCookie(RENTER_EMAIL);
  otherRenterCookie = await loginCookie(OTHER_RENTER_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

function futureWindow(offsetDays = 1, lengthDays = 2): { start: string; end: string } {
  const start = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const end = new Date(start.getTime() + lengthDays * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

describe("Rental booking lifecycle — happy path", () => {
  it(
    "walks pending_review → contract_pending → awaiting_payment → confirmed → active → completed",
    async () => {
      const { start, end } = futureWindow(1, 2);

      // 1. Renter creates the booking request.
      const createRes = await request(app)
        .post("/api/rental-bookings")
        .set("Cookie", renterCookie)
        .send({
          carId,
          renterId: renterProfileId,
          startDate: start,
          endDate: end,
          rentalMode: "self_drive",
        });
      expect(createRes.status, createRes.text).toBe(201);
      const bookingId: string = createRes.body.id;
      expect(createRes.body.status).toBe("pending_review");

      // 2. Owner approves → contract generated, status contract_pending.
      const approveRes = await request(app)
        .patch(`/api/rental-bookings/${bookingId}`)
        .set("Cookie", ownerCookie)
        .send({ ownerReview: { decision: "approve" } });
      expect(approveRes.status, approveRes.text).toBe(200);
      expect(approveRes.body.status).toBe("contract_pending");
      expect(approveRes.body.contractText).toBeTruthy();

      // 3. Renter signs as renter.
      const renterSign = await request(app)
        .patch(`/api/rental-bookings/${bookingId}`)
        .set("Cookie", renterCookie)
        .send({ sign: { party: "renter", name: "Rental Renter" } });
      expect(renterSign.status, renterSign.text).toBe(200);
      expect(renterSign.body.status).toBe("contract_pending");
      expect(renterSign.body.renterSignedAt).toBeTruthy();

      // 4. Owner signs as owner — both sigs present → promotes to
      //    awaiting_payment.
      const ownerSign = await request(app)
        .patch(`/api/rental-bookings/${bookingId}`)
        .set("Cookie", ownerCookie)
        .send({ sign: { party: "owner", name: "Rental Owner" } });
      expect(ownerSign.status, ownerSign.text).toBe(200);
      expect(ownerSign.body.status).toBe("awaiting_payment");
      expect(ownerSign.body.ownerSignedAt).toBeTruthy();

      // 5. Renter pays online → confirmed. In production this goes through
      //    PaySwitch (POST /payments/payswitch/rental-bookings/:id then async
      //    callback). Here we simulate the callback's terminal effect by
      //    directly stamping paymentStatus=paid + status=confirmed on the
      //    row, which is what the callback's `markPaid` branch does.
      const now = new Date();
      const [paidRow] = await db
        .update(rentalBookingsTable)
        .set({
          paymentMethod: "online",
          paymentStatus: "paid",
          paidAt: now,
          status: "confirmed",
          confirmedAt: now,
        })
        .where(eq(rentalBookingsTable.id, bookingId))
        .returning();
      expect(paidRow?.status).toBe("confirmed");
      expect(paidRow?.paymentStatus).toBe("paid");

      // 6. Owner marks trip active.
      const activeRes = await request(app)
        .patch(`/api/rental-bookings/${bookingId}`)
        .set("Cookie", ownerCookie)
        .send({ status: "active" });
      expect(activeRes.status, activeRes.text).toBe(200);
      expect(activeRes.body.status).toBe("active");

      // 7. Renter completes the trip.
      const doneRes = await request(app)
        .patch(`/api/rental-bookings/${bookingId}`)
        .set("Cookie", renterCookie)
        .send({ status: "completed" });
      expect(doneRes.status, doneRes.text).toBe(200);
      expect(doneRes.body.status).toBe("completed");

      const [finalRow] = await db
        .select()
        .from(rentalBookingsTable)
        .where(eq(rentalBookingsTable.id, bookingId));
      expect(finalRow?.status).toBe("completed");
      expect(finalRow?.completedAt).toBeTruthy();
    },
  );
});

describe("Rental booking lifecycle — invalid transitions return 409", () => {
  let bookingId: string;

  beforeAll(async () => {
    const start = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
    const [row] = await db
      .insert(rentalBookingsTable)
      .values({
        carId,
        renterId: renterProfileId,
        renterName: "Rental Renter",
        renterPhone: RENTER_PHONE,
        startDate: start,
        endDate: end,
        days: 2,
        dailyRate: 150,
        total: 300,
        status: "pending_review",
      })
      .returning({ id: rentalBookingsTable.id });
    bookingId = row!.id;
  });

  it("rejects status=active before the booking is confirmed", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "active" });
    expect(res.status, res.text).toBe(409);
    expect(res.body.error).toMatch(/Cannot move rental/i);
  });

  it("rejects status=completed before the booking is active", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", ownerCookie)
      .send({ status: "completed" });
    expect(res.status).toBe(409);
  });

  it("rejects signing while still in pending_review (no contract yet)", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", renterCookie)
      .send({ sign: { party: "renter", name: "Rental Renter" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/contract/i);
  });

  it("rejects payment before both signatures land", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", renterCookie)
      .send({ payment: { method: "online", markPaid: true } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/sign/i);
  });

  it("rejects a second owner review after the first decision", async () => {
    // Approve once to move out of pending_review.
    const approve = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", ownerCookie)
      .send({ ownerReview: { decision: "approve" } });
    expect(approve.status, approve.text).toBe(200);
    expect(approve.body.status).toBe("contract_pending");

    // Second ownerReview attempt is no longer valid.
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", ownerCookie)
      .send({ ownerReview: { decision: "reject" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/pending review/i);
  });
});

describe("Rental booking lifecycle — party-bound guards return 403", () => {
  let bookingId: string;

  beforeAll(async () => {
    const start = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000);
    const end = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
    const [row] = await db
      .insert(rentalBookingsTable)
      .values({
        carId,
        renterId: renterProfileId,
        renterName: "Rental Renter",
        renterPhone: RENTER_PHONE,
        startDate: start,
        endDate: end,
        days: 2,
        dailyRate: 150,
        total: 300,
        status: "contract_pending",
        ownerReviewStatus: "approved",
        ownerReviewedAt: new Date(),
        contractText: "TEST CONTRACT",
        contractGeneratedAt: new Date(),
      })
      .returning({ id: rentalBookingsTable.id });
    bookingId = row!.id;
  });

  it("blocks the renter from approving/rejecting the booking (owner-only)", async () => {
    // Reset to pending_review for this assertion only.
    const [pending] = await db
      .insert(rentalBookingsTable)
      .values({
        carId,
        renterId: renterProfileId,
        renterName: "Rental Renter",
        renterPhone: RENTER_PHONE,
        startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 32 * 24 * 60 * 60 * 1000),
        days: 2,
        dailyRate: 150,
        total: 300,
        status: "pending_review",
      })
      .returning({ id: rentalBookingsTable.id });

    const res = await request(app)
      .patch(`/api/rental-bookings/${pending!.id}`)
      .set("Cookie", renterCookie)
      .send({ ownerReview: { decision: "approve" } });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/owner/i);

    const [unchanged] = await db
      .select()
      .from(rentalBookingsTable)
      .where(eq(rentalBookingsTable.id, pending!.id));
    expect(unchanged?.status).toBe("pending_review");
  });

  it("blocks the renter from forging the owner's signature", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", renterCookie)
      .send({ sign: { party: "owner", name: "Imposter" } });
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(rentalBookingsTable)
      .where(eq(rentalBookingsTable.id, bookingId));
    expect(row?.ownerSignedAt).toBeNull();
    expect(row?.ownerSignatureName).toBeNull();
  });

  it("blocks the owner from forging the renter's signature", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingId}`)
      .set("Cookie", ownerCookie)
      .send({ sign: { party: "renter", name: "Not The Renter" } });
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(rentalBookingsTable)
      .where(eq(rentalBookingsTable.id, bookingId));
    expect(row?.renterSignedAt).toBeNull();
    expect(row?.renterSignatureName).toBeNull();
  });

  it("blocks an unrelated renter from filing an incident on this booking", async () => {
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", otherRenterCookie)
      .send({ kind: "breakdown", reportedBy: "renter", notes: "not mine" });
    expect(res.status).toBe(403);
  });

  it("blocks an unrelated renter from posting a GPS ping for this booking", async () => {
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/locations`)
      .set("Cookie", otherRenterCookie)
      .send({ lat: 5.6, lng: -0.2 });
    expect(res.status).toBe(403);
  });

  it("allows the actual renter to file an incident with reportedBy derived server-side", async () => {
    // Move booking to active so location/incident pings are accepted by FSM.
    await db
      .update(rentalBookingsTable)
      .set({
        status: "active",
        renterSignatureName: "Rental Renter",
        renterSignedAt: new Date(),
        ownerSignatureName: "Rental Owner",
        ownerSignedAt: new Date(),
        paymentMethod: "online",
        paymentStatus: "paid",
        paidAt: new Date(),
        confirmedAt: new Date(),
        startedAt: new Date(),
      })
      .where(eq(rentalBookingsTable.id, bookingId));

    // Even when the client lies and claims reportedBy=owner, server overrides
    // it with the verified relationship (renter).
    const res = await request(app)
      .post(`/api/rental-bookings/${bookingId}/incidents`)
      .set("Cookie", renterCookie)
      .send({
        kind: "breakdown",
        reportedBy: "owner",
        notes: "flat tire",
        lat: 5.61,
        lng: -0.21,
      });
    expect(res.status, res.text).toBe(201);
    expect(res.body.reportedBy).toBe("renter");
  });
});
