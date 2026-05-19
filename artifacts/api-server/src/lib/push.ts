import webpush from "web-push";
import { and, eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import { logger } from "./logger";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env["VAPID_PUBLIC_KEY"];
  const priv = process.env["VAPID_PRIVATE_KEY"];
  const contact = process.env["VAPID_CONTACT_EMAIL"] ?? "support@autocare.local";
  if (!pub || !priv) {
    logger.warn("VAPID keys not set; web push disabled");
    return false;
  }
  webpush.setVapidDetails(`mailto:${contact}`, pub, priv);
  configured = true;
  return true;
}

export function vapidPublicKey(): string | null {
  const pub = process.env["VAPID_PUBLIC_KEY"];
  const priv = process.env["VAPID_PRIVATE_KEY"];
  if (!pub || !priv) return null;
  return pub;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendPushToOwner(
  ownerPhone: string,
  payload: PushPayload,
): Promise<void> {
  if (!ensureConfigured()) return;
  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.ownerPhone, ownerPhone));
  if (subs.length === 0) return;

  const json = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          json,
        );
      } catch (err: unknown) {
        const status =
          err && typeof err === "object" && "statusCode" in err
            ? (err as { statusCode: number }).statusCode
            : 0;
        if (status === 404 || status === 410) {
          // Subscription is gone — clean it up.
          await db
            .delete(pushSubscriptionsTable)
            .where(
              and(
                eq(pushSubscriptionsTable.ownerPhone, ownerPhone),
                eq(pushSubscriptionsTable.endpoint, s.endpoint),
              ),
            );
          logger.info({ endpoint: s.endpoint }, "Removed expired push subscription");
        } else {
          logger.warn({ err, status }, "Push send failed");
        }
      }
    }),
  );
}
