import { pgTable, uuid, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const deliveryAgentsTable = pgTable("delivery_agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  city: text("city").notNull(),
  region: text("region").notNull(),
  vehicleType: text("vehicle_type").notNull().default("motorbike"),
  bio: text("bio"),
  rating: real("rating").notNull().default(0),
  completedDeliveries: integer("completed_deliveries").notNull().default(0),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeliveryAgent = typeof deliveryAgentsTable.$inferSelect;
