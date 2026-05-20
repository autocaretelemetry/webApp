import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gte, inArray, ne, or } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  serviceCentersTable,
  mechanicsTable,
  bookingsTable,
  bookingEventsTable,
  invoicesTable,
  organizationPreferredCentersTable,
  centerStaffTable,
} from "@workspace/db";
import { getEntitlements, getOwnerEntitlementsForVehicle } from "../lib/entitlements";
import {
  CreateBookingBody,
  ListBookingsQueryParams,
  GetBookingParams,
  UpdateBookingStatusParams,
  UpdateBookingStatusBody,
  AssignMechanicParams,
  AssignMechanicBody,
} from "@workspace/api-zod";
import { notifyCenterNewBooking } from "../lib/centerAlerts";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

export type BookingRelationship = "admin" | "owner" | "center";

/**
 * Returns the set of service-center ids the signed-in user is staff of.
 * Empty array for owners, renters, etc. Cached briefly on `req` to avoid
 * re-querying within a single request.
 */
async function getCallerCenterIds(req: Request): Promise<string[]> {
  const cache = (req as unknown as { _centerIds?: string[] })._centerIds;
  if (cache) return cache;
  const userId = req.user?.id;
  if (!userId) return [];
  const rows = await db
    .select({ centerId: centerStaffTable.centerId })
    .from(centerStaffTable)
    .where(and(eq(centerStaffTable.userId, userId), eq(centerStaffTable.active, true)));
  const ids = rows.map((r) => r.centerId);
  (req as unknown as { _centerIds?: string[] })._centerIds = ids;
  return ids;
}

/**
 * Loads a booking and authorizes the signed-in caller. Returns null AFTER
 * writing the appropriate 401/403/404 response — callers should `return`.
 *
 * Access rules:
 *  - admin / super_admin: always allowed
 *  - vehicle owner (matched by phone): allowed
 *  - active center staff of the booking's service center: allowed
 *  - everyone else: 403
 */
export async function authorizeServiceBooking(
  req: Request,
  res: Response,
  bookingId: string,
): Promise<{
  booking: typeof bookingsTable.$inferSelect;
  vehicle: typeof vehiclesTable.$inferSelect;
  relationship: BookingRelationship;
} | null> {
  if (!req.user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, booking.vehicleId));
  if (!vehicle) {
    // Booking pointing at a deleted vehicle — treat as not found to avoid
    // leaking internal state.
    res.status(404).json({ error: "Booking not found" });
    return null;
  }
  const role = req.user.role;
  if (role === "admin" || role === "super_admin") {
    return { booking, vehicle, relationship: "admin" };
  }
  const userPhone = (req.user.phone ?? "").trim();
  if (userPhone && vehicle.ownerPhone && userPhone === vehicle.ownerPhone.trim()) {
    return { booking, vehicle, relationship: "owner" };
  }
  const centerIds = await getCallerCenterIds(req);
  if (centerIds.includes(booking.serviceCenterId)) {
    return { booking, vehicle, relationship: "center" };
  }
  res.status(403).json({ error: "You don't have access to this booking." });
  return null;
}

async function openJobsByCenter(centerIds: string[]): Promise<Map<string, number>> {
  if (centerIds.length === 0) return new Map();
  const rows = await db
    .select({
      centerId: bookingsTable.serviceCenterId,
      n: count(bookingsTable.id),
    })
    .from(bookingsTable)
    .where(
      and(
        inArray(bookingsTable.serviceCenterId, centerIds),
        ne(bookingsTable.status, "completed"),
        ne(bookingsTable.status, "cancelled"),
      ),
    )
    .groupBy(bookingsTable.serviceCenterId);
  return new Map(rows.map((r) => [r.centerId, Number(r.n)]));
}

async function hydrateBookings(
  bookings: (typeof bookingsTable.$inferSelect)[],
) {
  if (bookings.length === 0) return [];
  const vehicleIds = [...new Set(bookings.map((b) => b.vehicleId))];
  const centerIds = [...new Set(bookings.map((b) => b.serviceCenterId))];
  const mechanicIds = [
    ...new Set(
      bookings.map((b) => b.mechanicId).filter((id): id is string => !!id),
    ),
  ];

  const [vehicles, centers, mechanics, openMap] = await Promise.all([
    db.select().from(vehiclesTable).where(inArray(vehiclesTable.id, vehicleIds)),
    db
      .select()
      .from(serviceCentersTable)
      .where(inArray(serviceCentersTable.id, centerIds)),
    mechanicIds.length
      ? db
          .select()
          .from(mechanicsTable)
          .where(inArray(mechanicsTable.id, mechanicIds))
      : Promise.resolve([] as (typeof mechanicsTable.$inferSelect)[]),
    openJobsByCenter(centerIds),
  ]);

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v]));
  const centerMap = new Map(centers.map((c) => [c.id, c]));
  const mechanicMap = new Map(mechanics.map((m) => [m.id, m]));

  return bookings.map((b) => {
    const vehicle = vehicleMap.get(b.vehicleId)!;
    const center = centerMap.get(b.serviceCenterId)!;
    const mechanic = b.mechanicId ? mechanicMap.get(b.mechanicId) ?? null : null;
    return {
      ...b,
      vehicle,
      serviceCenter: { ...center, openJobs: openMap.get(center.id) ?? 0 },
      mechanic,
    };
  });
}

router.get("/bookings", requireAuth, async (req, res): Promise<void> => {
  const q = ListBookingsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.status) conditions.push(eq(bookingsTable.status, q.data.status));

  // Scope the list to bookings the caller can actually see. Admins see
  // everything; vehicle owners see bookings on cars they own; center staff
  // see bookings routed to their center(s); everyone else gets an empty
  // list rather than leaking cross-tenant data.
  const role = req.user!.role;
  if (role !== "admin" && role !== "super_admin") {
    const userPhone = (req.user!.phone ?? "").trim();
    const centerIds = await getCallerCenterIds(req);
    const ownedVehicleIds = userPhone
      ? (
          await db
            .select({ id: vehiclesTable.id })
            .from(vehiclesTable)
            .where(eq(vehiclesTable.ownerPhone, userPhone))
        ).map((r) => r.id)
      : [];
    const scopeClauses = [] as ReturnType<typeof eq>[];
    if (ownedVehicleIds.length > 0) {
      scopeClauses.push(inArray(bookingsTable.vehicleId, ownedVehicleIds));
    }
    if (centerIds.length > 0) {
      scopeClauses.push(inArray(bookingsTable.serviceCenterId, centerIds));
    }
    if (scopeClauses.length === 0) {
      res.json([]);
      return;
    }
    const scope =
      scopeClauses.length === 1 ? scopeClauses[0] : or(...scopeClauses)!;
    conditions.push(scope);
  }

  // Priority bookings (granted by the owner's plan) always surface above
  // non-priority within the same status filter, then newest first.
  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(bookingsTable)
          .where(and(...conditions))
          .orderBy(desc(bookingsTable.priority), desc(bookingsTable.requestedAt))
      : await db
          .select()
          .from(bookingsTable)
          .orderBy(desc(bookingsTable.priority), desc(bookingsTable.requestedAt));

  const hydrated = await hydrateBookings(rows);
  res.json(hydrated);
});

router.post("/bookings", requireAuth, async (req, res): Promise<void> => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, parsed.data.vehicleId));
  if (!vehicle) {
    res.status(400).json({ error: "Vehicle not found" });
    return;
  }

  // Owners can only book service on their OWN vehicles. Admins can book
  // on behalf of anyone (used for support flows + the seed scripts).
  {
    const user = req.user!;
    const isPlatformAdmin = user.role === "admin" || user.role === "super_admin";
    if (!isPlatformAdmin) {
      const userPhone = (user.phone ?? "").trim();
      if (!userPhone || !vehicle.ownerPhone || userPhone !== vehicle.ownerPhone.trim()) {
        res.status(403).json({ error: "You can only book service on a vehicle you own." });
        return;
      }
    }
  }
  const [center] = await db
    .select()
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, parsed.data.serviceCenterId));
  if (!center) {
    res.status(400).json({ error: "Service center not found" });
    return;
  }

  // Fleet vehicles can only be booked at centers in the org's preferred
  // pool. Platform admins can override (e.g. to triage on behalf of an
  // org during onboarding) — every other caller is held to the pool.
  if (vehicle.organizationId) {
    const user = req.user;
    const isPlatformAdmin = user?.role === "admin" || user?.role === "super_admin";
    if (!isPlatformAdmin) {
      const [preferred] = await db
        .select({ id: organizationPreferredCentersTable.serviceCenterId })
        .from(organizationPreferredCentersTable)
        .where(
          and(
            eq(organizationPreferredCentersTable.organizationId, vehicle.organizationId),
            eq(organizationPreferredCentersTable.serviceCenterId, center.id),
          ),
        );
      if (!preferred) {
        res.status(400).json({
          error: `${center.name} is not in this fleet's preferred service centers. Add it to the preferred pool first.`,
          reason: "center_not_preferred",
        });
        return;
      }
    }
  }

  // Quota gate: the receiving center's plan caps how many bookings it can
  // take per calendar month. Free tier defaults apply when no active sub.
  const centerLimits = await getEntitlements("center", center.id);
  if (centerLimits.maxBookingsPerMonth != null) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const [{ n }] = await db
      .select({ n: count(bookingsTable.id) })
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.serviceCenterId, center.id),
          gte(bookingsTable.requestedAt, monthStart),
        ),
      );
    if (Number(n) >= centerLimits.maxBookingsPerMonth) {
      res.status(402).json({
        error: `${center.name} has reached its monthly booking cap (${centerLimits.maxBookingsPerMonth}). Ask them to upgrade their plan.`,
        reason: "quota_exceeded",
      });
      return;
    }
  }

  // Priority flag: owner's plan grants it. Cheap one-query lookup; safe to
  // miss (defaults to false) if the vehicle has no ownerPhone yet. For
  // fleet vehicles, the org's plan ALSO contributes — Fleet Pro grants
  // priority booking, and we OR the two entitlements so either path can
  // upgrade the booking.
  const ownerEntitlements = await getOwnerEntitlementsForVehicle(vehicle.id);
  let priority = ownerEntitlements.limits.priorityBooking;
  if (!priority && vehicle.organizationId) {
    const orgLimits = await getEntitlements("organization", vehicle.organizationId);
    priority = priority || orgLimits.priorityBooking;
  }

  const [row] = await db
    .insert(bookingsTable)
    .values({
      vehicleId: parsed.data.vehicleId,
      serviceCenterId: parsed.data.serviceCenterId,
      serviceType: parsed.data.serviceType,
      description: parsed.data.description,
      scheduledAt: parsed.data.scheduledAt ?? null,
      status: "requested",
      priority,
    })
    .returning();

  await db.insert(bookingEventsTable).values({
    bookingId: row.id,
    label: `Booking requested for ${vehicle.brand} ${vehicle.model}`,
    actor: vehicle.ownerName,
    kind: "booking_created",
  });

  const [hydrated] = await hydrateBookings([row]);

  // Fire-and-forget WhatsApp alert; never block the response.
  notifyCenterNewBooking(row).catch((err) =>
    req.log.warn({ err }, "WhatsApp new-booking alert failed"),
  );

  res.status(201).json(hydrated);
});

router.get("/bookings/:bookingId", requireAuth, async (req, res): Promise<void> => {
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const access = await authorizeServiceBooking(req, res, params.data.bookingId);
  if (!access) return;
  const row = access.booking;
  const [hydrated] = await hydrateBookings([row]);

  const events = await db
    .select()
    .from(bookingEventsTable)
    .where(eq(bookingEventsTable.bookingId, row.id))
    .orderBy(asc(bookingEventsTable.at));

  let invoice = null;
  if (row.invoiceId) {
    const [inv] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, row.invoiceId));
    invoice = inv ?? null;
  }

  res.json({
    ...hydrated,
    invoice,
    timeline: events.map((e) => ({
      at: e.at,
      label: e.label,
      actor: e.actor,
    })),
  });
});

router.patch(
  "/bookings/:bookingId/status",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateBookingStatusParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = UpdateBookingStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const access = await authorizeServiceBooking(req, res, params.data.bookingId);
    if (!access) return;
    const current = access.booking;
    // Status mutations are a service-center action — owners/admins drive
    // the workflow elsewhere (invoice approve/pay). Anyone else who has
    // read-access (the vehicle owner) must not be able to change status.
    if (access.relationship === "owner") {
      res.status(403).json({
        error: "Only the service center handling this booking can update its status.",
      });
      return;
    }

    const allowedTransitions: Record<string, string[]> = {
      requested: ["accepted", "cancelled"],
      accepted: ["in_progress", "cancelled"],
      in_progress: ["awaiting_approval"],
      awaiting_approval: ["approved", "in_progress"],
      approved: ["completed"],
      completed: [],
      cancelled: [],
    };
    const next = parsed.data.status;
    if (!allowedTransitions[current.status]?.includes(next)) {
      res.status(409).json({
        error: `Cannot transition booking from "${current.status}" to "${next}"`,
      });
      return;
    }
    if (next === "in_progress" && !current.mechanicId) {
      res.status(409).json({
        error: "Assign a mechanic before starting work",
      });
      return;
    }

    const updates: Partial<typeof bookingsTable.$inferInsert> = {
      status: next,
    };
    if (parsed.data.estimatedDurationHours != null)
      updates.estimatedDurationHours = parsed.data.estimatedDurationHours;
    if (parsed.data.scheduledAt != null)
      updates.scheduledAt = parsed.data.scheduledAt;
    if (next === "completed") updates.completedAt = new Date();

    const [row] = await db
      .update(bookingsTable)
      .set(updates)
      .where(eq(bookingsTable.id, params.data.bookingId))
      .returning();

    if (!row) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }

    const kindMap: Record<string, string> = {
      accepted: "booking_accepted",
      in_progress: "booking_accepted",
      completed: "booking_completed",
      cancelled: "booking_completed",
    };
    await db.insert(bookingEventsTable).values({
      bookingId: row.id,
      label: `Status updated to ${parsed.data.status.replace(/_/g, " ")}`,
      actor: "Service Center",
      kind: kindMap[parsed.data.status] ?? "booking_accepted",
    });

    if (parsed.data.status === "completed" && row.mechanicId) {
      await db
        .update(mechanicsTable)
        .set({
          completedJobs: (
            await db
              .select({ n: count(bookingsTable.id) })
              .from(bookingsTable)
              .where(
                and(
                  eq(bookingsTable.mechanicId, row.mechanicId),
                  eq(bookingsTable.status, "completed"),
                ),
              )
          )[0].n as number,
        })
        .where(eq(mechanicsTable.id, row.mechanicId));
    }

    const [hydrated] = await hydrateBookings([row]);
    res.json(hydrated);
  },
);

router.post(
  "/bookings/:bookingId/assign-mechanic",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = AssignMechanicParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = AssignMechanicBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const access = await authorizeServiceBooking(req, res, params.data.bookingId);
    if (!access) return;
    // Assigning a mechanic is purely a service-center action.
    if (access.relationship === "owner") {
      res.status(403).json({
        error: "Only the service center handling this booking can assign a mechanic.",
      });
      return;
    }

    const [mechanic] = await db
      .select()
      .from(mechanicsTable)
      .where(eq(mechanicsTable.id, parsed.data.mechanicId));
    if (!mechanic) {
      res.status(400).json({ error: "Mechanic not found" });
      return;
    }

    const [row] = await db
      .update(bookingsTable)
      .set({ mechanicId: parsed.data.mechanicId })
      .where(eq(bookingsTable.id, params.data.bookingId))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Booking not found" });
      return;
    }
    await db.insert(bookingEventsTable).values({
      bookingId: row.id,
      label: `Mechanic ${mechanic.name} assigned`,
      actor: "Service Center",
      kind: "mechanic_assigned",
    });
    const [hydrated] = await hydrateBookings([row]);
    res.json(hydrated);
  },
);

export default router;
