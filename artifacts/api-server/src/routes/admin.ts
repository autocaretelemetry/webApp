import { Router, type IRouter } from "express";
import { count, desc, eq, sum } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  serviceCentersTable,
  mechanicsTable,
  vendorsTable,
  partsTable,
  deliveryAgentsTable,
  bookingsTable,
  ordersTable,
  invoicesTable,
} from "@workspace/db";

const router: IRouter = Router();

// One-shot snapshot of the whole platform — what a super admin / platform
// owner needs to see at a glance: counts of every entity, revenue, status
// breakdowns, and the freshest activity. Kept as a single endpoint so the UI
// can render the dashboard with a single round-trip.
router.get("/admin/overview", async (_req, res): Promise<void> => {
  const [
    vehiclesCount,
    centersCount,
    mechanicsCount,
    vendorsCount,
    partsCount,
    agents,
    bookingsCount,
    ordersCount,
    invoicesCount,
    bookingStatus,
    orderStatus,
    invoicesPaidRow,
    ordersRevenueRow,
    recentBookings,
    recentOrders,
  ] = await Promise.all([
    db.select({ n: count() }).from(vehiclesTable),
    db.select({ n: count() }).from(serviceCentersTable),
    db.select({ n: count() }).from(mechanicsTable),
    db.select({ n: count() }).from(vendorsTable),
    db.select({ n: count() }).from(partsTable),
    db.select().from(deliveryAgentsTable),
    db.select({ n: count() }).from(bookingsTable),
    db.select({ n: count() }).from(ordersTable),
    db.select({ n: count() }).from(invoicesTable),
    db
      .select({ status: bookingsTable.status, n: count(bookingsTable.id) })
      .from(bookingsTable)
      .groupBy(bookingsTable.status),
    db
      .select({ status: ordersTable.status, n: count(ordersTable.id) })
      .from(ordersTable)
      .groupBy(ordersTable.status),
    db
      .select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(eq(invoicesTable.status, "paid")),
    db.select({ total: sum(ordersTable.total) }).from(ordersTable),
    db.select().from(bookingsTable).orderBy(desc(bookingsTable.requestedAt)).limit(8),
    db.select().from(ordersTable).orderBy(desc(ordersTable.placedAt)).limit(8),
  ]);

  res.json({
    counts: {
      vehicles: Number(vehiclesCount[0]?.n ?? 0),
      serviceCenters: Number(centersCount[0]?.n ?? 0),
      mechanics: Number(mechanicsCount[0]?.n ?? 0),
      vendors: Number(vendorsCount[0]?.n ?? 0),
      parts: Number(partsCount[0]?.n ?? 0),
      deliveryAgents: agents.length,
      activeDeliveryAgents: agents.filter((a) => a.active).length,
      bookings: Number(bookingsCount[0]?.n ?? 0),
      orders: Number(ordersCount[0]?.n ?? 0),
      invoices: Number(invoicesCount[0]?.n ?? 0),
    },
    revenue: {
      invoicesPaid: Number(invoicesPaidRow[0]?.total ?? 0),
      ordersPlaced: Number(ordersRevenueRow[0]?.total ?? 0),
    },
    bookingStatusBreakdown: bookingStatus.map((r) => ({
      status: r.status,
      count: Number(r.n),
    })),
    orderStatusBreakdown: orderStatus.map((r) => ({
      status: r.status,
      count: Number(r.n),
    })),
    recentBookings,
    recentOrders: recentOrders.map((o) => ({ ...o, itemsCount: 0 })),
  });
});

export default router;
