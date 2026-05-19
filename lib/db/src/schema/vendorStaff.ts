import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";

export const vendorStaffTable = pgTable(
  "vendor_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendorsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role").notNull().default("staff"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("vendor_staff_vendor_email_idx").on(t.vendorId, t.email)],
);

export type VendorStaff = typeof vendorStaffTable.$inferSelect;
