import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const vehiclesTable = pgTable("vehicles", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerName: text("owner_name").notNull(),
  ownerPhone: text("owner_phone"),
  brand: text("brand").notNull(),
  model: text("model").notNull(),
  year: integer("year").notNull(),
  vin: text("vin"),
  plateNumber: text("plate_number").notNull(),
  color: text("color").notNull(),
  engineType: text("engine_type"),
  mileage: integer("mileage").notNull().default(0),
  imageUrl: text("image_url"),
  nextServiceDate: timestamp("next_service_date", { withTimezone: true }),
  insuranceProvider: text("insurance_provider"),
  lastServicedAt: timestamp("last_serviced_at", { withTimezone: true }),
  lastServicedMileage: integer("last_serviced_mileage"),
  serviceIntervalDays: integer("service_interval_days").notNull().default(90),
  serviceIntervalKm: integer("service_interval_km").notNull().default(5000),
  // Fleet linkage. When set, the vehicle belongs to an organization and
  // fleet-admin authorization (plus maxFleetVehicles enforcement) applies
  // alongside the standard owner-phone checks. `assignedDriverPhone`
  // scopes which driver-role member sees the vehicle in their portal.
  organizationId: uuid("organization_id"),
  assignedDriverPhone: text("assigned_driver_phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vehicle = typeof vehiclesTable.$inferSelect;
