import { and, count, eq, inArray, lt } from "drizzle-orm";
import type { Logger } from "pino";
import { db, paymentTransactionsTable, usersTable } from "@workspace/db";
import { createOwnerNotification } from "./notify";
import { appPublicUrl } from "./whatsapp";
import { sendEmail, paymentStuckAlertEmail } from "./email";
import { logger as rootLogger } from "./logger";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Default number of `payment_transactions` rows stuck in `pending` past the
 * stale cutoff that trips the admin alert. A PaySwitch outage that strands
 * dozens of charges should page operators rather than waiting for someone to
 * happen to open the queue. Overridable via `PAYMENT_STUCK_ALERT_THRESHOLD`.
 */
const DEFAULT_STUCK_COUNT_THRESHOLD = 10;

/**
 * Default number of verifications in a single reconciler sweep that fail to
 * reach PaySwitch before we treat the provider as unreachable and alert. This
 * is the early-warning signal for an outage — the queue may not have grown
 * past the count threshold yet, but if every verification is bouncing the
 * provider is down. Overridable via `PAYMENT_STUCK_UNREACHABLE_STREAK`.
 */
const DEFAULT_UNREACHABLE_STREAK = 5;

export function stuckCountThreshold(): number {
  const raw = process.env["PAYMENT_STUCK_ALERT_THRESHOLD"];
  if (!raw) return DEFAULT_STUCK_COUNT_THRESHOLD;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_STUCK_COUNT_THRESHOLD;
  return Math.floor(n);
}

export function unreachableStreakThreshold(): number {
  const raw = process.env["PAYMENT_STUCK_UNREACHABLE_STREAK"];
  if (!raw) return DEFAULT_UNREACHABLE_STREAK;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_UNREACHABLE_STREAK;
  return Math.floor(n);
}

function dayBucket(d: Date = new Date()): string {
  return String(Math.floor(d.getTime() / DAY));
}

/**
 * Count `payment_transactions` rows stuck in `pending` for longer than
 * `staleAfterMs`. Independent of the reconciler's per-tick `limit`, so the
 * threshold check sees the true backlog even when a single sweep only
 * processes the first N rows.
 */
export async function countStalePendingPayments(
  staleAfterMs: number,
): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const [row] = await db
    .select({ c: count() })
    .from(paymentTransactionsTable)
    .where(
      and(
        eq(paymentTransactionsTable.provider, "payswitch"),
        eq(paymentTransactionsTable.status, "pending"),
        lt(paymentTransactionsTable.createdAt, cutoff),
      ),
    );
  return Number(row?.c ?? 0);
}

/**
 * Resolve digest email recipients. Explicit `REMINDER_ALERT_EMAILS`
 * (comma-separated) wins — the task asks payment-stuck alerts to reuse the
 * exact recipient list as reminder-job failures; otherwise fall back to every
 * active platform super-admin's verified email so a fresh deployment still
 * gets a heads-up without extra config.
 */
async function getAlertRecipients(): Promise<string[]> {
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

export type PaymentStuckAlertResult = {
  triggered: boolean;
  stuckCount: number;
  unreachable: number;
  notificationsCreated: number;
  emailsSent: number;
};

/**
 * Decide whether the current reconciler sweep is unhealthy enough to page
 * platform admins, and if so drop a deduped in-app notification into every
 * active super-admin's queue + email the same recipients as reminder-job
 * failures.
 *
 * Two independent triggers, either of which fires the alert:
 *   1. The number of `pending` rows older than the stale cutoff is at or above
 *      `PAYMENT_STUCK_ALERT_THRESHOLD` — the backlog has grown dangerously.
 *   2. `unreachable` verifications in this single sweep is at or above
 *      `PAYMENT_STUCK_UNREACHABLE_STREAK` — PaySwitch looks down even if the
 *      backlog hasn't piled up yet.
 *
 * Deduped per UTC day via the notification (ownerPhone, dedupeKey) uniqueness,
 * so a single incident produces at most one banner per super-admin per day and
 * the email is sent only on the first alerting sweep of the day. Never throws;
 * per-recipient failures are logged and the run continues.
 */
export async function maybeAlertStuckPayments(args: {
  staleAfterMs: number;
  unreachable: number;
  log?: Logger;
}): Promise<PaymentStuckAlertResult> {
  const log = args.log ?? rootLogger;
  const unreachable = Math.max(0, args.unreachable);
  const stuckCount = await countStalePendingPayments(args.staleAfterMs);

  const countThreshold = stuckCountThreshold();
  const streakThreshold = unreachableStreakThreshold();
  const byCount = stuckCount >= countThreshold;
  const byStreak = unreachable >= streakThreshold;

  if (!byCount && !byStreak) {
    return {
      triggered: false,
      stuckCount,
      unreachable,
      notificationsCreated: 0,
      emailsSent: 0,
    };
  }

  const reasons: string[] = [];
  if (byCount) {
    reasons.push(
      `${stuckCount} payment${stuckCount === 1 ? "" : "s"} stuck in 'pending' past the stale cutoff (alert threshold ${countThreshold})`,
    );
  }
  if (byStreak) {
    reasons.push(
      `${unreachable} verification${unreachable === 1 ? "" : "s"} could not reach PaySwitch on the last sweep (alert threshold ${streakThreshold})`,
    );
  }

  const supers = await db
    .select({ phone: usersTable.phone })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.active, true),
        eq(usersTable.role, "super_admin"),
      ),
    );
  const phones = supers
    .map((s) => s.phone)
    .filter((p): p is string => Boolean(p && p.trim().length > 0));

  if (phones.length === 0) {
    log.warn(
      { stuckCount, unreachable },
      "Payments stuck alert tripped but no active super_admin phones to notify",
    );
  }

  const dedupeKey = `payment_stuck:${dayBucket()}`;
  const url = appPublicUrl("/super-admin/payments");
  const body = reasons.join("; ").slice(0, 280);

  let notificationsCreated = 0;
  for (const phone of phones) {
    try {
      const r = await createOwnerNotification({
        ownerPhone: phone,
        kind: "payment_stuck",
        title: "Payments stuck in 'pending'",
        body,
        dedupeKey,
        url,
      });
      if (r.created) notificationsCreated += 1;
    } catch (err) {
      log.warn({ err, phone }, "payment stuck notification insert failed");
    }
  }

  // Email only on the first alerting sweep of the UTC day. A fresh
  // notification (created === true) means the per-day dedupe key was not
  // present yet, so this is the first time today the incident tripped.
  let emailsSent = 0;
  if (notificationsCreated > 0) {
    const recipients = await getAlertRecipients();
    if (recipients.length === 0) {
      log.warn(
        { stuckCount, unreachable },
        "Payments stuck alert tripped but no email recipients configured",
      );
    } else {
      const msg = paymentStuckAlertEmail({
        stuckCount,
        unreachable,
        staleAfterMs: args.staleAfterMs,
        reasons,
        listUrl: url,
      });
      await Promise.all(
        recipients.map((to) =>
          sendEmail({ to, ...msg })
            .then((r) => {
              if (r.ok) emailsSent += 1;
            })
            .catch((err) =>
              log.warn({ err, to }, "payment stuck alert send threw"),
            ),
        ),
      );
    }
  }

  log.warn(
    {
      stuckCount,
      unreachable,
      byCount,
      byStreak,
      notificationsCreated,
      emailsSent,
    },
    "Payments stuck alert tripped",
  );

  return {
    triggered: true,
    stuckCount,
    unreachable,
    notificationsCreated,
    emailsSent,
  };
}
