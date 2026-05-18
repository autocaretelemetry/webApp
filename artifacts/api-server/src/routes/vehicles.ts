import { Router, type IRouter } from "express";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  bookingsTable,
  invoicesTable,
  serviceCentersTable,
  mechanicsTable,
} from "@workspace/db";
import {
  CreateVehicleBody,
  GetVehicleParams,
  UpdateVehicleParams,
  UpdateVehicleBody,
  DeleteVehicleParams,
  GetVehicleHistoryParams,
  GetVehicleRemindersParams,
} from "@workspace/api-zod";
import { computeReminders } from "../lib/reminders";

const router: IRouter = Router();

router.get("/vehicles", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(vehiclesTable)
    .orderBy(desc(vehiclesTable.createdAt));
  res.json(rows);
});

router.post("/vehicles", async (req, res): Promise<void> => {
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(vehiclesTable).values(parsed.data).returning();
  res.status(201).json(row);
});

router.get("/vehicles/:vehicleId", async (req, res): Promise<void> => {
  const params = GetVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, params.data.vehicleId));
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(row);
});

router.patch("/vehicles/:vehicleId", async (req, res): Promise<void> => {
  const params = UpdateVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .update(vehiclesTable)
    .set(parsed.data)
    .where(eq(vehiclesTable.id, params.data.vehicleId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.json(row);
});

router.delete("/vehicles/:vehicleId", async (req, res): Promise<void> => {
  const params = DeleteVehicleParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .delete(vehiclesTable)
    .where(eq(vehiclesTable.id, params.data.vehicleId))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Vehicle not found" });
    return;
  }
  res.sendStatus(204);
});

router.get("/vehicles/:vehicleId/history", async (req, res): Promise<void> => {
  const params = GetVehicleHistoryParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const completed = await db
    .select()
    .from(bookingsTable)
    .where(
      and(
        eq(bookingsTable.vehicleId, params.data.vehicleId),
        eq(bookingsTable.status, "completed"),
      ),
    )
    .orderBy(desc(bookingsTable.completedAt));

  if (completed.length === 0) {
    res.json([]);
    return;
  }

  const centerIds = [...new Set(completed.map((b) => b.serviceCenterId))];
  const mechanicIds = completed
    .map((b) => b.mechanicId)
    .filter((id): id is string => !!id);
  const invoiceIds = completed
    .map((b) => b.invoiceId)
    .filter((id): id is string => !!id);

  const centers = centerIds.length
    ? await db
        .select()
        .from(serviceCentersTable)
        .where(inArray(serviceCentersTable.id, centerIds))
    : [];
  const mechanics = mechanicIds.length
    ? await db
        .select()
        .from(mechanicsTable)
        .where(inArray(mechanicsTable.id, mechanicIds))
    : [];
  const invoices = invoiceIds.length
    ? await db
        .select()
        .from(invoicesTable)
        .where(inArray(invoicesTable.id, invoiceIds))
    : [];

  const centerMap = new Map(centers.map((c) => [c.id, c]));
  const mechanicMap = new Map(mechanics.map((m) => [m.id, m]));
  const invoiceMap = new Map(invoices.map((i) => [i.id, i]));

  const records = completed.map((b) => {
    const center = centerMap.get(b.serviceCenterId);
    const mechanic = b.mechanicId ? mechanicMap.get(b.mechanicId) : null;
    const invoice = b.invoiceId ? invoiceMap.get(b.invoiceId) : null;
    return {
      id: b.id,
      vehicleId: b.vehicleId,
      serviceType: b.serviceType,
      summary: b.description,
      totalCost: invoice?.total ?? 0,
      completedAt: b.completedAt,
      serviceCenterName: center?.name ?? "Unknown",
      mechanicName: mechanic?.name ?? null,
      mileageAtService: null,
    };
  });

  res.json(records);
});

router.get(
  "/vehicles/:vehicleId/reminders",
  async (req, res): Promise<void> => {
    const params = GetVehicleRemindersParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [vehicle] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, params.data.vehicleId));
    if (!vehicle) {
      res.status(404).json({ error: "Vehicle not found" });
      return;
    }
    res.json(computeReminders(vehicle));
  },
);

export default router;
