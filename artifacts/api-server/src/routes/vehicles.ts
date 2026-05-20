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
import { getEntitlements } from "../lib/entitlements";
import { requireAuth } from "../lib/auth";

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

// CSV export of completed-service history. Gated by the owner's plan
// (`canExportHistory`) and authorized to the owner (matched on the
// session user's phone) or an admin. Returned as a plain text/csv body
// so the client can stream the download via a regular anchor — kept out
// of OpenAPI/Orval because their binary handling is awkward and the
// route is auth-only anyway.
router.get(
  "/vehicles/:vehicleId/maintenance-history.csv",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = GetVehicleHistoryParams.safeParse(req.params);
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
    const user = req.user!;
    const isAdmin = user.role === "admin" || user.role === "super_admin";
    const isOwner = !!vehicle.ownerPhone && user.phone === vehicle.ownerPhone;
    if (!isAdmin && !isOwner) {
      res.status(403).json({ error: "Not authorized for this vehicle" });
      return;
    }
    if (!isAdmin) {
      const limits = await getEntitlements("owner", vehicle.ownerPhone!);
      if (!limits.canExportHistory) {
        res.status(402).json({
          error: "Maintenance history export requires the Owner Premium plan.",
          reason: "entitlement_required",
        });
        return;
      }
    }
    const completed = await db
      .select()
      .from(bookingsTable)
      .where(
        and(
          eq(bookingsTable.vehicleId, vehicle.id),
          eq(bookingsTable.status, "completed"),
        ),
      )
      .orderBy(desc(bookingsTable.completedAt));
    const centerIds = [...new Set(completed.map((b) => b.serviceCenterId))];
    const invoiceIds = completed
      .map((b) => b.invoiceId)
      .filter((id): id is string => !!id);
    const centers = centerIds.length
      ? await db
          .select()
          .from(serviceCentersTable)
          .where(inArray(serviceCentersTable.id, centerIds))
      : [];
    const invoices = invoiceIds.length
      ? await db
          .select()
          .from(invoicesTable)
          .where(inArray(invoicesTable.id, invoiceIds))
      : [];
    const centerMap = new Map(centers.map((c) => [c.id, c]));
    const invoiceMap = new Map(invoices.map((i) => [i.id, i]));
    // Minimal CSV escaper — wrap any field with comma/quote/newline in
    // quotes and double internal quotes. Avoids pulling in a dependency.
    const esc = (v: unknown): string => {
      if (v == null) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = [
      "completed_at",
      "service_type",
      "description",
      "service_center",
      "invoice_total",
    ].join(",");
    const lines = completed.map((b) => {
      const center = centerMap.get(b.serviceCenterId);
      const invoice = b.invoiceId ? invoiceMap.get(b.invoiceId) : null;
      return [
        b.completedAt?.toISOString() ?? "",
        b.serviceType,
        b.description,
        center?.name ?? "",
        invoice?.total ?? 0,
      ].map(esc).join(",");
    });
    const filename = `${vehicle.plateNumber.replace(/[^A-Za-z0-9_-]/g, "_")}-history.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send([header, ...lines].join("\n"));
  },
);

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
