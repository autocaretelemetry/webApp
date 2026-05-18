import { pgTable, uuid, text, real, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

export const partsTable = pgTable("parts", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  brand: text("brand").notNull(),
  sku: text("sku").notNull(),
  price: real("price").notNull(),
  stock: integer("stock").notNull().default(0),
  imageUrl: text("image_url"),
  compatibleBrands: text("compatible_brands").array().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Part = typeof partsTable.$inferSelect;
