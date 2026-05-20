import { Router, type IRouter } from "express";
import { eq, count, inArray, and } from "drizzle-orm";
import { db, vendorsTable, partsTable, ordersTable } from "@workspace/db";
import { featuredSubscriberIds } from "../lib/entitlements";
import {
  GetVendorParams,
  ListVendorsQueryParams,
  UpdateVendorBody,
  UpdateVendorParams,
  DeleteVendorParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Vendor directory + admin mutations all require a signed-in session.
// The public landing page does not call any of these endpoints.
router.use(requireAuth);

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

router.get("/vendors", async (req, res): Promise<void> => {
  const q = ListVendorsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const nearCity = q.data.nearCity?.trim().toLowerCase() ?? "";
  const nearRegion = q.data.nearRegion?.trim().toLowerCase() ?? "";
  // Buyers should never see suspended vendors; admin pages opt in via
  // `includeInactive=true` so the directory can show every record.
  const includeInactive = req.query.includeInactive === "true";
  const rows = await db
    .select()
    .from(vendorsTable)
    .where(includeInactive ? undefined : eq(vendorsTable.active, true))
    .orderBy(vendorsTable.name);
  // Featured placement first (subscription entitlement), then proximity:
  // same city, then same region, then everywhere else; stable by name
  // within each tier.
  const featured = await featuredSubscriberIds("vendor", rows.map((r) => r.id));
  const tiered = rows
    .map((v, idx) => {
      const sameCity = nearCity && v.city.toLowerCase() === nearCity;
      const sameRegion = nearRegion && v.region.toLowerCase() === nearRegion;
      const tier = sameCity ? 0 : sameRegion ? 1 : 2;
      return { v, tier, idx, featured: featured.has(v.id) };
    })
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return a.tier - b.tier || a.idx - b.idx;
    })
    .map((x) => ({ ...x.v, featured: x.featured }));
  res.json(await hydrate(tiered));
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

router.patch("/vendors/:vendorId", async (req, res): Promise<void> => {
  const params = UpdateVendorParams.safeParse(req.params);
  const body = UpdateVendorBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res
      .status(400)
      .json({ error: (params.success ? body : params).error!.message });
    return;
  }
  const [row] = await db
    .update(vendorsTable)
    .set({ active: body.data.active })
    .where(eq(vendorsTable.id, params.data.vendorId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  const [hydrated] = await hydrate([row]);
  res.json(hydrated);
});

router.delete("/vendors/:vendorId", async (req, res): Promise<void> => {
  const params = DeleteVendorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // Block hard-delete if the vendor has any parts or orders — those are the
  // historical records buyers and the platform rely on. Admin should suspend.
  const [partsRow] = await db
    .select({ n: count() })
    .from(partsTable)
    .where(eq(partsTable.vendorId, params.data.vendorId));
  const [ordersRow] = await db
    .select({ n: count() })
    .from(ordersTable)
    .where(eq(ordersTable.vendorId, params.data.vendorId));
  const partsN = Number(partsRow?.n ?? 0);
  const ordersN = Number(ordersRow?.n ?? 0);
  if (partsN > 0 || ordersN > 0) {
    res.status(409).json({
      error: "Vendor has dependent records",
      reason: "has_dependents",
      details: `${partsN} part(s) and ${ordersN} order(s) reference this vendor. Suspend instead.`,
    });
    return;
  }
  const deleted = await db
    .delete(vendorsTable)
    .where(eq(vendorsTable.id, params.data.vendorId))
    .returning({ id: vendorsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Vendor not found" });
    return;
  }
  res.status(204).end();
});

export default router;
