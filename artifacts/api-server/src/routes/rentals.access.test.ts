import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  rentalCarsTable,
  rentalBookingsTable,
  renterProfilesTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task37-iso";
const RENTER_A_EMAIL = `${TAG}-renter-a@autocare.test`;
const RENTER_B_EMAIL = `${TAG}-renter-b@autocare.test`;
const OWNER_A_EMAIL = `${TAG}-owner-a@autocare.test`;
const OWNER_B_EMAIL = `${TAG}-owner-b@autocare.test`;
const RENTER_A_PHONE = `+99900010001`;
const RENTER_B_PHONE = `+99900010002`;
const OWNER_A_PHONE = `+99900020001`;
const OWNER_B_PHONE = `+99900020002`;
const PASSWORD = "test-password-1234";

const created = {
  userIds: [] as string[],
  carIds: [] as string[],
  bookingIds: [] as string[],
  renterProfileIds: [] as string[],
};

async function seedUser(opts: {
  email: string;
  phone: string;
  role: "renter" | "owner";
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
  created.userIds.push(row!.id);
  return row!.id;
}

async function seedCar(opts: {
  ownerName: string;
  ownerPhone: string;
  plate: string;
}): Promise<string> {
  const [row] = await db
    .insert(rentalCarsTable)
    .values({
      ownerKind: "user",
      ownerName: opts.ownerName,
      ownerPhone: opts.ownerPhone,
      brand: "TestBrand",
      model: "TestModel",
      year: 2022,
      color: "Black",
      plateNumber: opts.plate,
      transmission: "automatic",
      seats: 5,
      fuelType: "petrol",
      dailyRate: 100,
      city: "Lagos",
      pickupAddress: "1 Test St",
      status: "approved",
      active: true,
      rentalModes: ["self_drive"],
    })
    .returning({ id: rentalCarsTable.id });
  created.carIds.push(row!.id);
  return row!.id;
}

async function seedRenterProfile(opts: {
  name: string;
  phone: string;
  email: string;
}): Promise<string> {
  const [row] = await db
    .insert(renterProfilesTable)
    .values({
      name: opts.name,
      phone: opts.phone,
      email: opts.email,
      kycStatus: "verified",
    })
    .returning({ id: renterProfilesTable.id });
  created.renterProfileIds.push(row!.id);
  return row!.id;
}

async function seedBooking(opts: {
  carId: string;
  renterId: string;
  renterName: string;
  renterPhone: string;
}): Promise<string> {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const end = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  const [row] = await db
    .insert(rentalBookingsTable)
    .values({
      carId: opts.carId,
      renterId: opts.renterId,
      renterName: opts.renterName,
      renterPhone: opts.renterPhone,
      startDate: start,
      endDate: end,
      days: 2,
      dailyRate: 100,
      total: 200,
      status: "pending_review",
    })
    .returning({ id: rentalBookingsTable.id });
  created.bookingIds.push(row!.id);
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

let renterAId: string;
let renterBId: string;
let renterAProfileId: string;
let renterBProfileId: string;
let carAId: string;
let carBId: string;
let bookingAId: string; // renter A on owner A's car
let bookingBId: string; // renter B on owner B's car
let cookieRenterA: string;
let cookieOwnerA: string;

beforeAll(async () => {
  // Clean any leftovers from a prior crashed run before seeding.
  await cleanup();

  renterAId = await seedUser({
    email: RENTER_A_EMAIL,
    phone: RENTER_A_PHONE,
    role: "renter",
    name: "Renter A",
  });
  renterBId = await seedUser({
    email: RENTER_B_EMAIL,
    phone: RENTER_B_PHONE,
    role: "renter",
    name: "Renter B",
  });
  await seedUser({
    email: OWNER_A_EMAIL,
    phone: OWNER_A_PHONE,
    role: "owner",
    name: "Owner A",
  });
  await seedUser({
    email: OWNER_B_EMAIL,
    phone: OWNER_B_PHONE,
    role: "owner",
    name: "Owner B",
  });
  void renterAId;
  void renterBId;

  renterAProfileId = await seedRenterProfile({
    name: "Renter A",
    phone: RENTER_A_PHONE,
    email: RENTER_A_EMAIL,
  });
  renterBProfileId = await seedRenterProfile({
    name: "Renter B",
    phone: RENTER_B_PHONE,
    email: RENTER_B_EMAIL,
  });

  carAId = await seedCar({
    ownerName: "Owner A",
    ownerPhone: OWNER_A_PHONE,
    plate: `${TAG}-A`,
  });
  carBId = await seedCar({
    ownerName: "Owner B",
    ownerPhone: OWNER_B_PHONE,
    plate: `${TAG}-B`,
  });

  bookingAId = await seedBooking({
    carId: carAId,
    renterId: renterAProfileId,
    renterName: "Renter A",
    renterPhone: RENTER_A_PHONE,
  });
  bookingBId = await seedBooking({
    carId: carBId,
    renterId: renterBProfileId,
    renterName: "Renter B",
    renterPhone: RENTER_B_PHONE,
  });

  cookieRenterA = await loginCookie(RENTER_A_EMAIL);
  cookieOwnerA = await loginCookie(OWNER_A_EMAIL);
});

async function cleanup() {
  const tagEmails = [
    RENTER_A_EMAIL,
    RENTER_B_EMAIL,
    OWNER_A_EMAIL,
    OWNER_B_EMAIL,
  ];
  const tagPhones = [
    RENTER_A_PHONE,
    RENTER_B_PHONE,
    OWNER_A_PHONE,
    OWNER_B_PHONE,
  ];
  // Bookings reference cars + renter profiles, drop them first.
  await db
    .delete(rentalBookingsTable)
    .where(inArray(rentalBookingsTable.renterPhone, tagPhones));
  await db
    .delete(rentalCarsTable)
    .where(inArray(rentalCarsTable.ownerPhone, tagPhones));
  await db
    .delete(renterProfilesTable)
    .where(inArray(renterProfilesTable.phone, tagPhones));
  await db.delete(usersTable).where(inArray(usersTable.email, tagEmails));
  created.userIds.length = 0;
  created.carIds.length = 0;
  created.bookingIds.length = 0;
  created.renterProfileIds.length = 0;
}

afterAll(async () => {
  await cleanup();
});

describe("Rental access isolation — renter cannot read other renters", () => {
  it("403s when renter A queries bookings filtered by renter B's phone", async () => {
    const res = await request(app)
      .get(`/api/rental-bookings?renterPhone=${encodeURIComponent(RENTER_B_PHONE)}`)
      .set("Cookie", cookieRenterA);
    expect(res.status).toBe(403);
  });

  it("403s when renter A queries bookings filtered by renter B's renterId", async () => {
    const res = await request(app)
      .get(`/api/rental-bookings?renterId=${renterBProfileId}`)
      .set("Cookie", cookieRenterA);
    expect(res.status).toBe(403);
  });

  it("scopes unfiltered bookings list to bookings touching renter A only", async () => {
    const res = await request(app)
      .get(`/api/rental-bookings`)
      .set("Cookie", cookieRenterA);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).not.toContain(bookingBId);
    // Sanity: renter A's own booking must still be visible to them.
    expect(ids).toContain(bookingAId);
  });

  it("403s when renter A fetches renter B's profile by id", async () => {
    const res = await request(app)
      .get(`/api/renter-profiles/${renterBProfileId}`)
      .set("Cookie", cookieRenterA);
    expect(res.status).toBe(403);
  });

  it("403s when renter A fetches renter B's profile by phone", async () => {
    const res = await request(app)
      .get(`/api/renter-profiles/by-phone/${encodeURIComponent(RENTER_B_PHONE)}`)
      .set("Cookie", cookieRenterA);
    expect(res.status).toBe(403);
  });

  it("403s when renter A tries to PATCH renter B's profile", async () => {
    const res = await request(app)
      .patch(`/api/renter-profiles/${renterBProfileId}`)
      .set("Cookie", cookieRenterA)
      .send({ name: "hijacked" });
    expect(res.status).toBe(403);

    // Confirm the row was not mutated.
    const [row] = await db
      .select()
      .from(renterProfilesTable)
      .where(eq(renterProfilesTable.id, renterBProfileId));
    expect(row?.name).toBe("Renter B");
  });

  it("403s when renter A tries to PATCH renter B's booking (cancel)", async () => {
    const res = await request(app)
      .patch(`/api/rental-bookings/${bookingBId}`)
      .set("Cookie", cookieRenterA)
      .send({ status: "cancelled" });
    expect(res.status).toBe(403);

    // Booking status must be unchanged.
    const [row] = await db
      .select()
      .from(rentalBookingsTable)
      .where(eq(rentalBookingsTable.id, bookingBId));
    expect(row?.status).toBe("pending_review");
  });
});

describe("Rental access isolation — owner cannot mutate other owners' cars", () => {
  it("403s when owner A tries to PATCH a car owned by owner B", async () => {
    const res = await request(app)
      .patch(`/api/rental-cars/${carBId}`)
      .set("Cookie", cookieOwnerA)
      .send({ dailyRate: 1 });
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(rentalCarsTable)
      .where(eq(rentalCarsTable.id, carBId));
    expect(row?.dailyRate).toBe(100);
  });

  it("403s when owner A tries to DELETE a car owned by owner B", async () => {
    const res = await request(app)
      .delete(`/api/rental-cars/${carBId}`)
      .set("Cookie", cookieOwnerA);
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(rentalCarsTable)
      .where(eq(rentalCarsTable.id, carBId));
    expect(row?.id).toBe(carBId);
  });
});
