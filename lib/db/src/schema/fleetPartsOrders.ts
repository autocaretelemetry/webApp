import {
  pgTable,
  uuid,
  text,
  timestamp,
  numeric,
  jsonb,
} from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

export const FLEET_PARTS_ORDER_STATUSES = [
  "pending_finance",
  "approved",
  "paid",
  "rejected",
] as const;
export type FleetPartsOrderStatus = (typeof FLEET_PARTS_ORDER_STATUSES)[number];

export type FleetPartsOrderItem = {
  partId: string;
  vendorId: string;
  vendorName: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
};

export const fleetPartsOrdersTable = pgTable("fleet_parts_orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizationsTable.id, { onDelete: "cascade" }),
  requestedByPhone: text("requested_by_phone").notNull(),
  requestedByName: text("requested_by_name").notNull(),
  status: text("status").notNull().default("pending_finance"),
  items: jsonb("items").$type<FleetPartsOrderItem[]>().notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  shippingAddress: text("shipping_address").notNull(),
  deliveryCity: text("delivery_city"),
  deliveryRegion: text("delivery_region"),
  notes: text("notes"),
  approvedByPhone: text("approved_by_phone"),
  approvedByName: text("approved_by_name"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  paidByPhone: text("paid_by_phone"),
  paidByName: text("paid_by_name"),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  rejectedByPhone: text("rejected_by_phone"),
  rejectedByName: text("rejected_by_name"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type FleetPartsOrder = typeof fleetPartsOrdersTable.$inferSelect;
