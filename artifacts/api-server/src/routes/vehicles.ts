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
import PDFDocument from "pdfkit";
import { computeReminders } from "../lib/reminders";
import { getEntitlements } from "../lib/entitlements";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

// All vehicle routes carry owner PII (name, phone, plate) and per-vehicle
// service history. Nothing here is meant to be reachable anonymously, so
// gate the whole router up front rather than per-handler.
router.use(requireAuth);

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

// Maintenance-history export. One route, two formats negotiated via the
// file-extension suffix (`.csv` | `.pdf`). Gated by the owner's plan
// (`canExportHistory`) and authorized to the owner (matched on the
// session user's phone) or an admin. Kept out of OpenAPI/Orval because
// their binary/csv handling is awkward and the route is auth-only.
const maintenanceHistoryHandler = (format: "csv" | "pdf") =>
  async (req: import("express").Request, res: import("express").Response): Promise<void> => {
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
    const safePlate = vehicle.plateNumber.replace(/[^A-Za-z0-9_-]/g, "_");

    if (format === "csv") {
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
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safePlate}-history.csv"`,
      );
      res.send([header, ...lines].join("\n"));
      return;
    }

    // PDF: stream pdfkit straight into the response. Uses the bundled
    // Helvetica font (no font assets needed). Layout is intentionally
    // simple — title, vehicle metadata, then one block per completed job.
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safePlate}-history.pdf"`,
    );
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    doc.pipe(res);
    doc.fillColor("#1a1a1a").fontSize(20).text("Maintenance History", { align: "left" });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .fillColor("#555")
      .text(`${vehicle.year} ${vehicle.brand} ${vehicle.model}  -  Plate ${vehicle.plateNumber}`);
    doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`);
    doc.moveDown(0.8);
    doc
      .strokeColor("#cccccc")
      .lineWidth(1)
      .moveTo(doc.x, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .stroke();
    doc.moveDown(0.5);

    if (completed.length === 0) {
      doc.fillColor("#555").fontSize(12).text("No completed services on record.");
    } else {
      for (const b of completed) {
        const center = centerMap.get(b.serviceCenterId);
        const invoice = b.invoiceId ? invoiceMap.get(b.invoiceId) : null;
        const date = b.completedAt
          ? b.completedAt.toISOString().slice(0, 10)
          : "Unknown date";
        doc
          .fillColor("#1a1a1a")
          .fontSize(13)
          .text(`${b.serviceType}`, { continued: true })
          .fillColor("#888")
          .text(`   ${date}`);
        doc.fontSize(10).fillColor("#555").text(center?.name ?? "Unknown center");
        doc.fontSize(11).fillColor("#1a1a1a").text(b.description, { paragraphGap: 4 });
        doc
          .fontSize(11)
          .fillColor("#1a1a1a")
          .text(`Invoice total: ${invoice?.total ?? 0}`);
        doc.moveDown(0.8);
      }
    }
    doc.end();
  };

// Two routes share one handler. Express 5's path-to-regexp doesn't
// allow `:format(csv|pdf)` inline regex on params, so we register the
// extensions explicitly.
router.get(
  "/vehicles/:vehicleId/maintenance-history.csv",
  requireAuth,
  maintenanceHistoryHandler("csv"),
);
router.get(
  "/vehicles/:vehicleId/maintenance-history.pdf",
  requireAuth,
  maintenanceHistoryHandler("pdf"),
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
