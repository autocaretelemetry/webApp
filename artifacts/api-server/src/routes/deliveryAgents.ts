import { Router, type IRouter } from "express";
import { and, asc, eq } from "drizzle-orm";
import { db, deliveryAgentsTable } from "@workspace/db";
import {
  GetDeliveryAgentParams,
  ListDeliveryAgentsQueryParams,
  RegisterDeliveryAgentBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

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
  const [row] = await db
    .insert(deliveryAgentsTable)
    .values({
      name: parsed.data.name,
      phone: parsed.data.phone,
      city: parsed.data.city,
      region: parsed.data.region,
      vehicleType: parsed.data.vehicleType,
      bio: parsed.data.bio ?? null,
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

export default router;
