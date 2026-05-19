import { pgTable, uuid, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { rentalCarsTable } from "./rentalCars";
import { bookingsTable } from "./bookings";

export const rentalBookingsTable = pgTable("rental_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  carId: uuid("car_id")
    .notNull()
    .references(() => rentalCarsTable.id, { onDelete: "cascade" }),
  renterName: text("renter_name").notNull(),
  renterPhone: text("renter_phone").notNull(),
  renterEmail: text("renter_email"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  days: integer("days").notNull(),
  dailyRate: real("daily_rate").notNull(),
  total: real("total").notNull(),
  // requested -> confirmed -> active -> completed
  // requested/confirmed -> cancelled
  status: text("status").notNull().default("requested"),
  // "general" or "loaner" (linked to a service booking)
  purpose: text("purpose").notNull().default("general"),
  serviceBookingId: uuid("service_booking_id").references(() => bookingsTable.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export type RentalBooking = typeof rentalBookingsTable.$inferSelect;
