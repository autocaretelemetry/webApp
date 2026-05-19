import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  real,
  timestamp,
  boolean,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { serviceCentersTable } from "./serviceCenters";

/**
 * A retainer plan offered by a single service center: a flat fee paid
 * monthly / quarterly / annually that entitles the vehicle owner to perks
 * (priority booking, free oil changes, discounted labour, etc.).
 */
export const retainerPlansTable = pgTable(
  "retainer_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceCenterId: uuid("service_center_id")
      .notNull()
      .references(() => serviceCentersTable.id, { onDelete: "cascade" }),
    cadence: text("cadence").notNull(), // monthly | quarterly | annual
    price: real("price").notNull(),
    perks: text("perks").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A center can only offer one plan per cadence; the server's read-then-
    // insert check is racey under concurrent writes, so enforce it at the DB.
    uniqueIndex("retainer_plans_center_cadence_uq").on(t.serviceCenterId, t.cadence),
  ],
);

/**
 * An active or historical retainer agreement between a vehicle owner
 * (identified by phone, matching how vehicles store their owner) and a
 * service center. cadence/price are snapshotted from the plan at signup
 * so price changes on the plan never silently alter active retainers.
 *
 * Owners on retainer at one center can still book pay-as-you-go services
 * at any other center — retainers do not restrict the owner.
 */
export const retainersTable = pgTable(
  "retainers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    serviceCenterId: uuid("service_center_id")
      .notNull()
      .references(() => serviceCentersTable.id, { onDelete: "cascade" }),
    planId: uuid("plan_id").references(() => retainerPlansTable.id, {
      onDelete: "set null",
    }),
    ownerName: text("owner_name").notNull(),
    ownerPhone: text("owner_phone").notNull(),
    cadence: text("cadence").notNull(),
    price: real("price").notNull(),
    status: text("status").notNull().default("active"), // active | cancelled | expired
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // At most one active retainer per (owner phone, center) — the spec
    // forbids double-billing the same owner with the same center. Partial
    // unique index lets cancelled/expired rows accumulate freely as history.
    uniqueIndex("retainers_active_owner_center_uq")
      .on(t.ownerPhone, t.serviceCenterId)
      .where(sql`${t.status} = 'active'`),
  ],
);

export type RetainerPlan = typeof retainerPlansTable.$inferSelect;
export type Retainer = typeof retainersTable.$inferSelect;
