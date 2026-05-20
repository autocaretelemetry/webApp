import { Router, type IRouter } from "express";
import { and, count, desc, eq } from "drizzle-orm";
import { db, driversTable, rentalCarsTable } from "@workspace/db";
import {
  ListDriversQueryParams,
  CreateDriverBody,
  UpdateDriverBody,
  GetDriverParams,
  UpdateDriverParams,
  DeleteDriverParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Chauffeur profiles are owner-scoped data; every route here mutates or
// reads PII keyed by ownerPhone, so block anonymous traffic up front.
router.use(requireAuth);

router.get("/drivers", async (req, res): Promise<void> => {
  const q = ListDriversQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(driversTable)
    .where(eq(driversTable.ownerPhone, q.data.ownerPhone))
    .orderBy(desc(driversTable.createdAt));
  res.json(rows);
});

router.get("/drivers/:driverId", async (req, res): Promise<void> => {
  const params = GetDriverParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(driversTable)
    .where(eq(driversTable.id, params.data.driverId));
  if (!row) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  res.json(row);
});

router.post("/drivers", async (req, res): Promise<void> => {
  const body = CreateDriverBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(driversTable)
    .values({
      ownerPhone: body.data.ownerPhone,
      name: body.data.name,
      phone: body.data.phone,
      photoUrl: body.data.photoUrl ?? null,
      licenseNumber: body.data.licenseNumber ?? null,
      yearsExperience: body.data.yearsExperience ?? 0,
      languages: body.data.languages ?? [],
      bio: body.data.bio ?? null,
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/drivers/:driverId", async (req, res): Promise<void> => {
  const params = UpdateDriverParams.safeParse(req.params);
  const body = UpdateDriverBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db
    .update(driversTable)
    .set({ ...body.data, updatedAt: new Date() })
    .where(eq(driversTable.id, params.data.driverId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  res.json(row);
});

router.delete("/drivers/:driverId", async (req, res): Promise<void> => {
  const params = DeleteDriverParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Block deletion if any car still has this driver attached — otherwise the
  // listing would advertise "with driver" but no driver profile to show.
  const [attached] = await db
    .select({ n: count() })
    .from(rentalCarsTable)
    .where(
      and(
        eq(rentalCarsTable.driverId, params.data.driverId),
        eq(rentalCarsTable.active, true),
      ),
    );
  const n = Number(attached?.n ?? 0);
  if (n > 0) {
    res.status(409).json({
      error: "Driver is attached to one or more listings",
      reason: "has_dependents",
      details: `${n} active listing(s) reference this driver. Remove the driver from those listings or set them as self-drive only first.`,
    });
    return;
  }
  const deleted = await db
    .delete(driversTable)
    .where(eq(driversTable.id, params.data.driverId))
    .returning({ id: driversTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Driver not found" });
    return;
  }
  res.status(204).end();
});

export default router;
