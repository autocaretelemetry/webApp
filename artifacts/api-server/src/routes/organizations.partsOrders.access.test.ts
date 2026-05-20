import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  usersTable,
  organizationsTable,
  organizationMembersTable,
  fleetPartsOrdersTable,
} from "@workspace/db";
import app from "../app";
import { hashPassword } from "../lib/auth";

const TAG = "task64-partsorders";
const PASSWORD = "test-password-1234";

const ORG_A_SLUG = `${TAG}-org-a`;
const ORG_B_SLUG = `${TAG}-org-b`;

const USERS = {
  adminA: { email: `${TAG}-admin-a@autocare.test`, phone: `+99900064001`, name: "Admin A", role: "fleet" as const },
  financeA: { email: `${TAG}-finance-a@autocare.test`, phone: `+99900064002`, name: "Finance A", role: "fleet" as const },
  managerA: { email: `${TAG}-manager-a@autocare.test`, phone: `+99900064003`, name: "Manager A", role: "fleet" as const },
  driverA: { email: `${TAG}-driver-a@autocare.test`, phone: `+99900064004`, name: "Driver A", role: "fleet" as const },
  trustedDriverA: { email: `${TAG}-trusted-driver-a@autocare.test`, phone: `+99900064005`, name: "Trusted Driver A", role: "fleet" as const },
  outsider: { email: `${TAG}-outsider@autocare.test`, phone: `+99900064006`, name: "Outsider", role: "owner" as const },
  adminB: { email: `${TAG}-admin-b@autocare.test`, phone: `+99900064007`, name: "Admin B", role: "fleet" as const },
  financeB: { email: `${TAG}-finance-b@autocare.test`, phone: `+99900064008`, name: "Finance B", role: "fleet" as const },
  platformAdmin: { email: `${TAG}-platform-admin@autocare.test`, phone: `+99900064009`, name: "Platform Admin", role: "admin" as const },
};
type UserKey = keyof typeof USERS;

const ITEM = {
  partId: "11111111-1111-1111-1111-111111111111",
  vendorId: "22222222-2222-2222-2222-222222222222",
  vendorName: "Acme Parts",
  name: "Brake Pad",
  sku: "BP-001",
  unitPrice: 50,
  quantity: 2,
};

const SAMPLE_BODY = {
  items: [ITEM],
  totalAmount: 100,
  shippingAddress: "1 Industrial Ave, Accra",
  deliveryCity: "Accra",
  deliveryRegion: "Greater Accra",
  notes: null as string | null,
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
      .delete(fleetPartsOrdersTable)
      .where(inArray(fleetPartsOrdersTable.organizationId, orgIds));
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
      requireFinanceApproval: true,
    })
    .returning({ id: organizationsTable.id });
  const [orgB] = await db
    .insert(organizationsTable)
    .values({
      name: `${TAG} Org B`,
      slug: ORG_B_SLUG,
      contactName: USERS.adminB.name,
      contactPhone: USERS.adminB.phone,
      requireFinanceApproval: true,
    })
    .returning({ id: organizationsTable.id });
  orgAId = orgA!.id;
  orgBId = orgB!.id;

  await db.insert(organizationMembersTable).values([
    { organizationId: orgAId, phone: USERS.adminA.phone, name: USERS.adminA.name, role: "admin" },
    { organizationId: orgAId, phone: USERS.financeA.phone, name: USERS.financeA.name, role: "finance" },
    { organizationId: orgAId, phone: USERS.managerA.phone, name: USERS.managerA.name, role: "manager" },
    { organizationId: orgAId, phone: USERS.driverA.phone, name: USERS.driverA.name, role: "driver" },
    {
      organizationId: orgAId,
      phone: USERS.trustedDriverA.phone,
      name: USERS.trustedDriverA.name,
      role: "driver",
      canCheckoutDirectly: true,
    },
    { organizationId: orgBId, phone: USERS.adminB.phone, name: USERS.adminB.name, role: "admin" },
    { organizationId: orgBId, phone: USERS.financeB.phone, name: USERS.financeB.name, role: "finance" },
  ]);

  for (const key of Object.keys(USERS) as UserKey[]) {
    cookies[key] = await loginCookie(USERS[key].email);
  }
});

afterAll(async () => {
  await cleanup();
});

async function resetOrders() {
  await db
    .delete(fleetPartsOrdersTable)
    .where(inArray(fleetPartsOrdersTable.organizationId, [orgAId, orgBId]));
}

async function setOrgApproval(orgId: string, required: boolean) {
  await db
    .update(organizationsTable)
    .set({ requireFinanceApproval: required })
    .where(eq(organizationsTable.id, orgId));
}

async function setMemberOverride(orgId: string, phone: string, can: boolean) {
  await db
    .update(organizationMembersTable)
    .set({ canCheckoutDirectly: can })
    .where(
      and(
        eq(organizationMembersTable.organizationId, orgId),
        eq(organizationMembersTable.phone, phone),
      ),
    );
}

async function createOrder(
  cookie: string,
  orgId: string,
  body: Partial<typeof SAMPLE_BODY> & { mode?: "pay_now" | "submit_for_approval" } = {},
) {
  return await request(app)
    .post(`/api/organizations/${orgId}/parts-orders`)
    .set("Cookie", cookie)
    .send({ ...SAMPLE_BODY, ...body });
}

describe("Fleet parts orders — checkout authorization", () => {
  beforeEach(async () => {
    await resetOrders();
    await setOrgApproval(orgAId, true);
    await setMemberOverride(orgAId, USERS.trustedDriverA.phone, true);
    await setMemberOverride(orgAId, USERS.driverA.phone, false);
  });

  it("401s when unauthenticated", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders`)
      .send({ ...SAMPLE_BODY, mode: "submit_for_approval" });
    expect(res.status).toBe(401);
  });

  it("403s when caller is not a member of the org", async () => {
    const res = await createOrder(cookies.outsider!, orgAId, { mode: "submit_for_approval" });
    expect(res.status).toBe(403);
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
  ] as Array<[string, UserKey]>)("%s can pay directly even when approval is required", async (_role, key) => {
    const res = await createOrder(cookies[key]!, orgAId, { mode: "pay_now" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.status).toBe("paid");
    expect(res.body.paidByPhone).toBe(USERS[key].phone);
    expect(res.body.approvedByPhone).toBe(USERS[key].phone);
  });

  it.each([
    ["manager", "managerA"],
    ["driver", "driverA"],
  ] as Array<[string, UserKey]>)("%s pay_now is rejected with approval_required when org requires approval", async (_role, key) => {
    const res = await createOrder(cookies[key]!, orgAId, { mode: "pay_now" });
    expect(res.status).toBe(403);
    expect(res.body.reason).toBe("approval_required");
  });

  it.each([
    ["manager", "managerA"],
    ["driver", "driverA"],
  ] as Array<[string, UserKey]>)("%s submit_for_approval lands in pending_finance", async (_role, key) => {
    const res = await createOrder(cookies[key]!, orgAId, { mode: "submit_for_approval" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.status).toBe("pending_finance");
    expect(res.body.requestedByPhone).toBe(USERS[key].phone);
    expect(res.body.paidAt).toBeNull();
  });

  it("per-member canCheckoutDirectly lets a driver pay directly", async () => {
    const res = await createOrder(cookies.trustedDriverA!, orgAId, { mode: "pay_now" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.status).toBe("paid");
    expect(res.body.paidByPhone).toBe(USERS.trustedDriverA.phone);
  });

  it("when requireFinanceApproval=false, manager/driver can pay_now without the per-member override", async () => {
    await setOrgApproval(orgAId, false);
    const manager = await createOrder(cookies.managerA!, orgAId, { mode: "pay_now" });
    expect(manager.status, manager.text).toBe(201);
    expect(manager.body.status).toBe("paid");

    const driver = await createOrder(cookies.driverA!, orgAId, { mode: "pay_now" });
    expect(driver.status, driver.text).toBe(201);
    expect(driver.body.status).toBe("paid");
  });

  it("platform admin can pay_now on any org", async () => {
    const res = await createOrder(cookies.platformAdmin!, orgAId, { mode: "pay_now" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.status).toBe("paid");
  });
});

describe("Fleet parts orders — approve / reject authorization", () => {
  let pendingOrderId: string;

  beforeEach(async () => {
    await resetOrders();
    await setOrgApproval(orgAId, true);
    const created = await createOrder(cookies.managerA!, orgAId, { mode: "submit_for_approval" });
    expect(created.status).toBe(201);
    pendingOrderId = created.body.id;
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
  ] as Array<[string, UserKey]>)("%s can pay a pending order", async (_role, key) => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/pay`)
      .set("Cookie", cookies[key]!);
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("paid");
    expect(res.body.paidByPhone).toBe(USERS[key].phone);
  });

  it.each([
    ["manager", "managerA"],
    ["driver", "driverA"],
  ] as Array<[string, UserKey]>)("%s cannot pay a pending order", async (_role, key) => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/pay`)
      .set("Cookie", cookies[key]!);
    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(fleetPartsOrdersTable)
      .where(eq(fleetPartsOrdersTable.id, pendingOrderId));
    expect(row?.status).toBe("pending_finance");
  });

  it("non-member cannot pay", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/pay`)
      .set("Cookie", cookies.outsider!);
    expect(res.status).toBe(403);
  });

  it.each([
    ["admin", "adminA"],
    ["finance", "financeA"],
  ] as Array<[string, UserKey]>)("%s can reject a pending order", async (_role, key) => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/reject`)
      .set("Cookie", cookies[key]!)
      .send({ reason: "Out of budget" });
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("rejected");
    expect(res.body.rejectionReason).toBe("Out of budget");
    expect(res.body.rejectedByPhone).toBe(USERS[key].phone);
  });

  it.each([
    ["manager", "managerA"],
    ["driver", "driverA"],
  ] as Array<[string, UserKey]>)("%s cannot reject a pending order", async (_role, key) => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/reject`)
      .set("Cookie", cookies[key]!)
      .send({ reason: "no" });
    expect(res.status).toBe(403);
  });

  it("non-member cannot reject", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/reject`)
      .set("Cookie", cookies.outsider!)
      .send({ reason: "no" });
    expect(res.status).toBe(403);
  });

  it("trusted driver (canCheckoutDirectly) can pay their OWN pending order", async () => {
    const own = await createOrder(cookies.trustedDriverA!, orgAId, { mode: "submit_for_approval" });
    expect(own.status).toBe(201);
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${own.body.id}/pay`)
      .set("Cookie", cookies.trustedDriverA!);
    expect(res.status, res.text).toBe(200);
    expect(res.body.status).toBe("paid");
  });

  it("trusted driver cannot pay someone else's pending order", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${pendingOrderId}/pay`)
      .set("Cookie", cookies.trustedDriverA!);
    expect(res.status).toBe(403);
  });
});

describe("Fleet parts orders — cross-org IDOR isolation", () => {
  let orgBOrderId: string;

  beforeEach(async () => {
    await resetOrders();
    const created = await createOrder(cookies.adminB!, orgBId, { mode: "submit_for_approval" });
    expect(created.status).toBe(201);
    orgBOrderId = created.body.id;
  });

  it("org A admin cannot list org B's parts orders", async () => {
    const res = await request(app)
      .get(`/api/organizations/${orgBId}/parts-orders`)
      .set("Cookie", cookies.adminA!);
    expect(res.status).toBe(403);
  });

  it("org A finance cannot pay an org B order", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgBId}/parts-orders/${orgBOrderId}/pay`)
      .set("Cookie", cookies.financeA!);
    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(fleetPartsOrdersTable)
      .where(eq(fleetPartsOrdersTable.id, orgBOrderId));
    expect(row?.status).toBe("pending_finance");
  });

  it("org A finance cannot reject an org B order", async () => {
    const res = await request(app)
      .post(`/api/organizations/${orgBId}/parts-orders/${orgBOrderId}/reject`)
      .set("Cookie", cookies.financeA!)
      .send({ reason: "nope" });
    expect(res.status).toBe(403);
    const [row] = await db
      .select()
      .from(fleetPartsOrdersTable)
      .where(eq(fleetPartsOrdersTable.id, orgBOrderId));
    expect(row?.status).toBe("pending_finance");
  });

  it("treating an org B order id as if it lived under org A returns 404", async () => {
    const pay = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${orgBOrderId}/pay`)
      .set("Cookie", cookies.financeA!);
    expect(pay.status).toBe(404);
    const reject = await request(app)
      .post(`/api/organizations/${orgAId}/parts-orders/${orgBOrderId}/reject`)
      .set("Cookie", cookies.financeA!)
      .send({ reason: "no" });
    expect(reject.status).toBe(404);

    const [row] = await db
      .select()
      .from(fleetPartsOrdersTable)
      .where(eq(fleetPartsOrdersTable.id, orgBOrderId));
    expect(row?.status).toBe("pending_finance");
    expect(row?.organizationId).toBe(orgBId);
  });
});

describe("Fleet parts orders — list scoping", () => {
  beforeEach(async () => {
    await resetOrders();
    await setOrgApproval(orgAId, true);
  });

  it("finance/admin see every order; drivers/managers see only their own", async () => {
    const a = await createOrder(cookies.managerA!, orgAId, { mode: "submit_for_approval" });
    const b = await createOrder(cookies.driverA!, orgAId, { mode: "submit_for_approval" });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    const adminList = await request(app)
      .get(`/api/organizations/${orgAId}/parts-orders`)
      .set("Cookie", cookies.adminA!);
    expect(adminList.status).toBe(200);
    expect(adminList.body.orders).toHaveLength(2);

    const financeList = await request(app)
      .get(`/api/organizations/${orgAId}/parts-orders`)
      .set("Cookie", cookies.financeA!);
    expect(financeList.status).toBe(200);
    expect(financeList.body.orders).toHaveLength(2);

    const driverList = await request(app)
      .get(`/api/organizations/${orgAId}/parts-orders`)
      .set("Cookie", cookies.driverA!);
    expect(driverList.status).toBe(200);
    expect(driverList.body.orders).toHaveLength(1);
    expect(driverList.body.orders[0].requestedByPhone).toBe(USERS.driverA.phone);

    const managerList = await request(app)
      .get(`/api/organizations/${orgAId}/parts-orders`)
      .set("Cookie", cookies.managerA!);
    expect(managerList.status).toBe(200);
    expect(managerList.body.orders).toHaveLength(1);
    expect(managerList.body.orders[0].requestedByPhone).toBe(USERS.managerA.phone);
  });
});
