import { Router, type IRouter } from "express";
import { eq, and, desc, count } from "drizzle-orm";
import {
  db,
  subscriptionPlansTable,
  subscriptionsTable,
  subscriptionPaymentsTable,
} from "@workspace/db";
import {
  ListSubscriptionPlansQueryParams,
  CreateSubscriptionPlanBody,
  UpdateSubscriptionPlanParams,
  UpdateSubscriptionPlanBody,
  DeleteSubscriptionPlanParams,
  ListSubscriptionsQueryParams,
  CreateSubscriptionBody,
  UpdateSubscriptionParams,
  UpdateSubscriptionBody,
  DeleteSubscriptionParams,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// Subscription plans + active subscriptions are signed-in concerns
// (owners/centers/vendors managing their own plan, admins managing the
// catalog). Plan pricing on the public landing page is hand-curated copy
// and does not hit this router.
router.use(requireAuth);

// ───── Plans ─────

router.get("/subscription-plans", async (req, res): Promise<void> => {
  const q = ListSubscriptionPlansQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.audience) conditions.push(eq(subscriptionPlansTable.audience, q.data.audience));
  if (!q.data.includeInactive) conditions.push(eq(subscriptionPlansTable.active, true));
  const rows = await db
    .select()
    .from(subscriptionPlansTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(subscriptionPlansTable.audience, subscriptionPlansTable.priceMonthly);
  res.json(rows);
});

router.post("/subscription-plans", async (req, res): Promise<void> => {
  const body = CreateSubscriptionPlanBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [row] = await db
    .insert(subscriptionPlansTable)
    .values({
      name: body.data.name,
      audience: body.data.audience,
      priceMonthly: body.data.priceMonthly,
      features: body.data.features ?? [],
      ...(body.data.limits ? { limits: body.data.limits } : {}),
    })
    .returning();
  res.status(201).json(row);
});

router.patch("/subscription-plans/:planId", async (req, res): Promise<void> => {
  const params = UpdateSubscriptionPlanParams.safeParse(req.params);
  const body = UpdateSubscriptionPlanBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [row] = await db
    .update(subscriptionPlansTable)
    .set(body.data)
    .where(eq(subscriptionPlansTable.id, params.data.planId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  res.json(row);
});

router.delete("/subscription-plans/:planId", async (req, res): Promise<void> => {
  const params = DeleteSubscriptionPlanParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [{ n }] = await db
    .select({ n: count(subscriptionsTable.id) })
    .from(subscriptionsTable)
    .where(
      and(
        eq(subscriptionsTable.planId, params.data.planId),
        eq(subscriptionsTable.status, "active"),
      ),
    );
  if (Number(n) > 0) {
    res.status(409).json({
      error: "Plan has active subscribers",
      reason: "has_dependents",
      details: `${n} active subscriber(s) still on this plan. Move them off the plan first.`,
    });
    return;
  }
  await db
    .delete(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, params.data.planId));
  res.status(204).end();
});

// ───── Subscriptions ─────

async function hydrateSubs(rows: (typeof subscriptionsTable.$inferSelect)[]) {
  if (rows.length === 0) return [];
  const plans = await db.select().from(subscriptionPlansTable);
  const planMap = new Map(plans.map((p) => [p.id, p]));
  return rows.map((s) => {
    const plan = s.planId ? planMap.get(s.planId) : undefined;
    return {
      ...s,
      planName: plan?.name ?? null,
      priceMonthly: plan?.priceMonthly ?? null,
    };
  });
}

router.get("/subscriptions", async (req, res): Promise<void> => {
  const q = ListSubscriptionsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.status) conditions.push(eq(subscriptionsTable.status, q.data.status));
  if (q.data.subscriberKind)
    conditions.push(eq(subscriptionsTable.subscriberKind, q.data.subscriberKind));
  const rows = await db
    .select()
    .from(subscriptionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(subscriptionsTable.createdAt));
  res.json(await hydrateSubs(rows));
});

router.post("/subscriptions", async (req, res): Promise<void> => {
  const body = CreateSubscriptionBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [plan] = await db
    .select()
    .from(subscriptionPlansTable)
    .where(eq(subscriptionPlansTable.id, body.data.planId));
  if (!plan) {
    res.status(404).json({ error: "Plan not found" });
    return;
  }
  if (plan.audience !== body.data.subscriberKind) {
    res.status(400).json({
      error: `Plan "${plan.name}" is for ${plan.audience}s, not ${body.data.subscriberKind}s.`,
    });
    return;
  }
  const periodEnd = new Date();
  periodEnd.setMonth(periodEnd.getMonth() + 1);
  const [sub] = await db
    .insert(subscriptionsTable)
    .values({
      subscriberKind: body.data.subscriberKind,
      subscriberId: body.data.subscriberId,
      subscriberName: body.data.subscriberName,
      planId: plan.id,
      status: "active",
      currentPeriodEnd: periodEnd,
    })
    .returning();
  await db.insert(subscriptionPaymentsTable).values({
    subscriptionId: sub.id,
    amount: plan.priceMonthly,
    paidAt: new Date(),
  });
  const [hydrated] = await hydrateSubs([sub]);
  res.status(201).json(hydrated);
});

router.patch("/subscriptions/:subscriptionId", async (req, res): Promise<void> => {
  const params = UpdateSubscriptionParams.safeParse(req.params);
  const body = UpdateSubscriptionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.error ?? body.error)?.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(subscriptionsTable)
    .where(eq(subscriptionsTable.id, params.data.subscriptionId));
  if (!existing) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  const patch: Partial<typeof subscriptionsTable.$inferInsert> = {};
  if (body.data.planId) {
    const [plan] = await db
      .select()
      .from(subscriptionPlansTable)
      .where(eq(subscriptionPlansTable.id, body.data.planId));
    if (!plan) {
      res.status(404).json({ error: "Plan not found" });
      return;
    }
    if (!plan.active) {
      res.status(400).json({ error: `Plan "${plan.name}" is archived.` });
      return;
    }
    if (plan.audience !== existing.subscriberKind) {
      res.status(400).json({
        error: `Plan "${plan.name}" is for ${plan.audience}s, but this subscriber is a ${existing.subscriberKind}.`,
      });
      return;
    }
    patch.planId = body.data.planId;
  }
  if (body.data.status) {
    patch.status = body.data.status;
    if (body.data.status === "cancelled") {
      patch.cancelledAt = new Date();
    } else {
      patch.cancelledAt = null;
    }
  }
  const [row] = await db
    .update(subscriptionsTable)
    .set(patch)
    .where(eq(subscriptionsTable.id, params.data.subscriptionId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Subscription not found" });
    return;
  }
  const [hydrated] = await hydrateSubs([row]);
  res.json(hydrated);
});

router.delete("/subscriptions/:subscriptionId", async (req, res): Promise<void> => {
  const params = DeleteSubscriptionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  await db
    .delete(subscriptionsTable)
    .where(eq(subscriptionsTable.id, params.data.subscriptionId));
  res.status(204).end();
});

export default router;
