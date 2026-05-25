import { pgTable, uuid, text, integer, real, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import type { PayoutAccount } from "./payoutAccount";

export const serviceCentersTable = pgTable("service_centers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  address: text("address").notNull(),
  city: text("city").notNull().default(""),
  region: text("region").notNull().default(""),
  phone: text("phone").notNull(),
  specialties: text("specialties").array().notNull().default([]),
  rating: real("rating").notNull().default(0),
  reviewsCount: integer("reviews_count").notNull().default(0),
  imageUrl: text("image_url"),
  bio: text("bio"),
  active: boolean("active").notNull().default(true),
  whatsappOptIn: boolean("whatsapp_opt_in").notNull().default(false),
  // Destination for automated PaySwitch disbursements after a buyer pays
  // a service invoice. Optional: when null, payouts queue as needs_account
  // until the center fills in their bank or MoMo details.
  payoutAccount: jsonb("payout_account").$type<PayoutAccount>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ServiceCenter = typeof serviceCentersTable.$inferSelect;
