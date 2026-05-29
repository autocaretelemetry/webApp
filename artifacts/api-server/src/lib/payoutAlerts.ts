import { and, eq, inArray, lt } from "drizzle-orm";
import {
  db,
  sellerPayoutsTable,
  usersTable,
  type SellerPayout,
} from "@workspace/db";
import { createOwnerNotification } from "./notify";
import { appPublicUrl } from "./whatsapp";
import { sendEmail, payoutStuckDigestEmail } from "./email";
import { logger } from "./logger";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * Default age after which a `seller_payouts` row in a non-terminal state
 * (`needs_account` / `pending` / `failed`) is treated as stuck and worth
 * flagging to platform admins. Overridable via `PAYOUT_STUCK_THRESHOLD_MS`.
 */
const DEFAULT_STUCK_THRESHOLD_MS = 24 * HOUR;

export function payoutStuckThresholdMs(): number {
  const raw = process.env["PAYOUT_STUCK_THRESHOLD_MS"];
  if (!raw) return DEFAULT_STUCK_THRESHOLD_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_STUCK_THRESHOLD_MS;
  return Math.floor(n);
}

const STUCK_STATUSES = ["needs_account", "pending", "failed"] as const;

/**
 * Return every payout row stuck in a non-terminal state for longer than
 * the threshold. Sorted by creation time so digest output reads oldest
 * first (most overdue at the top).
 */
export async function findStuckPayouts(
  thresholdMs: number = payoutStuckThresholdMs(),
): Promise<SellerPayout[]> {
  const cutoff = new Date(Date.now() - thresholdMs);
  const rows = await db
    .select()
    .from(sellerPayoutsTable)
    .where(
      and(
        inArray(sellerPayoutsTable.status, STUCK_STATUSES as unknown as string[]),
        lt(sellerPayoutsTable.createdAt, cutoff),
      ),
    );
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

function dayBucket(d: Date = new Date()): string {
  return String(Math.floor(d.getTime() / DAY));
}

function statusReason(p: SellerPayout): string {
  if (p.status === "needs_account") return "no payout account on file";
  if (p.status === "failed") {
    return `disbursement failed — ${(p.lastError ?? "unknown error").slice(0, 120)}`;
  }
  return "still pending disbursement";
}

function notifBody(p: SellerPayout, thresholdMs: number): string {
  const hours = Math.max(1, Math.floor(thresholdMs / HOUR));
  const amount = Number.isFinite(p.netAmount) ? p.netAmount.toFixed(2) : "0.00";
  return `GHS ${amount} to ${p.sellerName} stuck for over ${hours}h (${statusReason(p)}).`.slice(
    0,
    280,
  );
}

/**
 * Resolve digest email recipients. Explicit `PAYOUT_ALERT_EMAILS`
 * (comma-separated) wins; otherwise fall back to every active platform
 * super-admin's verified email, mirroring the reminder-failure alert
 * plumbing so a fresh deployment still gets a heads-up without extra
 * config.
 */
async function getAlertRecipients(): Promise<string[]> {
  const env = process.env["PAYOUT_ALERT_EMAILS"];
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

export type PayoutStuckRunResult = {
  stuck: number;
  notificationsCreated: number;
  newlyAlerted: number;
  emailsSent: number;
};

/**
 * Scan `seller_payouts` for rows stuck past the threshold, drop a
 * deduped in-app notification into every active admin/super_admin's
 * queue (one per payout per UTC day, so a row that sits stuck for a
 * week produces one banner per admin per day, not seven on day seven),
 * and email a digest of *newly* alerted rows to the configured
 * recipients. Idempotent within a UTC day — repeated ticks the same
 * day are no-ops for already-notified rows and do not re-send email.
 *
 * Never throws; per-row failures are logged and the run continues.
 */
export async function runPayoutStuckAlerts(): Promise<PayoutStuckRunResult> {
  const thresholdMs = payoutStuckThresholdMs();
  const stuck = await findStuckPayouts(thresholdMs);
  if (stuck.length === 0) {
    return { stuck: 0, notificationsCreated: 0, newlyAlerted: 0, emailsSent: 0 };
  }

  const admins = await db
    .select({ phone: usersTable.phone })
    .from(usersTable)
    .where(
      and(
        eq(usersTable.active, true),
        inArray(usersTable.role, ["admin", "super_admin"]),
      ),
    );
  const adminPhones = admins
    .map((a) => a.phone)
    .filter((p): p is string => Boolean(p && p.trim().length > 0));

  if (adminPhones.length === 0) {
    logger.warn(
      { stuck: stuck.length },
      "Stuck payouts detected but no active admin phones to notify",
    );
  }

  const bucket = dayBucket();
  const url = appPublicUrl("/super-admin/payouts");

  let notificationsCreated = 0;
  const newlyAlerted: SellerPayout[] = [];

  for (const payout of stuck) {
    let firstAlertToday = false;
    for (const phone of adminPhones) {
      try {
        const r = await createOwnerNotification({
          ownerPhone: phone,
          kind: "payout_stuck",
          title: `Payout stuck: ${payout.sellerName}`,
          body: notifBody(payout, thresholdMs),
          dedupeKey: `payout_stuck:${payout.id}:${bucket}`,
          url,
        });
        if (r.created) {
          notificationsCreated += 1;
          firstAlertToday = true;
        }
      } catch (err) {
        logger.warn(
          { err, phone, payoutId: payout.id },
          "payout stuck notification insert failed",
        );
      }
    }
    if (firstAlertToday) newlyAlerted.push(payout);
  }

  let emailsSent = 0;
  if (newlyAlerted.length > 0) {
    const recipients = await getAlertRecipients();
    if (recipients.length === 0) {
      logger.warn(
        { newlyAlerted: newlyAlerted.length },
        "Newly stuck payouts detected but no email recipients configured",
      );
    } else {
      const msg = payoutStuckDigestEmail({
        payouts: newlyAlerted,
        thresholdMs,
        listUrl: url,
      });
      await Promise.all(
        recipients.map((to) =>
          sendEmail({ to, ...msg })
            .then((r) => {
              if (r.ok) emailsSent += 1;
            })
            .catch((err) =>
              logger.warn({ err, to }, "payout stuck digest send threw"),
            ),
        ),
      );
    }
  }

  logger.info(
    {
      stuck: stuck.length,
      notificationsCreated,
      newlyAlerted: newlyAlerted.length,
      emailsSent,
      thresholdMs,
    },
    "Payout stuck alert run completed",
  );

  return {
    stuck: stuck.length,
    notificationsCreated,
    newlyAlerted: newlyAlerted.length,
    emailsSent,
  };
}
