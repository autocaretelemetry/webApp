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
  fleetTripLocationsTable,
  fleetIncidentsTable,
  type Organization,
  type OrganizationMember,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { getEntitlements } from "../lib/entitlements";
import { computeReminders } from "../lib/reminders";
import PDFDocument from "pdfkit";

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

export default router;
