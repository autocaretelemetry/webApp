import { db, notificationsTable } from "@workspace/db";
import { sendPushToOwner, type PushPayload } from "./push";
import { logger } from "./logger";

export type OwnerNotificationInput = {
  ownerPhone: string;
  kind: string;
  title: string;
  body: string;
  dedupeKey: string;
  vehicleId?: string | null;
  bookingId?: string | null;
  url?: string;
};

/**
 * Persist an in-app notification for the owner and fan it out via web push.
 * Uses (ownerPhone, dedupeKey) uniqueness — duplicates within the same key
 * are silently dropped so cron-style generators are safe to re-run.
 */
export async function createOwnerNotification(
  input: OwnerNotificationInput,
): Promise<{ created: boolean }> {
  const [row] = await db
    .insert(notificationsTable)
    .values({
      ownerPhone: input.ownerPhone,
      kind: input.kind,
      title: input.title,
      body: input.body,
      dedupeKey: input.dedupeKey,
      vehicleId: input.vehicleId ?? null,
      bookingId: input.bookingId ?? null,
    })
    .onConflictDoNothing({
      target: [notificationsTable.ownerPhone, notificationsTable.dedupeKey],
    })
    .returning();

  if (!row) return { created: false };

  const payload: PushPayload = {
    title: input.title,
    body: input.body,
    tag: input.dedupeKey,
    ...(input.url ? { url: input.url } : {}),
  };
  sendPushToOwner(input.ownerPhone, payload).catch((err) =>
    logger.warn({ err }, "fan-out push failed"),
  );
  return { created: true };
}
