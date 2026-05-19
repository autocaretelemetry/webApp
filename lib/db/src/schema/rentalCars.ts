import { pgTable, uuid, text, integer, real, boolean, timestamp } from "drizzle-orm/pg-core";

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
  status: text("status").notNull().default("pending"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RentalCar = typeof rentalCarsTable.$inferSelect;
