import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { serviceCentersTable } from "./serviceCenters";
import { usersTable } from "./users";

export const centerStaffTable = pgTable(
  "center_staff",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    centerId: uuid("center_id")
      .notNull()
      .references(() => serviceCentersTable.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    phone: text("phone"),
    role: text("role").notNull().default("staff"),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("center_staff_center_email_idx").on(t.centerId, t.email)],
);

export type CenterStaff = typeof centerStaffTable.$inferSelect;
