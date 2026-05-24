import { pgTable, uuid, text, integer, timestamp } from "drizzle-orm/pg-core";

export const paymentTransactionsTable = pgTable("payment_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull().default("payswitch"),
  transactionId: text("transaction_id").notNull().unique(),
  purpose: text("purpose").notNull(),
  purposeRef: uuid("purpose_ref"),
  amount: integer("amount").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  description: text("description").notNull(),
  status: text("status").notNull().default("pending"),
  providerCode: text("provider_code"),
  providerReason: text("provider_reason"),
  checkoutUrl: text("checkout_url"),
  initiatedByUserId: uuid("initiated_by_user_id"),
  successRedirect: text("success_redirect").notNull(),
  failureRedirect: text("failure_redirect").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type PaymentTransaction = typeof paymentTransactionsTable.$inferSelect;
