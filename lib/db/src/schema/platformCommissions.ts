import { pgTable, uuid, text, real, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Super-admin-configurable percentage skim per sale kind.
 * One row per `saleKind` (singleton-per-kind via unique index).
 * Percent is stored as a number 0-100. Default seeded rows live in
 * `seedPlatform.ts` so the table is never empty at runtime.
 */
export const commissionRatesTable = pgTable(
  "commission_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleKind: text("sale_kind").notNull(),
    percent: real("percent").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedByUserId: uuid("updated_by_user_id"),
  },
  (t) => ({
    saleKindUnique: uniqueIndex("commission_rates_sale_kind_uniq").on(t.saleKind),
  }),
);

/**
 * Append-only ledger of every commission deducted from a seller payout.
 * `saleKind` + `saleId` is unique so payment-flip code paths can be
 * called more than once without double-charging.
 */
export const commissionLedgerTable = pgTable(
  "commission_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    saleKind: text("sale_kind").notNull(),
    saleId: uuid("sale_id").notNull(),
    sellerKind: text("seller_kind").notNull(),
    sellerId: text("seller_id").notNull(),
    grossAmount: real("gross_amount").notNull(),
    percent: real("percent").notNull(),
    commissionAmount: real("commission_amount").notNull(),
    netToSeller: real("net_to_seller").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    saleUnique: uniqueIndex("commission_ledger_sale_uniq").on(t.saleKind, t.saleId),
  }),
);

export type CommissionRate = typeof commissionRatesTable.$inferSelect;
export type CommissionLedgerEntry = typeof commissionLedgerTable.$inferSelect;

export const COMMISSION_SALE_KINDS = [
  "service_invoice",
  "parts_order",
  "rental_booking",
] as const;
export type CommissionSaleKind = (typeof COMMISSION_SALE_KINDS)[number];
