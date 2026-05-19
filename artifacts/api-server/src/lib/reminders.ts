import { db, vehiclesTable, type Vehicle } from "@workspace/db";
import { createOwnerNotification } from "./notify";
import { appPublicUrl } from "./whatsapp";
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
