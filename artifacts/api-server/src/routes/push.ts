import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, pushSubscriptionsTable } from "@workspace/db";
import {
  CreatePushSubscriptionBody,
  DeletePushSubscriptionBody,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Push-subscription create/delete writes per-owner endpoints to our DB.
// Require sign-in so anonymous callers can't enumerate or churn rows.
// The public VAPID-key endpoint lives in `publicCatalog.ts`.
router.use(requireAuth);

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
