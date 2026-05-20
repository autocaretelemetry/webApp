import { pgTable, uuid, real, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { rentalBookingsTable } from "./rentalBookings";

/**
 * A single GPS-style ping recorded against an active rental booking. Pings are
 * append-only — the most recent one is treated as the vehicle's "last known
 * location" for tracking, theft assist, and emergency lookups.
 *
 * `source` distinguishes how the ping arrived: 'device' (renter's app), 'owner'
 * (manual update from the car owner), 'admin' (platform staff lookup or
 * simulated), or 'sim' (seed/demo data).
 */
export const tripLocationsTable = pgTable(
  "trip_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => rentalBookingsTable.id, { onDelete: "cascade" }),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    accuracyMeters: integer("accuracy_meters"),
    speedKph: real("speed_kph"),
    source: text("source").notNull().default("device"),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byBookingRecorded: index("trip_locations_booking_recorded_idx").on(
      t.bookingId,
      t.recordedAt,
    ),
  }),
);

export type TripLocation = typeof tripLocationsTable.$inferSelect;
