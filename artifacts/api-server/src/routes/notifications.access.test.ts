import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { and, inArray, eq, desc } from "drizzle-orm";
import { db, usersTable, notificationsTable, reminderRunsTable } from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";
import { runReminderJob } from "../lib/reminders";

const TAG = "task61-notif";
const USER_A_EMAIL = `${TAG}-a@autocare.test`;
const USER_B_EMAIL = `${TAG}-b@autocare.test`;
const USER_A_PHONE = `+99900061001`;
const USER_B_PHONE = `+99900061002`;
const ADMIN_EMAIL = `${TAG}-admin@autocare.test`;
const ADMIN_PHONE = `+99900061003`;
const PASSWORD = "test-password-1234";

async function seedUser(
  email: string,
  phone: string,
  name: string,
  role: "owner" | "admin" = "owner",
) {
  const [row] = await db
    .insert(usersTable)
    .values({
      email: email.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name,
      role,
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
let cookieAdmin: string;

async function cleanup() {
  await db
    .delete(notificationsTable)
    .where(inArray(notificationsTable.ownerPhone, [USER_A_PHONE, USER_B_PHONE]));
  await db
    .delete(usersTable)
    .where(inArray(usersTable.email, [USER_A_EMAIL, USER_B_EMAIL, ADMIN_EMAIL]));
}

beforeAll(async () => {
  await cleanup();
  await seedUser(USER_A_EMAIL, USER_A_PHONE, "User A");
  await seedUser(USER_B_EMAIL, USER_B_PHONE, "User B");
  await seedUser(ADMIN_EMAIL, ADMIN_PHONE, "Admin", "admin");
  notifAId = (await seedNotification(USER_A_PHONE, `${TAG}-a-1`)).id;
  notifBId = (await seedNotification(USER_B_PHONE, `${TAG}-b-1`)).id;
  cookieA = await loginCookie(USER_A_EMAIL);
  cookieAdmin = await loginCookie(ADMIN_EMAIL);
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

  it("403s on GET /notifications/reminder-runs for non-admin", async () => {
    const res = await request(app)
      .get(`/api/notifications/reminder-runs`)
      .set("Cookie", cookieA);
    expect(res.status).toBe(403);
  });

  it("200s on GET /notifications/reminder-runs for admin and returns rows", async () => {
    const res = await request(app)
      .get(`/api/notifications/reminder-runs`)
      .set("Cookie", cookieAdmin);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
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

describe("runReminderJob persists run rows", () => {
  it("records a success row with the created count when the generator returns", async () => {
    const before = new Date();
    const result = await runReminderJob("manual");
    expect(result.status).toBe("success");
    expect(result.errorMessage).toBeNull();

    const [row] = await db
      .select()
      .from(reminderRunsTable)
      .where(eq(reminderRunsTable.id, result.runId));
    expect(row).toBeDefined();
    expect(row!.status).toBe("success");
    expect(row!.trigger).toBe("manual");
    expect(row!.createdCount).toBe(result.created);
    expect(row!.errorMessage).toBeNull();
    expect(row!.finishedAt).not.toBeNull();
    expect(row!.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });

  it("records an error row with the thrown message when the generator throws", async () => {
    const spy = vi
      .spyOn(db, "select")
      .mockImplementationOnce(() => {
        throw new Error("boom-task75");
      });
    try {
      const result = await runReminderJob("scheduler");
      expect(result.status).toBe("error");
      expect(result.created).toBe(0);
      expect(result.errorMessage).toBe("boom-task75");

      spy.mockRestore();

      const [row] = await db
        .select()
        .from(reminderRunsTable)
        .where(eq(reminderRunsTable.id, result.runId));
      expect(row).toBeDefined();
      expect(row!.status).toBe("error");
      expect(row!.trigger).toBe("scheduler");
      expect(row!.createdCount).toBe(0);
      expect(row!.errorMessage).toBe("boom-task75");
      expect(row!.finishedAt).not.toBeNull();
    } finally {
      spy.mockRestore();
    }
  });

  it("drops an in-app notification into every admin's queue when a run fails, and dedupes by error+day", async () => {
    // Clean any prior failure notifications for this admin so the dedupe
    // assertion is unambiguous.
    await db
      .delete(notificationsTable)
      .where(eq(notificationsTable.ownerPhone, ADMIN_PHONE));

    const errMsg = "alert-task80-unique-boom";
    const spy = vi
      .spyOn(db, "select")
      .mockImplementationOnce(() => {
        throw new Error(errMsg);
      });
    try {
      const r1 = await runReminderJob("scheduler");
      spy.mockRestore();
      expect(r1.status).toBe("error");

      const after1 = await db
        .select()
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.ownerPhone, ADMIN_PHONE),
            eq(notificationsTable.kind, "reminder_job_failed"),
          ),
        )
        .orderBy(desc(notificationsTable.createdAt));
      expect(after1.length).toBe(1);
      expect(after1[0]!.body).toContain(errMsg);

      // A second failure with the same message on the same day must NOT
      // create another row (per-error-per-day dedupe).
      const spy2 = vi
        .spyOn(db, "select")
        .mockImplementationOnce(() => {
          throw new Error(errMsg);
        });
      const r2 = await runReminderJob("scheduler");
      spy2.mockRestore();
      expect(r2.status).toBe("error");
      const after2 = await db
        .select()
        .from(notificationsTable)
        .where(
          and(
            eq(notificationsTable.ownerPhone, ADMIN_PHONE),
            eq(notificationsTable.kind, "reminder_job_failed"),
          ),
        );
      expect(after2.length).toBe(1);
    } finally {
      spy.mockRestore();
      await db
        .delete(notificationsTable)
        .where(eq(notificationsTable.ownerPhone, ADMIN_PHONE));
    }
  });

  it("surfaces the most recent runs to admins via GET /notifications/reminder-runs", async () => {
    const result = await runReminderJob("external");
    const res = await request(app)
      .get(`/api/notifications/reminder-runs`)
      .set("Cookie", cookieAdmin);
    expect(res.status).toBe(200);
    const rows = res.body as Array<{ id: string; trigger: string }>;
    const found = rows.find((r) => r.id === result.runId);
    expect(found).toBeDefined();
    expect(found!.trigger).toBe("external");
    const ordered = [...rows].sort(
      (a, b) =>
        new Date((b as unknown as { startedAt: string }).startedAt).getTime() -
        new Date((a as unknown as { startedAt: string }).startedAt).getTime(),
    );
    expect(rows.map((r) => r.id)).toEqual(ordered.map((r) => r.id));
  });
});
