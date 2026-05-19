import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  bookingsTable,
  bookingEventsTable,
  invoicesTable,
  vehiclesTable,
} from "@workspace/db";
import {
  CreateInvoiceBody,
  CreateInvoiceParams,
  GetInvoiceParams,
  ApproveInvoiceParams,
  PayInvoiceParams,
} from "@workspace/api-zod";
import {
  notifyCenterInvoiceApproved,
  notifyCenterPaymentReceived,
} from "../lib/centerAlerts";

const router: IRouter = Router();

router.post("/bookings/:bookingId/invoice", async (req, res): Promise<void> => {
  const params = CreateInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = CreateInvoiceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, params.data.bookingId));
  if (!booking) {
    res.status(404).json({ error: "Booking not found" });
    return;
  }
  if (booking.status !== "in_progress") {
    res.status(409).json({
      error: `Invoices can only be created while a booking is in progress (current status: ${booking.status})`,
    });
    return;
  }
  if (booking.invoiceId) {
    res.status(409).json({ error: "This booking already has an invoice" });
    return;
  }

  const laborTotal = parsed.data.items
    .filter((i) => i.kind === "labor")
    .reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const partsTotal = parsed.data.items
    .filter((i) => i.kind === "part")
    .reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const subtotal = laborTotal + partsTotal;
  const tax = +(subtotal * parsed.data.taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  const [invoice] = await db
    .insert(invoicesTable)
    .values({
      bookingId: booking.id,
      items: parsed.data.items,
      laborTotal: +laborTotal.toFixed(2),
      partsTotal: +partsTotal.toFixed(2),
      tax,
      total,
      notes: parsed.data.notes ?? null,
      status: "pending_approval",
    })
    .returning();

  await db
    .update(bookingsTable)
    .set({ invoiceId: invoice.id, status: "awaiting_approval" })
    .where(eq(bookingsTable.id, booking.id));

  await db.insert(bookingEventsTable).values({
    bookingId: booking.id,
    label: `Invoice issued — total $${total.toFixed(2)}`,
    actor: "Service Center",
    kind: "invoice_created",
  });

  res.status(201).json(invoice);
});

router.get("/invoices/:invoiceId", async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.data.invoiceId));
  if (!row) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  res.json(row);
});

router.post(
  "/invoices/:invoiceId/approve",
  async (req, res): Promise<void> => {
    const params = ApproveInvoiceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [existing] = await db
      .select()
      .from(invoicesTable)
      .where(eq(invoicesTable.id, params.data.invoiceId));
    if (!existing) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (existing.status !== "pending_approval") {
      res.status(409).json({
        error: `Only pending invoices can be approved (current status: ${existing.status})`,
      });
      return;
    }
    const [row] = await db
      .update(invoicesTable)
      .set({ status: "approved", approvedAt: new Date() })
      .where(eq(invoicesTable.id, params.data.invoiceId))
      .returning();
    await db
      .update(bookingsTable)
      .set({ status: "approved" })
      .where(eq(bookingsTable.id, row.bookingId));
    await db.insert(bookingEventsTable).values({
      bookingId: row.bookingId,
      label: "Invoice approved by owner",
      actor: "Owner",
      kind: "invoice_approved",
    });
    notifyCenterInvoiceApproved(row.bookingId, row.total).catch((err) =>
      req.log.warn({ err }, "WhatsApp invoice-approved alert failed"),
    );
    res.json(row);
  },
);

router.post("/invoices/:invoiceId/pay", async (req, res): Promise<void> => {
  const params = PayInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, params.data.invoiceId));
  if (!existing) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (existing.status !== "approved") {
    res.status(409).json({
      error: `Only approved invoices can be paid (current status: ${existing.status})`,
    });
    return;
  }
  const [row] = await db
    .update(invoicesTable)
    .set({ status: "paid", paidAt: new Date() })
    .where(eq(invoicesTable.id, params.data.invoiceId))
    .returning();
  const completedAt = new Date();
  const [bookingRow] = await db
    .update(bookingsTable)
    .set({ status: "completed", completedAt })
    .where(eq(bookingsTable.id, row.bookingId))
    .returning();
  if (bookingRow) {
    // Snapshot the vehicle's current mileage as the "last serviced" baseline
    // so the next reminder window is computed from this completed job.
    const [veh] = await db
      .select()
      .from(vehiclesTable)
      .where(eq(vehiclesTable.id, bookingRow.vehicleId));
    if (veh) {
      await db
        .update(vehiclesTable)
        .set({
          lastServicedAt: completedAt,
          lastServicedMileage: veh.mileage,
        })
        .where(eq(vehiclesTable.id, veh.id));
    }
  }
  await db.insert(bookingEventsTable).values({
    bookingId: row.bookingId,
    label: "Payment received — job marked complete",
    actor: "Owner",
    kind: "invoice_paid",
  });
  notifyCenterPaymentReceived(row.bookingId, row.total).catch((err) =>
    req.log.warn({ err }, "WhatsApp payment-received alert failed"),
  );
  res.json(row);
});

export default router;
