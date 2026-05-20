import { pgTable, uuid, text, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

/**
 * Concrete, machine-enforceable entitlements attached to a plan.
 * `null` on a numeric limit means "unlimited". Booleans default false.
 *
 * This is the single source of truth the server reads at every gated
 * action (booking creation, parts upload, directory sort, history export,
 * priority queue). Plan `features` (the bulleted text on the plan card)
 * stay free-form marketing copy — `limits` is what actually enforces.
 */
export type PlanLimits = {
  maxBookingsPerMonth: number | null;
  maxPartsListed: number | null;
  featuredPlacement: boolean;
  canExportHistory: boolean;
  priorityBooking: boolean;
};

export const DEFAULT_PLAN_LIMITS: PlanLimits = {
  maxBookingsPerMonth: null,
  maxPartsListed: null,
  featuredPlacement: false,
  canExportHistory: false,
  priorityBooking: false,
};

export const subscriptionPlansTable = pgTable("subscription_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  audience: text("audience").notNull(),
  priceMonthly: real("price_monthly").notNull(),
  features: jsonb("features").$type<string[]>().notNull().default([]),
  limits: jsonb("limits").$type<PlanLimits>().notNull().default(DEFAULT_PLAN_LIMITS),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SubscriptionPlan = typeof subscriptionPlansTable.$inferSelect;
