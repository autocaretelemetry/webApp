import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, count, desc, eq, inArray, ne, sql, sum } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembersTable,
  organizationPreferredCentersTable,
  organizationAddressesTable,
  vehiclesTable,
  serviceCentersTable,
  bookingsTable,
  invoicesTable,
  fleetTripLocationsTable,
  fleetIncidentsTable,
  fleetPartsOrdersTable,
  ORG_MEMBER_ROLES,
  type Organization,
  type OrganizationMember,
  type OrganizationAddress,
} from "@workspace/db";
import { requireAuth, requireSuperAdmin } from "../lib/auth";
import { getEntitlements } from "../lib/entitlements";
import { subscriptionsTable, subscriptionPlansTable } from "@workspace/db";
import { computeReminders } from "../lib/reminders";
import { createOwnerNotification } from "../lib/notify";
import PDFDocument from "pdfkit";

const router: IRouter = Router();

// ───────── Helpers ─────────

function isPlatformAdmin(req: Request): boolean {
  return req.user?.role === "admin" || req.user?.role === "super_admin";
}

type OrgRole = "admin" | "finance" | "manager" | "driver";

// Roles considered "finance-level" for parts-order approval/payment + billing
// access. Admins are always included so a small org can run without a
// dedicated finance person.
const FINANCE_LEVEL_ROLES: OrgRole[] = ["admin", "finance"];

/**
 * True when the actor may checkout (pay) a parts order directly without
 * finance approval. Admins/finance always can. Other members can only
 * when the org doesn't require finance approval OR they have the
 * per-member override. Platform admins always pass.
 */
function canCheckoutDirectly(
  m: { org: Organization; member: OrganizationMember | null; isPlatform: boolean },
): boolean {
  if (m.isPlatform) return true;
  if (!m.member) return false;
  if (FINANCE_LEVEL_ROLES.includes(m.member.role as OrgRole)) return true;
  if (!m.org.requireFinanceApproval) return true;
  return m.member.canCheckoutDirectly;
}

function isFinanceLevel(
  m: { member: OrganizationMember | null; isPlatform: boolean },
): boolean {
  if (m.isPlatform) return true;
  return !!m.member && FINANCE_LEVEL_ROLES.includes(m.member.role as OrgRole);
}

/**
 * Ensure the authenticated user is a member of the org (or a platform
 * admin) and optionally has a minimum org-role. Returns `null` after
 * writing a 401/403/404 response when authorization fails, so callers
 * should `if (!membership) return;` immediately after.
 *
 * Platform admins synthesize an "admin" membership so they can manage
 * any org for support/QA purposes, but they are NOT auto-added to the
 * members table — visible membership stays the org's own list.
 *
 * `minRole === "admin"` accepts only admin; for other gates use
 * `isFinanceLevel()` / `canCheckoutDirectly()` on the returned member.
 */
async function requireOrgMember(
  req: Request,
  res: Response,
  orgId: string,
  minRole?: OrgRole,
): Promise<{ org: Organization; member: OrganizationMember | null; isPlatform: boolean } | null> {
  const [org] = await db
    .select()
    .from(organizationsTable)
    .where(eq(organizationsTable.id, orgId));
  if (!org) {
    res.status(404).json({ error: "Organization not found" });
    return null;
  }
  if (isPlatformAdmin(req)) {
    return { org, member: null, isPlatform: true };
  }
  const phone = req.user?.phone;
  if (!phone) {
    res.status(403).json({ error: "Not a member of this organization" });
    return null;
  }
  const [member] = await db
    .select()
    .from(organizationMembersTable)
    .where(
      and(
        eq(organizationMembersTable.organizationId, orgId),
        eq(organizationMembersTable.phone, phone),
      ),
    );
  if (!member) {
    res.status(403).json({ error: "Not a member of this organization" });
    return null;
  }
  if (minRole === "admin" && member.role !== "admin") {
    res.status(403).json({ error: "Org admin only" });
    return null;
  }
  return { org, member, isPlatform: false };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

// ───────── Schemas ─────────

const CreateOrgBody = z.object({
  name: z.string().min(2),
  industry: z.string().optional(),
  contactName: z.string().min(2),
  contactPhone: z.string().min(6),
  contactEmail: z.string().email().optional(),
  billingAddress: z.string().optional(),
  city: z.string().optional(),
  region: z.string().optional(),
  logoUrl: z.string().url().optional(),
});

const UpdateOrgBody = CreateOrgBody.partial().extend({
  requireFinanceApproval: z.boolean().optional(),
});

const UpsertMemberBody = z.object({
  phone: z.string().min(6),
  name: z.string().min(2),
  role: z.enum(ORG_MEMBER_ROLES).default("driver"),
  canCheckoutDirectly: z.boolean().optional(),
});

const CreatePartsOrderBody = z.object({
  items: z
    .array(
      z.object({
        partId: z.string().uuid(),
        vendorId: z.string().uuid(),
        vendorName: z.string(),
        name: z.string(),
        sku: z.string(),
        unitPrice: z.number().nonnegative(),
        quantity: z.number().int().min(1),
        imageUrl: z.string().nullable().optional(),
      }),
    )
    .min(1),
  totalAmount: z.number().nonnegative(),
  shippingAddress: z.string().min(3),
  deliveryCity: z.string().nullable().optional(),
  deliveryRegion: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  // If "pay_now", the requester must have direct-checkout permission;
  // otherwise the server forces "submit_for_approval".
  mode: z.enum(["submit_for_approval", "pay_now"]).default("submit_for_approval"),
});

const RejectPartsOrderBody = z.object({
  reason: z.string().min(1).max(500),
});

const PayPartsOrderBody = z.object({
  note: z.string().trim().max(500).optional(),
});

const ReplacePreferredCentersBody = z.object({
  serviceCenterIds: z.array(z.string().uuid()),
});

const OrgAddressBody = z.object({
  label: z.string().trim().min(1).max(60),
  recipientName: z.string().trim().min(1).max(120),
  recipientPhone: z.string().trim().min(1).max(40),
  addressLine: z.string().trim().min(1).max(500),
  city: z.string().trim().max(120).optional().default(""),
  region: z.string().trim().max(120).optional().default(""),
  isDefault: z.boolean().optional(),
});

const OrgAddressPatch = OrgAddressBody.partial();

const CreateFleetVehicleBody = z.object({
  brand: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(2100),
  plateNumber: z.string().min(1),
  color: z.string().min(1),
  vin: z.string().optional(),
  engineType: z.string().optional(),
  mileage: z.number().int().min(0).optional(),
  imageUrl: z.string().url().optional(),
  insuranceProvider: z.string().optional(),
  assignedDriverPhone: z.string().optional(),
});

const UpdateFleetVehicleBody = z.object({
  assignedDriverPhone: z.string().nullable().optional(),
  mileage: z.number().int().min(0).optional(),
  insuranceProvider: z.string().optional(),
  imageUrl: z.string().url().optional(),
});

// ───────── Routes ─────────

// List orgs the current user belongs to. Used by the web client to drive
// the role switch / org picker.
router.get("/organizations/mine", requireAuth, async (req, res): Promise<void> => {
  const phone = req.user!.phone;
  if (!phone) {
    res.json({ organizations: [] });
    return;
  }
  const memberships = await db
    .select({
      org: organizationsTable,
      role: organizationMembersTable.role,
      canCheckoutDirectly: organizationMembersTable.canCheckoutDirectly,
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationMembersTable.organizationId, organizationsTable.id),
    )
    .where(eq(organizationMembersTable.phone, phone));
  res.json({
    organizations: memberships.map((m) => ({
      ...m.org,
      myRole: m.role,
      myCanCheckoutDirectly: m.canCheckoutDirectly,
    })),
  });
});

// Super-admin: list every organization on the platform with rollup counts
// and the active subscription plan name. Powers the super-admin
// "Institutions & Fleets" page.
router.get(
  "/admin/organizations",
  requireAuth,
  requireSuperAdmin,
  async (_req, res): Promise<void> => {
    const orgs = await db
      .select()
      .from(organizationsTable)
      .orderBy(desc(organizationsTable.createdAt));
    if (orgs.length === 0) {
      res.json({ organizations: [] });
      return;
    }
    const orgIds = orgs.map((o) => o.id);
    const [memberCounts, vehicleCounts, centerCounts, subs] = await Promise.all([
      db
        .select({
          organizationId: organizationMembersTable.organizationId,
          c: count(),
        })
        .from(organizationMembersTable)
        .where(inArray(organizationMembersTable.organizationId, orgIds))
        .groupBy(organizationMembersTable.organizationId),
      db
        .select({
          organizationId: vehiclesTable.organizationId,
          c: count(),
        })
        .from(vehiclesTable)
        .where(inArray(vehiclesTable.organizationId, orgIds))
        .groupBy(vehiclesTable.organizationId),
      db
        .select({
          organizationId: organizationPreferredCentersTable.organizationId,
          c: count(),
        })
        .from(organizationPreferredCentersTable)
        .where(inArray(organizationPreferredCentersTable.organizationId, orgIds))
        .groupBy(organizationPreferredCentersTable.organizationId),
      db
        .select({
          subscriberId: subscriptionsTable.subscriberId,
          planName: subscriptionPlansTable.name,
          status: subscriptionsTable.status,
          startedAt: subscriptionsTable.startedAt,
        })
        .from(subscriptionsTable)
        .innerJoin(
          subscriptionPlansTable,
          eq(subscriptionsTable.planId, subscriptionPlansTable.id),
        )
        .where(
          and(
            eq(subscriptionsTable.subscriberKind, "organization"),
            eq(subscriptionsTable.status, "active"),
            inArray(subscriptionsTable.subscriberId, orgIds),
          ),
        )
        .orderBy(desc(subscriptionsTable.startedAt)),
    ]);
    const memberByOrg = new Map(memberCounts.map((r) => [r.organizationId, Number(r.c)]));
    const vehicleByOrg = new Map(
      vehicleCounts
        .filter((r): r is { organizationId: string; c: number } => r.organizationId !== null)
        .map((r) => [r.organizationId, Number(r.c)]),
    );
    const centerByOrg = new Map(centerCounts.map((r) => [r.organizationId, Number(r.c)]));
    // First (newest active) sub wins per org.
    const planByOrg = new Map<string, string>();
    for (const s of subs) {
      if (!planByOrg.has(s.subscriberId)) planByOrg.set(s.subscriberId, s.planName);
    }
    res.json({
      organizations: orgs.map((o) => ({
        ...o,
        memberCount: memberByOrg.get(o.id) ?? 0,
        vehicleCount: vehicleByOrg.get(o.id) ?? 0,
        preferredCenterCount: centerByOrg.get(o.id) ?? 0,
        planName: planByOrg.get(o.id) ?? null,
      })),
    });
  },
);

// Signup. The creator becomes the first admin member.
router.post("/organizations", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateOrgBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const slug = `${slugify(parsed.data.name)}-${Date.now().toString(36).slice(-4)}`;
  const [org] = await db
    .insert(organizationsTable)
    .values({ ...parsed.data, slug })
    .returning();
  await db.insert(organizationMembersTable).values({
    organizationId: org.id,
    phone: req.user!.phone ?? parsed.data.contactPhone,
    name: req.user!.name ?? parsed.data.contactName,
    role: "admin",
  });
  res.status(201).json(org);
});

router.get("/organizations/:orgId", requireAuth, async (req, res): Promise<void> => {
  const m = await requireOrgMember(req, res, String(req.params.orgId));
  if (!m) return;
  res.json(m.org);
});

router.patch("/organizations/:orgId", requireAuth, async (req, res): Promise<void> => {
  const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
  if (!m) return;
  const parsed = UpdateOrgBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [updated] = await db
    .update(organizationsTable)
    .set(parsed.data)
    .where(eq(organizationsTable.id, m.org.id))
    .returning();
  res.json(updated);
});

// ───── Members ─────

router.get(
  "/organizations/:orgId/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    // Driver role doesn't get the team directory — phones + override
    // flags are admin/finance/manager material. Keep this in sync with
    // `fleetNavFor()` in AppShell which already hides /fleet/drivers.
    if (!m.isPlatform && m.member && m.member.role === "driver") {
      res.status(403).json({ error: "Drivers cannot view the team directory." });
      return;
    }
    const members = await db
      .select()
      .from(organizationMembersTable)
      .where(eq(organizationMembersTable.organizationId, m.org.id))
      .orderBy(desc(organizationMembersTable.createdAt));
    res.json({ members });
  },
);

router.post(
  "/organizations/:orgId/members",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const parsed = UpsertMemberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Upsert by (orgId, phone). Allows re-inviting / role change in one call.
    const [existing] = await db
      .select()
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, m.org.id),
          eq(organizationMembersTable.phone, parsed.data.phone),
        ),
      );
    if (existing) {
      const [updated] = await db
        .update(organizationMembersTable)
        .set({
          name: parsed.data.name,
          role: parsed.data.role,
          ...(parsed.data.canCheckoutDirectly !== undefined
            ? { canCheckoutDirectly: parsed.data.canCheckoutDirectly }
            : {}),
        })
        .where(
          and(
            eq(organizationMembersTable.organizationId, m.org.id),
            eq(organizationMembersTable.phone, parsed.data.phone),
          ),
        )
        .returning();
      res.json(updated);
      return;
    }
    const [inserted] = await db
      .insert(organizationMembersTable)
      .values({
        organizationId: m.org.id,
        phone: parsed.data.phone,
        name: parsed.data.name,
        role: parsed.data.role,
        canCheckoutDirectly: parsed.data.canCheckoutDirectly ?? false,
      })
      .returning();
    res.status(201).json(inserted);
  },
);

router.delete(
  "/organizations/:orgId/members/:phone",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    // Guard: can't remove the last admin — would orphan the org. The
    // check uses the strict `admin` role only (finance/manager/driver
    // don't count for this purpose).
    const admins = await db
      .select({ phone: organizationMembersTable.phone })
      .from(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, m.org.id),
          eq(organizationMembersTable.role, "admin"),
        ),
      );
    if (admins.length === 1 && admins[0].phone === String(req.params.phone)) {
      res
        .status(400)
        .json({ error: "Cannot remove the last admin from the organization." });
      return;
    }
    await db
      .delete(organizationMembersTable)
      .where(
        and(
          eq(organizationMembersTable.organizationId, m.org.id),
          eq(organizationMembersTable.phone, String(req.params.phone)),
        ),
      );
    res.status(204).send();
  },
);

// ───── Preferred centers ─────

router.get(
  "/organizations/:orgId/preferred-centers",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    const rows = await db
      .select({ center: serviceCentersTable })
      .from(organizationPreferredCentersTable)
      .innerJoin(
        serviceCentersTable,
        eq(organizationPreferredCentersTable.serviceCenterId, serviceCentersTable.id),
      )
      .where(eq(organizationPreferredCentersTable.organizationId, m.org.id));
    res.json({ centers: rows.map((r) => r.center) });
  },
);

router.put(
  "/organizations/:orgId/preferred-centers",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const parsed = ReplacePreferredCentersBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Validate the candidate ids actually exist before we wipe and replace.
    if (parsed.data.serviceCenterIds.length > 0) {
      const found = await db
        .select({ id: serviceCentersTable.id })
        .from(serviceCentersTable)
        .where(inArray(serviceCentersTable.id, parsed.data.serviceCenterIds));
      if (found.length !== parsed.data.serviceCenterIds.length) {
        res.status(400).json({ error: "Unknown service center id" });
        return;
      }
    }
    await db
      .delete(organizationPreferredCentersTable)
      .where(eq(organizationPreferredCentersTable.organizationId, m.org.id));
    if (parsed.data.serviceCenterIds.length > 0) {
      await db.insert(organizationPreferredCentersTable).values(
        parsed.data.serviceCenterIds.map((id: string) => ({
          organizationId: m.org.id,
          serviceCenterId: id,
        })),
      );
    }
    res.status(204).send();
  },
);

// ───── Saved shipping addresses (org-scoped address book) ─────

/**
 * Org-scoped address book used by fleet parts-order checkout. Mirrors the
 * per-user `/me/addresses` book but rows are visible to every member, so
 * managers/drivers see the same HQ/branch entries the admin set up. Any
 * member may list (drivers need it to pick at checkout) and bump
 * `lastUsedAt`; create/update/delete are gated to admin/finance/manager
 * because driver members shouldn't be able to alter where the org's
 * deliveries land.
 */

const ADDRESS_MUTATION_ROLES: OrgRole[] = ["admin", "finance", "manager"];

function canMutateOrgAddresses(
  m: { member: OrganizationMember | null; isPlatform: boolean },
): boolean {
  if (m.isPlatform) return true;
  return !!m.member && ADDRESS_MUTATION_ROLES.includes(m.member.role as OrgRole);
}

function toOrgAddressDto(row: OrganizationAddress) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    label: row.label,
    recipientName: row.recipientName,
    recipientPhone: row.recipientPhone,
    addressLine: row.addressLine,
    city: row.city,
    region: row.region,
    isDefault: row.isDefault,
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
    createdByPhone: row.createdByPhone,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function clearOtherOrgDefaults(orgId: string, exceptId?: string) {
  const whereClause = exceptId
    ? and(
        eq(organizationAddressesTable.organizationId, orgId),
        sql`${organizationAddressesTable.id} <> ${exceptId}`,
      )
    : eq(organizationAddressesTable.organizationId, orgId);
  await db
    .update(organizationAddressesTable)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(whereClause);
}

router.get(
  "/organizations/:orgId/addresses",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    // Sort: default first, then most-recently-used, then newest. The
    // client renders the dropdown in this order and uses the first row
    // as the auto-preselect.
    const rows = await db
      .select()
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.organizationId, m.org.id))
      .orderBy(
        desc(organizationAddressesTable.isDefault),
        desc(
          sql`coalesce(${organizationAddressesTable.lastUsedAt}, ${organizationAddressesTable.createdAt})`,
        ),
        desc(organizationAddressesTable.createdAt),
      );
    res.json({ addresses: rows.map(toOrgAddressDto) });
  },
);

router.post(
  "/organizations/:orgId/addresses",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    if (!canMutateOrgAddresses(m)) {
      res.status(403).json({
        error: "Only admins, finance, and managers can edit the fleet address book.",
      });
      return;
    }
    const parsed = OrgAddressBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const existing = await db
      .select({ id: organizationAddressesTable.id })
      .from(organizationAddressesTable)
      .where(eq(organizationAddressesTable.organizationId, m.org.id));
    // First address always becomes the default — checkout expects exactly
    // one preselected entry once the book is non-empty.
    const shouldBeDefault = parsed.data.isDefault === true || existing.length === 0;
    if (shouldBeDefault) {
      await clearOtherOrgDefaults(m.org.id);
    }
    const [row] = await db
      .insert(organizationAddressesTable)
      .values({
        organizationId: m.org.id,
        label: parsed.data.label,
        recipientName: parsed.data.recipientName,
        recipientPhone: parsed.data.recipientPhone,
        addressLine: parsed.data.addressLine,
        city: parsed.data.city ?? "",
        region: parsed.data.region ?? "",
        isDefault: shouldBeDefault,
        createdByPhone: req.user!.phone ?? null,
      })
      .returning();
    if (!row) {
      res.status(500).json({ error: "Could not save address" });
      return;
    }
    res.status(201).json(toOrgAddressDto(row));
  },
);

router.patch(
  "/organizations/:orgId/addresses/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    if (!canMutateOrgAddresses(m)) {
      res.status(403).json({
        error: "Only admins, finance, and managers can edit the fleet address book.",
      });
      return;
    }
    const parsed = OrgAddressPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const id = String(req.params.id);
    const [current] = await db
      .select()
      .from(organizationAddressesTable)
      .where(
        and(
          eq(organizationAddressesTable.id, id),
          eq(organizationAddressesTable.organizationId, m.org.id),
        ),
      );
    if (!current) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    const patch: Partial<typeof organizationAddressesTable.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (parsed.data.label !== undefined) patch.label = parsed.data.label;
    if (parsed.data.recipientName !== undefined)
      patch.recipientName = parsed.data.recipientName;
    if (parsed.data.recipientPhone !== undefined)
      patch.recipientPhone = parsed.data.recipientPhone;
    if (parsed.data.addressLine !== undefined)
      patch.addressLine = parsed.data.addressLine;
    if (parsed.data.city !== undefined) patch.city = parsed.data.city ?? "";
    if (parsed.data.region !== undefined)
      patch.region = parsed.data.region ?? "";
    const makingDefault = parsed.data.isDefault === true;
    const clearingDefault =
      parsed.data.isDefault === false && current.isDefault;
    if (makingDefault) {
      await clearOtherOrgDefaults(m.org.id, id);
      patch.isDefault = true;
    } else if (clearingDefault) {
      const others = await db
        .select({ id: organizationAddressesTable.id })
        .from(organizationAddressesTable)
        .where(
          and(
            eq(organizationAddressesTable.organizationId, m.org.id),
            sql`${organizationAddressesTable.id} <> ${id}`,
          ),
        );
      if (others.length === 0) {
        res.status(400).json({
          error: "At least one address must be marked as default.",
        });
        return;
      }
      patch.isDefault = false;
    }
    const [row] = await db
      .update(organizationAddressesTable)
      .set(patch)
      .where(eq(organizationAddressesTable.id, id))
      .returning();
    res.json(toOrgAddressDto(row!));
  },
);

router.delete(
  "/organizations/:orgId/addresses/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    if (!canMutateOrgAddresses(m)) {
      res.status(403).json({
        error: "Only admins, finance, and managers can edit the fleet address book.",
      });
      return;
    }
    const id = String(req.params.id);
    const [current] = await db
      .select()
      .from(organizationAddressesTable)
      .where(
        and(
          eq(organizationAddressesTable.id, id),
          eq(organizationAddressesTable.organizationId, m.org.id),
        ),
      );
    if (!current) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    await db
      .delete(organizationAddressesTable)
      .where(eq(organizationAddressesTable.id, id));
    // If we just removed the default, promote the most-recently-used
    // surviving entry so checkout still has a preselected address.
    if (current.isDefault) {
      const [next] = await db
        .select({ id: organizationAddressesTable.id })
        .from(organizationAddressesTable)
        .where(eq(organizationAddressesTable.organizationId, m.org.id))
        .orderBy(
          desc(
            sql`coalesce(${organizationAddressesTable.lastUsedAt}, ${organizationAddressesTable.createdAt})`,
          ),
          desc(organizationAddressesTable.createdAt),
        )
        .limit(1);
      if (next) {
        await db
          .update(organizationAddressesTable)
          .set({ isDefault: true, updatedAt: new Date() })
          .where(eq(organizationAddressesTable.id, next.id));
      }
    }
    res.status(204).end();
  },
);

// Bump lastUsedAt and promote to default. Any member may call this —
// it fires after a successful fleet parts-order checkout so the next
// visit preselects the address they just shipped to.
router.post(
  "/organizations/:orgId/addresses/:id/touch",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    const id = String(req.params.id);
    const [current] = await db
      .select()
      .from(organizationAddressesTable)
      .where(
        and(
          eq(organizationAddressesTable.id, id),
          eq(organizationAddressesTable.organizationId, m.org.id),
        ),
      );
    if (!current) {
      res.status(404).json({ error: "Address not found" });
      return;
    }
    await clearOtherOrgDefaults(m.org.id, id);
    const [row] = await db
      .update(organizationAddressesTable)
      .set({ lastUsedAt: new Date(), isDefault: true, updatedAt: new Date() })
      .where(eq(organizationAddressesTable.id, id))
      .returning();
    res.json(toOrgAddressDto(row!));
  },
);

// ───── Fleet vehicles ─────

router.get(
  "/organizations/:orgId/vehicles",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    let vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.organizationId, m.org.id))
      .orderBy(desc(vehiclesTable.createdAt));
    // Driver members only see their assigned vehicles.
    if (m.member?.role === "driver") {
      vehicles = vehicles.filter((v) => v.assignedDriverPhone === m.member!.phone);
    }
    res.json({ vehicles });
  },
);

router.post(
  "/organizations/:orgId/vehicles",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const parsed = CreateFleetVehicleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Enforce fleet-size cap.
    const limits = await getEntitlements("organization", m.org.id);
    const [{ value: existingCount }] = await db
      .select({ value: count(vehiclesTable.id) })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.organizationId, m.org.id));
    if (
      limits.maxFleetVehicles !== null &&
      existingCount >= limits.maxFleetVehicles
    ) {
      res.status(402).json({
        error: `Fleet vehicle cap (${limits.maxFleetVehicles}) reached. Upgrade the Fleet plan to add more.`,
        reason: "quota_exceeded",
      });
      return;
    }
    const [inserted] = await db
      .insert(vehiclesTable)
      .values({
        organizationId: m.org.id,
        // Owner-phone is set to the org's contact phone so existing
        // owner-scoped UI/queries keep working uniformly.
        ownerName: m.org.name,
        ownerPhone: m.org.contactPhone,
        brand: parsed.data.brand,
        model: parsed.data.model,
        year: parsed.data.year,
        plateNumber: parsed.data.plateNumber,
        color: parsed.data.color,
        vin: parsed.data.vin ?? null,
        engineType: parsed.data.engineType ?? null,
        mileage: parsed.data.mileage ?? 0,
        imageUrl: parsed.data.imageUrl ?? null,
        insuranceProvider: parsed.data.insuranceProvider ?? null,
        assignedDriverPhone: parsed.data.assignedDriverPhone ?? null,
      })
      .returning();
    res.status(201).json(inserted);
  },
);

router.patch(
  "/organizations/:orgId/vehicles/:vehicleId",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const parsed = UpdateFleetVehicleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Sanity: vehicle must belong to this org.
    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, String(req.params.vehicleId)));
    if (!vehicle || vehicle.organizationId !== m.org.id) {
      res.status(404).json({ error: "Vehicle not found in this fleet" });
      return;
    }
    const [updated] = await db
      .update(vehiclesTable)
      .set(parsed.data)
      .where(eq(vehiclesTable.id, vehicle.id))
      .returning();
    res.json(updated);
  },
);

// ───── Dashboard / reminders / parts spend ─────

router.get(
  "/organizations/:orgId/dashboard",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    const allVehicles = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.organizationId, m.org.id));
    // Drivers only see vehicles assigned to them; admins (and platform
    // admins acting as synthetic admins) see the full fleet.
    const driverScoped =
      !m.isPlatform && m.member?.role === "driver";
    const vehicles = driverScoped
      ? allVehicles.filter((v) => v.assignedDriverPhone === m.member!.phone)
      : allVehicles;
    const vehicleIds = vehicles.map((v) => v.id);
    const limits = await getEntitlements("organization", m.org.id);

    let openByStatus: Record<string, number> = {};
    let recentBookings: typeof bookings = [];
    let bookings: (typeof bookingsTable.$inferSelect)[] = [];
    let totalSpend = 0;
    let invoiceCount = 0;
    if (vehicleIds.length > 0) {
      bookings = await db
        .select()
        .from(bookingsTable)
        .where(inArray(bookingsTable.vehicleId, vehicleIds));
      openByStatus = bookings.reduce<Record<string, number>>((acc, b) => {
        acc[b.status] = (acc[b.status] ?? 0) + 1;
        return acc;
      }, {});
      recentBookings = [...bookings]
        .sort((a, b) =>
          (b.requestedAt?.getTime() ?? 0) - (a.requestedAt?.getTime() ?? 0),
        )
        .slice(0, 8);
      const invoiceIds = bookings.map((b) => b.invoiceId).filter((id): id is string => !!id);
      if (invoiceIds.length > 0) {
        const [agg] = await db
          .select({
            total: sum(invoicesTable.total).mapWith(Number),
            n: count(invoicesTable.id),
          })
          .from(invoicesTable)
          .where(inArray(invoicesTable.id, invoiceIds));
        totalSpend = Number(agg.total ?? 0);
        invoiceCount = Number(agg.n ?? 0);
      }
    }

    const reminders = vehicles
      .flatMap((v) => computeReminders(v).map((r) => ({ ...r, vehicle: v })))
      .sort((a, b) =>
        (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity),
      );

    res.json({
      organization: m.org,
      limits,
      counts: {
        vehicles: vehicles.length,
        maxVehicles: limits.maxFleetVehicles,
        openJobs:
          (openByStatus["requested"] ?? 0) +
          (openByStatus["accepted"] ?? 0) +
          (openByStatus["in_progress"] ?? 0) +
          (openByStatus["awaiting_approval"] ?? 0),
        completedJobs: openByStatus["completed"] ?? 0,
        totalSpend,
        invoiceCount,
      },
      openByStatus,
      reminders: reminders.slice(0, 20),
      recentBookings,
    });
  },
);

router.get(
  "/organizations/:orgId/parts-spend",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const limits = await getEntitlements("organization", m.org.id);
    if (!limits.partsCostTransparency && !m.isPlatform) {
      res.status(402).json({
        error: "Parts-cost transparency requires a Fleet plan upgrade.",
        reason: "entitlement_required",
      });
      return;
    }
    const vehicles = await db
      .select({ id: vehiclesTable.id })
      .from(vehiclesTable)
      .where(eq(vehiclesTable.organizationId, m.org.id));
    if (vehicles.length === 0) {
      res.json({ totalParts: 0, totalLabour: 0, lines: [] });
      return;
    }
    const bookings = await db
      .select({ id: bookingsTable.id, invoiceId: bookingsTable.invoiceId })
      .from(bookingsTable)
      .where(
        and(
          inArray(
            bookingsTable.vehicleId,
            vehicles.map((v) => v.id),
          ),
          ne(bookingsTable.status, "cancelled"),
        ),
      );
    const invoiceIds = bookings.map((b) => b.invoiceId).filter((id): id is string => !!id);
    if (invoiceIds.length === 0) {
      res.json({ totalParts: 0, totalLabour: 0, lines: [] });
      return;
    }
    const invoices = await db
      .select()
      .from(invoicesTable)
      .where(inArray(invoicesTable.id, invoiceIds));
    // Sum parts vs labour across line items. We treat any line with
    // `category === 'part'` (or kind === 'part' depending on shape)
    // as a part; everything else rolls up to labour/other.
    let totalParts = 0;
    let totalLabour = 0;
    const lines: Array<{ invoiceId: string; description: string; amount: number; category: string }> = [];
    for (const inv of invoices) {
      // Use the rolled-up totals stored on the invoice header so this
      // matches what the customer was actually charged, then surface
      // each line item too so admins can audit specific parts.
      totalParts += Number(inv.partsTotal ?? 0);
      totalLabour += Number(inv.laborTotal ?? 0);
      for (const li of inv.items ?? []) {
        const amount = Number(li.unitPrice ?? 0) * Number(li.quantity ?? 1);
        lines.push({
          invoiceId: inv.id,
          description: li.description ?? "(no description)",
          amount,
          category: li.kind === "part" ? "part" : "labour",
        });
      }
    }
    res.json({ totalParts, totalLabour, lines });
  },
);

// ───────── Safety & Tracking ─────────

/**
 * Resolve a vehicle inside the org and confirm the caller may act on it.
 * Platform admins and org admins always pass; drivers only pass for the
 * vehicle they're assigned to. Mirrors the rentals `authorizeBookingAccess`
 * pattern so we never accidentally expose another driver's data.
 */
async function requireOrgVehicle(
  req: Request,
  res: Response,
  orgId: string,
  vehicleId: string,
) {
  const m = await requireOrgMember(req, res, orgId);
  if (!m) return null;
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, vehicleId));
  if (!vehicle || vehicle.organizationId !== orgId) {
    res.status(404).json({ error: "Vehicle not found in this fleet" });
    return null;
  }
  const isAdminLevel = m.isPlatform || m.member?.role === "admin";
  if (!isAdminLevel) {
    // Driver — must be the assigned driver for this vehicle.
    if (vehicle.assignedDriverPhone !== m.member?.phone) {
      res.status(403).json({ error: "Not authorised for this vehicle" });
      return null;
    }
  }
  return { m, vehicle, isAdminLevel };
}

const locationInput = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  speedKph: z.number().nonnegative().optional(),
  accuracyMeters: z.number().int().nonnegative().optional(),
  note: z.string().max(500).optional(),
});

router.post(
  "/organizations/:orgId/vehicles/:vehicleId/locations",
  requireAuth,
  async (req, res): Promise<void> => {
    const ctx = await requireOrgVehicle(
      req,
      res,
      String(req.params.orgId),
      String(req.params.vehicleId),
    );
    if (!ctx) return;
    const parsed = locationInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid location", issues: parsed.error.issues });
      return;
    }
    const [ping] = await db
      .insert(fleetTripLocationsTable)
      .values({
        vehicleId: ctx.vehicle.id,
        lat: parsed.data.lat,
        lng: parsed.data.lng,
        speedKph: parsed.data.speedKph,
        accuracyMeters: parsed.data.accuracyMeters,
        note: parsed.data.note,
        source: ctx.isAdminLevel ? "admin" : "driver",
      })
      .returning();
    res.status(201).json(ping);
  },
);

const incidentInput = z.object({
  kind: z.enum(["accident", "breakdown", "theft", "sos"]),
  notes: z.string().max(2000).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

router.post(
  "/organizations/:orgId/vehicles/:vehicleId/incidents",
  requireAuth,
  async (req, res): Promise<void> => {
    const ctx = await requireOrgVehicle(
      req,
      res,
      String(req.params.orgId),
      String(req.params.vehicleId),
    );
    if (!ctx) return;
    const parsed = incidentInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid incident", issues: parsed.error.issues });
      return;
    }

    // If caller shipped coordinates, also drop a fresh ping so the
    // safety dashboard shows the most accurate last-known position.
    let lastKnownLat: number | null = null;
    let lastKnownLng: number | null = null;
    let lastKnownAt: Date | null = null;
    if (parsed.data.lat !== undefined && parsed.data.lng !== undefined) {
      const [ping] = await db
        .insert(fleetTripLocationsTable)
        .values({
          vehicleId: ctx.vehicle.id,
          lat: parsed.data.lat,
          lng: parsed.data.lng,
          source: ctx.isAdminLevel ? "admin" : "driver",
          note: `incident:${parsed.data.kind}`,
        })
        .returning();
      lastKnownLat = ping.lat;
      lastKnownLng = ping.lng;
      lastKnownAt = ping.recordedAt;
    } else {
      const [latest] = await db
        .select()
        .from(fleetTripLocationsTable)
        .where(eq(fleetTripLocationsTable.vehicleId, ctx.vehicle.id))
        .orderBy(desc(fleetTripLocationsTable.recordedAt))
        .limit(1);
      if (latest) {
        lastKnownLat = latest.lat;
        lastKnownLng = latest.lng;
        lastKnownAt = latest.recordedAt;
      }
    }

    const [inc] = await db
      .insert(fleetIncidentsTable)
      .values({
        vehicleId: ctx.vehicle.id,
        organizationId: ctx.m.org.id,
        kind: parsed.data.kind,
        // reportedBy is derived from the verified relationship — never
        // trust a client-supplied value here.
        reportedBy: ctx.isAdminLevel ? "admin" : "driver",
        reporterPhone: ctx.m.member?.phone ?? null,
        notes: parsed.data.notes,
        lastKnownLat,
        lastKnownLng,
        lastKnownAt,
      })
      .returning();
    res.status(201).json(inc);
  },
);

router.get(
  "/organizations/:orgId/safety",
  requireAuth,
  async (req, res): Promise<void> => {
    // Org-wide safety triage is admin-only — drivers don't need to see
    // other drivers' incidents or locations.
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.organizationId, m.org.id));
    const vehicleIds = vehicles.map((v) => v.id);

    let latestByVehicle: Record<string, typeof fleetTripLocationsTable.$inferSelect> = {};
    let incidents: (typeof fleetIncidentsTable.$inferSelect)[] = [];
    if (vehicleIds.length > 0) {
      const pings = await db
        .select()
        .from(fleetTripLocationsTable)
        .where(inArray(fleetTripLocationsTable.vehicleId, vehicleIds))
        .orderBy(desc(fleetTripLocationsTable.recordedAt));
      for (const p of pings) {
        if (!latestByVehicle[p.vehicleId]) latestByVehicle[p.vehicleId] = p;
      }
      incidents = await db
        .select()
        .from(fleetIncidentsTable)
        .where(eq(fleetIncidentsTable.organizationId, m.org.id))
        .orderBy(desc(fleetIncidentsTable.reportedAt));
    }

    res.json({
      vehicles: vehicles.map((v) => ({
        id: v.id,
        brand: v.brand,
        model: v.model,
        year: v.year,
        plateNumber: v.plateNumber,
        assignedDriverPhone: v.assignedDriverPhone,
        lastPing: latestByVehicle[v.id] ?? null,
      })),
      incidents,
    });
  },
);

const incidentPatch = z.object({
  status: z.enum(["open", "investigating", "resolved"]).optional(),
  adminNotes: z.string().max(2000).optional(),
});

router.patch(
  "/organizations/:orgId/incidents/:incidentId",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    const parsed = incidentPatch.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid update", issues: parsed.error.issues });
      return;
    }
    const [existing] = await db
      .select()
      .from(fleetIncidentsTable)
      .where(eq(fleetIncidentsTable.id, String(req.params.incidentId)));
    if (!existing || existing.organizationId !== m.org.id) {
      res.status(404).json({ error: "Incident not found" });
      return;
    }
    const patch: Partial<typeof fleetIncidentsTable.$inferInsert> = {};
    if (parsed.data.status) {
      patch.status = parsed.data.status;
      if (parsed.data.status === "resolved") patch.resolvedAt = new Date();
    }
    if (parsed.data.adminNotes !== undefined) patch.adminNotes = parsed.data.adminNotes;
    const [updated] = await db
      .update(fleetIncidentsTable)
      .set(patch)
      .where(eq(fleetIncidentsTable.id, existing.id))
      .returning();
    res.json(updated);
  },
);

// ───────── Maintenance history export (CSV + PDF) ─────────
//
// Two scopes:
//   - Org-wide rollup at `/organizations/:orgId/maintenance-history.{csv,pdf}`
//     — admin only, includes one row/section per completed booking across
//     every vehicle in the fleet.
//   - Per-vehicle at `/organizations/:orgId/vehicles/:vehicleId/...` —
//     admin or the assigned driver (via `requireOrgVehicle`).
//
// Kept out of OpenAPI for the same reason as the owner version: binary
// payloads + CSV are awkward to model in Orval.

type HistoryRow = {
  completedAt: Date | null;
  serviceType: string;
  description: string;
  centerName: string;
  vehicleLabel: string;
  invoiceTotal: number;
};

// Upper bound on rows per export. Keeps an accidentally massive fleet
// (or a long-running org) from blowing memory or stalling a worker on
// a single download. If we ever hit this, the response includes a
// `truncated` row at the bottom so the caller knows to narrow the
// scope (date range filtering is a sensible follow-up).
const HISTORY_ROW_CAP = 5000;

async function buildHistoryRows(
  vehicles: { id: string; brand: string; model: string; year: number; plateNumber: string }[],
): Promise<{ rows: HistoryRow[]; truncated: boolean }> {
  if (vehicles.length === 0) return { rows: [], truncated: false };
  const vehicleIds = vehicles.map((v) => v.id);
  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));
  const completed = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        inArray(bookingsTable.vehicleId, vehicleIds),
        eq(bookingsTable.status, "completed"),
      ),
    )
    .orderBy(desc(bookingsTable.completedAt))
    .limit(HISTORY_ROW_CAP + 1);
  const truncated = completed.length > HISTORY_ROW_CAP;
  if (truncated) completed.length = HISTORY_ROW_CAP;
  const centerIds = [...new Set(completed.map((b) => b.serviceCenterId))];
  const invoiceIds = completed
    .map((b) => b.invoiceId)
    .filter((id): id is string => !!id);
  const centers = centerIds.length
    ? await db
        .select()
        .from(serviceCentersTable)
        .where(inArray(serviceCentersTable.id, centerIds))
    : [];
  const invoices = invoiceIds.length
    ? await db
        .select()
        .from(invoicesTable)
        .where(inArray(invoicesTable.id, invoiceIds))
    : [];
  const centerMap = new Map(centers.map((c) => [c.id, c]));
  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
  const rows = completed.map((b) => {
    const v = vehicleMap.get(b.vehicleId);
    const invoice = b.invoiceId ? invoiceMap.get(b.invoiceId) : null;
    return {
      completedAt: b.completedAt ?? null,
      serviceType: b.serviceType,
      description: b.description,
      centerName: centerMap.get(b.serviceCenterId)?.name ?? "",
      vehicleLabel: v
        ? `${v.year} ${v.brand} ${v.model} (${v.plateNumber})`
        : "Unknown vehicle",
      invoiceTotal: Number(invoice?.total ?? 0),
    };
  });
  return { rows, truncated };
}

const csvEsc = (v: unknown): string => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function sendHistoryCsv(
  res: Response,
  rows: HistoryRow[],
  filename: string,
  truncated: boolean,
) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
  // Stream row-by-row so we never hold the full file in memory.
  res.write(
    [
      "completed_at",
      "vehicle",
      "service_type",
      "description",
      "service_center",
      "invoice_total",
    ].join(",") + "\n",
  );
  for (const r of rows) {
    res.write(
      [
        r.completedAt?.toISOString() ?? "",
        r.vehicleLabel,
        r.serviceType,
        r.description,
        r.centerName,
        r.invoiceTotal,
      ]
        .map(csvEsc)
        .join(",") + "\n",
    );
  }
  if (truncated) {
    res.write(
      `# Truncated at ${HISTORY_ROW_CAP} rows. Narrow the export scope to see older history.\n`,
    );
  }
  res.end();
}

function sendHistoryPdf(
  res: Response,
  rows: HistoryRow[],
  title: string,
  subtitle: string,
  filename: string,
  truncated: boolean,
) {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  doc.pipe(res);
  doc.fillColor("#1a1a1a").fontSize(20).text(title, { align: "left" });
  doc.moveDown(0.3);
  doc.fontSize(12).fillColor("#555").text(subtitle);
  doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(0.8);
  doc
    .strokeColor("#cccccc")
    .lineWidth(1)
    .moveTo(doc.x, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .stroke();
  doc.moveDown(0.5);
  if (rows.length === 0) {
    doc.fillColor("#555").fontSize(12).text("No completed services on record.");
  } else {
    for (const r of rows) {
      const date = r.completedAt
        ? r.completedAt.toISOString().slice(0, 10)
        : "Unknown date";
      doc
        .fillColor("#1a1a1a")
        .fontSize(13)
        .text(r.serviceType, { continued: true })
        .fillColor("#888")
        .text(`   ${date}`);
      doc.fontSize(10).fillColor("#555").text(`${r.vehicleLabel} — ${r.centerName}`);
      doc.fontSize(11).fillColor("#1a1a1a").text(r.description, { paragraphGap: 4 });
      doc.fontSize(11).fillColor("#1a1a1a").text(`Invoice total: ${r.invoiceTotal}`);
      doc.moveDown(0.8);
    }
    if (truncated) {
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .fillColor("#a00")
        .text(`Truncated at ${HISTORY_ROW_CAP} rows. Narrow the export scope to see older history.`);
    }
  }
  doc.end();
}

const fleetHistoryAllHandler = (format: "csv" | "pdf") =>
  async (req: Request, res: Response): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId), "admin");
    if (!m) return;
    if (!m.isPlatform) {
      const limits = await getEntitlements("organization", m.org.id);
      if (!limits.canExportHistory) {
        res.status(402).json({
          error: "Maintenance history export requires a Fleet plan upgrade.",
          reason: "entitlement_required",
        });
        return;
      }
    }
    const vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.organizationId, m.org.id));
    const { rows, truncated } = await buildHistoryRows(vehicles);
    const safeSlug = m.org.slug.replace(/[^A-Za-z0-9_-]/g, "_");
    const fname = `${safeSlug}-fleet-history`;
    if (format === "csv") return sendHistoryCsv(res, rows, fname, truncated);
    sendHistoryPdf(
      res,
      rows,
      "Fleet Maintenance History",
      `${m.org.name} · ${vehicles.length} vehicle${vehicles.length === 1 ? "" : "s"}`,
      fname,
      truncated,
    );
  };

const fleetHistoryVehicleHandler = (format: "csv" | "pdf") =>
  async (req: Request, res: Response): Promise<void> => {
    const ctx = await requireOrgVehicle(
      req,
      res,
      String(req.params.orgId),
      String(req.params.vehicleId),
    );
    if (!ctx) return;
    if (!ctx.m.isPlatform) {
      const limits = await getEntitlements("organization", ctx.m.org.id);
      if (!limits.canExportHistory) {
        res.status(402).json({
          error: "Maintenance history export requires a Fleet plan upgrade.",
          reason: "entitlement_required",
        });
        return;
      }
    }
    const v = ctx.vehicle;
    const { rows, truncated } = await buildHistoryRows([
      { id: v.id, brand: v.brand, model: v.model, year: v.year, plateNumber: v.plateNumber },
    ]);
    const safePlate = v.plateNumber.replace(/[^A-Za-z0-9_-]/g, "_");
    const fname = `${safePlate}-history`;
    if (format === "csv") return sendHistoryCsv(res, rows, fname, truncated);
    sendHistoryPdf(
      res,
      rows,
      "Vehicle Maintenance History",
      `${v.year} ${v.brand} ${v.model} — Plate ${v.plateNumber}`,
      fname,
      truncated,
    );
  };

router.get(
  "/organizations/:orgId/maintenance-history.csv",
  requireAuth,
  fleetHistoryAllHandler("csv"),
);
router.get(
  "/organizations/:orgId/maintenance-history.pdf",
  requireAuth,
  fleetHistoryAllHandler("pdf"),
);
router.get(
  "/organizations/:orgId/vehicles/:vehicleId/maintenance-history.csv",
  requireAuth,
  fleetHistoryVehicleHandler("csv"),
);
router.get(
  "/organizations/:orgId/vehicles/:vehicleId/maintenance-history.pdf",
  requireAuth,
  fleetHistoryVehicleHandler("pdf"),
);

// ───── Fleet parts orders (RBAC + finance-approval workflow) ─────
//
// Roles & flow:
//   • driver/manager submit a parts request from the marketplace checkout.
//   • If the org requires finance approval AND the submitter lacks the
//     per-member `canCheckoutDirectly` override, the request lands in the
//     finance queue as `pending_finance`. Otherwise it's marked `paid`
//     immediately (direct checkout — payment integration is out of scope
//     for the demo; "paid" represents both approval and settlement).
//   • finance/admin can `approve+pay` (→ paid) or `reject` (→ rejected)
//     items from the queue.
//
// Vendor-side order rows are intentionally NOT created here — the demo
// stops at "paid" on the fleet ledger. Wiring through to real vendor
// orders would happen in a follow-up.

router.post(
  "/organizations/:orgId/parts-orders",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    const parsed = CreatePartsOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const wantsPayNow = parsed.data.mode === "pay_now";
    const allowedPayNow = canCheckoutDirectly(m);
    if (wantsPayNow && !allowedPayNow) {
      res.status(403).json({
        error: "Finance approval required before this order can be paid.",
        reason: "approval_required",
      });
      return;
    }
    // Server is the source of truth for the total — never trust the
    // client. We accept the item snapshot (which the user already saw on
    // the cart screen, vendor name + sku for receipt purposes) but the
    // money figure is always recomputed from unitPrice × quantity.
    const computedTotal = parsed.data.items.reduce(
      (s, it) => s + it.unitPrice * it.quantity,
      0,
    );
    if (Math.abs(computedTotal - parsed.data.totalAmount) > 0.01) {
      res.status(400).json({
        error: "Total amount does not match line items.",
        reason: "total_mismatch",
        expected: computedTotal,
      });
      return;
    }
    const status = wantsPayNow && allowedPayNow ? "paid" : "pending_finance";
    const now = new Date();
    const requesterPhone = m.member?.phone ?? req.user!.phone ?? "platform-admin";
    const requesterName = m.member?.name ?? req.user!.name ?? "Platform admin";
    const [inserted] = await db
      .insert(fleetPartsOrdersTable)
      .values({
        organizationId: m.org.id,
        requestedByPhone: requesterPhone,
        requestedByName: requesterName,
        status,
        items: parsed.data.items.map((it) => ({
          partId: it.partId,
          vendorId: it.vendorId,
          vendorName: it.vendorName,
          name: it.name,
          sku: it.sku,
          unitPrice: it.unitPrice,
          quantity: it.quantity,
          imageUrl: it.imageUrl ?? null,
        })),
        totalAmount: computedTotal.toFixed(2),
        shippingAddress: parsed.data.shippingAddress,
        deliveryCity: parsed.data.deliveryCity ?? null,
        deliveryRegion: parsed.data.deliveryRegion ?? null,
        notes: parsed.data.notes ?? null,
        ...(status === "paid"
          ? {
              approvedByPhone: requesterPhone,
              approvedByName: requesterName,
              approvedAt: now,
              paidByPhone: requesterPhone,
              paidByName: requesterName,
              paidAt: now,
            }
          : {}),
      })
      .returning();
    res.status(201).json(inserted);
  },
);

router.get(
  "/organizations/:orgId/parts-orders",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    const baseWhere = eq(fleetPartsOrdersTable.organizationId, m.org.id);
    const rows = await db
      .select()
      .from(fleetPartsOrdersTable)
      .where(
        isFinanceLevel(m)
          ? baseWhere
          : and(
              baseWhere,
              eq(fleetPartsOrdersTable.requestedByPhone, m.member?.phone ?? ""),
            ),
      )
      .orderBy(desc(fleetPartsOrdersTable.createdAt));
    res.json({ orders: rows });
  },
);

async function loadOrgOrder(
  m: { org: Organization; member: OrganizationMember | null; isPlatform: boolean },
  orderId: string,
) {
  const [order] = await db
    .select()
    .from(fleetPartsOrdersTable)
    .where(eq(fleetPartsOrdersTable.id, orderId));
  if (!order || order.organizationId !== m.org.id) return null;
  return order;
}

router.post(
  "/organizations/:orgId/parts-orders/:id/pay",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    const order = await loadOrgOrder(m, String(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    // Pay-permission: finance/admin always; the requester themselves only
    // if they have direct-checkout permission (covers the "submitted for
    // visibility but I can still pay it" edge case for trusted managers).
    const isRequester = order.requestedByPhone === m.member?.phone;
    const allowed = isFinanceLevel(m) || (isRequester && canCheckoutDirectly(m));
    if (!allowed) {
      res.status(403).json({ error: "Only finance or admin can pay this order." });
      return;
    }
    if (order.status === "paid") {
      res.json(order);
      return;
    }
    if (order.status === "rejected") {
      res.status(400).json({ error: "Rejected orders can't be paid." });
      return;
    }
    const parsed = PayPartsOrderBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const note = parsed.data.note?.trim();
    const now = new Date();
    const actorPhone = m.member?.phone ?? req.user!.phone ?? "platform-admin";
    const actorName = m.member?.name ?? req.user!.name ?? "Platform admin";
    const [updated] = await db
      .update(fleetPartsOrdersTable)
      .set({
        status: "paid",
        approvedByPhone: order.approvedByPhone ?? actorPhone,
        approvedByName: order.approvedByName ?? actorName,
        approvedAt: order.approvedAt ?? now,
        approvalNote: note ? note : order.approvalNote,
        paidByPhone: actorPhone,
        paidByName: actorName,
        paidAt: now,
      })
      .where(eq(fleetPartsOrdersTable.id, order.id))
      .returning();
    if (updated.requestedByPhone && updated.requestedByPhone !== actorPhone) {
      try {
        await createOwnerNotification({
          ownerPhone: updated.requestedByPhone,
          kind: "fleet_parts_order_paid",
          title: "Parts order approved",
          body: `Your parts order has been approved and paid by ${actorName}.`,
          dedupeKey: `fleet-parts-order:${updated.id}:paid`,
          url: `/fleet/parts-orders/${updated.id}`,
        });
      } catch (err) {
        req.log.warn({ err, orderId: updated.id }, "parts-order paid notify failed");
      }
    }
    res.json(updated);
  },
);

router.post(
  "/organizations/:orgId/parts-orders/:id/reject",
  requireAuth,
  async (req, res): Promise<void> => {
    const m = await requireOrgMember(req, res, String(req.params.orgId));
    if (!m) return;
    if (!isFinanceLevel(m)) {
      res.status(403).json({ error: "Only finance or admin can reject orders." });
      return;
    }
    const parsed = RejectPartsOrderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const order = await loadOrgOrder(m, String(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    if (order.status !== "pending_finance") {
      res.status(400).json({ error: "Only pending orders can be rejected." });
      return;
    }
    const now = new Date();
    const actorPhone = m.member?.phone ?? req.user!.phone ?? "platform-admin";
    const actorName = m.member?.name ?? req.user!.name ?? "Platform admin";
    const [updated] = await db
      .update(fleetPartsOrdersTable)
      .set({
        status: "rejected",
        rejectedByPhone: actorPhone,
        rejectedByName: actorName,
        rejectedAt: now,
        rejectionReason: parsed.data.reason,
      })
      .where(eq(fleetPartsOrdersTable.id, order.id))
      .returning();
    if (updated.requestedByPhone && updated.requestedByPhone !== actorPhone) {
      try {
        await createOwnerNotification({
          ownerPhone: updated.requestedByPhone,
          kind: "fleet_parts_order_rejected",
          title: "Parts order rejected",
          body: `Your parts order was rejected by ${actorName}: ${parsed.data.reason}`,
          dedupeKey: `fleet-parts-order:${updated.id}:rejected`,
          url: `/fleet/parts-orders/${updated.id}`,
        });
      } catch (err) {
        req.log.warn({ err, orderId: updated.id }, "parts-order rejected notify failed");
      }
    }
    res.json(updated);
  },
);

export default router;
