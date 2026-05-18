import { Router, type IRouter } from "express";
import { eq, desc, gte, and, sql } from "drizzle-orm";
import {
  db,
  subscriptionsTable,
  subscriptionPlansTable,
  subscriptionPaymentsTable,
  invoicesTable,
  ordersTable,
} from "@workspace/db";

const router: IRouter = Router();

const COMMISSION_RATE = 0.05;

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

router.get("/revenue/overview", async (_req, res): Promise<void> => {
  const now = new Date();
  const sixMonthsAgo = new Date(now);
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setUTCDate(1);
  sixMonthsAgo.setUTCHours(0, 0, 0, 0);

  // Active subscriptions & MRR
  const activeSubs = await db
    .select({
      id: subscriptionsTable.id,
      planId: subscriptionsTable.planId,
      subscriberName: subscriptionsTable.subscriberName,
    })
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.status, "active"));
  const plans = await db.select().from(subscriptionPlansTable);
  const planMap = new Map(plans.map((p) => [p.id, p]));
  let mrr = 0;
  for (const s of activeSubs) {
    const plan = s.planId ? planMap.get(s.planId) : undefined;
    if (plan) mrr += plan.priceMonthly;
  }

  // Subscription payments in the last 6 months
  const subPayments = await db
    .select({
      id: subscriptionPaymentsTable.id,
      subscriptionId: subscriptionPaymentsTable.subscriptionId,
      amount: subscriptionPaymentsTable.amount,
      paidAt: subscriptionPaymentsTable.paidAt,
    })
    .from(subscriptionPaymentsTable)
    .where(gte(subscriptionPaymentsTable.paidAt, sixMonthsAgo))
    .orderBy(desc(subscriptionPaymentsTable.paidAt));

  const subById = new Map<string, { subscriberName: string }>();
  for (const s of await db
    .select({ id: subscriptionsTable.id, subscriberName: subscriptionsTable.subscriberName })
    .from(subscriptionsTable)) {
    subById.set(s.id, { subscriberName: s.subscriberName });
  }

  // Paid invoices (booking commissions)
  const paidInvoices = await db
    .select({
      id: invoicesTable.id,
      totalAmount: invoicesTable.total,
      paidAt: invoicesTable.paidAt,
      bookingId: invoicesTable.bookingId,
    })
    .from(invoicesTable)
    .where(and(eq(invoicesTable.status, "paid"), gte(invoicesTable.paidAt, sixMonthsAgo)))
    .orderBy(desc(invoicesTable.paidAt));

  // Delivered orders (parts commissions)
  const deliveredOrders = await db
    .select({
      id: ordersTable.id,
      totalAmount: ordersTable.total,
      deliveredAt: ordersTable.deliveredAt,
      buyerName: ordersTable.buyerName,
    })
    .from(ordersTable)
    .where(and(eq(ordersTable.status, "delivered"), gte(ordersTable.deliveredAt, sixMonthsAgo)))
    .orderBy(desc(ordersTable.deliveredAt));

  // Build monthly buckets for the last 6 months
  type Bucket = {
    month: string;
    subscriptions: number;
    bookingCommissions: number;
    orderCommissions: number;
  };
  const buckets = new Map<string, Bucket>();
  for (let i = 0; i < 6; i++) {
    const d = new Date(sixMonthsAgo);
    d.setUTCMonth(d.getUTCMonth() + i);
    const key = monthKey(d);
    buckets.set(key, {
      month: key,
      subscriptions: 0,
      bookingCommissions: 0,
      orderCommissions: 0,
    });
  }

  for (const p of subPayments) {
    const b = buckets.get(monthKey(p.paidAt));
    if (b) b.subscriptions += p.amount;
  }
  for (const inv of paidInvoices) {
    if (!inv.paidAt) continue;
    const b = buckets.get(monthKey(inv.paidAt));
    if (b) b.bookingCommissions += inv.totalAmount * COMMISSION_RATE;
  }
  for (const o of deliveredOrders) {
    if (!o.deliveredAt) continue;
    const b = buckets.get(monthKey(o.deliveredAt));
    if (b) b.orderCommissions += o.totalAmount * COMMISSION_RATE;
  }

  const monthly = [...buckets.values()];
  const totals = monthly.reduce(
    (acc, m) => {
      acc.subscriptions += m.subscriptions;
      acc.bookingCommissions += m.bookingCommissions;
      acc.orderCommissions += m.orderCommissions;
      return acc;
    },
    { subscriptions: 0, bookingCommissions: 0, orderCommissions: 0 },
  );
  const total = totals.subscriptions + totals.bookingCommissions + totals.orderCommissions;

  // Recent payments — merge top 10 across all three sources by date.
  type RecentPayment = {
    id: string;
    kind: "subscription" | "booking_commission" | "order_commission";
    label: string;
    amount: number;
    paidAt: Date;
  };
  const recent: RecentPayment[] = [];
  for (const p of subPayments.slice(0, 10)) {
    const meta = subById.get(p.subscriptionId);
    recent.push({
      id: p.id,
      kind: "subscription",
      label: meta?.subscriberName ?? "Subscription",
      amount: p.amount,
      paidAt: p.paidAt,
    });
  }
  for (const inv of paidInvoices.slice(0, 10)) {
    if (!inv.paidAt) continue;
    recent.push({
      id: inv.id,
      kind: "booking_commission",
      label: `Booking #${inv.bookingId.slice(0, 6)} commission`,
      amount: inv.totalAmount * COMMISSION_RATE,
      paidAt: inv.paidAt,
    });
  }
  for (const o of deliveredOrders.slice(0, 10)) {
    if (!o.deliveredAt) continue;
    recent.push({
      id: o.id,
      kind: "order_commission",
      label: `${o.buyerName} parts order commission`,
      amount: o.totalAmount * COMMISSION_RATE,
      paidAt: o.deliveredAt,
    });
  }
  recent.sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime());

  res.json({
    mrr,
    activeSubscriptions: activeSubs.length,
    commissionRate: COMMISSION_RATE,
    totals: { ...totals, total },
    monthly,
    recentPayments: recent.slice(0, 12).map((r) => ({ ...r, paidAt: r.paidAt.toISOString() })),
  });
  // Reference sql to keep import used if needed by future filters
  void sql;
});

export default router;
