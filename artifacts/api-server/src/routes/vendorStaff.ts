import { Router, type IRouter } from "express";
import { and, desc, eq, ne } from "drizzle-orm";
import { db, vendorStaffTable, vendorsTable } from "@workspace/db";
import {
  ListVendorStaffParams,
  CreateVendorStaffParams,
  CreateVendorStaffBody,
  UpdateVendorStaffParams,
  UpdateVendorStaffBody,
  DeleteVendorStaffParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

async function vendorExists(vendorId: string): Promise<boolean> {
  const [v] = await db
    .select({ id: vendorsTable.id })
    .from(vendorsTable)
    .where(eq(vendorsTable.id, vendorId));
  return !!v;
}

router.get("/vendors/:vendorId/staff", async (req, res): Promise<void> => {
  const params = ListVendorStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await vendorExists(params.data.vendorId))) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const rows = await db
    .select()
    .from(vendorStaffTable)
    .where(eq(vendorStaffTable.vendorId, params.data.vendorId))
    .orderBy(desc(vendorStaffTable.createdAt));
  res.json(rows);
});

router.post("/vendors/:vendorId/staff", async (req, res): Promise<void> => {
  const params = CreateVendorStaffParams.safeParse(req.params);
  const body = CreateVendorStaffBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  if (!(await vendorExists(params.data.vendorId))) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  // Email uniqueness is scoped per vendor: two different vendors can each
  // have a staff member with the same email without conflict.
  const dup = await db
    .select({ id: vendorStaffTable.id })
    .from(vendorStaffTable)
    .where(
      and(
        eq(vendorStaffTable.vendorId, params.data.vendorId),
        eq(vendorStaffTable.email, body.data.email),
      ),
    );
  if (dup.length > 0) {
    res.status(409).json({ error: "A staff member with that email already exists." });
    return;
  }
  const [row] = await db
    .insert(vendorStaffTable)
    .values({
      vendorId: params.data.vendorId,
      name: body.data.name,
      email: body.data.email,
      phone: body.data.phone ?? null,
      role: body.data.role ?? "staff",
      permissions: body.data.permissions ?? [],
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/vendors/:vendorId/staff/:staffId", async (req, res): Promise<void> => {
  const params = UpdateVendorStaffParams.safeParse(req.params);
  const body = UpdateVendorStaffBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  if (!(await vendorExists(params.data.vendorId))) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  if (body.data.email) {
    const dup = await db
      .select({ id: vendorStaffTable.id })
      .from(vendorStaffTable)
      .where(
        and(
          eq(vendorStaffTable.vendorId, params.data.vendorId),
          eq(vendorStaffTable.email, body.data.email),
          ne(vendorStaffTable.id, params.data.staffId),
        ),
      );
    if (dup.length > 0) {
      res.status(409).json({ error: "A staff member with that email already exists." });
      return;
    }
  }
  const [row] = await db
    .update(vendorStaffTable)
    .set(body.data)
    .where(
      and(
        eq(vendorStaffTable.id, params.data.staffId),
        eq(vendorStaffTable.vendorId, params.data.vendorId),
      ),
    )
    .returning();
  if (!row) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  res.json(row);
});

router.delete("/vendors/:vendorId/staff/:staffId", async (req, res): Promise<void> => {
  const params = DeleteVendorStaffParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await vendorExists(params.data.vendorId))) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const deleted = await db
    .delete(vendorStaffTable)
    .where(
      and(
        eq(vendorStaffTable.id, params.data.staffId),
        eq(vendorStaffTable.vendorId, params.data.vendorId),
      ),
    )
    .returning({ id: vendorStaffTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Staff not found" });
    return;
  }
  res.status(204).end();
});

export default router;
