import { and, eq, lt } from "drizzle-orm";
import type { Logger } from "pino";
import { db, paymentTransactionsTable } from "@workspace/db";
import { checkTransactionStatus, payswitchConfigured } from "./payswitch";
import { settleVerifiedTransaction, type SettleOutcome } from "../routes/payswitch";
import { maybeAlertStuckPayments } from "./paymentStuckAlerts";
import { logger as rootLogger } from "./logger";

export interface ReconcileResult {
  checked: number;
  settled: number;
  failed: number;
  inProgress: number;
  unreachable: number;
  amountMismatch: number;
  handlerError: number;
}

/**
 * Sweep `payment_transactions` rows that have been stuck in `pending` for
 * longer than `staleAfterMs` and ask PaySwitch for the canonical status.
 * Anything the provider has settled (success or terminal failure) gets
 * applied through the same dispatcher as the browser callback so a
 * customer's payment never stays in limbo just because they closed the
 * tab before the redirect fired.
 *
 * Bounded by `limit` per run to keep memory predictable on big backlogs;
 * a future tick picks up the rest.
 */
export async function reconcilePendingPayments(opts?: {
  staleAfterMs?: number;
  limit?: number;
  log?: Logger;
}): Promise<ReconcileResult> {
  const log = opts?.log ?? rootLogger;
  const result: ReconcileResult = {
    checked: 0,
    settled: 0,
    failed: 0,
    inProgress: 0,
    unreachable: 0,
    amountMismatch: 0,
    handlerError: 0,
  };
  if (!payswitchConfigured()) {
    log.debug("paymentReconciler: PaySwitch not configured; skipping");
    return result;
  }
  const staleAfterMs = opts?.staleAfterMs ?? 10 * 60 * 1000;
  const limit = opts?.limit ?? 100;
  const cutoff = new Date(Date.now() - staleAfterMs);

  const rows = await db
    .select()
    .from(paymentTransactionsTable)
    .where(
      and(
        eq(paymentTransactionsTable.provider, "payswitch"),
        eq(paymentTransactionsTable.status, "pending"),
        lt(paymentTransactionsTable.createdAt, cutoff),
      ),
    )
    .limit(limit);

  for (const txn of rows) {
    result.checked += 1;
    try {
      const verified = await checkTransactionStatus(txn.transactionId);
      const outcome: SettleOutcome = await settleVerifiedTransaction(txn, verified, log);
      switch (outcome.kind) {
        case "settled":
        case "already_settled":
          result.settled += 1;
          break;
        case "failed":
          result.failed += 1;
          break;
        case "amount_mismatch":
          result.amountMismatch += 1;
          break;
        case "pending":
          result.unreachable += 1;
          break;
        case "in_progress":
          result.inProgress += 1;
          break;
        case "handler_error":
          result.handlerError += 1;
          break;
      }
    } catch (err) {
      result.handlerError += 1;
      log.error({ err, txn: txn.id }, "paymentReconciler: txn iteration threw");
    }
  }
  log.info({ ...result, cutoff }, "paymentReconciler tick complete");

  // Page platform admins if this sweep looks unhealthy — either too many
  // charges are stuck in `pending` past the cutoff, or too many verifications
  // bounced off PaySwitch (likely an outage). Deduped per UTC day. Never let
  // an alerting failure break the reconcile result.
  await maybeAlertStuckPayments({
    staleAfterMs,
    unreachable: result.unreachable,
    log,
  }).catch((err) =>
    log.error({ err }, "paymentReconciler: stuck-payment alert threw"),
  );

  return result;
}
