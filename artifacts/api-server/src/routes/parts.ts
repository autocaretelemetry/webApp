import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, asc, count, eq, inArray, ilike, isNull, isNotNull, or } from "drizzle-orm";
import {
  db,
  partsTable,
  vendorsTable,
  serviceCentersTable,
  centerStaffTable,
} from "@workspace/db";
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

router.use(requireAuth);

/**
 * Authorize the caller as staff (or platform admin) of the given service
 * center. Center-shop part CRUD is gated through this — never trust the
 * centerId from the request body alone.
 */
async function authorizeCenterStaff(
  req: Request,
  res: Response,
  centerId: string,
): Promise<boolean> {
  const role = req.user?.role;
  if (role === "admin" || role === "super_admin") return true;
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  const [row] = await db
    .select({ id: centerStaffTable.id })
    .from(centerStaffTable)
    .where(
      and(
        eq(centerStaffTable.userId, userId),
        eq(centerStaffTable.centerId, centerId),
        eq(centerStaffTable.active, true),
      ),
    );
  if (!row) {
    res.status(403).json({ error: "Not a member of this service center" });
    return false;
  }
  return true;
}

async function hydrate(parts: (typeof partsTable.$inferSelect)[]) {
  if (parts.length === 0) return [];
  const vendorIds = [
    ...new Set(parts.map((p) => p.vendorId).filter((v): v is string => !!v)),
  ];
  const centerIds = [
    ...new Set(parts.map((p) => p.centerId).filter((v): v is string => !!v)),
  ];
  const [vendors, centers] = await Promise.all([
    vendorIds.length
      ? db.select().from(vendorsTable).where(inArray(vendorsTable.id, vendorIds))
      : Promise.resolve([] as (typeof vendorsTable.$inferSelect)[]),
    centerIds.length
      ? db
          .select()
          .from(serviceCentersTable)
          .where(inArray(serviceCentersTable.id, centerIds))
      : Promise.resolve([] as (typeof serviceCentersTable.$inferSelect)[]),
  ]);
  const vmap = new Map(vendors.map((v) => [v.id, v]));
  const cmap = new Map(centers.map((c) => [c.id, c]));
  return parts.map((p) => ({
    ...p,
    vendor: p.vendorId ? (vmap.get(p.vendorId) ?? null) : null,
    sellerCenter: p.centerId ? (cmap.get(p.centerId) ?? null) : null,
  }));
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
  // Authorize as vendor staff OR center staff depending on which side
  // owns the part. Platform admins always pass.
  const [existing] = await db
    .select()
    .from(partsTable)
    .where(eq(partsTable.id, params.data.partId));
  if (!existing) {
    res.status(404).json({ error: "Part not found" });
    return;
  }
  if (existing.centerId) {
    const ok = await authorizeCenterStaff(req, res, existing.centerId);
    if (!ok) return;
  }
  // (Vendor-owned parts retain the prior implicit "any-vendor" model used
  // throughout this codebase — gated by requireAuth.)
  const [row] = await db
    .update(partsTable)
    .set(parsed.data)
    .where(eq(partsTable.id, params.data.partId))
    .returning();
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

// ───────── Service center "on-hand shop" parts ─────────
// Plain Express + Zod, intentionally outside the OpenAPI surface (like
// the fleet endpoints). Sold-from-own-shop parts skip the delivery
// workflow when ordered (see routes/orders.ts).

const CenterPartParams = z.object({ centerId: z.string().uuid() });

router.get("/service-centers/:centerId/parts", async (req, res): Promise<void> => {
  const params = CenterPartParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const ok = await authorizeCenterStaff(req, res, params.data.centerId);
  if (!ok) return;
  const rows = await db
    .select()
    .from(partsTable)
    .where(eq(partsTable.centerId, params.data.centerId))
    .orderBy(asc(partsTable.name));
  res.json(await hydrate(rows));
});

router.post("/service-centers/:centerId/parts", async (req, res): Promise<void> => {
  const params = CenterPartParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreatePartBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [center] = await db
    .select()
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, params.data.centerId));
  if (!center) {
    res.status(404).json({ error: "Service center not found" });
    return;
  }
  const ok = await authorizeCenterStaff(req, res, params.data.centerId);
  if (!ok) return;
  const [row] = await db
    .insert(partsTable)
    .values({
      vendorId: null,
      centerId: params.data.centerId,
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

// Silence unused-import warnings — these are used in orders.ts patterns but
// imported here for symmetry with the original module.
void isNull;
void isNotNull;

export default router;
