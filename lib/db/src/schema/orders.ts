import { pgTable, uuid, text, real, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";
import { partsTable } from "./parts";
import { bookingsTable } from "./bookings";
import { mechanicsTable } from "./mechanics";
import { deliveryAgentsTable } from "./deliveryAgents";

export type OrderItemSnapshot = {
  partId: string;
  name: string;
  sku: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
};

export const ordersTable = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendorsTable.id, { onDelete: "cascade" }),
  bookingId: uuid("booking_id").references(() => bookingsTable.id, {
    onDelete: "set null",
  }),
  mechanicId: uuid("mechanic_id").references(() => mechanicsTable.id, {
    onDelete: "set null",
  }),
  deliveryAgentId: uuid("delivery_agent_id").references(
    () => deliveryAgentsTable.id,
    { onDelete: "set null" },
  ),
  buyerKind: text("buyer_kind").notNull(),
  buyerName: text("buyer_name").notNull(),
  buyerPhone: text("buyer_phone").notNull(),
  shippingAddress: text("shipping_address").notNull(),
  deliveryCity: text("delivery_city").notNull().default(""),
  deliveryRegion: text("delivery_region").notNull().default(""),
  notes: text("notes"),
  // Lifecycle:
  //   Direct buy : placed → confirmed → shipped → delivered, cancelled terminal
  //   Mechanic-initiated for a job : proposed → placed (owner approves) → confirmed → shipped → delivered
  //   proposed → cancelled if owner rejects or mechanic withdraws
  status: text("status").notNull().default("placed"),
  itemsTotal: real("items_total").notNull(),
  shippingFee: real("shipping_fee").notNull().default(0),
  total: real("total").notNull(),
  proposedAt: timestamp("proposed_at", { withTimezone: true }),
  placedAt: timestamp("placed_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  shippedAt: timestamp("shipped_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  trackingCode: text("tracking_code"),
});

export const orderItemsTable = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => ordersTable.id, { onDelete: "cascade" }),
  partId: uuid("part_id")
    .notNull()
    .references(() => partsTable.id, { onDelete: "restrict" }),
  snapshot: jsonb("snapshot").notNull().$type<OrderItemSnapshot>(),
  quantity: integer("quantity").notNull(),
  unitPrice: real("unit_price").notNull(),
  lineTotal: real("line_total").notNull(),
});

export type Order = typeof ordersTable.$inferSelect;
export type OrderItem = typeof orderItemsTable.$inferSelect;
