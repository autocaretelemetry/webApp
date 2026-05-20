import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { organizationsTable } from "./organizations";

/**
 * Org-scoped shipping address book used by fleet parts-order checkout.
 * Modelled after `user_addresses` but keyed by `organizationId` instead
 * of `userId` so every fleet member sees the same entries (HQ, branch
 * garages, off-site workshops). One row may be flagged `isDefault=true`;
 * the server keeps that exclusive per-org on writes. `lastUsedAt` is
 * bumped after a successful checkout so the dropdown preselects the
 * most-recently-used entry on the next visit.
 */
export const organizationAddressesTable = pgTable(
  "organization_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    addressLine: text("address_line").notNull(),
    city: text("city").notNull().default(""),
    region: text("region").notNull().default(""),
    isDefault: boolean("is_default").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdByPhone: text("created_by_phone"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    orgIdx: index("organization_addresses_org_idx").on(t.organizationId),
  }),
);

export type OrganizationAddress = typeof organizationAddressesTable.$inferSelect;
