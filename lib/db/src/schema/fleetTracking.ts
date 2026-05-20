import { pgTable, uuid, real, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
import { organizationsTable } from "./organizations";

/**
 * GPS pings recorded against a fleet vehicle (as opposed to a rental
 * booking — see `tripLocationsTable`). Append-only; the most recent ping
 * per vehicle is the "last known location" used by the fleet Safety
 * dashboard. Drivers post their own pings; admins can simulate or
 * backfill via the same endpoint.
 */
export const fleetTripLocationsTable = pgTable(
  "fleet_trip_locations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehiclesTable.id, { onDelete: "cascade" }),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    accuracyMeters: integer("accuracy_meters"),
    speedKph: real("speed_kph"),
    source: text("source").notNull().default("driver"),
    note: text("note"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byVehicleRecorded: index("fleet_trip_locations_vehicle_recorded_idx").on(
      t.vehicleId,
      t.recordedAt,
    ),
  }),
);

export type FleetTripLocation = typeof fleetTripLocationsTable.$inferSelect;

/**
 * Safety event on a fleet vehicle (accident, breakdown, theft, sos).
 * `organizationId` is denormalised so org-scoped triage lists don't
 * have to join through vehicles. `reportedBy` is derived server-side
 * from the verified relationship — the client cannot spoof it.
 */
export const fleetIncidentsTable = pgTable("fleet_incidents", {
  id: uuid("id").primaryKey().defaultRandom(),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // accident | breakdown | theft | sos
  status: text("status").notNull().default("open"), // open | investigating | resolved
  reportedBy: text("reported_by").notNull(), // driver | admin
  reporterPhone: text("reporter_phone"),
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  lastKnownLat: real("last_known_lat"),
  lastKnownLng: real("last_known_lng"),
  lastKnownAt: timestamp("last_known_at", { withTimezone: true }),
  reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export type FleetIncident = typeof fleetIncidentsTable.$inferSelect;
