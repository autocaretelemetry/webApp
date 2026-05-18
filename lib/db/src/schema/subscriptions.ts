import { pgTable, uuid, text, real, timestamp } from "drizzle-orm/pg-core";
import { subscriptionPlansTable } from "./subscriptionPlans";

export const subscriptionsTable = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriberKind: text("subscriber_kind").notNull(),
  subscriberId: text("subscriber_id").notNull(),
  subscriberName: text("subscriber_name").notNull(),
  planId: uuid("plan_id").references(() => subscriptionPlansTable.id, {
    onDelete: "set null",
  }),
  status: text("status").notNull().default("active"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const subscriptionPaymentsTable = pgTable("subscription_payments", {
  id: uuid("id").primaryKey().defaultRandom(),
  subscriptionId: uuid("subscription_id")
    .notNull()
    .references(() => subscriptionsTable.id, { onDelete: "cascade" }),
  amount: real("amount").notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Subscription = typeof subscriptionsTable.$inferSelect;
export type SubscriptionPayment = typeof subscriptionPaymentsTable.$inferSelect;
