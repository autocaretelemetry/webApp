import { Router, type IRouter } from "express";
import { asc } from "drizzle-orm";
import { db, mechanicsTable } from "@workspace/db";

const router: IRouter = Router();

// Cross-center mechanic listing used by the admin directory.
router.get("/mechanics", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(mechanicsTable)
    .orderBy(asc(mechanicsTable.name));
  res.json(rows);
});

export default router;
