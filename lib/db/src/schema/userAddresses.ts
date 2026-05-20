import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Saved shipping addresses tied to a user account. Buyers can keep a small
 * address book (home, garage, workshop) and pick one at parts-checkout time
 * instead of retyping. One address per user may be `isDefault=true`; the
 * server keeps that flag exclusive on writes. `lastUsedAt` is bumped whenever
 * the address is selected at checkout so the UI can preselect the most
 * recently used entry.
 */
export const userAddressesTable = pgTable(
  "user_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    recipientName: text("recipient_name").notNull(),
    recipientPhone: text("recipient_phone").notNull(),
    addressLine: text("address_line").notNull(),
    city: text("city").notNull().default(""),
    region: text("region").notNull().default(""),
    isDefault: boolean("is_default").notNull().default(false),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    userIdx: index("user_addresses_user_idx").on(t.userId),
  }),
);

export type UserAddress = typeof userAddressesTable.$inferSelect;
