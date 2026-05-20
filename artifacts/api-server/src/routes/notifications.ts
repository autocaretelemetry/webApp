import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, notificationsTable } from "@workspace/db";
import {
  ListNotificationsQueryParams,
  MarkNotificationReadParams,
  MarkAllNotificationsReadBody,
  GenerateReminderNotificationsBody,
} from "@workspace/api-zod";
import { generateServiceReminderNotifications } from "../lib/reminders";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Notifications are scoped by ownerPhone in the query/body, but those
// strings come from the client and would otherwise be enumerable by an
// anonymous caller. Sign-in is required; per-owner authorization (matching
// the session phone) can be tightened in a follow-up.
router.use(requireAuth);

router.get("/notifications", async (req, res): Promise<void> => {
  const q = ListNotificationsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conds = [eq(notificationsTable.ownerPhone, q.data.ownerPhone)];
  if (q.data.unreadOnly) conds.push(isNull(notificationsTable.readAt));
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(and(...conds))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(q.data.limit ?? 50);
  res.json(rows);
});

router.patch(
  "/notifications/:notificationId/read",
  async (req, res): Promise<void> => {
    const params = MarkNotificationReadParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [row] = await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(eq(notificationsTable.id, params.data.notificationId))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(row);
  },
);

router.post("/notifications/mark-all-read", async (req, res): Promise<void> => {
  const body = MarkAllNotificationsReadBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.ownerPhone, body.data.ownerPhone),
        isNull(notificationsTable.readAt),
      ),
    );
  res.sendStatus(204);
});

router.post(
  "/notifications/generate-reminders",
  async (req, res): Promise<void> => {
    const body = GenerateReminderNotificationsBody.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    const created = await generateServiceReminderNotifications();
    res.json({ created });
  },
);

export default router;
