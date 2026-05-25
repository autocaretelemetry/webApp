import { pgTable, uuid, text, real, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import type { PayoutAccount } from "./payoutAccount";

export const vendorsTable = pgTable("vendors", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  bio: text("bio"),
  address: text("address").notNull(),
  city: text("city").notNull().default(""),
  region: text("region").notNull().default(""),
  phone: text("phone").notNull(),
  rating: real("rating").notNull().default(0),
  reviewsCount: integer("reviews_count").notNull().default(0),
  logoUrl: text("logo_url"),
  active: boolean("active").notNull().default(true),
  payoutAccount: jsonb("payout_account").$type<PayoutAccount>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Vendor = typeof vendorsTable.$inferSelect;
