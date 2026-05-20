import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Service-reminder generator: runs once shortly after boot and then on
  // a recurring interval (default daily). Each invocation goes through
  // `runReminderJob` so the outcome — success count or failure message —
  // is persisted to `reminder_runs` and shown in the admin UI. The
  // generator is idempotent via (ownerPhone, dedupeKey) so duplicate
  // ticks (multiple instances on autoscale, manual admin trigger, an
  // external Replit Scheduled Deployment, etc.) are all safe.
  //
  // The in-process scheduler is the dev / always-on-VM path; on the
  // autoscale production deployment the canonical schedule is a Replit
  // Scheduled Deployment that invokes `scripts/runReminders.ts`. Set
  // `DISABLE_REMINDER_SCHEDULER=1` to opt out (e.g. when the external
  // scheduler is the sole source of truth).
  if (process.env["DISABLE_REMINDER_SCHEDULER"] !== "1") {
    void import("./lib/reminders").then(({ runReminderJob }) => {
      const intervalMs = Number(
        process.env["REMINDER_INTERVAL_MS"] ?? 24 * 60 * 60 * 1000,
      );
      const delayMs = Number(process.env["REMINDER_INITIAL_DELAY_MS"] ?? 10_000);
      const tick = () => {
        void runReminderJob("scheduler");
      };
      setTimeout(tick, delayMs);
      setInterval(tick, intervalMs);
      logger.info(
        { intervalMs, delayMs },
        "In-process reminder scheduler enabled",
      );
    });
  } else {
    logger.info("In-process reminder scheduler disabled via env");
  }
});
