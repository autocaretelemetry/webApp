import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const platformStaffTable = pgTable("platform_staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("staff"),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlatformStaff = typeof platformStaffTable.$inferSelect;
