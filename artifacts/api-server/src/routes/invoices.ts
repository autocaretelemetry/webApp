import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  bookingsTable,
  bookingEventsTable,
  invoicesTable,
  vehiclesTable,
  ordersTable,
  orderItemsTable,
  type InvoiceItem,
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
import { requireAuth } from "../lib/auth";
import { authorizeServiceBooking, type BookingRelationship } from "./bookings";
import { recordCommission } from "../lib/commissions";

const router: IRouter = Router();

/**
 * Loads an invoice and authorizes the signed-in caller by piggy-backing on
 * the booking-level access helper (an invoice is always tied to exactly
 * one booking). Returns null AFTER writing a 401/403/404 response.
 */
async function authorizeInvoice(
  req: Request,
  res: Response,
  invoiceId: string,
): Promise<{
  invoice: typeof invoicesTable.$inferSelect;
  relationship: BookingRelationship;
} | null> {
  const [invoice] = await db
    .select()
    .from(invoicesTable)
    .where(eq(invoicesTable.id, invoiceId));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return null;
  }
  const access = await authorizeServiceBooking(req, res, invoice.bookingId);
  if (!access) return null;
  return { invoice, relationship: access.relationship };
}

router.post("/bookings/:bookingId/invoice", requireAuth, async (req, res): Promise<void> => {
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

  const access = await authorizeServiceBooking(req, res, params.data.bookingId);
  if (!access) return;
  const booking = access.booking;
  // Issuing an invoice is a service-center action.
  if (access.relationship === "owner") {
    res.status(403).json({
      error: "Only the service center handling this booking can issue an invoice.",
    });
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

  // Pull in any parts orders the service center paid for on the owner's behalf
  // (after the owner authorized center-pay). Those costs are billed back to
  // the owner through this invoice, so we automatically append them as
  // part-line items. We exclude anything already invoiced or cancelled.
  const centerPaidOrders = await db
    .select()
    .from(ordersTable)
    .where(
      and(
        eq(ordersTable.bookingId, booking.id),
        eq(ordersTable.paymentStatus, "paid_by_center"),
        isNull(ordersTable.invoicedAt),
      ),
    );
  const centerPaidIds = centerPaidOrders
    .filter((o) => o.status !== "cancelled")
    .map((o) => o.id);
  const centerPaidLines = centerPaidIds.length
    ? await db
        .select()
        .from(orderItemsTable)
        .where(inArray(orderItemsTable.orderId, centerPaidIds))
    : [];
  const autoPartItems: InvoiceItem[] = centerPaidLines.map((line) => ({
    description: `Part: ${line.snapshot.name} (paid by service center)`,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    kind: "part" as const,
  }));
  const allItems: InvoiceItem[] = [...parsed.data.items, ...autoPartItems];

  const laborTotal = allItems
    .filter((i) => i.kind === "labor")
    .reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const partsTotal = allItems
    .filter((i) => i.kind === "part")
    .reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const subtotal = laborTotal + partsTotal;
  const tax = +(subtotal * parsed.data.taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  // Atomically: insert invoice, CAS the booking to attach it (so concurrent
  // requests can't both create one), stamp invoicedAt on the included
  // center-paid orders, and write the timeline event.
  const now = new Date();
  let invoice: typeof invoicesTable.$inferSelect;
  try {
    invoice = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(invoicesTable)
        .values({
          bookingId: booking.id,
          items: allItems,
          laborTotal: +laborTotal.toFixed(2),
          partsTotal: +partsTotal.toFixed(2),
          tax,
          total,
          notes: parsed.data.notes ?? null,
          status: "pending_approval",
        })
        .returning();
      const claimed = await tx
        .update(bookingsTable)
        .set({ invoiceId: created.id, status: "awaiting_approval" })
        .where(and(eq(bookingsTable.id, booking.id), isNull(bookingsTable.invoiceId)))
        .returning({ id: bookingsTable.id });
      if (claimed.length === 0) {
        throw new Error("invoice_race");
      }
      if (centerPaidIds.length) {
        await tx
          .update(ordersTable)
          .set({ invoicedAt: now })
          .where(
            and(
              inArray(ordersTable.id, centerPaidIds),
              isNull(ordersTable.invoicedAt),
            ),
          );
      }
      await tx.insert(bookingEventsTable).values({
        bookingId: booking.id,
        label: `Invoice issued — total $${total.toFixed(2)}`,
        actor: "Service Center",
        kind: "invoice_created",
      });
      return created;
    });
  } catch (err) {
    if (err instanceof Error && err.message === "invoice_race") {
      res.status(409).json({ error: "This booking already has an invoice" });
      return;
    }
    throw err;
  }

  res.status(201).json(invoice);
});

router.get("/invoices/:invoiceId", requireAuth, async (req, res): Promise<void> => {
  const params = GetInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const access = await authorizeInvoice(req, res, params.data.invoiceId);
  if (!access) return;
  res.json(access.invoice);
});

router.post(
  "/invoices/:invoiceId/approve",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = ApproveInvoiceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const access = await authorizeInvoice(req, res, params.data.invoiceId);
    if (!access) return;
    // Approving an invoice is the vehicle owner's action.
    if (access.relationship === "center") {
      res.status(403).json({
        error: "Only the vehicle owner can approve this invoice.",
      });
      return;
    }
    const existing = access.invoice;
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

router.post("/invoices/:invoiceId/pay", requireAuth, async (req, res): Promise<void> => {
  const params = PayInvoiceParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const access = await authorizeInvoice(req, res, params.data.invoiceId);
  if (!access) return;
  // Paying an invoice is the vehicle owner's action.
  if (access.relationship === "center") {
    res.status(403).json({
      error: "Only the vehicle owner can pay this invoice.",
    });
    return;
  }
  const existing = access.invoice;
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
  // Platform commission: deduct super-admin-configured % from the
  // service center's effective payout. Fire-and-forget; ledger insert
  // is idempotent so retries can't double-charge.
  const [bookingForCommission] = await db
    .select({ centerId: bookingsTable.serviceCenterId })
    .from(bookingsTable)
    .where(eq(bookingsTable.id, row.bookingId));
  if (bookingForCommission) {
    await recordCommission({
      saleKind: "service_invoice",
      saleId: row.id,
      sellerKind: "service_center",
      sellerId: bookingForCommission.centerId,
      grossAmount: row.total,
    });
  }
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
