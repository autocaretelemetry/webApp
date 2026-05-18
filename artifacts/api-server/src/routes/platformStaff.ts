import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, platformStaffTable } from "@workspace/db";
import {
  ListPlatformStaffQueryParams,
  CreatePlatformStaffBody,
  UpdatePlatformStaffParams,
  UpdatePlatformStaffBody,
  DeletePlatformStaffParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/platform-staff", async (req, res): Promise<void> => {
  const q = ListPlatformStaffQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(platformStaffTable)
    .where(q.data.includeInactive ? undefined : eq(platformStaffTable.active, true))
    .orderBy(desc(platformStaffTable.createdAt));
  res.json(rows);
});

router.post("/platform-staff", async (req, res): Promise<void> => {
  const body = CreatePlatformStaffBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const existing = await db
    .select()
    .from(platformStaffTable)
    .where(eq(platformStaffTable.email, body.data.email));
  if (existing.length > 0) {
    res.status(409).json({ error: "A staff member with that email already exists." });
    return;
  }
  const [row] = await db
    .insert(platformStaffTable)
    .values({
      name: body.data.name,
      email: body.data.email,
      role: body.data.role ?? "staff",
      permissions: body.data.permissions ?? [],
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/platform-staff/:staffId", async (req, res): Promise<void> => {
  const params = UpdatePlatformStaffParams.safeParse(req.params);
  const body = UpdatePlatformStaffBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  if (body.data.email) {
    const dup = await db
      .select({ id: platformStaffTable.id })
      .from(platformStaffTable)
      .where(eq(platformStaffTable.email, body.data.email));
    if (dup.some((d) => d.id !== params.data.staffId)) {
      res.status(409).json({ error: "A staff member with that email already exists." });
      return;
    }
  }
  const [row] = await db
    .update(platformStaffTable)
    .set(body.data)
    .where(eq(platformStaffTable.id, params.data.staffId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  res.json(row);
});

router.delete("/platform-staff/:staffId", async (req, res): Promise<void> => {
  const params = DeletePlatformStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(platformStaffTable).where(eq(platformStaffTable.id, params.data.staffId));
  res.status(204).end();
});

export default router;
