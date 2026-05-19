import { Router, type IRouter } from "express";
import { and, count, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import {
  db,
  rentalCarsTable,
  rentalBookingsTable,
  renterProfilesTable,
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
  UpsertRenterProfileBody,
  GetRenterProfileParams,
  GetRenterProfileByPhoneParams,
  UpdateRenterProfileBody,
  UpdateRenterProfileParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const ACTIVE_RENTAL_STATUSES = [
  "pending_review",
  "contract_pending",
  "awaiting_payment",
  "confirmed",
  "active",
] as const;

function dayDiff(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function buildContractText(args: {
  car: typeof rentalCarsTable.$inferSelect;
  renter: typeof renterProfilesTable.$inferSelect;
  booking: typeof rentalBookingsTable.$inferSelect;
}): string {
  const { car, renter, booking } = args;
  return `AUTOCARE VEHICLE RENTAL AGREEMENT

Agreement reference: ${booking.id}
Generated: ${new Date().toISOString().slice(0, 10)}

PARTIES
Owner: ${car.ownerName} (${car.ownerPhone})${car.ownerEmail ? ` — ${car.ownerEmail}` : ""}
Renter: ${renter.name} (${renter.phone})${renter.email ? ` — ${renter.email}` : ""}
Driver's licence: ${renter.driverLicenseNumber ?? "n/a"}

VEHICLE
${car.year} ${car.brand} ${car.model} (${car.color})
Plate: ${car.plateNumber}
Pickup: ${car.pickupAddress}, ${car.city}

RENTAL TERMS
Pickup: ${fmtDate(booking.startDate)}
Return: ${fmtDate(booking.endDate)}
Duration: ${booking.days} day(s)
Daily rate: GHS ${booking.dailyRate.toLocaleString()}
Total: GHS ${booking.total.toLocaleString()}

CONDITIONS
1. The Renter shall return the Vehicle in the same condition received,
   normal wear and tear excepted.
2. The Renter is responsible for fuel, traffic violations, and any
   damages caused during the rental period.
3. The Vehicle shall only be driven by the Renter named above unless
   the Owner authorises additional drivers in writing.
4. Any cancellation after both parties have signed forfeits any
   non-refundable platform fees.
5. Either party may terminate this agreement before pickup; once the
   rental is active, termination requires written consent of both parties.
6. AutoCare facilitates this rental but is not a party to the agreement
   between Owner and Renter.

By signing below, both parties confirm they have read and agreed to the
terms above.`;
}

// ---------- Renter profiles ----------

router.post("/renter-profiles", async (req, res): Promise<void> => {
  const body = UpsertRenterProfileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(renterProfilesTable)
    .where(eq(renterProfilesTable.phone, body.data.phone));
  if (existing) {
    const [updated] = await db
      .update(renterProfilesTable)
      .set({ ...body.data, updatedAt: new Date() })
      .where(eq(renterProfilesTable.id, existing.id))
      .returning();
    res.json(updated);
    return;
  }
  const [row] = await db.insert(renterProfilesTable).values(body.data).returning();
  res.json(row);
});

router.get("/renter-profiles/by-phone/:phone", async (req, res): Promise<void> => {
  const params = GetRenterProfileByPhoneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(renterProfilesTable)
    .where(eq(renterProfilesTable.phone, params.data.phone));
  if (!row) {
    res.status(404).json({ error: "Renter profile not found" });
    return;
  }
  res.json(row);
});

router.get("/renter-profiles/:renterId", async (req, res): Promise<void> => {
  const params = GetRenterProfileParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(renterProfilesTable)
    .where(eq(renterProfilesTable.id, params.data.renterId));
  if (!row) {
    res.status(404).json({ error: "Renter profile not found" });
    return;
  }
  res.json(row);
});

router.patch("/renter-profiles/:renterId", async (req, res): Promise<void> => {
  const params = UpdateRenterProfileParams.safeParse(req.params);
  const body = UpdateRenterProfileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db
    .update(renterProfilesTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(renterProfilesTable.id, params.data.renterId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Renter profile not found" });
    return;
  }
  res.json(row);
});

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

router.get("/rental-cars/:carId/public", async (req, res): Promise<void> => {
  const params = GetRentalCarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.id, params.data.carId));
  // Anonymous share view: only expose listings that are approved AND active.
  // Anything else (pending review, withdrawn, blocked) responds 404 so a
  // leaked ID cannot reveal listing existence or owner PII.
  if (!row || row.status !== "approved" || !row.active) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  res.json({
    id: row.id,
    ownerKind: row.ownerKind,
    ownerName: row.ownerName,
    brand: row.brand,
    model: row.model,
    year: row.year,
    color: row.color,
    transmission: row.transmission,
    seats: row.seats,
    fuelType: row.fuelType,
    dailyRate: row.dailyRate,
    city: row.city,
    pickupAddress: row.pickupAddress,
    description: row.description,
    imageUrl: row.imageUrl,
    imageUrls: row.imageUrls ?? [],
  });
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
  // the seed/admin tooling, not through this route.
  // Cover/gallery invariant: when a gallery is supplied, `imageUrl` MUST
  // equal `imageUrls[0]`. When only `imageUrl` is supplied (legacy client),
  // promote it to a single-entry gallery so the two never desync.
  const incomingGallery = body.data.imageUrls ?? [];
  const imageUrls =
    incomingGallery.length > 0
      ? incomingGallery
      : body.data.imageUrl
        ? [body.data.imageUrl]
        : [];
  const imageUrl = imageUrls[0];
  const [row] = await db
    .insert(rentalCarsTable)
    .values({
      ...body.data,
      imageUrl,
      imageUrls,
      ownerKind: "user",
      status: "pending",
    })
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
  // Enforce the cover/gallery invariant on updates too. A caller cannot
  // change cover and gallery independently — whichever field is supplied
  // becomes the source of truth and the other is rewritten to match.
  const patch: typeof body.data = { ...body.data };
  if (patch.imageUrls !== undefined) {
    patch.imageUrl = patch.imageUrls[0];
  } else if (patch.imageUrl !== undefined) {
    patch.imageUrls = [patch.imageUrl];
  }
  const [row] = await db
    .update(rentalCarsTable)
    .set(patch)
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
  const renterIds = [...new Set(rows.map((r) => r.renterId).filter((x): x is string => !!x))];
  const cars = await db
    .select()
    .from(rentalCarsTable)
    .where(inArray(rentalCarsTable.id, carIds));
  const carMap = new Map(cars.map((c) => [c.id, c]));
  const renters = renterIds.length
    ? await db
        .select()
        .from(renterProfilesTable)
        .where(inArray(renterProfilesTable.id, renterIds))
    : [];
  const renterMap = new Map(renters.map((r) => [r.id, r]));
  return rows.map((r) => {
    const car = carMap.get(r.carId);
    return {
      ...r,
      carLabel: car ? `${car.year} ${car.brand} ${car.model}` : "",
      carImageUrl: car?.imageUrl ?? null,
      carCity: car?.city ?? null,
      ownerName: car?.ownerName ?? null,
      ownerPhone: car?.ownerPhone ?? null,
      renter: r.renterId ? renterMap.get(r.renterId) ?? null : null,
    };
  });
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
  if (q.data.renterId) filters.push(eq(rentalBookingsTable.renterId, q.data.renterId));
  if (q.data.status) filters.push(eq(rentalBookingsTable.status, q.data.status));

  let rows = await db
    .select()
    .from(rentalBookingsTable)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(rentalBookingsTable.createdAt));

  // ownerPhone filter joins through rental_cars; apply post-fetch for simplicity.
  if (q.data.ownerPhone) {
    const myCars = await db
      .select({ id: rentalCarsTable.id })
      .from(rentalCarsTable)
      .where(eq(rentalCarsTable.ownerPhone, q.data.ownerPhone));
    const carIdSet = new Set(myCars.map((c) => c.id));
    rows = rows.filter((r) => carIdSet.has(r.carId));
  }
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
  const [renter] = await db
    .select()
    .from(renterProfilesTable)
    .where(eq(renterProfilesTable.id, body.data.renterId));
  if (!renter) {
    res.status(404).json({
      error: "Renter profile not found. Please complete your profile before booking.",
    });
    return;
  }
  const purpose = body.data.purpose ?? "general";
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
      renterId: renter.id,
      renterName: renter.name,
      renterPhone: renter.phone,
      renterEmail: renter.email,
      startDate: start,
      endDate: end,
      days,
      dailyRate: car.dailyRate,
      total,
      status: "pending_review",
      ownerReviewStatus: "pending",
      purpose,
      serviceBookingId: body.data.serviceBookingId ?? null,
      notes: body.data.notes,
    })
    .returning();
  const [hydrated] = await hydrateRentalBookings([row]);
  res.status(201).json(hydrated);
});

// Manual status transitions still need to honour the FSM.
// Statuses that allow user/owner-initiated cancel:
const CANCELLABLE_FROM = new Set([
  "pending_review",
  "contract_pending",
  "awaiting_payment",
  "confirmed",
]);

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

  // Require exactly one action group per request (notes is freely combinable).
  const actionFields = [body.data.ownerReview, body.data.sign, body.data.payment, body.data.status];
  const actionCount = actionFields.filter((x) => x !== undefined).length;
  if (actionCount > 1) {
    res.status(400).json({ error: "Provide one action per request (ownerReview, sign, payment, or status)." });
    return;
  }

  const patch: Partial<typeof rentalBookingsTable.$inferInsert> = {};
  if (body.data.notes !== undefined) patch.notes = body.data.notes;
  const now = new Date();

  // --- Owner review (approve/reject) ---
  if (body.data.ownerReview) {
    if (existing.status !== "pending_review") {
      res.status(400).json({ error: "Owner review is only allowed while the booking is pending review." });
      return;
    }
    const { decision, notes } = body.data.ownerReview;
    if (decision === "reject") {
      patch.status = "rejected";
      patch.ownerReviewStatus = "rejected";
      patch.ownerReviewNotes = notes ?? null;
      patch.ownerReviewedAt = now;
      patch.rejectedAt = now;
    } else {
      // approve: generate contract and move to contract_pending
      const [car] = await db.select().from(rentalCarsTable).where(eq(rentalCarsTable.id, existing.carId));
      if (!car) {
        res.status(404).json({ error: "Car for this booking is missing." });
        return;
      }
      if (!existing.renterId) {
        res.status(400).json({ error: "Booking is missing a renter profile; cannot generate contract." });
        return;
      }
      const [renter] = await db
        .select()
        .from(renterProfilesTable)
        .where(eq(renterProfilesTable.id, existing.renterId));
      if (!renter) {
        res.status(404).json({ error: "Renter profile for this booking is missing." });
        return;
      }
      patch.status = "contract_pending";
      patch.ownerReviewStatus = "approved";
      patch.ownerReviewNotes = notes ?? null;
      patch.ownerReviewedAt = now;
      patch.contractText = buildContractText({ car, renter, booking: existing });
      patch.contractGeneratedAt = now;
    }
  }

  // --- Digital signature ---
  // We deliberately do NOT set status here based on the pre-read `existing`
  // row — two concurrent signs would each see no counterpart and leave status
  // stuck at contract_pending. Instead we persist the signature first, re-read
  // the row, and atomically promote to awaiting_payment if both signatures now
  // exist. The promotion is idempotent and guarded by a WHERE clause.
  let promoteAfterSign = false;
  if (body.data.sign) {
    if (existing.status !== "contract_pending") {
      res.status(400).json({ error: "Signing is only allowed once a contract has been generated." });
      return;
    }
    const { party, name } = body.data.sign;
    if (party === "renter") {
      patch.renterSignatureName = name;
      patch.renterSignedAt = now;
    } else {
      patch.ownerSignatureName = name;
      patch.ownerSignedAt = now;
    }
    promoteAfterSign = true;
  }

  // --- Payment ---
  if (body.data.payment) {
    if (existing.status !== "awaiting_payment") {
      res.status(400).json({ error: "Payment can only be recorded after both parties sign." });
      return;
    }
    const { method, markPaid } = body.data.payment;
    patch.paymentMethod = method;
    if (method === "online") {
      if (markPaid) {
        patch.paymentStatus = "paid";
        patch.paidAt = now;
        patch.status = "confirmed";
        patch.confirmedAt = now;
      }
      // else: remain awaiting_payment until paid
    } else {
      // cash_on_pickup: confirmed immediately, paid flips when owner marks pickup
      patch.status = "confirmed";
      patch.confirmedAt = now;
    }
  }

  // --- Manual status (cancel / active / completed) ---
  if (body.data.status) {
    const target = body.data.status;
    let ok = false;
    if (target === "cancelled" && CANCELLABLE_FROM.has(existing.status)) ok = true;
    if (target === "active" && existing.status === "confirmed") ok = true;
    if (target === "completed" && existing.status === "active") ok = true;
    if (!ok) {
      res.status(400).json({
        error: `Cannot move rental from "${existing.status}" to "${target}".`,
      });
      return;
    }
    patch.status = target;
    if (target === "cancelled") patch.cancelledAt = now;
    if (target === "active") {
      patch.startedAt = now;
      // For cash-on-pickup, treat starting the trip as receiving payment.
      if (existing.paymentMethod === "cash_on_pickup" && existing.paymentStatus !== "paid") {
        patch.paymentStatus = "paid";
        patch.paidAt = now;
      }
    }
    if (target === "completed") patch.completedAt = now;
  }

  let [row] = await db
    .update(rentalBookingsTable)
    .set(patch)
    .where(eq(rentalBookingsTable.id, params.data.rentalBookingId))
    .returning();

  // Race-safe dual-signature promotion: if either signer just persisted and
  // the freshly-read row now has both signatures, move to awaiting_payment.
  // The status guard in WHERE makes this a no-op if anything else has
  // advanced the booking in the meantime.
  if (promoteAfterSign && row.status === "contract_pending" && row.renterSignedAt && row.ownerSignedAt) {
    const [promoted] = await db
      .update(rentalBookingsTable)
      .set({ status: "awaiting_payment" })
      .where(
        and(
          eq(rentalBookingsTable.id, row.id),
          eq(rentalBookingsTable.status, "contract_pending"),
        ),
      )
      .returning();
    if (promoted) row = promoted;
  }

  const [hydrated] = await hydrateRentalBookings([row]);
  res.json(hydrated);
});

// Suppress unused import lint
void or;

export default router;
