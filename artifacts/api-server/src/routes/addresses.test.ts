import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import { db, usersTable, userAddressesTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task55-addr";
const USER_A_EMAIL = `${TAG}-a@autocare.test`;
const USER_B_EMAIL = `${TAG}-b@autocare.test`;
const USER_A_PHONE = `+99900055001`;
const USER_B_PHONE = `+99900055002`;
const PASSWORD = "test-password-1234";

async function seedUser(email: string, phone: string, name: string): Promise<string> {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name,
      role: "owner",
      phone,
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

const SAMPLE = {
  label: "Home",
  recipientName: "Test Buyer",
  recipientPhone: "+233200000000",
  addressLine: "1 Test Street",
  city: "Accra",
  region: "Greater Accra",
};

let userAId: string;
let userBId: string;
let cookieA: string;
let cookieB: string;

async function cleanup() {
  const emails = [USER_A_EMAIL, USER_B_EMAIL];
  const userRows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.email, emails));
  const ids = userRows.map((r) => r.id);
  if (ids.length > 0) {
    await db
      .delete(userAddressesTable)
      .where(inArray(userAddressesTable.userId, ids));
    await db.delete(usersTable).where(inArray(usersTable.id, ids));
  }
}

async function clearAddresses(userId: string) {
  await db
    .delete(userAddressesTable)
    .where(eq(userAddressesTable.userId, userId));
}

beforeAll(async () => {
  await cleanup();
  userAId = await seedUser(USER_A_EMAIL, USER_A_PHONE, "Buyer A");
  userBId = await seedUser(USER_B_EMAIL, USER_B_PHONE, "Buyer B");
  cookieA = await loginCookie(USER_A_EMAIL);
  cookieB = await loginCookie(USER_B_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

describe("Saved addresses — auth", () => {
  it("401s when unauthenticated", async () => {
    const list = await request(app).get("/api/me/addresses");
    expect(list.status).toBe(401);
    const create = await request(app)
      .post("/api/me/addresses")
      .send(SAMPLE);
    expect(create.status).toBe(401);
  });
});

describe("Saved addresses — create + default flag", () => {
  it("first address is automatically marked default", async () => {
    await clearAddresses(userAId);
    const res = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Home" });
    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.label).toBe("Home");
  });

  it("second address does NOT take default unless requested", async () => {
    const res = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Garage" });
    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(false);
  });

  it("creating with isDefault=true clears the previous default", async () => {
    const res = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Workshop", isDefault: true });
    expect(res.status).toBe(201);
    expect(res.body.isDefault).toBe(true);

    const list = await request(app)
      .get("/api/me/addresses")
      .set("Cookie", cookieA);
    expect(list.status).toBe(200);
    const defaults = (list.body as Array<{ isDefault: boolean }>).filter(
      (r) => r.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect((list.body as Array<{ label: string; isDefault: boolean }>)[0]).toMatchObject({
      label: "Workshop",
      isDefault: true,
    });
  });
});

describe("Saved addresses — cross-user isolation", () => {
  it("user A's list does not include user B's rows, and vice versa", async () => {
    await clearAddresses(userBId);
    const created = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieB)
      .send({ ...SAMPLE, label: "B Home" });
    expect(created.status).toBe(201);
    const bAddressId: string = created.body.id;

    const listA = await request(app)
      .get("/api/me/addresses")
      .set("Cookie", cookieA);
    expect(listA.status).toBe(200);
    const aIds = (listA.body as Array<{ id: string }>).map((r) => r.id);
    expect(aIds).not.toContain(bAddressId);
  });

  it("404s when user A tries to PATCH user B's address", async () => {
    const [bRow] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.userId, userBId))
      .limit(1);
    expect(bRow).toBeTruthy();
    const res = await request(app)
      .patch(`/api/me/addresses/${bRow!.id}`)
      .set("Cookie", cookieA)
      .send({ label: "Hijacked" });
    expect(res.status).toBe(404);
    const [unchanged] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.id, bRow!.id));
    expect(unchanged?.label).toBe(bRow!.label);
  });

  it("404s when user A tries to DELETE user B's address", async () => {
    const [bRow] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.userId, userBId))
      .limit(1);
    expect(bRow).toBeTruthy();
    const res = await request(app)
      .delete(`/api/me/addresses/${bRow!.id}`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(404);
    const [still] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.id, bRow!.id));
    expect(still).toBeTruthy();
  });

  it("404s when user A tries to TOUCH user B's address", async () => {
    const [bRow] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.userId, userBId))
      .limit(1);
    expect(bRow).toBeTruthy();
    const res = await request(app)
      .post(`/api/me/addresses/${bRow!.id}/touch`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(404);
  });
});

describe("Saved addresses — PATCH default behavior", () => {
  it("setting a new default clears the previous one", async () => {
    await clearAddresses(userAId);
    const first = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "First" });
    const second = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Second" });
    expect(first.body.isDefault).toBe(true);
    expect(second.body.isDefault).toBe(false);

    const promote = await request(app)
      .patch(`/api/me/addresses/${second.body.id}`)
      .set("Cookie", cookieA)
      .send({ isDefault: true });
    expect(promote.status).toBe(200);
    expect(promote.body.isDefault).toBe(true);

    const rows = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.userId, userAId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.body.id)?.isDefault).toBe(false);
    expect(byId.get(second.body.id)?.isDefault).toBe(true);
  });

  it("refuses to unset the default when it is the only address", async () => {
    await clearAddresses(userAId);
    const only = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Only" });
    expect(only.body.isDefault).toBe(true);

    const res = await request(app)
      .patch(`/api/me/addresses/${only.body.id}`)
      .set("Cookie", cookieA)
      .send({ isDefault: false });
    expect(res.status).toBe(400);

    const [row] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.id, only.body.id));
    expect(row?.isDefault).toBe(true);
  });
});

describe("Saved addresses — DELETE promotes next default", () => {
  it("deleting the default promotes another entry", async () => {
    await clearAddresses(userAId);
    const first = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "First" });
    const second = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Second" });
    expect(first.body.isDefault).toBe(true);
    expect(second.body.isDefault).toBe(false);

    const del = await request(app)
      .delete(`/api/me/addresses/${first.body.id}`)
      .set("Cookie", cookieA);
    expect(del.status).toBe(204);

    const [row] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.id, second.body.id));
    expect(row?.isDefault).toBe(true);
  });

  it("deleting a non-default address does not change the default", async () => {
    await clearAddresses(userAId);
    const first = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Keep" });
    const second = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Drop" });

    const del = await request(app)
      .delete(`/api/me/addresses/${second.body.id}`)
      .set("Cookie", cookieA);
    expect(del.status).toBe(204);

    const [row] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.id, first.body.id));
    expect(row?.isDefault).toBe(true);
  });
});

describe("Saved addresses — TOUCH bumps lastUsedAt and promotes default", () => {
  it("touch sets lastUsedAt and makes the address default", async () => {
    await clearAddresses(userAId);
    const first = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "First" });
    const second = await request(app)
      .post("/api/me/addresses")
      .set("Cookie", cookieA)
      .send({ ...SAMPLE, label: "Second" });
    expect(first.body.isDefault).toBe(true);
    expect(second.body.lastUsedAt).toBeNull();

    const before = Date.now();
    const res = await request(app)
      .post(`/api/me/addresses/${second.body.id}/touch`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.lastUsedAt).not.toBeNull();
    const touchedAt = new Date(res.body.lastUsedAt).getTime();
    expect(touchedAt).toBeGreaterThanOrEqual(before - 1000);

    const [firstRow] = await db
      .select()
      .from(userAddressesTable)
      .where(eq(userAddressesTable.id, first.body.id));
    expect(firstRow?.isDefault).toBe(false);
  });
});
