import { and, eq } from "drizzle-orm";
import {
  db,
  serviceCentersTable,
  vendorsTable,
  usersTable,
  rentalCarsTable,
  ordersTable,
  bookingsTable,
  invoicesTable,
  rentalBookingsTable,
  commissionLedgerTable,
  sellerPayoutsTable,
  type SellerPayout,
  type PayoutAccount,
  type PayoutAccountSnapshot,
} from "@workspace/db";
import { logger } from "./logger";
import {
  formatAmountPesewas,
  generateTxnId,
  payswitchEnv,
  publicOrigin,
} from "./payswitch";

const TEST_BASE = "https://test.theteller.net";
const LIVE_BASE = "https://prod.theteller.net";

/**
 * Disbursement uses a separate set of API credentials on PaySwitch's
 * Direct Pay (TheTeller "send-money") product. If those env vars aren't
 * present we skip the HTTP call and leave the payout row in `pending`
 * for the super-admin queue to settle manually.
 */
export function disbursementConfigured(): boolean {
  return Boolean(
    process.env["PAYSWITCH_DISBURSE_API_USER"] &&
      process.env["PAYSWITCH_DISBURSE_API_KEY"] &&
      process.env["PAYSWITCH_MERCHANT_ID"],
  );
}

const SALE_KINDS = ["service_invoice", "parts_order", "rental_booking"] as const;
export type SaleKind = (typeof SALE_KINDS)[number];

interface CreatePayoutInput {
  saleKind: SaleKind;
  saleId: string;
  sellerKind: "service_center" | "vendor" | "owner";
  sellerId: string;
  sellerName: string;
  grossAmount: number;
}

async function loadAccount(
  sellerKind: CreatePayoutInput["sellerKind"],
  sellerId: string,
): Promise<PayoutAccount | null> {
  if (sellerKind === "service_center") {
    const [c] = await db
      .select({ payoutAccount: serviceCentersTable.payoutAccount })
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, sellerId));
    return c?.payoutAccount ?? null;
  }
  if (sellerKind === "vendor") {
    const [v] = await db
      .select({ payoutAccount: vendorsTable.payoutAccount })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, sellerId));
    return v?.payoutAccount ?? null;
  }
  // owner — sellerId is the phone number; find the user row by phone.
  const [u] = await db
    .select({ payoutAccount: usersTable.payoutAccount })
    .from(usersTable)
    .where(eq(usersTable.phone, sellerId));
  return u?.payoutAccount ?? null;
}

/**
 * Create the payout row that pairs with a freshly-recorded commission
 * ledger entry. Idempotent: the `(saleKind, saleId)` unique index swallows
 * duplicate inserts. Reads the seller's payout destination at create time
 * and snapshots it so renaming the account later does not rewrite history.
 *
 * Fires `disburseToSeller` fire-and-forget when a destination is on file —
 * the buyer-facing flow completes regardless of disbursement outcome.
 */
export async function createPayoutForSale(args: CreatePayoutInput): Promise<void> {
  try {
    const [ledger] = await db
      .select()
      .from(commissionLedgerTable)
      .where(
        and(
          eq(commissionLedgerTable.saleKind, args.saleKind),
          eq(commissionLedgerTable.saleId, args.saleId),
        ),
      );
    // If no commission row was written (free-tier 0% or recordCommission
    // failed silently), fall back to gross = grossAmount, commission = 0.
    const gross = ledger?.grossAmount ?? args.grossAmount;
    const commission = ledger?.commissionAmount ?? 0;
    const net = ledger?.netToSeller ?? args.grossAmount;
    if (!Number.isFinite(net) || net <= 0) return;

    const account = await loadAccount(args.sellerKind, args.sellerId);
    const snapshot: PayoutAccountSnapshot | null = account
      ? {
          kind: account.kind,
          accountName: account.accountName,
          accountNumber: account.accountNumber,
          ...(account.bank ? { bank: account.bank } : {}),
          ...(account.network ? { network: account.network } : {}),
        }
      : null;

    const inserted = await db
      .insert(sellerPayoutsTable)
      .values({
        saleKind: args.saleKind,
        saleId: args.saleId,
        sellerKind: args.sellerKind,
        sellerId: args.sellerId,
        sellerName: args.sellerName,
        grossAmount: gross,
        commissionAmount: commission,
        netAmount: net,
        account: snapshot,
        status: snapshot ? "pending" : "needs_account",
      })
      .onConflictDoNothing({
        target: [sellerPayoutsTable.saleKind, sellerPayoutsTable.saleId],
      })
      .returning();
    const payout = inserted[0];
    if (payout && payout.status === "pending") {
      // fire-and-forget
      disburseToSeller(payout.id).catch((err) =>
        logger.warn({ err, payoutId: payout.id }, "auto-disburse failed"),
      );
    }
  } catch (err) {
    logger.warn({ err, args }, "createPayoutForSale failed");
  }
}

/**
 * Attempt to disburse net funds to the seller via TheTeller Direct Pay.
 * Idempotent against successful state (no-op if already paid). Updates
 * the payout row with the new status / reference / error and attempt
 * counter. Returns the final row.
 */
export async function disburseToSeller(payoutId: string): Promise<SellerPayout | null> {
  const [payout] = await db
    .select()
    .from(sellerPayoutsTable)
    .where(eq(sellerPayoutsTable.id, payoutId));
  if (!payout) return null;
  if (payout.status === "paid") return payout;

  // Re-snapshot account if missing (covers needs_account → pending after
  // the seller adds a destination via Payout settings).
  let snapshot = payout.account;
  if (!snapshot) {
    const account = await loadAccount(
      payout.sellerKind as CreatePayoutInput["sellerKind"],
      payout.sellerId,
    );
    if (!account) return payout;
    snapshot = {
      kind: account.kind,
      accountName: account.accountName,
      accountNumber: account.accountNumber,
      ...(account.bank ? { bank: account.bank } : {}),
      ...(account.network ? { network: account.network } : {}),
    };
    await db
      .update(sellerPayoutsTable)
      .set({ account: snapshot, status: "pending" })
      .where(eq(sellerPayoutsTable.id, payoutId));
  }

  const now = new Date();
  if (!disbursementConfigured()) {
    // No credentials → leave pending, just bump attempt counter so the
    // super-admin queue knows we tried.
    const [row] = await db
      .update(sellerPayoutsTable)
      .set({
        attempts: payout.attempts + 1,
        lastAttemptAt: now,
        lastError: "PaySwitch disbursement not configured on this server",
      })
      .where(eq(sellerPayoutsTable.id, payoutId))
      .returning();
    return row ?? null;
  }

  const merchantId = process.env["PAYSWITCH_MERCHANT_ID"]!;
  const apiUser = process.env["PAYSWITCH_DISBURSE_API_USER"]!;
  const apiKey = process.env["PAYSWITCH_DISBURSE_API_KEY"]!;
  const auth = Buffer.from(`${apiUser}:${apiKey}`).toString("base64");
  const base = payswitchEnv() === "live" ? LIVE_BASE : TEST_BASE;
  const txnId = generateTxnId();
  // Net amount is in cedis; PaySwitch expects 12-digit pesewas.
  const amountPesewas = Math.round(payout.netAmount * 100);

  const body = {
    merchant_id: merchantId,
    transaction_id: txnId,
    amount: formatAmountPesewas(amountPesewas),
    desc: `AutoCare payout — ${payout.sellerName}`.slice(0, 100),
    recipient_name: snapshot!.accountName,
    account_number: snapshot!.accountNumber,
    // TheTeller routes differ for bank vs mobile money:
    pass_code: snapshot!.kind === "momo" ? snapshot!.network : snapshot!.bank,
    account_type: snapshot!.kind === "momo" ? "mobile_money" : "bank",
  };
  let resp: Response;
  try {
    resp = await fetch(`${base}/v1.1/transaction/process`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const [row] = await db
      .update(sellerPayoutsTable)
      .set({
        status: "failed",
        attempts: payout.attempts + 1,
        lastAttemptAt: now,
        lastError: `Network error: ${String(err)}`,
      })
      .where(eq(sellerPayoutsTable.id, payoutId))
      .returning();
    return row ?? null;
  }
  const text = await resp.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    // leave null
  }
  const code = typeof json?.["code"] === "string" ? (json["code"] as string) : null;
  const reason =
    typeof json?.["reason"] === "string"
      ? (json["reason"] as string)
      : typeof json?.["status"] === "string"
        ? (json["status"] as string)
        : `HTTP ${resp.status}`;
  const ok = resp.ok && code === "000";
  if (ok) {
    const [row] = await db
      .update(sellerPayoutsTable)
      .set({
        status: "paid",
        attempts: payout.attempts + 1,
        lastAttemptAt: now,
        paidAt: now,
        reference: txnId,
        lastError: null,
      })
      .where(eq(sellerPayoutsTable.id, payoutId))
      .returning();
    return row ?? null;
  }
  const [row] = await db
    .update(sellerPayoutsTable)
    .set({
      status: "failed",
      attempts: payout.attempts + 1,
      lastAttemptAt: now,
      lastError: reason,
    })
    .where(eq(sellerPayoutsTable.id, payoutId))
    .returning();
  return row ?? null;
}

/**
 * Re-attempt every `needs_account` / `pending` payout owned by a given
 * seller — called after they save a fresh payout destination so they
 * don't have to wait for a super-admin retry.
 */
export async function retryPayoutsForSeller(
  sellerKind: CreatePayoutInput["sellerKind"],
  sellerId: string,
): Promise<void> {
  const rows = await db
    .select()
    .from(sellerPayoutsTable)
    .where(
      and(
        eq(sellerPayoutsTable.sellerKind, sellerKind),
        eq(sellerPayoutsTable.sellerId, sellerId),
      ),
    );
  for (const row of rows) {
    if (row.status === "needs_account" || row.status === "pending" || row.status === "failed") {
      disburseToSeller(row.id).catch((err) =>
        logger.warn({ err, payoutId: row.id }, "retryPayoutsForSeller failed"),
      );
    }
  }
}

/**
 * Helpers used by the PaySwitch callback to resolve the seller for each
 * sale kind after the buyer has paid. Each returns `{ sellerKind,
 * sellerId, sellerName, grossAmount }` or null when the sale isn't
 * eligible for a payout (e.g. soft-deleted).
 */
export async function resolveServiceInvoiceSeller(
  invoiceId: string,
): Promise<CreatePayoutInput | null> {
  const [inv] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoiceId));
  if (!inv) return null;
  const [booking] = await db
    .select({ centerId: bookingsTable.serviceCenterId })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, inv.bookingId));
  if (!booking) return null;
  const [center] = await db
    .select({ id: serviceCentersTable.id, name: serviceCentersTable.name })
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, booking.centerId));
  if (!center) return null;
  return {
    saleKind: "service_invoice",
    saleId: inv.id,
    sellerKind: "service_center",
    sellerId: center.id,
    sellerName: center.name,
    grossAmount: inv.total,
  };
}

export async function resolvePartsOrderSeller(
  orderId: string,
): Promise<CreatePayoutInput | null> {
  const [order] = await db.select().from(ordersTable).where(eq(ordersTable.id, orderId));
  if (!order) return null;
  if (order.sellerCenterId) {
    const [c] = await db
      .select({ id: serviceCentersTable.id, name: serviceCentersTable.name })
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, order.sellerCenterId));
    if (!c) return null;
    return {
      saleKind: "parts_order",
      saleId: order.id,
      sellerKind: "service_center",
      sellerId: c.id,
      sellerName: c.name,
      grossAmount: order.total,
    };
  }
  if (order.vendorId) {
    const [v] = await db
      .select({ id: vendorsTable.id, name: vendorsTable.name })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, order.vendorId));
    if (!v) return null;
    return {
      saleKind: "parts_order",
      saleId: order.id,
      sellerKind: "vendor",
      sellerId: v.id,
      sellerName: v.name,
      grossAmount: order.total,
    };
  }
  return null;
}

export async function resolveRentalBookingSeller(
  bookingId: string,
): Promise<CreatePayoutInput | null> {
  const [b] = await db
    .select()
    .from(rentalBookingsTable)
    .where(eq(rentalBookingsTable.id, bookingId));
  if (!b) return null;
  const [car] = await db
    .select({ ownerPhone: rentalCarsTable.ownerPhone })
    .from(rentalCarsTable)
    .where(eq(rentalCarsTable.id, b.carId));
  if (!car?.ownerPhone) return null;
  return {
    saleKind: "rental_booking",
    saleId: b.id,
    sellerKind: "owner",
    sellerId: car.ownerPhone,
    sellerName: car.ownerPhone,
    grossAmount: b.total,
  };
}
