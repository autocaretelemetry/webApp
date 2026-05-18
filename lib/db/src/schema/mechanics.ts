import { pgTable, uuid, text, integer, real, timestamp, boolean } from "drizzle-orm/pg-core";
import { serviceCentersTable } from "./serviceCenters";

export const mechanicsTable = pgTable("mechanics", {
  id: uuid("id").primaryKey().defaultRandom(),
  serviceCenterId: uuid("service_center_id")
    .notNull()
    .references(() => serviceCentersTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  yearsExperience: integer("years_experience").notNull().default(0),
  specialization: text("specialization").notNull(),
  certifications: text("certifications").array().notNull().default([]),
  rating: real("rating").notNull().default(0),
  completedJobs: integer("completed_jobs").notNull().default(0),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Mechanic = typeof mechanicsTable.$inferSelect;
