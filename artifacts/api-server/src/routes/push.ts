import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import {
  CreatePushSubscriptionBody,
  DeletePushSubscriptionBody,
} from "@workspace/api-zod";
import { vapidPublicKey } from "../lib/push";

const router: IRouter = Router();

router.get("/push/vapid-public-key", (_req, res): void => {
  const key = vapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Web push not configured" });
    return;
  }
  res.json({ publicKey: key });
});

router.post("/push/subscriptions", async (req, res): Promise<void> => {
  const parsed = CreatePushSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(pushSubscriptionsTable)
    .values({
      ownerPhone: parsed.data.ownerPhone,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.p256dh,
      auth: parsed.data.auth,
      userAgent: parsed.data.userAgent ?? null,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: {
        ownerPhone: parsed.data.ownerPhone,
        p256dh: parsed.data.p256dh,
        auth: parsed.data.auth,
      },
    })
    .returning();
  res.status(201).json(row);
});

router.delete("/push/subscriptions", async (req, res): Promise<void> => {
  const parsed = DeletePushSubscriptionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  await db
    .delete(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.endpoint, parsed.data.endpoint));
  res.sendStatus(204);
});

export default router;
