import { pgTable, uuid, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";
import { driversTable } from "./drivers";

export const rentalCarsTable = pgTable("rental_cars", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerKind: text("owner_kind").notNull(),
  ownerName: text("owner_name").notNull(),
  ownerPhone: text("owner_phone").notNull(),
  ownerEmail: text("owner_email"),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  color: text("color").notNull(),
  plateNumber: text("plate_number").notNull(),
  transmission: text("transmission").notNull(),
  seats: integer("seats").notNull().default(5),
  fuelType: text("fuel_type").notNull().default("petrol"),
  dailyRate: real("daily_rate").notNull(),
  city: text("city").notNull(),
  pickupAddress: text("pickup_address").notNull(),
  description: text("description"),
  imageUrl: text("image_url"),
  imageUrls: text("image_urls").array().notNull().default([]),
  status: text("status").notNull().default("pending"),
  active: boolean("active").notNull().default(true),
  // Rental modes the owner offers. Values: 'self_drive' and/or 'with_driver'.
  // At least one entry is enforced by the server route, not by Postgres.
  rentalModes: text("rental_modes").array().notNull().default(["self_drive"]),
  // Optional per-day rate when rented with a driver (covers driver fee).
  // Falls back to dailyRate at booking time if null.
  withDriverDailyRate: real("with_driver_daily_rate"),
  // Driver attached to this listing — required by the server route whenever
  // rentalModes includes 'with_driver'.
  driverId: uuid("driver_id").references(() => driversTable.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RentalCar = typeof rentalCarsTable.$inferSelect;
