import { Router, type IRouter } from "express";
import { asc, eq } from "drizzle-orm";
import { db, mechanicsTable, serviceCentersTable } from "@workspace/db";
import {
  CreateMechanicBody,
  CreateMechanicParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

// Cross-center mechanic listing used by the admin directory.
router.get("/mechanics", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(mechanicsTable)
    .orderBy(asc(mechanicsTable.name));
  res.json(rows);
});

// Service center adds a mechanic to its own roster. Path-scoped to a centerId
// so the new mechanic is always attached to the right workshop.
router.post(
  "/service-centers/:centerId/mechanics",
  async (req, res): Promise<void> => {
    const params = CreateMechanicParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = CreateMechanicBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }
    // Verify the center exists so a bad id surfaces as a clean 404 rather
    // than a foreign-key violation from the driver.
    const [center] = await db
      .select({ id: serviceCentersTable.id })
      .from(serviceCentersTable)
      .where(eq(serviceCentersTable.id, params.data.centerId));
    if (!center) {
      res.status(404).json({ error: "Service center not found" });
      return;
    }
    const [row] = await db
      .insert(mechanicsTable)
      .values({
        serviceCenterId: center.id,
        name: body.data.name.trim(),
        specialization: body.data.specialization.trim(),
        yearsExperience: body.data.yearsExperience ?? 0,
        certifications: body.data.certifications ?? [],
        avatarUrl: body.data.avatarUrl ?? null,
      })
      .returning();
    res.status(201).json(row);
  },
);

export default router;
