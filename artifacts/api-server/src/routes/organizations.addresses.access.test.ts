import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  organizationsTable,
  organizationMembersTable,
  organizationAddressesTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task62-orgaddr";
const PASSWORD = "test-password-1234";

const ORG_A_SLUG = `${TAG}-org-a`;
const ORG_B_SLUG = `${TAG}-org-b`;

const USERS = {
  adminA: { email: `${TAG}-admin-a@autocare.test`, phone: `+99900062001`, name: "Admin A", role: "fleet" as const },
  financeA: { email: `${TAG}-finance-a@autocare.test`, phone: `+99900062002`, name: "Finance A", role: "fleet" as const },
  managerA: { email: `${TAG}-manager-a@autocare.test`, phone: `+99900062003`, name: "Manager A", role: "fleet" as const },
  driverA: { email: `${TAG}-driver-a@autocare.test`, phone: `+99900062004`, name: "Driver A", role: "fleet" as const },
  outsider: { email: `${TAG}-outsider@autocare.test`, phone: `+99900062005`, name: "Outsider", role: "owner" as const },
  adminB: { email: `${TAG}-admin-b@autocare.test`, phone: `+99900062006`, name: "Admin B", role: "fleet" as const },
};
type UserKey = keyof typeof USERS;

const SAMPLE = {
  label: "HQ",
  recipientName: "Receiving Desk",
  recipientPhone: "+233200000000",
  addressLine: "1 Industrial Ave",
  city: "Accra",
  region: "Greater Accra",
};

async function seedUser(key: UserKey): Promise<string> {
  const u = USERS[key];
  const [row] = await db
    .insert(usersTable)
    .values({
      email: u.email.toLowerCase(),
      passwordHash: hashPassword(PASSWORD),
      name: u.name,
      role: u.role,
      phone: u.phone,
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

const emails = () => Object.values(USERS).map((u) => u.email.toLowerCase());
const slugs = () => [ORG_A_SLUG, ORG_B_SLUG];

async function cleanup() {
  const orgRows = await db
    .select({ id: organizationsTable.id })
    .from(organizationsTable)
    .where(inArray(organizationsTable.slug, slugs()));
  const orgIds = orgRows.map((r) => r.id);
  if (orgIds.length > 0) {
    await db
      .delete(organizationAddressesTable)
      .where(inArray(organizationAddressesTable.organizationId, orgIds));
    await db
      .delete(organizationMembersTable)
      .where(inArray(organizationMembersTable.organizationId, orgIds));
    await db
      .delete(organizationsTable)
      .where(inArray(organizationsTable.id, orgIds));
  }
  await db.delete(usersTable).where(inArray(usersTable.email, emails()));
}

let orgAId: string;
let orgBId: string;
const cookies: Partial<Record<UserKey, string>> = {};

beforeAll(async () => {
  await cleanup();

  for (const key of Object.keys(USERS) as UserKey[]) {
    await seedUser(key);
  }

  const [orgA] = await db
    .insert(organizationsTable)
    .values({
      name: `${TAG} Org A`,
      slug: ORG_A_SLUG,
      contactName: USERS.adminA.name,
      contactPhone: USERS.adminA.phone,
    })
    .returning({ id: organizationsTable.id });
  const [orgB] = await db
    .insert(organizationsTable)
    .values({
      name: `${TAG} Org B`,
      slug: ORG_B_SLUG,
      contactName: USERS.adminB.name,
      contactPhone: USERS.adminB.phone,
    })
    .returning({ id: organizationsTable.id });
  orgAId = orgA!.id;
  orgBId = orgB!.id;

  await db.insert(organizationMembersTable).values([
    { organizationId: orgAId, phone: USERS.adminA.phone, name: USERS.adminA.name, role: "admin" },
    { organizationId: orgAId, phone: USERS.financeA.phone, name: USERS.financeA.name, role: "finance" },
    { organizationId: orgAId, phone: USERS.managerA.phone, name: USERS.managerA.name, role: "manager" },
    { organizationId: orgAId, phone: USERS.driverA.phone, name: USERS.driverA.name, role: "driver" },
    { organizationId: orgBId, phone: USERS.adminB.phone, name: USERS.adminB.name, role: "admin" },
  ]);

  for (const key of Object.keys(USERS) as UserKey[]) {
    cookies[key] = await loginCookie(USERS[key].email);
  }
});

afterAll(async () => {
  await cleanup();
});

async function resetAddresses() {
  await db
    .delete(organizationAddressesTable)
    .where(inArray(organizationAddressesTable.organizationId, [orgAId, orgBId]));
}

async function createAddress(cookie: string, orgId: string, body: Partial<typeof SAMPLE> & { label: string; isDefault?: boolean }) {
  const res = await request(app)
    .post(`/api/organizations/${orgId}/addresses`)
    .set("Cookie", cookie)
    .send({ ...SAMPLE, ...body });
  expect(res.status, `create ${body.label} failed: ${res.text}`).toBe(201);
  return res.body as { id: string; isDefault: boolean; label: string };
}

describe("Org address book — auth", () => {
  beforeEach(resetAddresses);

  it("401s when unauthenticated", async () => {
    const list = await request(app).get(`/api/organizations/${orgAId}/addresses`);
    expect(list.status).toBe(401);
    const create = await request(app)
      .post(`/api/organizations/${orgAId}/addresses`)
      .send(SAMPLE);
    expect(create.status).toBe(401);
  });

  it("403s when caller is not a member of the org", async () => {
    const list = await request(app)
      .get(`/api/organizations/${orgAId}/addresses`)
      .set("Cookie", cookies.outsider!);
    expect(list.status).toBe(403);
    const create = await request(app)
      .post(`/api/organizations/${orgAId}/addresses`)
      .set("Cookie", cookies.outsider!)
      .send(SAMPLE);
    expect(create.status).toBe(403);
  });
});

describe("Org address book — list + touch open to every member", () => {
  beforeEach(async () => {
    await resetAddresses();
    await createAddress(cookies.adminA!, orgAId, { label: "Seeded" });
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
    ["manager", "managerA"],
    ["driver", "driverA"],
  ] as Array<[string, UserKey]>)("%s member can list", async (_role, key) => {
    const res = await request(app)
      .get(`/api/organizations/${orgAId}/addresses`)
      .set("Cookie", cookies[key]!);
    expect(res.status).toBe(200);
    expect(res.body.addresses).toHaveLength(1);
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
    ["manager", "managerA"],
    ["driver", "driverA"],
  ] as Array<[string, UserKey]>)("%s member can touch an address", async (_role, key) => {
    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.organizationId, orgAId));
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/addresses/${row!.id}/touch`)
      .set("Cookie", cookies[key]!);
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);
    expect(res.body.lastUsedAt).not.toBeNull();
  });
});

describe("Org address book — mutation gated to admin/finance/manager", () => {
  beforeEach(resetAddresses);

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
    ["manager", "managerA"],
  ] as Array<[string, UserKey]>)("%s can create", async (_role, key) => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/addresses`)
      .set("Cookie", cookies[key]!)
      .send({ ...SAMPLE, label: `By ${key}` });
    expect(res.status).toBe(201);
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
    ["manager", "managerA"],
  ] as Array<[string, UserKey]>)("%s can PATCH an address", async (_role, key) => {
    const created = await createAddress(cookies.adminA!, orgAId, { label: "Original" });
    const res = await request(app)
      .patch(`/api/organizations/${orgAId}/addresses/${created.id}`)
      .set("Cookie", cookies[key]!)
      .send({ label: `Edited by ${key}` });
    expect(res.status).toBe(200);
    expect(res.body.label).toBe(`Edited by ${key}`);
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
    ["manager", "managerA"],
  ] as Array<[string, UserKey]>)("%s can DELETE an address", async (_role, key) => {
    // Keep an extra row so deleting doesn't run into the only-default
    // promotion path; we just want to assert the mutation is allowed.
    await createAddress(cookies.adminA!, orgAId, { label: "Keep" });
    const target = await createAddress(cookies.adminA!, orgAId, { label: `Drop by ${key}` });
    const res = await request(app)
      .delete(`/api/organizations/${orgAId}/addresses/${target.id}`)
      .set("Cookie", cookies[key]!);
    expect(res.status).toBe(204);
    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, target.id));
    expect(row).toBeUndefined();
  });

  it("driver cannot create", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/addresses`)
      .set("Cookie", cookies.driverA!)
      .send({ ...SAMPLE, label: "Driver attempt" });
    expect(res.status).toBe(403);
  });

  it("driver cannot update or delete", async () => {
    const created = await createAddress(cookies.adminA!, orgAId, { label: "Locked" });
    const patch = await request(app)
      .patch(`/api/organizations/${orgAId}/addresses/${created.id}`)
      .set("Cookie", cookies.driverA!)
      .send({ label: "Hijack" });
    expect(patch.status).toBe(403);
    const del = await request(app)
      .delete(`/api/organizations/${orgAId}/addresses/${created.id}`)
      .set("Cookie", cookies.driverA!);
    expect(del.status).toBe(403);

    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, created.id));
    expect(row?.label).toBe("Locked");
  });
});

describe("Org address book — default-row invariants", () => {
  beforeEach(resetAddresses);

  it("first inserted row auto-becomes the default", async () => {
    const first = await createAddress(cookies.managerA!, orgAId, { label: "First" });
    expect(first.isDefault).toBe(true);
  });

  it("second row stays non-default unless requested", async () => {
    await createAddress(cookies.managerA!, orgAId, { label: "First" });
    const second = await createAddress(cookies.managerA!, orgAId, { label: "Second" });
    expect(second.isDefault).toBe(false);
  });

  it("only one default per org at a time (create with isDefault clears the previous one)", async () => {
    const first = await createAddress(cookies.managerA!, orgAId, { label: "First" });
    const second = await createAddress(cookies.managerA!, orgAId, {
      label: "Second",
      isDefault: true,
    });
    expect(second.isDefault).toBe(true);

    const rows = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.organizationId, orgAId));
    const defaults = rows.filter((r) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
    expect(rows.find((r) => r.id === first.id)?.isDefault).toBe(false);
  });

  it("PATCH isDefault=true clears every other default", async () => {
    const first = await createAddress(cookies.managerA!, orgAId, { label: "First" });
    const second = await createAddress(cookies.managerA!, orgAId, { label: "Second" });
    const promote = await request(app)
      .patch(`/api/organizations/${orgAId}/addresses/${second.id}`)
      .set("Cookie", cookies.managerA!)
      .send({ isDefault: true });
    expect(promote.status).toBe(200);
    expect(promote.body.isDefault).toBe(true);

    const rows = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.organizationId, orgAId));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(first.id)?.isDefault).toBe(false);
    expect(byId.get(second.id)?.isDefault).toBe(true);
  });

  it("touch promotes the touched row to default and demotes the previous one", async () => {
    const first = await createAddress(cookies.adminA!, orgAId, { label: "First" });
    const second = await createAddress(cookies.adminA!, orgAId, { label: "Second" });
    expect(first.isDefault).toBe(true);

    const res = await request(app)
      .post(`/api/organizations/${orgAId}/addresses/${second.id}/touch`)
      .set("Cookie", cookies.adminA!);
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(true);

    const rows = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.organizationId, orgAId));
    const defaults = rows.filter((r) => r.isDefault);
    expect(defaults).toHaveLength(1);
    expect(defaults[0]!.id).toBe(second.id);
  });

  it("deleting the default promotes the next entry", async () => {
    const first = await createAddress(cookies.adminA!, orgAId, { label: "First" });
    const second = await createAddress(cookies.adminA!, orgAId, { label: "Second" });
    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);

    const del = await request(app)
      .delete(`/api/organizations/${orgAId}/addresses/${first.id}`)
      .set("Cookie", cookies.adminA!);
    expect(del.status).toBe(204);

    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, second.id));
    expect(row?.isDefault).toBe(true);
  });

  it("deleting a non-default address leaves the existing default alone", async () => {
    const first = await createAddress(cookies.adminA!, orgAId, { label: "Keep" });
    const second = await createAddress(cookies.adminA!, orgAId, { label: "Drop" });

    const del = await request(app)
      .delete(`/api/organizations/${orgAId}/addresses/${second.id}`)
      .set("Cookie", cookies.adminA!);
    expect(del.status).toBe(204);

    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, first.id));
    expect(row?.isDefault).toBe(true);
  });

  it("rejects clearing the default when it is the only entry", async () => {
    const only = await createAddress(cookies.adminA!, orgAId, { label: "Only" });
    expect(only.isDefault).toBe(true);

    const res = await request(app)
      .patch(`/api/organizations/${orgAId}/addresses/${only.id}`)
      .set("Cookie", cookies.adminA!)
      .send({ isDefault: false });
    expect(res.status).toBe(400);

    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, only.id));
    expect(row?.isDefault).toBe(true);
  });
});

describe("Org address book — cross-org IDOR isolation", () => {
  beforeEach(resetAddresses);

  it("org A members cannot list org B's address book", async () => {
    await createAddress(cookies.adminB!, orgBId, { label: "B HQ" });
    const res = await request(app)
      .get(`/api/organizations/${orgBId}/addresses`)
      .set("Cookie", cookies.adminA!);
    expect(res.status).toBe(403);
  });

  it("org A admin cannot PATCH an org B address", async () => {
    const bRow = await createAddress(cookies.adminB!, orgBId, { label: "B Original" });
    const patch = await request(app)
      .patch(`/api/organizations/${orgBId}/addresses/${bRow.id}`)
      .set("Cookie", cookies.adminA!)
      .send({ label: "Hijacked" });
    expect(patch.status).toBe(403);
    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, bRow.id));
    expect(row?.label).toBe("B Original");
  });

  it("org A admin cannot DELETE an org B address", async () => {
    const bRow = await createAddress(cookies.adminB!, orgBId, { label: "B Survive" });
    const del = await request(app)
      .delete(`/api/organizations/${orgBId}/addresses/${bRow.id}`)
      .set("Cookie", cookies.adminA!);
    expect(del.status).toBe(403);
    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, bRow.id));
    expect(row).toBeTruthy();
  });

  it("org A driver cannot TOUCH an org B address", async () => {
    const bRow = await createAddress(cookies.adminB!, orgBId, { label: "B Touchable" });
    const res = await request(app)
      .post(`/api/organizations/${orgBId}/addresses/${bRow.id}/touch`)
      .set("Cookie", cookies.driverA!);
    expect(res.status).toBe(403);
  });

  it("treating an org B address id as if it lived under org A returns 404", async () => {
    const bRow = await createAddress(cookies.adminB!, orgBId, { label: "B Foreign" });
    const res = await request(app)
      .patch(`/api/organizations/${orgAId}/addresses/${bRow.id}`)
      .set("Cookie", cookies.adminA!)
      .send({ label: "Should fail" });
    expect(res.status).toBe(404);

    const [row] = await db
      .select()
      .from(organizationAddressesTable)
      .where(
        and(
          eq(organizationAddressesTable.id, bRow.id),
          eq(organizationAddressesTable.organizationId, orgBId),
        ),
      );
    expect(row?.label).toBe("B Foreign");
  });
});
