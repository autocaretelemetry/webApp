import { pgTable, uuid, text, timestamp, real, boolean } from "drizzle-orm/pg-core";
import { vehiclesTable } from "./vehicles";
import { serviceCentersTable } from "./serviceCenters";
import { mechanicsTable } from "./mechanics";

export const bookingsTable = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehiclesTable.id, { onDelete: "cascade" }),
  serviceCenterId: uuid("service_center_id")
    .notNull()
    .references(() => serviceCentersTable.id, { onDelete: "cascade" }),
  mechanicId: uuid("mechanic_id").references(() => mechanicsTable.id, {
    onDelete: "set null",
  }),
  serviceType: text("service_type").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("requested"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  estimatedDurationHours: real("estimated_duration_hours"),
  invoiceId: uuid("invoice_id"),
  // Set by the server at creation time when the booking's vehicle owner has
  // an active subscription whose plan grants `priorityBooking`. The center's
  // job queue surfaces priority bookings at the top regardless of age.
  priority: boolean("priority").notNull().default(false),
});

export const bookingEventsTable = pgTable("booking_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookingsTable.id, { onDelete: "cascade" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  label: text("label").notNull(),
  actor: text("actor"),
  kind: text("kind").notNull().default("booking_created"),
});

export type Booking = typeof bookingsTable.$inferSelect;
export type BookingEvent = typeof bookingEventsTable.$inferSelect;
