/**
 * Standalone entry point for the service-reminder generator. Designed to
 * be invoked by an external scheduler — most commonly a Replit Scheduled
 * Deployment configured to run e.g. once per day:
 *
 *   pnpm --filter @workspace/scripts run reminders:run
 *
 * Records the outcome in `reminder_runs` (visible to platform admins in
 * the dashboard) and exits with a non-zero status code on failure so the
 * scheduled deployment surfaces the error in its run history.
 */
import { db, pool, reminderRunsTable, vehiclesTable, notificationsTable, type Vehicle } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

const DAY = 1000 * 60 * 60 * 24;

function weekBucket(d: Date = new Date()): string {
  return String(Math.floor(d.getTime() / (7 * DAY)));
}

function serviceWindow(v: Vehicle) {
  const intervalDays = v.serviceIntervalDays ?? 90;
  const intervalKm = v.serviceIntervalKm ?? 5000;
  const lastAt = v.lastServicedAt ?? v.createdAt;
  const lastMileage = v.lastServicedMileage ?? v.mileage;
  const dueAt = new Date(lastAt.getTime() + intervalDays * DAY);
  const daysRemaining = Math.ceil((dueAt.getTime() - Date.now()) / DAY);
  const kmRemaining = lastMileage + intervalKm - v.mileage;
  const overdue = daysRemaining <= 0 || kmRemaining <= 0;
  return { intervalDays, intervalKm, daysRemaining, kmRemaining, overdue };
}

async function generate(): Promise<number> {
  const vehicles = await db.select().from(vehiclesTable);
  let created = 0;
  for (const v of vehicles) {
    if (!v.ownerPhone) continue;
    const w = serviceWindow(v);
    if (!w.overdue && w.daysRemaining > 7 && w.kmRemaining > 200) continue;
    const title = w.overdue
      ? `Service overdue: ${v.brand} ${v.model}`
      : `Service due soon: ${v.brand} ${v.model}`;
    const body = w.overdue
      ? `Book a workshop visit to avoid surprises.`
      : `${w.daysRemaining > 0 ? w.daysRemaining + " day(s)" : "today"} or ${w.kmRemaining > 0 ? w.kmRemaining.toLocaleString() + " km" : "now"} until your next service.`;
    const dedupeKey = `service:${v.id}:${weekBucket()}`;
    const [row] = await db
      .insert(notificationsTable)
      .values({
        ownerPhone: v.ownerPhone,
        kind: w.overdue ? "service_overdue" : "service_due_soon",
        title,
        body,
        dedupeKey,
        vehicleId: v.id,
      })
      .onConflictDoNothing({
        target: [notificationsTable.ownerPhone, notificationsTable.dedupeKey],
      })
      .returning({ id: notificationsTable.id });
    if (row) created += 1;
  }
  return created;
}

async function main(): Promise<void> {
  const [run] = await db
    .insert(reminderRunsTable)
    .values({ trigger: "external", status: "running" })
    .returning({ id: reminderRunsTable.id });
  const runId = run!.id;
  try {
    const created = await generate();
    await db
      .update(reminderRunsTable)
      .set({ status: "success", createdCount: created, finishedAt: new Date() })
      .where(eq(reminderRunsTable.id, runId));
    // Surface a tail of recent runs in stdout so the scheduled-deployment
    // log is self-contained.
    const recent = await db
      .select()
      .from(reminderRunsTable)
      .orderBy(desc(reminderRunsTable.startedAt))
      .limit(5);
    console.log(JSON.stringify({ runId, created, recent }, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(reminderRunsTable)
      .set({ status: "error", errorMessage: message, finishedAt: new Date() })
      .where(eq(reminderRunsTable.id, runId));
    console.error(JSON.stringify({ runId, error: message }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
