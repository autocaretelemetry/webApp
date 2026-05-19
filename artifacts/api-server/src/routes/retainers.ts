import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  retainerPlansTable,
  retainersTable,
  serviceCentersTable,
} from "@workspace/db";
import {
  ListRetainerPlansParams,
  CreateRetainerPlanParams,
  CreateRetainerPlanBody,
  UpdateRetainerPlanParams,
  UpdateRetainerPlanBody,
  DeleteRetainerPlanParams,
  ListRetainersQueryParams,
  CreateRetainerBody,
  UpdateRetainerParams,
  UpdateRetainerBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

const CADENCE_ORDER: Record<string, number> = { monthly: 0, quarterly: 1, annual: 2 };

function nextPeriodEnd(cadence: string, from: Date = new Date()): Date {
  const end = new Date(from);
  if (cadence === "monthly") end.setMonth(end.getMonth() + 1);
  else if (cadence === "quarterly") end.setMonth(end.getMonth() + 3);
  else if (cadence === "annual") end.setFullYear(end.getFullYear() + 1);
  else throw new Error(`Unknown cadence: ${cadence}`);
  return end;
}

// ---------- Retainer plans (per service center) ----------

router.get("/service-centers/:centerId/retainer-plans", async (req, res): Promise<void> => {
  const params = ListRetainerPlansParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(retainerPlansTable)
    .where(eq(retainerPlansTable.serviceCenterId, params.data.centerId))
    .orderBy(retainerPlansTable.price);
  rows.sort((a, b) => (CADENCE_ORDER[a.cadence] ?? 9) - (CADENCE_ORDER[b.cadence] ?? 9));
  res.json(rows);
});

router.post("/service-centers/:centerId/retainer-plans", async (req, res): Promise<void> => {
  const params = CreateRetainerPlanParams.safeParse(req.params);
  const body = CreateRetainerPlanBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  // Each center can only offer one plan per cadence — a second monthly plan
  // would be ambiguous for owners and break price snapshots on re-subscribe.
  const existing = await db
    .select()
    .from(retainerPlansTable)
    .where(
      and(
        eq(retainerPlansTable.serviceCenterId, params.data.centerId),
        eq(retainerPlansTable.cadence, body.data.cadence),
      ),
    );
  if (existing.length > 0) {
    res
      .status(409)
      .json({ error: `A ${body.data.cadence} plan already exists for this center.` });
    return;
  }
  try {
    const [row] = await db
      .insert(retainerPlansTable)
      .values({
        serviceCenterId: params.data.centerId,
        cadence: body.data.cadence,
        price: body.data.price,
        perks: body.data.perks ?? [],
        active: body.data.active ?? true,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res
        .status(409)
        .json({ error: `A ${body.data.cadence} plan already exists for this center.` });
      return;
    }
    throw err;
  }
});

router.patch("/retainer-plans/:planId", async (req, res): Promise<void> => {
  const params = UpdateRetainerPlanParams.safeParse(req.params);
  const body = UpdateRetainerPlanBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db
    .update(retainerPlansTable)
    .set(body.data)
    .where(eq(retainerPlansTable.id, params.data.planId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Retainer plan not found" });
    return;
  }
  res.json(row);
});

router.delete("/retainer-plans/:planId", async (req, res): Promise<void> => {
  const params = DeleteRetainerPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db.delete(retainerPlansTable).where(eq(retainerPlansTable.id, params.data.planId));
  res.status(204).end();
});

// ---------- Retainers (owner ↔ center agreements) ----------

router.get("/retainers", async (req, res): Promise<void> => {
  const q = ListRetainersQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const filters = [];
  if (q.data.ownerPhone) filters.push(eq(retainersTable.ownerPhone, q.data.ownerPhone));
  if (q.data.serviceCenterId)
    filters.push(eq(retainersTable.serviceCenterId, q.data.serviceCenterId));
  if (q.data.status) filters.push(eq(retainersTable.status, q.data.status));

  const rows = await db
    .select({
      retainer: retainersTable,
      serviceCenterName: serviceCentersTable.name,
    })
    .from(retainersTable)
    .leftJoin(
      serviceCentersTable,
      eq(retainersTable.serviceCenterId, serviceCentersTable.id),
    )
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(retainersTable.createdAt));

  res.json(rows.map((r) => ({ ...r.retainer, serviceCenterName: r.serviceCenterName })));
});

router.post("/retainers", async (req, res): Promise<void> => {
  const body = CreateRetainerBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const [plan] = await db
    .select()
    .from(retainerPlansTable)
    .where(eq(retainerPlansTable.id, body.data.planId));
  if (!plan || plan.serviceCenterId !== body.data.serviceCenterId || !plan.active) {
    res.status(400).json({ error: "Selected plan is not available." });
    return;
  }

  // Block double-subscription to the same center; the owner can still take
  // pay-as-you-go services elsewhere — that's a separate booking flow and
  // not gated by this check.
  const existing = await db
    .select()
    .from(retainersTable)
    .where(
      and(
        eq(retainersTable.ownerPhone, body.data.ownerPhone),
        eq(retainersTable.serviceCenterId, body.data.serviceCenterId),
        eq(retainersTable.status, "active"),
      ),
    );
  if (existing.length > 0) {
    res.status(409).json({
      error: "You already have an active retainer with this service center.",
    });
    return;
  }

  try {
    const [row] = await db
      .insert(retainersTable)
      .values({
        serviceCenterId: body.data.serviceCenterId,
        planId: plan.id,
        ownerName: body.data.ownerName,
        ownerPhone: body.data.ownerPhone,
        cadence: plan.cadence,
        price: plan.price,
        status: "active",
        currentPeriodEnd: nextPeriodEnd(plan.cadence),
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      res.status(409).json({
        error: "You already have an active retainer with this service center.",
      });
      return;
    }
    throw err;
  }
});

router.patch("/retainers/:retainerId", async (req, res): Promise<void> => {
  const params = UpdateRetainerParams.safeParse(req.params);
  const body = UpdateRetainerBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }

  const [current] = await db
    .select()
    .from(retainersTable)
    .where(eq(retainersTable.id, params.data.retainerId));
  if (!current) {
    res.status(404).json({ error: "Retainer not found" });
    return;
  }

  // Reactivating a cancelled/expired retainer must respect the same
  // single-active-per-(owner,center) invariant the POST enforces, otherwise
  // a client could flip status back to "active" and bypass it.
  if (body.data.status === "active" && current.status !== "active") {
    const conflict = await db
      .select({ id: retainersTable.id })
      .from(retainersTable)
      .where(
        and(
          eq(retainersTable.ownerPhone, current.ownerPhone),
          eq(retainersTable.serviceCenterId, current.serviceCenterId),
          eq(retainersTable.status, "active"),
        ),
      );
    if (conflict.length > 0) {
      res.status(409).json({
        error: "An active retainer already exists for this owner and center.",
      });
      return;
    }
  }

  const patch: Partial<typeof retainersTable.$inferInsert> = { ...body.data };
  if (body.data.status === "cancelled") patch.cancelledAt = new Date();
  if (body.data.status === "active") patch.cancelledAt = null;

  try {
    const [row] = await db
      .update(retainersTable)
      .set(patch)
      .where(eq(retainersTable.id, params.data.retainerId))
      .returning();
    res.json(row);
  } catch (err) {
    // Backstop in case the partial unique index trips between the check above
    // and the update (concurrent writers).
    if (isUniqueViolation(err)) {
      res.status(409).json({
        error: "An active retainer already exists for this owner and center.",
      });
      return;
    }
    throw err;
  }
});

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "23505"
  );
}

export default router;
