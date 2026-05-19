import { Router, type IRouter } from "express";
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  serviceCentersTable,
  mechanicsTable,
  bookingsTable,
  bookingEventsTable,
  invoicesTable,
} from "@workspace/db";
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

const router: IRouter = Router();

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

router.get("/bookings", async (req, res): Promise<void> => {
  const q = ListBookingsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.status) conditions.push(eq(bookingsTable.status, q.data.status));
  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(bookingsTable)
          .where(and(...conditions))
          .orderBy(desc(bookingsTable.requestedAt))
      : await db
          .select()
          .from(bookingsTable)
          .orderBy(desc(bookingsTable.requestedAt));

  const hydrated = await hydrateBookings(rows);
  res.json(hydrated);
});

router.post("/bookings", async (req, res): Promise<void> => {
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
  const [center] = await db
    .select()
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, parsed.data.serviceCenterId));
  if (!center) {
    res.status(400).json({ error: "Service center not found" });
    return;
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

router.get("/bookings/:bookingId", async (req, res): Promise<void> => {
  const params = GetBookingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, params.data.bookingId));
  if (!row) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
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

    const [current] = await db
      .select()
      .from(bookingsTable)
      .where(eq(bookingsTable.id, params.data.bookingId));
    if (!current) {
      res.status(404).json({ error: "Booking not found" });
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
