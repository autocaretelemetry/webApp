import { pgTable, uuid, text, jsonb, real, timestamp } from "drizzle-orm/pg-core";
import { bookingsTable } from "./bookings";

export type InvoiceItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  kind: "labor" | "part";
};

export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  bookingId: uuid("booking_id")
    .notNull()
    .references(() => bookingsTable.id, { onDelete: "cascade" }),
  items: jsonb("items").notNull().$type<InvoiceItem[]>(),
  laborTotal: real("labor_total").notNull(),
  partsTotal: real("parts_total").notNull(),
  tax: real("tax").notNull(),
  total: real("total").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("pending_approval"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
});

export type Invoice = typeof invoicesTable.$inferSelect;
