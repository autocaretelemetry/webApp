import { eq, and } from "drizzle-orm";
import {
  db,
  commissionRatesTable,
  commissionLedgerTable,
  type CommissionSaleKind,
} from "@workspace/db";
import { logger } from "./logger";

/**
 * Resolve the current commission percent for a sale kind. Returns 0 when
 * no row exists yet (free-tier behaviour) so payment paths never block.
 */
export async function getCommissionPercent(
  kind: CommissionSaleKind,
): Promise<number> {
  const [row] = await db
    .select()
    .from(commissionRatesTable)
    .where(eq(commissionRatesTable.saleKind, kind));
  if (!row) return 0;
  return row.percent;
}

interface RecordCommissionArgs {
  saleKind: CommissionSaleKind;
  saleId: string;
  sellerKind: "service_center" | "vendor" | "owner";
  sellerId: string;
  grossAmount: number;
}

/**
 * Compute and persist the platform's commission cut for a single sale.
 * Idempotent: the `(saleKind, saleId)` unique index swallows duplicate
 * inserts so retries or double payment hooks never double-charge.
 * Failures are logged and swallowed — commission tracking must never
 * abort a payment.
 */
export async function recordCommission(args: RecordCommissionArgs): Promise<void> {
  try {
    if (!Number.isFinite(args.grossAmount) || args.grossAmount <= 0) return;
    const percent = await getCommissionPercent(args.saleKind);
    if (percent <= 0) return;
    const commissionAmount = +((args.grossAmount * percent) / 100).toFixed(2);
    const netToSeller = +(args.grossAmount - commissionAmount).toFixed(2);
    await db
      .insert(commissionLedgerTable)
      .values({
        saleKind: args.saleKind,
        saleId: args.saleId,
        sellerKind: args.sellerKind,
        sellerId: args.sellerId,
        grossAmount: +args.grossAmount.toFixed(2),
        percent,
        commissionAmount,
        netToSeller,
      })
      .onConflictDoNothing({
        target: [commissionLedgerTable.saleKind, commissionLedgerTable.saleId],
      });
  } catch (err) {
    logger.warn({ err, args }, "recordCommission failed");
  }
}

/**
 * Idempotency guard used by callers that need to know whether a sale has
 * already been ledgered (e.g. to avoid extra DB reads when computing a
 * net payout).
 */
export async function commissionExists(
  saleKind: CommissionSaleKind,
  saleId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: commissionLedgerTable.id })
    .from(commissionLedgerTable)
    .where(
      and(
        eq(commissionLedgerTable.saleKind, saleKind),
        eq(commissionLedgerTable.saleId, saleId),
      ),
    );
  return !!row;
}
