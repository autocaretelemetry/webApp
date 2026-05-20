import { pgTable, uuid, text, integer, real, timestamp } from "drizzle-orm/pg-core";
import { rentalCarsTable } from "./rentalCars";
import { bookingsTable } from "./bookings";
import { renterProfilesTable } from "./renterProfiles";

export const rentalBookingsTable = pgTable("rental_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  carId: uuid("car_id")
    .notNull()
    .references(() => rentalCarsTable.id, { onDelete: "cascade" }),
  renterId: uuid("renter_id").references(() => renterProfilesTable.id, {
    onDelete: "set null",
  }),
  renterName: text("renter_name").notNull(),
  renterPhone: text("renter_phone").notNull(),
  renterEmail: text("renter_email"),
  startDate: timestamp("start_date", { withTimezone: true }).notNull(),
  endDate: timestamp("end_date", { withTimezone: true }).notNull(),
  days: integer("days").notNull(),
  dailyRate: real("daily_rate").notNull(),
  total: real("total").notNull(),
  // pending_review -> (owner approves) contract_pending -> (both sign)
  // awaiting_payment -> (payment) confirmed -> active -> completed
  // Terminal branches: rejected (owner declines), cancelled.
  status: text("status").notNull().default("pending_review"),
  // "general" or "loaner" (linked to a service booking)
  purpose: text("purpose").notNull().default("general"),
  serviceBookingId: uuid("service_booking_id").references(() => bookingsTable.id, {
    onDelete: "set null",
  }),
  notes: text("notes"),
  // Whether the renter chose 'self_drive' or 'with_driver' for this booking.
  // Defaults to 'self_drive' for backward compatibility with existing rows.
  rentalMode: text("rental_mode").notNull().default("self_drive"),

  // Owner review of renter & request
  ownerReviewStatus: text("owner_review_status").notNull().default("pending"),
  ownerReviewNotes: text("owner_review_notes"),
  ownerReviewedAt: timestamp("owner_reviewed_at", { withTimezone: true }),

  // Digital contract (generated on owner approval) and signatures
  contractText: text("contract_text"),
  contractGeneratedAt: timestamp("contract_generated_at", { withTimezone: true }),
  renterSignatureName: text("renter_signature_name"),
  renterSignedAt: timestamp("renter_signed_at", { withTimezone: true }),
  ownerSignatureName: text("owner_signature_name"),
  ownerSignedAt: timestamp("owner_signed_at", { withTimezone: true }),

  // Payment
  paymentMethod: text("payment_method"),
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  paidAt: timestamp("paid_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
});

export type RentalBooking = typeof rentalBookingsTable.$inferSelect;
