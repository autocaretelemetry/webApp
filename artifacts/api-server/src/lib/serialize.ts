import type {
  Vehicle,
  ServiceCenter,
  Mechanic,
  Booking,
  Invoice,
} from "@workspace/db";

export function serializeVehicle(v: Vehicle) {
  return { ...v };
}

export async function getOpenJobsForCenter(
  countByCenter: Map<string, number>,
  centerId: string,
): Promise<number> {
  return countByCenter.get(centerId) ?? 0;
}

export function serializeServiceCenter(c: ServiceCenter, openJobs: number) {
  return { ...c, openJobs };
}

export function serializeMechanic(m: Mechanic) {
  return { ...m };
}

export function serializeInvoice(i: Invoice) {
  return { ...i };
}

export function serializeBooking(
  b: Booking,
  vehicle: Vehicle,
  center: ServiceCenter,
  centerOpenJobs: number,
  mechanic: Mechanic | null,
) {
  return {
    ...b,
    vehicle: serializeVehicle(vehicle),
    serviceCenter: serializeServiceCenter(center, centerOpenJobs),
    mechanic: mechanic ? serializeMechanic(mechanic) : null,
  };
}
