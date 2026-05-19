import { eq } from "drizzle-orm";
import {
  db,
  serviceCentersTable,
  vehiclesTable,
  bookingsTable,
  type Booking,
  type ServiceCenter,
} from "@workspace/db";
import { sendWhatsAppText, appPublicUrl } from "./whatsapp";
import { logger } from "./logger";

async function loadCenter(
  centerId: string,
): Promise<ServiceCenter | null> {
  const [c] = await db
    .select()
    .from(serviceCentersTable)
    .where(eq(serviceCentersTable.id, centerId));
  return c ?? null;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

async function notifyCenter(
  centerId: string,
  message: string,
): Promise<void> {
  const center = await loadCenter(centerId);
  if (!center) return;
  if (!center.whatsappOptIn) {
    logger.debug({ centerId }, "Center has WhatsApp notifications disabled");
    return;
  }
  if (!center.phone) {
    logger.debug({ centerId }, "Center has no phone on file");
    return;
  }
  await sendWhatsAppText(center.phone, message);
}

export async function notifyCenterNewBooking(
  booking: Booking,
): Promise<void> {
  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, booking.vehicleId));
  const ownerLabel = vehicle?.ownerName ?? "Owner";
  const vehicleLabel = vehicle
    ? `${vehicle.brand} ${vehicle.model} (${vehicle.plateNumber})`
    : "Vehicle";
  const message =
    `AutoCare — new booking request\n` +
    `${ownerLabel} requested ${booking.serviceType} on ${vehicleLabel}.\n` +
    `"${booking.description}"\n` +
    `Open: ${appPublicUrl(`/jobs/${booking.id}`)}`;
  await notifyCenter(booking.serviceCenterId, message);
}

export async function notifyCenterInvoiceApproved(
  bookingId: string,
  invoiceTotal: number,
): Promise<void> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));
  if (!booking) return;
  const message =
    `AutoCare — invoice approved\n` +
    `Owner approved invoice for booking #${shortId(bookingId)}. ` +
    `Total: GHS ${invoiceTotal.toLocaleString()}.\n` +
    `Open: ${appPublicUrl(`/jobs/${bookingId}`)}`;
  await notifyCenter(booking.serviceCenterId, message);
}

export async function notifyCenterPaymentReceived(
  bookingId: string,
  invoiceTotal: number,
): Promise<void> {
  const [booking] = await db
    .select()
    .from(bookingsTable)
    .where(eq(bookingsTable.id, bookingId));
  if (!booking) return;
  const message =
    `AutoCare — payment received\n` +
    `Booking #${shortId(bookingId)} marked complete. ` +
    `Settled: GHS ${invoiceTotal.toLocaleString()}.\n` +
    `Open: ${appPublicUrl(`/jobs/${bookingId}`)}`;
  await notifyCenter(booking.serviceCenterId, message);
}
