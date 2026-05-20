import { db, vehiclesTable, reminderRunsTable, usersTable, type Vehicle, type ReminderRun, type ReminderRunTrigger } from "@workspace/db";
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { createOwnerNotification } from "./notify";
import { appPublicUrl } from "./whatsapp";
import { sendEmail, reminderJobFailureEmail } from "./email";
import { logger } from "./logger";

const DAY = 1000 * 60 * 60 * 24;

export type Reminder = {
  id: string;
  vehicleId: string;
  title: string;
  detail: string | null;
  dueAt: Date;
  urgency: "low" | "medium" | "high";
};

type ServiceWindow = {
  intervalDays: number;
  intervalKm: number;
  lastAt: Date;
  lastMileage: number;
  dueAt: Date;
  daysRemaining: number;
  kmRemaining: number;
  overdue: boolean;
};

export function serviceWindow(vehicle: Vehicle): ServiceWindow {
  const intervalDays = vehicle.serviceIntervalDays ?? 90;
  const intervalKm = vehicle.serviceIntervalKm ?? 5000;
  const lastAt = vehicle.lastServicedAt ?? vehicle.createdAt;
  // Baseline mileage: if the vehicle has never been serviced through AutoCare,
  // treat its current odometer as the baseline (rather than 0) so old vehicles
  // aren't flagged as immediately overdue. Once a service is paid, the
  // invoices route snapshots vehicle.mileage into lastServicedMileage.
  const lastMileage = vehicle.lastServicedMileage ?? vehicle.mileage;
  const dueAt = new Date(lastAt.getTime() + intervalDays * DAY);
  const daysRemaining = Math.ceil((dueAt.getTime() - Date.now()) / DAY);
  const kmRemaining = lastMileage + intervalKm - vehicle.mileage;
  const overdue = daysRemaining <= 0 || kmRemaining <= 0;
  return {
    intervalDays,
    intervalKm,
    lastAt,
    lastMileage,
    dueAt,
    daysRemaining,
    kmRemaining,
    overdue,
  };
}

export function computeReminders(vehicle: Vehicle): Reminder[] {
  const w = serviceWindow(vehicle);
  const urgency: Reminder["urgency"] = w.overdue
    ? "high"
    : w.daysRemaining <= 14 || w.kmRemaining <= 500
      ? "medium"
      : "low";

  const timeStr = w.daysRemaining <= 0
    ? `Overdue by ${Math.abs(w.daysRemaining)} day(s)`
    : `${w.daysRemaining} day(s) remaining`;
  const kmStr = w.kmRemaining <= 0
    ? `mileage threshold passed (${Math.abs(w.kmRemaining).toLocaleString()} km over)`
    : `${w.kmRemaining.toLocaleString()} km remaining`;

  return [
    {
      id: `${vehicle.id}-service`,
      vehicleId: vehicle.id,
      title: "Scheduled Service Due",
      detail: `Service every ${w.intervalDays} days or ${w.intervalKm.toLocaleString()} km. ${timeStr}; ${kmStr}.`,
      dueAt: w.dueAt,
      urgency,
    },
  ];
}

// Stable bucket so the same overdue vehicle doesn't spam the owner more than
// once per week.
function weekBucket(d: Date = new Date()): string {
  const ms = d.getTime();
  const week = Math.floor(ms / (7 * DAY));
  return String(week);
}

/**
 * Scan all vehicles, identify any whose time-or-mileage service window has
 * elapsed, and create an in-app notification (+ web push) for the owner.
 * Idempotent via (ownerPhone, dedupeKey) — safe to call on an interval.
 *
 * Prefer {@link runReminderJob} for scheduled / admin-triggered runs so the
 * outcome is persisted to `reminder_runs` for admin visibility. This raw
 * function is still exported so other call-sites (tests, ad hoc tooling)
 * can invoke the generator without recording a run row.
 */
export async function generateServiceReminderNotifications(): Promise<number> {
  const vehicles = await db.select().from(vehiclesTable);
  let createdCount = 0;
  for (const v of vehicles) {
    if (!v.ownerPhone) continue;
    const w = serviceWindow(v);
    if (!w.overdue && w.daysRemaining > 7 && w.kmRemaining > 200) continue;

    const reason =
      w.daysRemaining <= 0 && w.kmRemaining <= 0
        ? "time and mileage"
        : w.daysRemaining <= 0
          ? "time"
          : w.kmRemaining <= 0
            ? "mileage"
            : "upcoming";

    const title = w.overdue
      ? `Service overdue: ${v.brand} ${v.model}`
      : `Service due soon: ${v.brand} ${v.model}`;
    const body = w.overdue
      ? `Triggered by ${reason}. Book a workshop visit to avoid surprises.`
      : `${w.daysRemaining > 0 ? w.daysRemaining + " day(s)" : "today"} or ${w.kmRemaining > 0 ? w.kmRemaining.toLocaleString() + " km" : "now"} until your next service.`;

    const dedupeKey = `service:${v.id}:${weekBucket()}`;
    try {
      const r = await createOwnerNotification({
        ownerPhone: v.ownerPhone,
        kind: w.overdue ? "service_overdue" : "service_due_soon",
        title,
        body,
        dedupeKey,
        vehicleId: v.id,
        url: appPublicUrl(`/garage/${v.id}`),
      });
      if (r.created) createdCount += 1;
    } catch (err) {
      logger.warn({ err, vehicleId: v.id }, "Failed to create reminder");
    }
  }
  return createdCount;
}

export type ReminderJobResult = {
  runId: string;
  created: number;
  status: "success" | "error";
  errorMessage: string | null;
};

/**
 * Run the reminder generator and persist the outcome to `reminder_runs` so
 * admins can audit when it last ran and whether it succeeded. Used by the
 * in-process scheduler, the admin manual trigger, and the standalone
 * `scripts/runReminders.ts` entry point invoked by Replit Scheduled
 * Deployments. Never throws — errors are recorded on the run row.
 */
export async function runReminderJob(
  trigger: ReminderRunTrigger,
): Promise<ReminderJobResult> {
  const [row] = await db
    .insert(reminderRunsTable)
    .values({ trigger, status: "running" })
    .returning({ id: reminderRunsTable.id });
  const runId = row!.id;
  try {
    const created = await generateServiceReminderNotifications();
    await db
      .update(reminderRunsTable)
      .set({ status: "success", createdCount: created, finishedAt: new Date() })
      .where(eq(reminderRunsTable.id, runId));
    if (created > 0) {
      logger.info({ runId, trigger, created }, "Reminder run completed");
    }
    try {
      await pruneOldReminderRuns();
    } catch (pruneErr) {
      logger.warn({ err: pruneErr, runId }, "Failed to prune old reminder runs");
    }
    return { runId, created, status: "success", errorMessage: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(reminderRunsTable)
      .set({ status: "error", errorMessage: message, finishedAt: new Date() })
      .where(eq(reminderRunsTable.id, runId));
    logger.error({ err, runId, trigger }, "Reminder run failed");
    await maybeAlertOnFailureStreak(message).catch((alertErr) =>
      logger.warn({ err: alertErr, runId }, "Failed to dispatch reminder-failure alert"),
    );
    return { runId, created: 0, status: "error", errorMessage: message };
  }
}

/**
 * Default number of consecutive failed runs that triggers an admin alert.
 * Overridable via `REMINDER_FAILURE_ALERT_THRESHOLD`.
 */
const DEFAULT_FAILURE_ALERT_THRESHOLD = 3;

function failureAlertThreshold(): number {
  const raw = process.env["REMINDER_FAILURE_ALERT_THRESHOLD"];
  if (!raw) return DEFAULT_FAILURE_ALERT_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_FAILURE_ALERT_THRESHOLD;
  return Math.floor(n);
}

/**
 * Resolve which addresses receive a reminder-job failure alert. Explicit
 * `REMINDER_ALERT_EMAILS` (comma-separated) wins; otherwise fall back to
 * every active platform super-admin's verified email so a fresh deployment
 * still gets a heads-up without extra config.
 */
async function getFailureAlertRecipients(): Promise<string[]> {
  const env = process.env["REMINDER_ALERT_EMAILS"];
  if (env && env.trim()) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  const rows = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.active, true),
        inArray(usersTable.role, ["super_admin"]),
      ),
    );
  return rows.map((r) => r.email).filter((e): e is string => Boolean(e));
}

/**
 * Email platform admins exactly once per failure streak. A "streak" is N
 * consecutive `status="error"` runs where N is the configured threshold.
 * To avoid re-spamming, we only fire when the current run is the Nth error
 * AND the run immediately preceding the streak is either absent or NOT an
 * error — that means the Nth-failure boundary was just crossed, so any
 * earlier failure in the same streak would already have sent its own alert
 * one tick later (and would now skip because the (N+1)th prior run is an
 * error). A single success in between resets the streak naturally.
 */
async function maybeAlertOnFailureStreak(latestError: string): Promise<void> {
  const threshold = failureAlertThreshold();
  const recent = await db
    .select({ status: reminderRunsTable.status })
    .from(reminderRunsTable)
    .orderBy(desc(reminderRunsTable.startedAt))
    .limit(threshold + 1);
  if (recent.length < threshold) return;
  const streak = recent.slice(0, threshold);
  if (!streak.every((r) => r.status === "error")) return;
  // If a run before the streak window also failed, we already alerted on
  // the previous tick when the boundary was first crossed.
  if (recent.length > threshold && recent[threshold]!.status === "error") return;

  const recipients = await getFailureAlertRecipients();
  if (recipients.length === 0) {
    logger.warn(
      { threshold },
      "Reminder job failure streak detected but no alert recipients configured",
    );
    return;
  }
  const msg = reminderJobFailureEmail({
    streakLength: threshold,
    errorMessage: latestError,
    runUrl: appPublicUrl("/admin/reminder-runs"),
  });
  logger.warn(
    { threshold, recipients: recipients.length },
    "Reminder job failure streak detected; emailing platform admins",
  );
  await Promise.all(
    recipients.map((to) =>
      sendEmail({ to, ...msg }).catch((err) =>
        logger.warn({ err, to }, "reminder failure alert send threw"),
      ),
    ),
  );
}

/**
 * Default retention window for `reminder_runs` rows. Anything older than this
 * is deleted by {@link pruneOldReminderRuns} so the table doesn't grow without
 * bound (one row per scheduler tick + every manual/external invocation).
 * Overridable via `REMINDER_RETENTION_DAYS` env var.
 */
export const DEFAULT_REMINDER_RETENTION_DAYS = 90;

function getRetentionDays(): number {
  const raw = process.env["REMINDER_RETENTION_DAYS"];
  if (!raw) return DEFAULT_REMINDER_RETENTION_DAYS;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_REMINDER_RETENTION_DAYS;
  return n;
}

/**
 * Delete reminder_runs rows older than the retention window. Returns the
 * number of rows removed. Safe to call repeatedly; called automatically at
 * the end of every successful {@link runReminderJob}.
 */
export async function pruneOldReminderRuns(
  retentionDays: number = getRetentionDays(),
): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * DAY);
  const deleted = await db
    .delete(reminderRunsTable)
    .where(lt(reminderRunsTable.startedAt, cutoff))
    .returning({ id: reminderRunsTable.id });
  if (deleted.length > 0) {
    logger.info(
      { deleted: deleted.length, retentionDays, cutoff: cutoff.toISOString() },
      "Pruned old reminder runs",
    );
  }
  return deleted.length;
}

export async function listRecentReminderRuns(limit = 25): Promise<ReminderRun[]> {
  return db
    .select()
    .from(reminderRunsTable)
    .orderBy(desc(reminderRunsTable.startedAt))
    .limit(limit);
}
