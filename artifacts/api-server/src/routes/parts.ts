import { Router, type IRouter } from "express";
import { and, asc, count, eq, inArray, ilike, or } from "drizzle-orm";
import { db, partsTable, vendorsTable } from "@workspace/db";
import { getEntitlements } from "../lib/entitlements";
import {
  ListPartsForVendorParams,
  CreatePartParams,
  CreatePartBody,
  GetPartParams,
  UpdatePartParams,
  UpdatePartBody,
  ListPartsQueryParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Every parts handler requires a signed-in session. The previously-public
// `/catalog/part-categories` endpoint was moved to `publicCatalog.ts` so
// it can be mounted ahead of the auth gate without leaking parts data.
router.use(requireAuth);

async function hydrate(parts: (typeof partsTable.$inferSelect)[]) {
  if (parts.length === 0) return [];
  const vendorIds = [...new Set(parts.map((p) => p.vendorId))];
  const vendors = await db
    .select()
    .from(vendorsTable)
    .where(inArray(vendorsTable.id, vendorIds));
  const vmap = new Map(vendors.map((v) => [v.id, v]));
  return parts.map((p) => ({ ...p, vendor: vmap.get(p.vendorId) ?? null }));
}

router.get("/parts", async (req, res): Promise<void> => {
  const q = ListPartsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [eq(partsTable.active, true)];
  if (q.data.category) conditions.push(eq(partsTable.category, q.data.category));
  if (q.data.brand) conditions.push(eq(partsTable.brand, q.data.brand));
  if (q.data.search) {
    const s = `%${q.data.search}%`;
    const orExpr = or(
      ilike(partsTable.name, s),
      ilike(partsTable.description, s),
      ilike(partsTable.sku, s),
    );
    if (orExpr) conditions.push(orExpr);
  }
  const rows = await db
    .select()
    .from(partsTable)
    .where(and(...conditions))
    .orderBy(asc(partsTable.name));
  res.json(await hydrate(rows));
});

router.get("/parts/:partId", async (req, res): Promise<void> => {
  const params = GetPartParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(partsTable)
    .where(eq(partsTable.id, params.data.partId));
  if (!row) {
    res.status(404).json({ error: "Part not found" });
    return;
  }
  const [hydrated] = await hydrate([row]);
  res.json(hydrated);
});

router.patch("/parts/:partId", async (req, res): Promise<void> => {
  const params = UpdatePartParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(partsTable)
    .set(parsed.data)
    .where(eq(partsTable.id, params.data.partId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Part not found" });
    return;
  }
  const [hydrated] = await hydrate([row]);
  res.json(hydrated);
});

router.get("/vendors/:vendorId/parts", async (req, res): Promise<void> => {
  const params = ListPartsForVendorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(partsTable)
    .where(eq(partsTable.vendorId, params.data.vendorId))
    .orderBy(asc(partsTable.name));
  res.json(await hydrate(rows));
});

router.post("/vendors/:vendorId/parts", async (req, res): Promise<void> => {
  const params = CreatePartParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vendor] = await db
    .select()
    .from(vendorsTable)
    .where(eq(vendorsTable.id, params.data.vendorId));
  if (!vendor) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  // Quota gate: vendor's plan caps how many parts they can list.
  const vendorLimits = await getEntitlements("vendor", vendor.id);
  if (vendorLimits.maxPartsListed != null) {
    const [{ n }] = await db
      .select({ n: count(partsTable.id) })
      .from(partsTable)
      .where(eq(partsTable.vendorId, vendor.id));
    if (Number(n) >= vendorLimits.maxPartsListed) {
      res.status(402).json({
        error: `Vendor has reached the parts-listing cap (${vendorLimits.maxPartsListed}) for their current plan.`,
        reason: "quota_exceeded",
      });
      return;
    }
  }
  const [row] = await db
    .insert(partsTable)
    .values({
      vendorId: params.data.vendorId,
      name: parsed.data.name,
      description: parsed.data.description,
      category: parsed.data.category,
      brand: parsed.data.brand,
      sku: parsed.data.sku,
      price: parsed.data.price,
      stock: parsed.data.stock,
      imageUrl: parsed.data.imageUrl ?? null,
      compatibleBrands: parsed.data.compatibleBrands ?? [],
    })
    .returning();
  const [hydrated] = await hydrate([row]);
  res.status(201).json(hydrated);
});

export default router;
