import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, desc, gte, ne, sql } from "drizzle-orm";
import {
  db,
  paymentTransactionsTable,
  commissionLedgerTable,
  sellerPayoutsTable,
} from "@workspace/db";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

function requireSuperAdmin(
  req: import("express").Request,
  res: import("express").Response,
): boolean {
  if (req.user?.role !== "super_admin") {
    res.status(403).json({ error: "Super admin only." });
    return false;
  }
  return true;
}

// Map a raw `payment_transactions.purpose` to one of the high-level sale
// kinds we report on. Subscriptions are excluded from GMV — they're
// platform revenue tracked elsewhere.
function bucketPurpose(purpose: string): "service_invoice" | "parts_order" | "rental_booking" | null {
  if (purpose === "service_invoice") return "service_invoice";
  if (purpose === "rental_booking") return "rental_booking";
  if (purpose.startsWith("parts_order")) return "parts_order";
  return null;
}

const SUMMARY_KINDS = ["service_invoice", "parts_order", "rental_booking"] as const;
type SummaryKind = (typeof SUMMARY_KINDS)[number];

router.get("/admin/finance-summary", requireAuth, async (req, res): Promise<void> => {
  if (!requireSuperAdmin(req, res)) return;
  const parsedDays = z.coerce
    .number()
    .int()
    .min(1)
    .max(365)
    .safeParse(req.query["days"] ?? 30);
  if (!parsedDays.success) {
    res.status(400).json({ error: "Invalid days parameter" });
    return;
  }
  const days = parsedDays.data;
  // Normalize the window to whole UTC days so the query range and the
  // densified day-buckets always line up — otherwise transactions from
  // "today" fall outside the bucket map and the GMV total no longer
  // equals the sum of the per-day series.
  const now = new Date();
  const todayStart = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  // `days=30` means today + the previous 29 calendar days.
  const since = new Date(todayStart - (days - 1) * 24 * 60 * 60 * 1000);

  // GMV from payment_transactions: every successful charge except
  // subscription. `amount` is in pesewas — convert to cedis at query time.
  const txRows = await db
    .select({
      day: sql<string>`to_char(date_trunc('day', ${paymentTransactionsTable.completedAt}), 'YYYY-MM-DD')`,
      purpose: paymentTransactionsTable.purpose,
      gross: sql<number>`coalesce(sum(${paymentTransactionsTable.amount}), 0)::float / 100`,
      count: sql<number>`count(*)::int`,
    })
    .from(paymentTransactionsTable)
    .where(
      and(
        sql`${paymentTransactionsTable.status} = 'successful'`,
        ne(paymentTransactionsTable.purpose, "subscription"),
        gte(paymentTransactionsTable.completedAt, since),
      ),
    )
    .groupBy(
      sql`date_trunc('day', ${paymentTransactionsTable.completedAt})`,
      paymentTransactionsTable.purpose,
    );

  // Build a dense day-by-kind series so the chart always shows the full
  // window even on quiet days.
  const dayMap = new Map<string, Record<SummaryKind, number> & { date: string; total: number }>();
  for (let i = 0; i < days; i++) {
    const d = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    dayMap.set(key, { date: key, service_invoice: 0, parts_order: 0, rental_booking: 0, total: 0 });
  }
  const gmvByKind: Record<SummaryKind, { gross: number; count: number }> = {
    service_invoice: { gross: 0, count: 0 },
    parts_order: { gross: 0, count: 0 },
    rental_booking: { gross: 0, count: 0 },
  };
  for (const r of txRows) {
    const kind = bucketPurpose(r.purpose);
    if (!kind) continue;
    const bucket = dayMap.get(r.day);
    if (bucket) {
      bucket[kind] += r.gross;
      bucket.total += r.gross;
    }
    gmvByKind[kind].gross += r.gross;
    gmvByKind[kind].count += r.count;
  }
  const gmvByDay = Array.from(dayMap.values());

  // Commission earned: lifetime totals + last-`days` window.
  const commissionLifetime = await db
    .select({
      kind: commissionLedgerTable.saleKind,
      amount: sql<number>`coalesce(sum(${commissionLedgerTable.commissionAmount}), 0)::float`,
    })
    .from(commissionLedgerTable)
    .groupBy(commissionLedgerTable.saleKind);
  const commissionWindow = await db
    .select({
      kind: commissionLedgerTable.saleKind,
      amount: sql<number>`coalesce(sum(${commissionLedgerTable.commissionAmount}), 0)::float`,
    })
    .from(commissionLedgerTable)
    .where(gte(commissionLedgerTable.createdAt, since))
    .groupBy(commissionLedgerTable.saleKind);
  const commission = {
    lifetimeTotal: commissionLifetime.reduce((s, r) => s + r.amount, 0),
    windowTotal: commissionWindow.reduce((s, r) => s + r.amount, 0),
    byKind: commissionLifetime.map((r) => ({ kind: r.kind, amount: r.amount })),
  };

  // Payouts: status breakdown (count + sum of net).
  const payoutRows = await db
    .select({
      status: sellerPayoutsTable.status,
      count: sql<number>`count(*)::int`,
      amount: sql<number>`coalesce(sum(${sellerPayoutsTable.netAmount}), 0)::float`,
    })
    .from(sellerPayoutsTable)
    .groupBy(sellerPayoutsTable.status);
  const payouts = {
    byStatus: payoutRows.map((r) => ({ status: r.status, count: r.count, amount: r.amount })),
  };

  // Top 10 sellers by net payout (lifetime, settled and pending alike so
  // queued income shows up too — caller filters by status if desired).
  const topSellers = await db
    .select({
      sellerKind: sellerPayoutsTable.sellerKind,
      sellerId: sellerPayoutsTable.sellerId,
      sellerName: sellerPayoutsTable.sellerName,
      netAmount: sql<number>`coalesce(sum(${sellerPayoutsTable.netAmount}), 0)::float`,
      grossAmount: sql<number>`coalesce(sum(${sellerPayoutsTable.grossAmount}), 0)::float`,
      count: sql<number>`count(*)::int`,
    })
    .from(sellerPayoutsTable)
    .groupBy(
      sellerPayoutsTable.sellerKind,
      sellerPayoutsTable.sellerId,
      sellerPayoutsTable.sellerName,
    )
    .orderBy(desc(sql`sum(${sellerPayoutsTable.netAmount})`))
    .limit(10);

  res.json({
    windowDays: days,
    gmv: {
      byDay: gmvByDay,
      byKind: SUMMARY_KINDS.map((k) => ({ kind: k, ...gmvByKind[k] })),
      windowTotal: gmvByDay.reduce((s, d) => s + d.total, 0),
    },
    commission,
    payouts,
    topSellers,
  });
});

export default router;
