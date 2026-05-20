import { pgTable, uuid, text, real, timestamp } from "drizzle-orm/pg-core";
import { rentalBookingsTable } from "./rentalBookings";

/**
 * A safety event raised against an active rental — theft, accident, breakdown,
 * or generic SOS. Raised by the renter or the car owner from the app, then
 * triaged by platform staff (open → investigating → resolved).
 *
 * `lastKnownLat/Lng` are denormalised at create-time from the latest trip ping
 * so the admin Safety page can show a map link even when fresh telemetry is
 * unavailable (e.g. vehicle goes dark after theft).
 */
export const rentalIncidentsTable = pgTable("rental_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => rentalBookingsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // theft | accident | breakdown | sos
  status: text("status").notNull().default("open"), // open | investigating | resolved
  reportedBy: text("reported_by").notNull(), // renter | owner | admin
  reporterName: text("reporter_name"),
  reporterPhone: text("reporter_phone"),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  lastKnownLat: real("last_known_lat"),
  lastKnownLng: real("last_known_lng"),
  lastKnownAt: timestamp("last_known_at", { withTimezone: true }),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type RentalIncident = typeof rentalIncidentsTable.$inferSelect;
