import { Router, type IRouter } from "express";
import { eq, count, inArray } from "drizzle-orm";
import { db, vendorsTable, partsTable } from "@workspace/db";
import { GetVendorParams } from "@workspace/api-zod";

const router: IRouter = Router();

async function hydrate(vendors: (typeof vendorsTable.$inferSelect)[]) {
  if (vendors.length === 0) return [];
  const ids = vendors.map((v) => v.id);
  const counts = await db
    .select({ vendorId: partsTable.vendorId, n: count(partsTable.id) })
    .from(partsTable)
    .where(inArray(partsTable.vendorId, ids))
    .groupBy(partsTable.vendorId);
  const countMap = new Map(counts.map((c) => [c.vendorId, Number(c.n)]));
  return vendors.map((v) => ({ ...v, partsCount: countMap.get(v.id) ?? 0 }));
}

router.get("/vendors", async (_req, res): Promise<void> => {
  const rows = await db.select().from(vendorsTable).orderBy(vendorsTable.name);
  res.json(await hydrate(rows));
});

router.get("/vendors/:vendorId", async (req, res): Promise<void> => {
  const params = GetVendorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, params.data.vendorId));
  if (!row) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const [hydrated] = await hydrate([row]);
  res.json(hydrated);
});

export default router;
