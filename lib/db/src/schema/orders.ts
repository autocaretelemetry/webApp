import { pgTable, uuid, text, real, integer, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { vendorsTable } from "./vendors";
import { partsTable } from "./parts";
import { bookingsTable } from "./bookings";
import { serviceCentersTable } from "./serviceCenters";
import { mechanicsTable } from "./mechanics";
import { deliveryAgentsTable } from "./deliveryAgents";
import { userAddressesTable } from "./userAddresses";

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
  // Either vendorId or sellerCenterId is set (mutually exclusive). vendorId
  // is the classic third-party parts vendor (delivery required); sellerCenterId
  // marks an order fulfilled from a service center's own on-hand shop
  // (no shipping, no delivery agent).
  vendorId: uuid("vendor_id").references(() => vendorsTable.id, {
    onDelete: "cascade",
  }),
  sellerCenterId: uuid("seller_center_id").references(
    () => serviceCentersTable.id,
    { onDelete: "cascade" },
  ),
  // 'delivery' (vendor-fulfilled, ships through a delivery agent) or
  // 'on_hand' (center-fulfilled from its own shop; auto-ready, no shipping).
  fulfillmentKind: text("fulfillment_kind").notNull().default("delivery"),
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
  // Optional FK back to the saved address book entry the buyer picked at
  // checkout. Null for proposal orders (which ship to the booking's
  // service center, not a saved address) and for legacy / typed-once
  // direct buys. `onDelete: set null` so removing an address from the
  // book doesn't cascade-delete historical orders.
  shippingAddressId: uuid("shipping_address_id").references(
    () => userAddressesTable.id,
    { onDelete: "set null" },
  ),
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
  // Payment for the order itself (the part cost paid to the vendor). For
  // direct buys this is implicitly `paid_by_owner` at checkout; for
  // mechanic-proposed orders the owner decides at approval time whether
  // they pay the vendor directly or authorize the service center to pay
  // and bill them back via the booking's invoice.
  //   unpaid          — proposed orders before owner action
  //   paid_by_owner   — owner approved & paid the vendor directly
  //   paid_by_center  — owner authorized + center settled with vendor;
  //                     cost will roll into the service invoice
  paymentStatus: text("payment_status").notNull().default("unpaid"),
  centerPayAuthorized: boolean("center_pay_authorized").notNull().default(false),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  paidByUserId: uuid("paid_by_user_id"),
  // Set when the line items have been folded into a booking invoice so the
  // same parts aren't billed twice if a second invoice is ever created.
  invoicedAt: timestamp("invoiced_at", { withTimezone: true }),
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
