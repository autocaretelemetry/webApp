import type { Vehicle } from "@workspace/db";

type Reminder = {
  id: string;
  vehicleId: string;
  title: string;
  detail: string | null;
  dueAt: Date;
  urgency: "low" | "medium" | "high";
};

const DAY = 1000 * 60 * 60 * 24;

export function computeReminders(vehicle: Vehicle): Reminder[] {
  const now = Date.now();
  const created = vehicle.createdAt.getTime();
  const ageDays = Math.max(0, Math.floor((now - created) / DAY));

  const seed = (vehicle.id.charCodeAt(0) + vehicle.id.charCodeAt(1)) % 30;

  const reminders: Reminder[] = [
    {
      id: `${vehicle.id}-oil`,
      vehicleId: vehicle.id,
      title: "Engine Oil Change",
      detail: "Manufacturer recommends every 5,000 km or 90 days.",
      dueAt: new Date(now + (60 - ageDays + seed) * DAY),
      urgency: ageDays > 80 ? "high" : ageDays > 45 ? "medium" : "low",
    },
    {
      id: `${vehicle.id}-tires`,
      vehicleId: vehicle.id,
      title: "Tire Rotation",
      detail: "Rotate tires to balance tread wear across all four wheels.",
      dueAt: new Date(now + (100 - ageDays + seed) * DAY),
      urgency: ageDays > 100 ? "medium" : "low",
    },
    {
      id: `${vehicle.id}-brakes`,
      vehicleId: vehicle.id,
      title: "Brake Inspection",
      detail: "Visual inspection of pads, rotors, and fluid level.",
      dueAt: new Date(now + (140 - ageDays + seed) * DAY),
      urgency: "low",
    },
    {
      id: `${vehicle.id}-battery`,
      vehicleId: vehicle.id,
      title: "Battery Health Check",
      detail: "Load test and terminal cleaning recommended.",
      dueAt: new Date(now + (180 - ageDays + seed) * DAY),
      urgency: "low",
    },
  ];

  return reminders.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
}
