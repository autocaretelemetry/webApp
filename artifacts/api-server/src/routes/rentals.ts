import { Router, type IRouter } from "express";
import { and, count, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../lib/auth";
import {
  db,
  rentalCarsTable,
  rentalBookingsTable,
  renterProfilesTable,
  bookingsTable,
  driversTable,
  tripLocationsTable,
  rentalIncidentsTable,
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
  ListRenterProfilesQueryParams,
  ListTripLocationsParams,
  CreateTripLocationBody,
  CreateTripLocationParams,
  CreateRentalIncidentBody,
  CreateRentalIncidentParams,
  ListRentalIncidentsQueryParams,
  UpdateRentalIncidentBody,
  UpdateRentalIncidentParams,
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

const RENTAL_MODE_VALUES = ["self_drive", "with_driver"] as const;
type RentalMode = (typeof RENTAL_MODE_VALUES)[number];

/**
 * Normalize an incoming rentalModes array: dedupe, drop unknowns, default to
 * ['self_drive'] when empty. Returns null when the input contains only
 * invalid values so callers can reject with 400.
 */
function normalizeRentalModes(input: string[] | undefined | null): RentalMode[] | null {
  if (!input || input.length === 0) return ["self_drive"];
  const allowed = new Set<RentalMode>(RENTAL_MODE_VALUES);
  const out: RentalMode[] = [];
  for (const v of input) {
    if (allowed.has(v as RentalMode) && !out.includes(v as RentalMode)) {
      out.push(v as RentalMode);
    }
  }
  return out.length === 0 ? null : out;
}

/**
 * Attach driver objects to a list of cars in one query. Cars without a
 * driverId keep `driver: null`.
 */
async function hydrateCarsWithDriver<T extends { driverId: string | null }>(
  rows: T[],
): Promise<(T & { driver: typeof driversTable.$inferSelect | null })[]> {
  const ids = [...new Set(rows.map((r) => r.driverId).filter((x): x is string => !!x))];
  if (ids.length === 0) return rows.map((r) => ({ ...r, driver: null }));
  const drivers = await db
    .select()
    .from(driversTable)
    .where(inArray(driversTable.id, ids));
  const map = new Map(drivers.map((d) => [d.id, d]));
  return rows.map((r) => ({ ...r, driver: r.driverId ? map.get(r.driverId) ?? null : null }));
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

router.get("/renter-profiles", requireAdmin, async (req, res): Promise<void> => {
  const q = ListRenterProfilesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const where = q.data.kycStatus
    ? eq(renterProfilesTable.kycStatus, q.data.kycStatus)
    : undefined;
  const renters = await db
    .select()
    .from(renterProfilesTable)
    .where(where as ReturnType<typeof eq>)
    .orderBy(desc(renterProfilesTable.createdAt));

  // Build booking counts per renterId in a single pass.
  const renterIds = renters.map((r) => r.id);
  type CountRow = { renterId: string | null; status: string; n: number };
  const countsArr: CountRow[] = renterIds.length
    ? ((await db
        .select({
          renterId: rentalBookingsTable.renterId,
          status: rentalBookingsTable.status,
          n: count(),
        })
        .from(rentalBookingsTable)
        .where(inArray(rentalBookingsTable.renterId, renterIds))
        .groupBy(rentalBookingsTable.renterId, rentalBookingsTable.status)) as CountRow[])
    : [];
  const ACTIVE = new Set<string>(ACTIVE_RENTAL_STATUSES);
  const counts = new Map<string, { total: number; active: number }>();
  for (const row of countsArr) {
    if (!row.renterId) continue;
    const c = counts.get(row.renterId) ?? { total: 0, active: 0 };
    c.total += Number(row.n);
    if (ACTIVE.has(row.status)) c.active += Number(row.n);
    counts.set(row.renterId, c);
  }

  res.json(
    renters.map((r) => {
      const c = counts.get(r.id) ?? { total: 0, active: 0 };
      return {
        id: r.id,
        name: r.name,
        phone: r.phone,
        email: r.email,
        kycStatus: r.kycStatus,
        hasDriverLicense: Boolean(r.driverLicenseNumber || r.driverLicenseUrl),
        hasIdDocument: Boolean(r.idDocumentUrl),
        hasSelfie: Boolean(r.selfieUrl),
        bookingCount: c.total,
        activeBookings: c.active,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    }),
  );
});

router.post("/renter-profiles", requireAuth, async (req, res): Promise<void> => {
  const body = UpsertRenterProfileBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && body.data.phone.trim() !== callerPhone) {
    res.status(403).json({ error: "You can only edit your own renter profile." });
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

router.get("/renter-profiles/by-phone/:phone", requireAuth, async (req, res): Promise<void> => {
  const params = GetRenterProfileByPhoneParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && params.data.phone.trim() !== callerPhone) {
    res.status(403).json({ error: "You can only view your own renter profile." });
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

router.get("/renter-profiles/:renterId", requireAuth, async (req, res): Promise<void> => {
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
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && row.phone.trim() !== callerPhone) {
    res.status(403).json({ error: "You can only view your own renter profile." });
    return;
  }
  res.json(row);
});

router.patch("/renter-profiles/:renterId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateRenterProfileParams.safeParse(req.params);
  const body = UpdateRenterProfileBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [target] = await db
    .select()
    .from(renterProfilesTable)
    .where(eq(renterProfilesTable.id, params.data.renterId));
  if (!target) {
    res.status(404).json({ error: "Renter profile not found" });
    return;
  }
  // Only platform admins/super-admins may set kycStatus; reject with 403 so
  // callers can't accidentally believe their KYC update succeeded.
  const patch: Record<string, unknown> = { ...body.data, updatedAt: new Date() };
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && target.phone.trim() !== callerPhone) {
    res.status(403).json({ error: "You can only edit your own renter profile." });
    return;
  }
  if (patch.kycStatus !== undefined && !isAdmin) {
    res.status(403).json({ error: "Only admins may change KYC status" });
    return;
  }
  const [row] = await db
    .update(renterProfilesTable)
    .set(patch)
    .where(eq(renterProfilesTable.id, params.data.renterId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Renter profile not found" });
    return;
  }
  res.json(row);
});

// ---------- Rental cars ----------

router.get("/rental-cars", requireAuth, async (req, res): Promise<void> => {
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
  res.json(await hydrateCarsWithDriver(rows));
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
  // Public share view of the driver: keep only the fields a prospective
  // renter needs to evaluate the chauffeur (name, photo, experience,
  // languages, bio). Phone and licence number are PII and are withheld
  // until a booking is created and the owner approves it.
  const fullDriver = row.driverId
    ? (await db.select().from(driversTable).where(eq(driversTable.id, row.driverId)))[0] ?? null
    : null;
  const driver = fullDriver
    ? {
        id: fullDriver.id,
        name: fullDriver.name,
        photoUrl: fullDriver.photoUrl,
        yearsExperience: fullDriver.yearsExperience,
        languages: fullDriver.languages ?? [],
        bio: fullDriver.bio,
      }
    : null;
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
    rentalModes: row.rentalModes ?? ["self_drive"],
    withDriverDailyRate: row.withDriverDailyRate,
    driver,
  });
});

// Bookings that count as "the owner approved this renter for this car" — at
// these statuses the renter legitimately needs the chauffeur's phone /
// licence (and the owner's phone/email) to coordinate pickup, so we expose
// the full driver row + owner contact. The rental FSM is
// `pending_review -> contract_pending -> awaiting_payment -> confirmed ->
// active -> completed`; owner approval flips the booking out of
// `pending_review` into `contract_pending`, so everything from
// contract_pending onward (short of cancelled/rejected) counts as
// owner-approved.
const DRIVER_PII_BOOKING_STATUSES = [
  "contract_pending",
  "awaiting_payment",
  "confirmed",
  "active",
  "completed",
] as const;
const OWNER_PII_BOOKING_STATUSES = DRIVER_PII_BOOKING_STATUSES;

router.get("/rental-cars/:carId", requireAuth, async (req, res): Promise<void> => {
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
  const [hydrated] = await hydrateCarsWithDriver([row]);

  // Decide whether this caller may see the chauffeur's PII (phone, licence
  // number, etc). General signed-in browsers get the same redacted driver
  // shape as the public share view; only admins, the car owner, and renters
  // with an approved booking on this car see the full row.
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  let canSeePii = isAdmin || (!!callerPhone && callerPhone === row.ownerPhone.trim());
  if (!canSeePii && callerPhone) {
    const [match] = await db
      .select({ id: rentalBookingsTable.id })
      .from(rentalBookingsTable)
      .where(
        and(
          eq(rentalBookingsTable.carId, row.id),
          eq(rentalBookingsTable.renterPhone, callerPhone),
          inArray(rentalBookingsTable.status, [...OWNER_PII_BOOKING_STATUSES]),
        ),
      )
      .limit(1);
    canSeePii = !!match;
  }

  const driver =
    hydrated.driver && !canSeePii
      ? {
          id: hydrated.driver.id,
          name: hydrated.driver.name,
          photoUrl: hydrated.driver.photoUrl,
          yearsExperience: hydrated.driver.yearsExperience,
          languages: hydrated.driver.languages ?? [],
          bio: hydrated.driver.bio,
        }
      : hydrated.driver;
  // Owner PII (phone, email) is gated the same way as the chauffeur's: only
  // admins, the owner themselves, and renters with an owner-approved booking
  // on this car see them. Everyone else gets the same shape as the /public
  // share view (ownerKind + ownerName only).
  const redactedOwner = canSeePii
    ? {}
    : { ownerPhone: undefined, ownerEmail: undefined };
  res.json({ ...hydrated, driver, ...redactedOwner });
});

router.post("/rental-cars", requireAuth, async (req, res): Promise<void> => {
  const body = CreateRentalCarBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Non-admins can only list cars under their own phone — otherwise a renter
  // could create a fake listing in another owner's name.
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && body.data.ownerPhone.trim() !== callerPhone) {
    res.status(403).json({ error: "You can only list cars under your own owner phone." });
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

  // Rental modes: default to self_drive if omitted. If with_driver is
  // selected, a driverId is required and must belong to this owner — we
  // can't ship a listing that advertises a chauffeur with no profile.
  const rentalModes = normalizeRentalModes(body.data.rentalModes ?? null);
  if (!rentalModes) {
    res.status(400).json({ error: "rentalModes must contain at least one of self_drive, with_driver." });
    return;
  }
  let driverId: string | null = null;
  if (rentalModes.includes("with_driver")) {
    if (!body.data.driverId) {
      res.status(400).json({ error: "Pick a driver profile before listing the car as with-driver." });
      return;
    }
    const [drv] = await db
      .select()
      .from(driversTable)
      .where(eq(driversTable.id, body.data.driverId));
    if (!drv || drv.ownerPhone !== body.data.ownerPhone) {
      res.status(400).json({ error: "Selected driver does not belong to you." });
      return;
    }
    driverId = drv.id;
  }

  const [row] = await db
    .insert(rentalCarsTable)
    .values({
      ...body.data,
      imageUrl,
      imageUrls,
      ownerKind: "user",
      status: "pending",
      rentalModes,
      withDriverDailyRate: body.data.withDriverDailyRate ?? null,
      driverId,
    })
    .returning();
  const [hydrated] = await hydrateCarsWithDriver([row]);
  res.status(201).json(hydrated);
});

router.patch("/rental-cars/:carId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateRentalCarParams.safeParse(req.params);
  const body = UpdateRentalCarBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [carRow] = await db
    .select()
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.id, params.data.carId));
  if (!carRow) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && carRow.ownerPhone.trim() !== callerPhone) {
    res.status(403).json({ error: "You don't own this rental car." });
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

  // If rentalModes or driverId is being updated, re-validate the invariant
  // that with_driver listings always have a valid, owner-owned driver.
  if (patch.rentalModes !== undefined || patch.driverId !== undefined) {
    const [existing] = await db
      .select()
      .from(rentalCarsTable)
      .where(eq(rentalCarsTable.id, params.data.carId));
    if (!existing) {
      res.status(404).json({ error: "Rental car not found" });
      return;
    }
    const nextModes = normalizeRentalModes(
      patch.rentalModes ?? existing.rentalModes,
    );
    if (!nextModes) {
      res.status(400).json({ error: "rentalModes must contain at least one of self_drive, with_driver." });
      return;
    }
    patch.rentalModes = nextModes;
    const nextDriverId =
      patch.driverId === undefined ? existing.driverId : patch.driverId;
    if (nextModes.includes("with_driver")) {
      if (!nextDriverId) {
        res.status(400).json({ error: "Pick a driver profile before listing the car as with-driver." });
        return;
      }
      const [drv] = await db
        .select()
        .from(driversTable)
        .where(eq(driversTable.id, nextDriverId));
      if (!drv || drv.ownerPhone !== existing.ownerPhone) {
        res.status(400).json({ error: "Selected driver does not belong to you." });
        return;
      }
    } else {
      // Dropping with_driver — null out the driver link so the car page
      // doesn't keep showing a profile that no longer applies.
      patch.driverId = null;
    }
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
  const [hydrated] = await hydrateCarsWithDriver([row]);
  res.json(hydrated);
});

router.delete("/rental-cars/:carId", requireAuth, async (req, res): Promise<void> => {
  const params = DeleteRentalCarParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [carRow] = await db
    .select()
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.id, params.data.carId));
  if (!carRow) {
    res.status(404).json({ error: "Rental car not found" });
    return;
  }
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  if (!isAdmin && carRow.ownerPhone.trim() !== callerPhone) {
    res.status(403).json({ error: "You don't own this rental car." });
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

router.get("/rental-bookings", requireAuth, async (req, res): Promise<void> => {
  const q = ListRentalBookingsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const role = req.user?.role;
  const isAdmin = role === "admin" || role === "super_admin";
  const callerPhone = (req.user?.phone ?? "").trim();
  // Non-admins cannot ask about anyone else's bookings. Any phone/id filter
  // they pass must resolve back to themselves; otherwise we refuse rather
  // than silently rewriting it so the client gets a clear signal.
  if (!isAdmin) {
    if (q.data.renterPhone && q.data.renterPhone.trim() !== callerPhone) {
      res.status(403).json({ error: "You can only list your own rental bookings." });
      return;
    }
    if (q.data.ownerPhone && q.data.ownerPhone.trim() !== callerPhone) {
      res.status(403).json({ error: "You can only list rentals on cars you own." });
      return;
    }
    if (q.data.renterId) {
      const [rp] = await db
        .select({ phone: renterProfilesTable.phone })
        .from(renterProfilesTable)
        .where(eq(renterProfilesTable.id, q.data.renterId));
      if (!rp || rp.phone.trim() !== callerPhone) {
        res.status(403).json({ error: "You can only list your own rental bookings." });
        return;
      }
    }
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

  // Safety net: if a non-admin reached this point without any identity
  // filter (e.g. only filtered by status or carId), scope the result set to
  // bookings that touch them as renter OR owner.
  if (!isAdmin && !q.data.renterPhone && !q.data.renterId && !q.data.ownerPhone) {
    const myCars = await db
      .select({ id: rentalCarsTable.id })
      .from(rentalCarsTable)
      .where(eq(rentalCarsTable.ownerPhone, callerPhone));
    const carIdSet = new Set(myCars.map((c) => c.id));
    rows = rows.filter(
      (r) => (r.renterPhone ?? "").trim() === callerPhone || carIdSet.has(r.carId),
    );
  }

  res.json(await hydrateRentalBookings(rows));
});

router.post("/rental-bookings", requireAuth, async (req, res): Promise<void> => {
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
  // The renter profile in the body must belong to the signed-in user.
  // Without this gate any renter could book a car under another renter's
  // identity and stick them with the contract.
  {
    const role = req.user?.role;
    const isAdmin = role === "admin" || role === "super_admin";
    const callerPhone = (req.user?.phone ?? "").trim();
    if (!isAdmin && renter.phone.trim() !== callerPhone) {
      res.status(403).json({ error: "You can only book under your own renter profile." });
      return;
    }
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
  // Rental mode: validate against what the owner offers and pick the right
  // per-day rate. With-driver uses withDriverDailyRate when set, otherwise
  // falls back to the plain dailyRate.
  const rentalMode: RentalMode = (body.data.rentalMode ?? "self_drive") as RentalMode;
  const offered = (car.rentalModes ?? ["self_drive"]) as RentalMode[];
  if (!offered.includes(rentalMode)) {
    res.status(400).json({
      error: `This car is not offered in "${rentalMode}" mode. Choose one of: ${offered.join(", ")}.`,
    });
    return;
  }
  if (rentalMode === "with_driver" && !car.driverId) {
    res.status(400).json({
      error: "Owner advertised this car with-driver but no driver profile is attached.",
    });
    return;
  }
  const effectiveDailyRate =
    rentalMode === "with_driver" && car.withDriverDailyRate != null
      ? car.withDriverDailyRate
      : car.dailyRate;
  const days = dayDiff(start, end);
  const total = days * effectiveDailyRate;
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
      dailyRate: effectiveDailyRate,
      total,
      status: "pending_review",
      ownerReviewStatus: "pending",
      purpose,
      serviceBookingId: body.data.serviceBookingId ?? null,
      notes: body.data.notes,
      rentalMode,
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

router.patch("/rental-bookings/:rentalBookingId", requireAuth, async (req, res): Promise<void> => {
  const params = UpdateRentalBookingParams.safeParse(req.params);
  const body = UpdateRentalBookingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const access = await authorizeBookingAccess(req, res, params.data.rentalBookingId);
  if (!access) return;
  const [existing] = await db
    .select()
    .from(rentalBookingsTable)
    .where(eq(rentalBookingsTable.id, params.data.rentalBookingId));
  if (!existing) {
    res.status(404).json({ error: "Rental booking not found" });
    return;
  }
  // Owner-only action: approving/rejecting the booking belongs to the owner
  // (or platform admin). Renters can still sign, pay, cancel, etc.
  if (body.data.ownerReview && access.relationship === "renter") {
    res.status(403).json({ error: "Only the car owner can approve or reject this booking." });
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

// ---------- Trip locations (live tracking) ----------

type BookingRelationship = "admin" | "renter" | "owner";

/**
 * Authorize the caller against a specific rental booking. Returns the caller's
 * relationship to it ("admin" | "renter" | "owner") or null if they have no
 * legitimate connection. Renters are matched by phone, owners by the car's
 * `ownerPhone`. Admins/super-admins bypass the relationship check.
 *
 * On rejection, this function writes the appropriate 401/403/404 response and
 * the caller should simply return.
 */
async function authorizeBookingAccess(
  req: import("express").Request,
  res: import("express").Response,
  bookingId: string,
): Promise<{ relationship: BookingRelationship; renterPhone: string | null; ownerPhone: string | null } | null> {
  const [b] = await db
    .select({
      id: rentalBookingsTable.id,
      renterPhone: rentalBookingsTable.renterPhone,
      ownerPhone: rentalCarsTable.ownerPhone,
    })
    .from(rentalBookingsTable)
    .leftJoin(rentalCarsTable, eq(rentalBookingsTable.carId, rentalCarsTable.id))
    .where(eq(rentalBookingsTable.id, bookingId));
  if (!b) {
    res.status(404).json({ error: "Rental booking not found" });
    return null;
  }
  const user = req.user;
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  if (user.role === "admin" || user.role === "super_admin") {
    return { relationship: "admin", renterPhone: b.renterPhone, ownerPhone: b.ownerPhone };
  }
  const userPhone = (user.phone ?? "").trim();
  if (userPhone && b.renterPhone && userPhone === b.renterPhone.trim()) {
    return { relationship: "renter", renterPhone: b.renterPhone, ownerPhone: b.ownerPhone };
  }
  if (userPhone && b.ownerPhone && userPhone === b.ownerPhone.trim()) {
    return { relationship: "owner", renterPhone: b.renterPhone, ownerPhone: b.ownerPhone };
  }
  res.status(403).json({ error: "You don't have access to this rental booking." });
  return null;
}


router.get("/rental-bookings/:rentalBookingId/locations", requireAuth, async (req, res): Promise<void> => {
  const params = ListTripLocationsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const access = await authorizeBookingAccess(req, res, params.data.rentalBookingId);
  if (!access) return;
  const rows = await db
    .select()
    .from(tripLocationsTable)
    .where(eq(tripLocationsTable.bookingId, params.data.rentalBookingId))
    .orderBy(desc(tripLocationsTable.recordedAt))
    .limit(500);
  // Return oldest -> newest so client can render a polyline directly.
  res.json(rows.slice().reverse());
});

router.post("/rental-bookings/:rentalBookingId/locations", requireAuth, async (req, res): Promise<void> => {
  const params = CreateTripLocationParams.safeParse(req.params);
  const body = CreateTripLocationBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const access = await authorizeBookingAccess(req, res, params.data.rentalBookingId);
  if (!access) return;
  const [booking] = await db
    .select({ id: rentalBookingsTable.id, status: rentalBookingsTable.status })
    .from(rentalBookingsTable)
    .where(eq(rentalBookingsTable.id, params.data.rentalBookingId));
  if (!booking) {
    res.status(404).json({ error: "Rental booking not found" });
    return;
  }
  // Accept pings on confirmed/active trips; ignore on completed/cancelled to
  // keep historical data clean.
  if (!["confirmed", "active"].includes(booking.status)) {
    res.status(400).json({ error: "Trip is not in a state that accepts location pings." });
    return;
  }
  const [row] = await db
    .insert(tripLocationsTable)
    .values({
      bookingId: booking.id,
      lat: body.data.lat,
      lng: body.data.lng,
      accuracyMeters: body.data.accuracyMeters,
      speedKph: body.data.speedKph,
      source: body.data.source ?? "device",
      note: body.data.note,
      recordedAt: body.data.recordedAt ? new Date(body.data.recordedAt) : new Date(),
    })
    .returning();
  res.status(201).json(row);
});

// ---------- Incidents (theft / accident / breakdown / SOS) ----------

async function lastPingFor(bookingId: string) {
  const [ping] = await db
    .select()
    .from(tripLocationsTable)
    .where(eq(tripLocationsTable.bookingId, bookingId))
    .orderBy(desc(tripLocationsTable.recordedAt))
    .limit(1);
  return ping ?? null;
}

router.post("/rental-bookings/:rentalBookingId/incidents", requireAuth, async (req, res): Promise<void> => {
  const params = CreateRentalIncidentParams.safeParse(req.params);
  const body = CreateRentalIncidentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const access = await authorizeBookingAccess(req, res, params.data.rentalBookingId);
  if (!access) return;
  const booking = { id: params.data.rentalBookingId };
  // Derive reportedBy from the verified relationship — client cannot spoof.
  const reportedBy: "renter" | "owner" | "admin" = access.relationship;
  // If the renter provided explicit GPS at the moment of reporting, persist it
  // alongside the location feed and use it as the incident's last-known
  // location; otherwise fall back to the trip's most recent recorded ping.
  let incidentLat: number | null = null;
  let incidentLng: number | null = null;
  let incidentAt: Date | null = null;
  if (typeof body.data.lat === "number" && typeof body.data.lng === "number") {
    const [ping] = await db
      .insert(tripLocationsTable)
      .values({
        bookingId: booking.id,
        lat: body.data.lat,
        lng: body.data.lng,
        accuracyMeters: body.data.accuracy != null ? Math.round(body.data.accuracy) : null,
        source: reportedBy === "renter" ? "device" : reportedBy === "owner" ? "owner" : "admin",
        note: "Captured at incident report",
      })
      .returning();
    incidentLat = ping?.lat ?? body.data.lat;
    incidentLng = ping?.lng ?? body.data.lng;
    incidentAt = ping?.recordedAt ?? new Date();
  } else {
    const ping = await lastPingFor(booking.id);
    incidentLat = ping?.lat ?? null;
    incidentLng = ping?.lng ?? null;
    incidentAt = ping?.recordedAt ?? null;
  }
  const [row] = await db
    .insert(rentalIncidentsTable)
    .values({
      bookingId: booking.id,
      kind: body.data.kind,
      reportedBy,
      reporterName: body.data.reporterName ?? req.user?.name ?? null,
      reporterPhone: body.data.reporterPhone ?? req.user?.phone ?? null,
      notes: body.data.notes,
      lastKnownLat: incidentLat,
      lastKnownLng: incidentLng,
      lastKnownAt: incidentAt,
    })
    .returning();
  res.status(201).json(row);
});

router.get("/rental-incidents", requireAdmin, async (req, res): Promise<void> => {
  const q = ListRentalIncidentsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const where = q.data.status
    ? eq(rentalIncidentsTable.status, q.data.status)
    : undefined;
  const rows = await db
    .select({
      i: rentalIncidentsTable,
      car: {
        brand: rentalCarsTable.brand,
        model: rentalCarsTable.model,
        year: rentalCarsTable.year,
        plateNumber: rentalCarsTable.plateNumber,
        ownerName: rentalCarsTable.ownerName,
        ownerPhone: rentalCarsTable.ownerPhone,
      },
      renter: {
        renterName: rentalBookingsTable.renterName,
        renterPhone: rentalBookingsTable.renterPhone,
      },
    })
    .from(rentalIncidentsTable)
    .leftJoin(rentalBookingsTable, eq(rentalIncidentsTable.bookingId, rentalBookingsTable.id))
    .leftJoin(rentalCarsTable, eq(rentalBookingsTable.carId, rentalCarsTable.id))
    .where(where as ReturnType<typeof eq>)
    .orderBy(desc(rentalIncidentsTable.reportedAt));

  res.json(
    rows.map(({ i, car, renter }) => ({
      ...i,
      carLabel: car ? `${car.year} ${car.brand} ${car.model}` : null,
      carPlate: car?.plateNumber ?? null,
      ownerName: car?.ownerName ?? null,
      ownerPhone: car?.ownerPhone ?? null,
      renterName: renter?.renterName ?? null,
      renterPhone: renter?.renterPhone ?? null,
    })),
  );
});

router.patch("/rental-incidents/:incidentId", requireAdmin, async (req, res): Promise<void> => {
  const params = UpdateRentalIncidentParams.safeParse(req.params);
  const body = UpdateRentalIncidentBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const patch: Record<string, unknown> = { ...body.data };
  if (body.data.status === "resolved") patch.resolvedAt = new Date();
  const [row] = await db
    .update(rentalIncidentsTable)
    .set(patch)
    .where(eq(rentalIncidentsTable.id, params.data.incidentId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Incident not found" });
    return;
  }
  res.json(row);
});

router.get("/tracked-trips", requireAdmin, async (_req, res): Promise<void> => {
  // Live trips = bookings in confirmed/active. We enrich each with last ping
  // and whether any open incident is attached.
  const trips = await db
    .select({
      b: rentalBookingsTable,
      car: {
        brand: rentalCarsTable.brand,
        model: rentalCarsTable.model,
        year: rentalCarsTable.year,
        plateNumber: rentalCarsTable.plateNumber,
        ownerName: rentalCarsTable.ownerName,
        ownerPhone: rentalCarsTable.ownerPhone,
      },
    })
    .from(rentalBookingsTable)
    .leftJoin(rentalCarsTable, eq(rentalBookingsTable.carId, rentalCarsTable.id))
    .where(inArray(rentalBookingsTable.status, ["confirmed", "active"]))
    .orderBy(desc(rentalBookingsTable.startDate));

  const ids = trips.map((t) => t.b.id);
  // Last ping per booking
  const lastPings = new Map<string, { lat: number; lng: number; recordedAt: Date; n: number }>();
  if (ids.length) {
    const allPings = await db
      .select()
      .from(tripLocationsTable)
      .where(inArray(tripLocationsTable.bookingId, ids))
      .orderBy(desc(tripLocationsTable.recordedAt));
    for (const p of allPings) {
      const cur = lastPings.get(p.bookingId);
      if (!cur) {
        lastPings.set(p.bookingId, { lat: p.lat, lng: p.lng, recordedAt: p.recordedAt, n: 1 });
      } else {
        cur.n += 1;
      }
    }
    // Open incidents per booking
    const openIncidents = await db
      .select({ bookingId: rentalIncidentsTable.bookingId })
      .from(rentalIncidentsTable)
      .where(
        and(
          inArray(rentalIncidentsTable.bookingId, ids),
          inArray(rentalIncidentsTable.status, ["open", "investigating"]),
        ),
      );
    const flagged = new Set(openIncidents.map((r) => r.bookingId));

    res.json(
      trips.map(({ b, car }) => {
        const last = lastPings.get(b.id);
        return {
          bookingId: b.id,
          carLabel: car ? `${car.year} ${car.brand} ${car.model}` : "Rental",
          carPlate: car?.plateNumber ?? null,
          renterName: b.renterName,
          renterPhone: b.renterPhone,
          ownerName: car?.ownerName ?? "Unknown",
          ownerPhone: car?.ownerPhone ?? "",
          status: b.status,
          startDate: b.startDate,
          endDate: b.endDate,
          lastLat: last?.lat ?? null,
          lastLng: last?.lng ?? null,
          lastSeenAt: last?.recordedAt ?? null,
          pingCount: last?.n ?? 0,
          hasIncident: flagged.has(b.id),
        };
      }),
    );
    return;
  }
  res.json([]);
});

// Suppress unused import lint
void or;
void gt;
void lt;

export default router;
