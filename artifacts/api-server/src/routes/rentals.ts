import { Router, type IRouter } from "express";
import { and, count, desc, eq, gt, inArray, lt } from "drizzle-orm";
import {
  db,
  rentalCarsTable,
  rentalBookingsTable,
  bookingsTable,
} from "@workspace/db";
import {
  ListRentalCarsQueryParams,
  GetRentalCarParams,
  CreateRentalCarBody,
  UpdateRentalCarBody,
  UpdateRentalCarParams,
  DeleteRentalCarParams,
  ListRentalBookingsQueryParams,
  CreateRentalBookingBody,
  UpdateRentalBookingBody,
  UpdateRentalBookingParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ACTIVE_RENTAL_STATUSES = ["requested", "confirmed", "active"] as const;

function dayDiff(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

// ---------- Rental cars ----------

router.get("/rental-cars", async (req, res): Promise<void> => {
  const q = ListRentalCarsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const filters = [];
  if (q.data.city) filters.push(eq(rentalCarsTable.city, q.data.city));
  if (q.data.status) filters.push(eq(rentalCarsTable.status, q.data.status));
  if (q.data.ownerKind) filters.push(eq(rentalCarsTable.ownerKind, q.data.ownerKind));
  if (!q.data.includeInactive) filters.push(eq(rentalCarsTable.active, true));

  const rows = await db
    .select()
    .from(rentalCarsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(rentalCarsTable.createdAt));
  res.json(rows);
});

router.get("/rental-cars/:carId", async (req, res): Promise<void> => {
  const params = GetRentalCarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.id, params.data.carId));
  if (!row) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  res.json(row);
});

router.post("/rental-cars", async (req, res): Promise<void> => {
  const body = CreateRentalCarBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Public onboarding endpoint: every listing is treated as user-submitted
  // and starts pending admin review. Platform fleet cars are inserted via
  // the seed/admin tooling, not through this route, so the client cannot
  // self-promote a listing to "approved" by sending ownerKind: "platform".
  const [row] = await db
    .insert(rentalCarsTable)
    .values({ ...body.data, ownerKind: "user", status: "pending" })
    .returning();
  res.status(201).json(row);
});

router.patch("/rental-cars/:carId", async (req, res): Promise<void> => {
  const params = UpdateRentalCarParams.safeParse(req.params);
  const body = UpdateRentalCarBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db
    .update(rentalCarsTable)
    .set(body.data)
    .where(eq(rentalCarsTable.id, params.data.carId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  res.json(row);
});

router.delete("/rental-cars/:carId", async (req, res): Promise<void> => {
  const params = DeleteRentalCarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [activeRow] = await db
    .select({ n: count() })
    .from(rentalBookingsTable)
    .where(
      and(
        eq(rentalBookingsTable.carId, params.data.carId),
        inArray(rentalBookingsTable.status, [...ACTIVE_RENTAL_STATUSES]),
      ),
    );
  const activeN = Number(activeRow?.n ?? 0);
  if (activeN > 0) {
    res.status(409).json({
      error: "Car has active rentals",
      reason: "has_dependents",
      details: `${activeN} active rental(s) reference this car. Mark it unavailable instead.`,
    });
    return;
  }
  const deleted = await db
    .delete(rentalCarsTable)
    .where(eq(rentalCarsTable.id, params.data.carId))
    .returning({ id: rentalCarsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  res.status(204).end();
});

// ---------- Rental bookings ----------

async function hydrateRentalBookings(rows: (typeof rentalBookingsTable.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const carIds = [...new Set(rows.map((r) => r.carId))];
  const cars = await db
    .select({
      id: rentalCarsTable.id,
      brand: rentalCarsTable.brand,
      model: rentalCarsTable.model,
      year: rentalCarsTable.year,
    })
    .from(rentalCarsTable)
    .where(inArray(rentalCarsTable.id, carIds));
  const map = new Map(cars.map((c) => [c.id, `${c.year} ${c.brand} ${c.model}`]));
  return rows.map((r) => ({ ...r, carLabel: map.get(r.carId) ?? "" }));
}

router.get("/rental-bookings", async (req, res): Promise<void> => {
  const q = ListRentalBookingsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const filters = [];
  if (q.data.carId) filters.push(eq(rentalBookingsTable.carId, q.data.carId));
  if (q.data.renterPhone) filters.push(eq(rentalBookingsTable.renterPhone, q.data.renterPhone));
  if (q.data.status) filters.push(eq(rentalBookingsTable.status, q.data.status));
  const rows = await db
    .select()
    .from(rentalBookingsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(rentalBookingsTable.createdAt));
  res.json(await hydrateRentalBookings(rows));
});

router.post("/rental-bookings", async (req, res): Promise<void> => {
  const body = CreateRentalBookingBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [car] = await db
    .select()
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.id, body.data.carId));
  if (!car) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  if (!car.active || car.status !== "approved") {
    res.status(400).json({ error: "This car is not available for rental right now." });
    return;
  }
  const purpose = body.data.purpose ?? "general";
  // Loaner rentals must be tied to a service booking; "general" rentals must
  // not be tied to one. Enforce both directions so the data stays consistent.
  if (purpose === "loaner" && !body.data.serviceBookingId) {
    res.status(400).json({ error: "Loaner rentals require a linked service booking." });
    return;
  }
  if (purpose === "general" && body.data.serviceBookingId) {
    res.status(400).json({
      error: "Only loaner rentals can be linked to a service booking.",
    });
    return;
  }
  if (body.data.serviceBookingId) {
    const [sb] = await db
      .select({ id: bookingsTable.id })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, body.data.serviceBookingId));
    if (!sb) {
      res.status(404).json({ error: "Service booking not found" });
      return;
    }
  }
  const start = new Date(body.data.startDate);
  const end = new Date(body.data.endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    res.status(400).json({ error: "Invalid start/end date" });
    return;
  }
  if (end <= start) {
    res.status(400).json({ error: "End date must be after start date." });
    return;
  }
  // Block overlapping active rentals for the same car. Two intervals overlap
  // when existing.start < new.end AND existing.end > new.start.
  const conflicts = await db
    .select({ id: rentalBookingsTable.id })
    .from(rentalBookingsTable)
    .where(
      and(
        eq(rentalBookingsTable.carId, car.id),
        inArray(rentalBookingsTable.status, [...ACTIVE_RENTAL_STATUSES]),
        lt(rentalBookingsTable.startDate, end),
        gt(rentalBookingsTable.endDate, start),
      ),
    );
  if (conflicts.length > 0) {
    res.status(409).json({
      error: "This car is already booked for part of that window.",
      reason: "date_conflict",
    });
    return;
  }
  const days = dayDiff(start, end);
  const total = days * car.dailyRate;
  const [row] = await db
    .insert(rentalBookingsTable)
    .values({
      carId: car.id,
      renterName: body.data.renterName,
      renterPhone: body.data.renterPhone,
      renterEmail: body.data.renterEmail,
      startDate: start,
      endDate: end,
      days,
      dailyRate: car.dailyRate,
      total,
      status: "requested",
      purpose,
      serviceBookingId: body.data.serviceBookingId ?? null,
      notes: body.data.notes,
    })
    .returning();
  const [hydrated] = await hydrateRentalBookings([row]);
  res.status(201).json(hydrated);
});

const TRANSITIONS: Record<string, string[]> = {
  requested: ["confirmed", "cancelled"],
  confirmed: ["active", "cancelled"],
  active: ["completed"],
  completed: [],
  cancelled: [],
};

router.patch("/rental-bookings/:rentalBookingId", async (req, res): Promise<void> => {
  const params = UpdateRentalBookingParams.safeParse(req.params);
  const body = UpdateRentalBookingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(rentalBookingsTable)
    .where(eq(rentalBookingsTable.id, params.data.rentalBookingId));
  if (!existing) {
    res.status(404).json({ error: "Rental booking not found" });
    return;
  }
  const patch: Partial<typeof rentalBookingsTable.$inferInsert> = {};
  if (body.data.notes !== undefined) patch.notes = body.data.notes;
  if (body.data.status && body.data.status !== existing.status) {
    const allowed = TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(body.data.status)) {
      res.status(400).json({
        error: `Cannot move rental from "${existing.status}" to "${body.data.status}".`,
      });
      return;
    }
    patch.status = body.data.status;
    const now = new Date();
    if (body.data.status === "confirmed") patch.confirmedAt = now;
    if (body.data.status === "active") patch.startedAt = now;
    if (body.data.status === "completed") patch.completedAt = now;
    if (body.data.status === "cancelled") patch.cancelledAt = now;
  }
  const [row] = await db
    .update(rentalBookingsTable)
    .set(patch)
    .where(eq(rentalBookingsTable.id, params.data.rentalBookingId))
    .returning();
  const [hydrated] = await hydrateRentalBookings([row]);
  res.json(hydrated);
});

export default router;
