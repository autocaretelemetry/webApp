import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { inArray, eq } from "drizzle-orm";
import { db, usersTable, notificationsTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task61-notif";
const USER_A_EMAIL = `${TAG}-a@autocare.test`;
const USER_B_EMAIL = `${TAG}-b@autocare.test`;
const USER_A_PHONE = `+99900061001`;
const USER_B_PHONE = `+99900061002`;
const PASSWORD = "test-password-1234";

async function seedUser(email: string, phone: string, name: string) {
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

async function seedNotification(ownerPhone: string, dedupeKey: string) {
  const [row] = await db
    .insert(notificationsTable)
    .values({
      ownerPhone,
      kind: "reminder",
      title: `Hello ${ownerPhone}`,
      body: "test notification",
      dedupeKey,
    })
    .returning();
  return row!;
}

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

let notifAId: string;
let notifBId: string;
let cookieA: string;

async function cleanup() {
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.ownerPhone, [USER_A_PHONE, USER_B_PHONE]));
  await db
    .delete(usersTable)
    .where(inArray(usersTable.email, [USER_A_EMAIL, USER_B_EMAIL]));
}

beforeAll(async () => {
  await cleanup();
  await seedUser(USER_A_EMAIL, USER_A_PHONE, "User A");
  await seedUser(USER_B_EMAIL, USER_B_PHONE, "User B");
  notifAId = (await seedNotification(USER_A_PHONE, `${TAG}-a-1`)).id;
  notifBId = (await seedNotification(USER_B_PHONE, `${TAG}-b-1`)).id;
  cookieA = await loginCookie(USER_A_EMAIL);
});

afterAll(async () => {
  await cleanup();
});

describe("Notifications access isolation", () => {
  it("ignores a spoofed ownerPhone on GET and returns only the caller's notifications", async () => {
    const res = await request(app)
      .get(`/api/notifications?ownerPhone=${encodeURIComponent(USER_B_PHONE)}`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string; ownerPhone: string }>).map(
      (r) => r.id,
    );
    expect(ids).toContain(notifAId);
    expect(ids).not.toContain(notifBId);
    for (const row of res.body as Array<{ ownerPhone: string }>) {
      expect(row.ownerPhone).toBe(USER_A_PHONE);
    }
  });

  it("returns the caller's notifications when no ownerPhone is supplied", async () => {
    const res = await request(app)
      .get(`/api/notifications`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain(notifAId);
    expect(ids).not.toContain(notifBId);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(
      `/api/notifications?ownerPhone=${encodeURIComponent(USER_A_PHONE)}`,
    );
    expect(res.status).toBe(401);
  });

  it("403s when user A tries to mark user B's notification read", async () => {
    const res = await request(app)
      .patch(`/api/notifications/${notifBId}/read`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(403);

    const [row] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, notifBId));
    expect(row?.readAt).toBeNull();
  });

  it("403s when a regular user tries to generate platform-wide reminders", async () => {
    const res = await request(app)
      .post(`/api/notifications/generate-reminders`)
      .set("Cookie", cookieA)
      .send({});
    expect(res.status).toBe(403);
  });

  it("ignores spoofed ownerPhone on mark-all-read and only touches caller's rows", async () => {
    const res = await request(app)
      .post(`/api/notifications/mark-all-read`)
      .set("Cookie", cookieA)
      .send({ ownerPhone: USER_B_PHONE });
    expect(res.status).toBe(204);

    const [bRow] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, notifBId));
    expect(bRow?.readAt).toBeNull();

    const [aRow] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, notifAId));
    expect(aRow?.readAt).not.toBeNull();
  });
});
