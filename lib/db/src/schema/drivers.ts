import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

/**
 * Drivers are profiles of professional chauffeurs that a car owner can attach
 * to a rental car listing. When a car is listed `with_driver`, the renter sees
 * the driver's profile (photo, experience, languages) before booking.
 *
 * Scoped by `ownerPhone` to match how rental_cars is scoped — this app keys
 * ownership off the phone number that is also the renter-profile primary key.
 */
export const driversTable = pgTable("drivers", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerPhone: text("owner_phone").notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  photoUrl: text("photo_url"),
  licenseNumber: text("license_number"),
  yearsExperience: integer("years_experience").notNull().default(0),
  languages: text("languages").array().notNull().default([]),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Driver = typeof driversTable.$inferSelect;
