import {
  pgTable,
  uuid,
  text,
  integer,
  real,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Snapshot of the seller's payout destination at the moment the payout was
 * created. We freeze it so renaming/replacing the account later does not
 * rewrite history. Mirrors `PayoutAccount` (shape used on owning tables).
 */
export type PayoutAccountSnapshot = {
  kind: "bank" | "momo";
  accountName: string;
  accountNumber: string;
  bank?: string;
  network?: string;
};

/**
 * One row per (saleKind, saleId) — created the moment a sale is paid online
 * via PaySwitch. Tracks the disbursement attempt back to the seller (service
 * center, vendor, or rental car owner). Unique on (saleKind, saleId) so the
 * PaySwitch callback can be invoked more than once without creating
 * duplicate payouts.
 *
 * Status:
 *   needs_account — seller hasn't filled in their bank/MoMo destination yet
 *   pending       — destination on file, disbursement not attempted or
 *                   attempted unsuccessfully
 *   paid          — PaySwitch confirmed (or super-admin manually settled)
 *   failed        — disbursement attempted and rejected (still actionable
 *                   via Retry; super-admin queue surfaces these first)
 */
export const sellerPayoutsTable = pgTable(
  "seller_payouts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleKind: text("sale_kind").notNull(),
    saleId: uuid("sale_id").notNull(),
    sellerKind: text("seller_kind").notNull(),
    sellerId: text("seller_id").notNull(),
    sellerName: text("seller_name").notNull(),
    grossAmount: real("gross_amount").notNull(),
    commissionAmount: real("commission_amount").notNull(),
    netAmount: real("net_amount").notNull(),
    account: jsonb("account").$type<PayoutAccountSnapshot>(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    reference: text("reference"),
    manualNote: text("manual_note"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  },
  (t) => ({
    saleUnique: uniqueIndex("seller_payouts_sale_uniq").on(
      t.saleKind,
      t.saleId,
    ),
  }),
);

export type SellerPayout = typeof sellerPayoutsTable.$inferSelect;

export const PAYOUT_STATUSES = [
  "needs_account",
  "pending",
  "paid",
  "failed",
] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
