import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, inArray, ne, sql, sum } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  bookingsTable,
  bookingEventsTable,
  invoicesTable,
  mechanicsTable,
} from "@workspace/db";
import { computeReminders } from "../lib/reminders";
import { SERVICE_TYPES } from "../lib/catalog";
import { ListActivityQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/dashboard/owner", async (_req, res): Promise<void> => {
  const [vehicles, statusRows, lifetimeRow] = await Promise.all([
    db.select().from(vehiclesTable),
    db
      .select({ status: bookingsTable.status, n: count(bookingsTable.id) })
      .from(bookingsTable)
      .groupBy(bookingsTable.status),
    db
      .select({ total: sum(invoicesTable.total) })
      .from(invoicesTable)
      .where(eq(invoicesTable.status, "paid")),
  ]);

  const statusMap = new Map(statusRows.map((r) => [r.status, Number(r.n)]));
  const activeStatuses = [
    "requested",
    "accepted",
    "in_progress",
    "awaiting_approval",
    "approved",
  ];
  const activeBookings = activeStatuses.reduce(
    (s, st) => s + (statusMap.get(st) ?? 0),
    0,
  );
  const pendingApprovals = statusMap.get("awaiting_approval") ?? 0;

  const reminders = vehicles
    .flatMap((v) => computeReminders(v))
    .sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())
    .slice(0, 6);

  res.json({
    vehiclesCount: vehicles.length,
    activeBookings,
    pendingApprovals,
    lifetimeSpend: Number(lifetimeRow[0]?.total ?? 0),
    upcomingReminders: reminders,
    statusBreakdown: statusRows.map((r) => ({
      status: r.status,
      count: Number(r.n),
    })),
  });
});

router.get("/dashboard/center", async (_req, res): Promise<void> => {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const [statusRows, completedTodayRow, revenueRow, mechanics] =
    await Promise.all([
      db
        .select({ status: bookingsTable.status, n: count(bookingsTable.id) })
        .from(bookingsTable)
        .groupBy(bookingsTable.status),
      db
        .select({ n: count(bookingsTable.id) })
        .from(bookingsTable)
        .where(
          and(
            eq(bookingsTable.status, "completed"),
            gte(bookingsTable.completedAt, startOfDay),
          ),
        ),
      db
        .select({ total: sum(invoicesTable.total) })
        .from(invoicesTable)
        .where(
          and(
            eq(invoicesTable.status, "paid"),
            gte(invoicesTable.paidAt, startOfMonth),
          ),
        ),
      db
        .select()
        .from(mechanicsTable)
        .orderBy(desc(mechanicsTable.rating))
        .limit(5),
    ]);

  const statusMap = new Map(statusRows.map((r) => [r.status, Number(r.n)]));

  res.json({
    pendingRequests: statusMap.get("requested") ?? 0,
    jobsInProgress:
      (statusMap.get("accepted") ?? 0) + (statusMap.get("in_progress") ?? 0),
    completedToday: Number(completedTodayRow[0]?.n ?? 0),
    revenueThisMonth: Number(revenueRow[0]?.total ?? 0),
    topMechanics: mechanics,
    statusBreakdown: statusRows.map((r) => ({
      status: r.status,
      count: Number(r.n),
    })),
  });
});

router.get("/activity", async (req, res): Promise<void> => {
  const q = ListActivityQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const limit = q.data.limit ?? 20;

  const events = await db
    .select({
      id: bookingEventsTable.id,
      at: bookingEventsTable.at,
      label: bookingEventsTable.label,
      kind: bookingEventsTable.kind,
      bookingId: bookingEventsTable.bookingId,
      vehicleId: bookingsTable.vehicleId,
    })
    .from(bookingEventsTable)
    .innerJoin(
      bookingsTable,
      eq(bookingEventsTable.bookingId, bookingsTable.id),
    )
    .orderBy(desc(bookingEventsTable.at))
    .limit(limit);

  res.json(
    events.map((e) => ({
      id: e.id,
      at: e.at,
      kind: e.kind,
      message: e.label,
      bookingId: e.bookingId,
      vehicleId: e.vehicleId,
    })),
  );
});

router.get("/catalog/service-types", async (_req, res): Promise<void> => {
  res.json(SERVICE_TYPES);
});

export default router;
