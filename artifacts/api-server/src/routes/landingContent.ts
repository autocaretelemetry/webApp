import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, landingContentTable } from "@workspace/db";
import { UpdateLandingContentBody } from "@workspace/api-zod";
import { requireSuperAdmin } from "../lib/auth";

const router: IRouter = Router();

const SINGLETON_ID = "default";

// Lazily insert the default singleton row so a fresh database doesn't need a
// dedicated seed step. The schema defaults populate every required field.
// Uses ON CONFLICT DO NOTHING so concurrent first-hits can't race into a
// duplicate-key error.
async function loadOrCreate() {
  await db
    .insert(landingContentTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing({ target: landingContentTable.id });
  const [row] = await db
    .select()
    .from(landingContentTable)
    .where(eq(landingContentTable.id, SINGLETON_ID));
  return row;
}

router.get("/landing-content", async (_req, res): Promise<void> => {
  const row = await loadOrCreate();
  res.json(row);
});

router.put("/landing-content", requireSuperAdmin, async (req, res): Promise<void> => {
  const parsed = UpdateLandingContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Make sure the singleton exists before updating so the response always
  // returns a populated row.
  await loadOrCreate();
  const [updated] = await db
    .update(landingContentTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(landingContentTable.id, SINGLETON_ID))
    .returning();
  res.json(updated);
});

export default router;
