import { pgTable, uuid, text, integer, real, timestamp } from "drizzle-orm/pg-core";

export const serviceCentersTable = pgTable("service_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  phone: text("phone").notNull(),
  specialties: text("specialties").array().notNull().default([]),
  rating: real("rating").notNull().default(0),
  reviewsCount: integer("reviews_count").notNull().default(0),
  imageUrl: text("image_url"),
  bio: text("bio"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceCenter = typeof serviceCentersTable.$inferSelect;
