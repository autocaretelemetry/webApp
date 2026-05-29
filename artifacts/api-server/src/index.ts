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
  // Reconcile any reminder_runs rows left as `status="running"` by a
  // previous process that was killed mid-tick (deploy, OOM, hard crash)
  // before doing anything else, so the admin audit log is honest from
  // the moment the new process is up. Runs regardless of whether the
  // in-process scheduler is enabled — external Scheduled Deployments
  // can leave stale rows too.
  void import("./lib/reminders").then(({ markStaleReminderRunsAsCrashed }) => {
    markStaleReminderRunsAsCrashed().catch((err) =>
      logger.warn({ err }, "Boot-time stale reminder-run sweep failed"),
    );
  });

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

  // Payment-reconciliation sweep: every few minutes, look for
  // `payment_transactions` rows that have been stuck in `pending` past the
  // stale-threshold and ask PaySwitch for the canonical status. This is the
  // self-healing safety net for customers who closed the tab before the
  // browser callback fired AND whose webhook delivery was lost. Idempotent
  // via the shared settlement dispatcher's CAS guard, so it's safe to run
  // alongside the in-process scheduler and any external Scheduled
  // Deployment running the same script. Each tick also pages platform admins
  // (deduped per UTC day) when the `pending` backlog past the stale cutoff
  // grows beyond `PAYMENT_STUCK_ALERT_THRESHOLD` or too many verifications
  // bounce off PaySwitch (`PAYMENT_STUCK_UNREACHABLE_STREAK`).
  if (process.env["DISABLE_PAYMENT_RECONCILER"] !== "1") {
    void import("./lib/paymentReconciler").then(({ reconcilePendingPayments }) => {
      const intervalMs = Number(
        process.env["PAYMENT_RECONCILE_INTERVAL_MS"] ?? 5 * 60 * 1000,
      );
      const delayMs = Number(
        process.env["PAYMENT_RECONCILE_INITIAL_DELAY_MS"] ?? 30_000,
      );
      const staleAfterMs = Number(
        process.env["PAYMENT_RECONCILE_STALE_AFTER_MS"] ?? 10 * 60 * 1000,
      );
      const tick = () => {
        void reconcilePendingPayments({ staleAfterMs, log: logger }).catch((err) =>
          logger.error({ err }, "paymentReconciler tick threw"),
        );
      };
      setTimeout(tick, delayMs);
      setInterval(tick, intervalMs);
      logger.info(
        { intervalMs, delayMs, staleAfterMs },
        "In-process payment reconciler enabled",
      );
    });
  } else {
    logger.info("In-process payment reconciler disabled via env");
  }

  // Seller-payout stuck-row sweep: every few hours, scan `seller_payouts`
  // for rows in `needs_account` / `pending` / `failed` past the stuck
  // threshold (default 24h) and drop a deduped in-app notification +
  // optional email digest into every active admin's queue so funds don't
  // sit unpaid waiting for a super-admin to manually visit the queue.
  // Opt out with `DISABLE_PAYOUT_STUCK_SCHEDULER=1`.
  if (process.env["DISABLE_PAYOUT_STUCK_SCHEDULER"] !== "1") {
    void import("./lib/payoutAlerts").then(({ runPayoutStuckAlerts }) => {
      const intervalMs = Number(
        process.env["PAYOUT_STUCK_INTERVAL_MS"] ?? 6 * 60 * 60 * 1000,
      );
      const delayMs = Number(
        process.env["PAYOUT_STUCK_INITIAL_DELAY_MS"] ?? 60_000,
      );
      const tick = () => {
        runPayoutStuckAlerts().catch((err) =>
          logger.error({ err }, "payout stuck alert tick threw"),
        );
      };
      setTimeout(tick, delayMs);
      setInterval(tick, intervalMs);
      logger.info(
        { intervalMs, delayMs },
        "In-process payout stuck-alert scheduler enabled",
      );
    });
  } else {
    logger.info("In-process payout stuck-alert scheduler disabled via env");
  }
});
