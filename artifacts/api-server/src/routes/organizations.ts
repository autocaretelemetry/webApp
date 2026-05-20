import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, count, desc, eq, inArray, ne, sum } from "drizzle-orm";
import {
  db,
  organizationsTable,
  organizationMembersTable,
  organizationPreferredCentersTable,
  vehiclesTable,
  serviceCentersTable,
  bookingsTable,
  invoicesTable,
  type Organization,
  type OrganizationMember,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getEntitlements } from "../lib/entitlements";
import { computeReminders } from "../lib/reminders";

const router: IRouter = Router();

// ───────── Helpers ─────────

function isPlatformAdmin(req: Request): boolean {
  return req.user?.role === "admin" || req.user?.role === "super_admin";
}

type OrgRole = "admin" | "driver";

/**
 * Ensure the authenticated user is a member of the org (or a platform
 * admin) and optionally has a minimum org-role. Returns `null` after
 * writing a 401/403/404 response when authorization fails, so callers
 * should `if (!membership) return;` immediately after.
 *
 * Platform admins synthesize an "admin" membership so they can manage
 * any org for support/QA purposes, but they are NOT auto-added to the
 * members table — visible membership stays the org's own list.
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

const UpdateOrgBody = CreateOrgBody.partial();

const UpsertMemberBody = z.object({
  phone: z.string().min(6),
  name: z.string().min(2),
  role: z.enum(["admin", "driver"]).default("driver"),
});

const ReplacePreferredCentersBody = z.object({
  serviceCenterIds: z.array(z.string().uuid()),
});

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
    })
    .from(organizationMembersTable)
    .innerJoin(
      organizationsTable,
      eq(organizationMembersTable.organizationId, organizationsTable.id),
    )
    .where(eq(organizationMembersTable.phone, phone));
  res.json({
    organizations: memberships.map((m) => ({ ...m.org, myRole: m.role })),
  });
});

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
        .set({ name: parsed.data.name, role: parsed.data.role })
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
      .values({ ...parsed.data, organizationId: m.org.id })
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
    // Guard: can't remove the last admin — would orphan the org.
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

export default router;
