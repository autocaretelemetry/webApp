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
import { requireAuth, requireAdmin } from "../lib/auth";

const router: IRouter = Router();

router.use(requireAuth);

// Notifications are owner-scoped by phone. The session phone is the only
// trusted identifier; admin/super_admin may override via an explicit
// `ownerPhone` to inspect another user's queue. Anyone else who passes a
// phone has it silently ignored — see rentals.access.test.ts for the
// access-isolation pattern.
function resolveOwnerPhone(
  req: Parameters<Parameters<typeof router.get>[1]>[0],
  clientPhone: string | undefined,
): { ok: true; phone: string } | { ok: false; status: number; error: string } {
  const user = req.user;
  if (!user) return { ok: false, status: 401, error: "Not authenticated" };
  const role = user.role;
  if (role === "admin" || role === "super_admin") {
    return { ok: true, phone: clientPhone ?? user.phone ?? "" };
  }
  if (!user.phone) {
    return { ok: false, status: 403, error: "No phone on account" };
  }
  return { ok: true, phone: user.phone };
}

router.get("/notifications", async (req, res): Promise<void> => {
  const q = ListNotificationsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const owner = resolveOwnerPhone(req, q.data.ownerPhone);
  if (!owner.ok) {
    res.status(owner.status).json({ error: owner.error });
    return;
  }
  const conds = [eq(notificationsTable.ownerPhone, owner.phone)];
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
    const user = req.user!;
    const isAdmin = user.role === "admin" || user.role === "super_admin";
    const [existing] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, params.data.notificationId));
    if (!existing) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    if (!isAdmin && existing.ownerPhone !== user.phone) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    const [row] = await db
      .update(notificationsTable)
      .set({ readAt: new Date() })
      .where(eq(notificationsTable.id, params.data.notificationId))
      .returning();
    res.json(row);
  },
);

router.post("/notifications/mark-all-read", async (req, res): Promise<void> => {
  const body = MarkAllNotificationsReadBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const owner = resolveOwnerPhone(req, body.data.ownerPhone);
  if (!owner.ok) {
    res.status(owner.status).json({ error: owner.error });
    return;
  }
  await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.ownerPhone, owner.phone),
        isNull(notificationsTable.readAt),
      ),
    );
  res.sendStatus(204);
});

router.post(
  "/notifications/generate-reminders",
  requireAdmin,
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
