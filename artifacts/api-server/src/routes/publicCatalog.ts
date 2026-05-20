import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, partsTable } from "@workspace/db";
import { SERVICE_TYPES } from "../lib/catalog";
import { vapidPublicKey } from "../lib/push";

// Public catalog endpoints. These are intentionally anonymous: they feed
// dropdowns / filter chips on the booking and marketplace pages, and the
// VAPID key is, by design, public.
//
// They live in their own tiny router so we can mount them BEFORE the
// gated resource routers in `routes/index.ts`. That ordering matters —
// each gated router calls `router.use(requireAuth)` internally, and
// express runs sub-router middleware for every request that reaches the
// router (not just for matched routes). Mounting publics first lets
// them respond before the auth gate fires.
const router: IRouter = Router();

router.get("/catalog/service-types", async (_req, res): Promise<void> => {
  res.json(SERVICE_TYPES);
});

router.get("/catalog/part-categories", async (_req, res): Promise<void> => {
  const rows = await db.select().from(partsTable).where(eq(partsTable.active, true));
  const map = new Map<string, number>();
  for (const r of rows) map.set(r.category, (map.get(r.category) ?? 0) + 1);
  res.json(
    [...map.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  );
});

router.get("/push/vapid-public-key", (_req, res): void => {
  const key = vapidPublicKey();
  if (!key) {
    res.status(503).json({ error: "Web push not configured" });
    return;
  }
  res.json({ publicKey: key });
});

export default router;
