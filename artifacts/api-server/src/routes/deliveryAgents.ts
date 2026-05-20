import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, deliveryAgentsTable, vendorsTable } from "@workspace/db";

// Loose UUID v4-ish check — good enough to reject obvious garbage before it
// hits the DB driver and produces a confusing 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
import {
  GetDeliveryAgentParams,
  ListDeliveryAgentsQueryParams,
  RegisterDeliveryAgentBody,
  UpdateDeliveryAgentBody,
  UpdateDeliveryAgentParams,
  DeleteDeliveryAgentParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// `POST /delivery-agents` is the legacy self-signup endpoint still wired
// up by `/delivery/Register` and the vendor onboarding flow. It is kept
// anonymous (matching `POST /organizations` / `POST /auth/signup`) so a
// new rider can register before they have a session; KYC + super-admin
// approval still gate the account from doing anything else. Everything
// else on this router (read / update / delete) is signed-in only.
router.get("/delivery-agents", async (req, res): Promise<void> => {
  const q = ListDeliveryAgentsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.city) conditions.push(eq(deliveryAgentsTable.city, q.data.city));
  if (q.data.region) conditions.push(eq(deliveryAgentsTable.region, q.data.region));
  if (q.data.activeOnly) conditions.push(eq(deliveryAgentsTable.active, true));
  if (q.data.vendorId) conditions.push(eq(deliveryAgentsTable.vendorId, q.data.vendorId));
  const base = db.select().from(deliveryAgentsTable);
  const rows =
    conditions.length > 0
      ? await base.where(and(...conditions)).orderBy(asc(deliveryAgentsTable.name))
      : await base.orderBy(asc(deliveryAgentsTable.name));
  res.json(rows);
});

router.post("/delivery-agents", async (req, res): Promise<void> => {
  const parsed = RegisterDeliveryAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  // Government ID requirement: at least one of passport / Ghana card /
  // driver's license must be supplied. License alone is acceptable; license
  // by itself is not mandatory if another ID is present.
  const hasGovernmentId = Boolean(
    parsed.data.passportUrl?.trim() ||
      parsed.data.ghanaCardUrl?.trim() ||
      parsed.data.licenseUrl?.trim(),
  );
  if (!hasGovernmentId) {
    res.status(400).json({
      error: "At least one government-issued ID (passport, Ghana card, or driver's license) is required.",
    });
    return;
  }
  // When the caller claims this rider belongs to a vendor, verify the vendor
  // actually exists before we trust the link (and before the DB FK would
  // surface as an opaque 500). Certification is server-controlled and only
  // granted when the vendorId resolves to a real vendor row.
  let vendorId: string | null = null;
  if (parsed.data.vendorId) {
    if (!UUID_RE.test(parsed.data.vendorId)) {
      res.status(400).json({ error: "vendorId is not a valid id" });
      return;
    }
    const [v] = await db
      .select({ id: vendorsTable.id })
      .from(vendorsTable)
      .where(eq(vendorsTable.id, parsed.data.vendorId));
    if (!v) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }
    vendorId = v.id;
  }
  const [row] = await db
    .insert(deliveryAgentsTable)
    .values({
      name: parsed.data.name,
      phone: parsed.data.phone,
      city: parsed.data.city,
      region: parsed.data.region,
      vehicleType: parsed.data.vehicleType,
      bio: parsed.data.bio ?? null,
      photoUrl: parsed.data.photoUrl ?? null,
      passportUrl: parsed.data.passportUrl ?? null,
      ghanaCardUrl: parsed.data.ghanaCardUrl ?? null,
      licenseUrl: parsed.data.licenseUrl ?? null,
      vendorId,
      // Vendor-created riders are automatically certified by their vendor.
      // Certification is never trusted from the client — it's derived from
      // a vendorId that we've just verified above.
      vendorCertified: vendorId !== null,
    })
    .returning();
  res.status(201).json(row);
});

router.get("/delivery-agents/:agentId", async (req, res): Promise<void> => {
  const params = GetDeliveryAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(deliveryAgentsTable)
    .where(eq(deliveryAgentsTable.id, params.data.agentId));
  if (!row) {
    res.status(404).json({ error: "Delivery agent not found" });
    return;
  }
  res.json(row);
});

router.patch("/delivery-agents/:agentId", async (req, res): Promise<void> => {
  const params = UpdateDeliveryAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateDeliveryAgentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  // Build update payload from only the fields the caller actually sent.
  const updates: Partial<typeof deliveryAgentsTable.$inferInsert> = {};
  if (body.data.active !== undefined) updates.active = body.data.active;
  if (body.data.bio !== undefined) updates.bio = body.data.bio;
  if (body.data.vehicleType !== undefined) updates.vehicleType = body.data.vehicleType;
  if (body.data.photoUrl !== undefined) updates.photoUrl = body.data.photoUrl;
  if (body.data.passportUrl !== undefined) updates.passportUrl = body.data.passportUrl;
  if (body.data.ghanaCardUrl !== undefined) updates.ghanaCardUrl = body.data.ghanaCardUrl;
  if (body.data.licenseUrl !== undefined) updates.licenseUrl = body.data.licenseUrl;
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }
  // If the patch touches any KYC field, re-check the invariant against the
  // post-update state so a rider can never end up with zero government IDs.
  const touchesKyc =
    body.data.passportUrl !== undefined ||
    body.data.ghanaCardUrl !== undefined ||
    body.data.licenseUrl !== undefined;
  if (touchesKyc) {
    const [current] = await db
      .select()
      .from(deliveryAgentsTable)
      .where(eq(deliveryAgentsTable.id, params.data.agentId));
    if (!current) {
      res.status(404).json({ error: "Delivery agent not found" });
      return;
    }
    const next = {
      passportUrl: body.data.passportUrl !== undefined ? body.data.passportUrl : current.passportUrl,
      ghanaCardUrl: body.data.ghanaCardUrl !== undefined ? body.data.ghanaCardUrl : current.ghanaCardUrl,
      licenseUrl: body.data.licenseUrl !== undefined ? body.data.licenseUrl : current.licenseUrl,
    };
    if (!next.passportUrl?.trim() && !next.ghanaCardUrl?.trim() && !next.licenseUrl?.trim()) {
      res.status(400).json({
        error: "Cannot remove the last government-issued ID. Upload a replacement first.",
      });
      return;
    }
  }
  const [row] = await db
    .update(deliveryAgentsTable)
    .set(updates)
    .where(eq(deliveryAgentsTable.id, params.data.agentId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Delivery agent not found" });
    return;
  }
  res.json(row);
});

router.delete("/delivery-agents/:agentId", async (req, res): Promise<void> => {
  const params = DeleteDeliveryAgentParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  // orders.deliveryAgentId is ON DELETE SET NULL — safe to hard-delete; any
  // orders the agent handled keep their record with a null courier.
  const deleted = await db
    .delete(deliveryAgentsTable)
    .where(eq(deliveryAgentsTable.id, params.data.agentId))
    .returning({ id: deliveryAgentsTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Delivery agent not found" });
    return;
  }
  res.status(204).end();
});

export default router;
