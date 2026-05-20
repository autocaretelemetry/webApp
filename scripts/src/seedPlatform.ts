import {
  db,
  pool,
  platformStaffTable,
  subscriptionPlansTable,
  subscriptionsTable,
  subscriptionPaymentsTable,
  serviceCentersTable,
  vendorsTable,
  organizationsTable,
  organizationMembersTable,
  organizationPreferredCentersTable,
  vehiclesTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

// Defaults for newly added PlanLimits fields. Most non-org plans don't
// surface fleet entitlements at all, so they get zeroes.
const NO_FLEET = {
  maxFleetVehicles: 0,
  partsCostTransparency: false,
  dedicatedSupport: false,
} as const;

const ALL_PERMS = [
  "manage_vendors",
  "manage_centers",
  "manage_mechanics",
  "manage_agents",
  "manage_subscriptions",
  "manage_finance",
  "manage_staff",
];

async function main() {
  console.log("Clearing platform staff & subscription tables...");
  await db.delete(subscriptionPaymentsTable);
  await db.delete(subscriptionsTable);
  await db.delete(subscriptionPlansTable);
  await db.delete(platformStaffTable);

  console.log("Seeding platform staff...");
  await db.insert(platformStaffTable).values([
    {
      name: "Adaeze Okafor",
      email: "adaeze@autocare.ng",
      role: "admin",
      permissions: ALL_PERMS,
    },
    {
      name: "Chinedu Balogun",
      email: "chinedu@autocare.ng",
      role: "staff",
      permissions: ["manage_finance", "manage_subscriptions"],
    },
    {
      name: "Funmi Adeleke",
      email: "funmi@autocare.ng",
      role: "staff",
      permissions: ["manage_centers", "manage_mechanics", "manage_vendors"],
    },
    {
      name: "Tunde Eze",
      email: "tunde@autocare.ng",
      role: "staff",
      permissions: ["manage_agents"],
      active: false,
    },
  ]);

  console.log("Seeding subscription plans...");
  const plans = await db
    .insert(subscriptionPlansTable)
    .values([
      {
        name: "Center Basic",
        audience: "center",
        priceMonthly: 15000,
        features: ["Listed in directory", "Up to 50 bookings/mo", "Email support"],
        limits: {
          maxBookingsPerMonth: 50,
          maxPartsListed: null,
          featuredPlacement: false,
          canExportHistory: false,
          priorityBooking: false,
          ...NO_FLEET,
        },
      },
      {
        name: "Center Pro",
        audience: "center",
        priceMonthly: 45000,
        features: ["Unlimited bookings", "Priority placement", "Phone support", "Analytics"],
        limits: {
          maxBookingsPerMonth: null,
          maxPartsListed: null,
          featuredPlacement: true,
          canExportHistory: false,
          priorityBooking: false,
          ...NO_FLEET,
        },
      },
      {
        name: "Vendor Storefront",
        audience: "vendor",
        priceMonthly: 12000,
        features: ["Up to 100 parts listed", "Marketplace listing"],
        limits: {
          maxBookingsPerMonth: null,
          maxPartsListed: 100,
          featuredPlacement: false,
          canExportHistory: false,
          priorityBooking: false,
          ...NO_FLEET,
        },
      },
      {
        name: "Vendor Plus",
        audience: "vendor",
        priceMonthly: 35000,
        features: ["Unlimited parts", "Featured placement", "Sales analytics"],
        limits: {
          maxBookingsPerMonth: null,
          maxPartsListed: null,
          featuredPlacement: true,
          canExportHistory: false,
          priorityBooking: false,
          ...NO_FLEET,
        },
      },
      {
        name: "Owner Premium",
        audience: "owner",
        priceMonthly: 2500,
        features: ["Service reminders", "Priority booking", "Maintenance history export"],
        limits: {
          maxBookingsPerMonth: null,
          maxPartsListed: null,
          featuredPlacement: false,
          canExportHistory: true,
          priorityBooking: true,
          ...NO_FLEET,
        },
      },
      {
        name: "Fleet Starter",
        audience: "organization",
        priceMonthly: 80000,
        features: [
          "Up to 10 fleet vehicles",
          "Preferred service centers",
          "Reminders dashboard",
          "Email support",
        ],
        limits: {
          maxBookingsPerMonth: null,
          maxPartsListed: null,
          featuredPlacement: false,
          canExportHistory: true,
          priorityBooking: false,
          maxFleetVehicles: 10,
          partsCostTransparency: false,
          dedicatedSupport: false,
        },
      },
      {
        name: "Fleet Pro",
        audience: "organization",
        priceMonthly: 250000,
        features: [
          "Unlimited fleet vehicles",
          "Parts-cost transparency",
          "Priority booking at preferred centers",
          "Dedicated account manager",
        ],
        limits: {
          maxBookingsPerMonth: null,
          maxPartsListed: null,
          featuredPlacement: false,
          canExportHistory: true,
          priorityBooking: true,
          maxFleetVehicles: null,
          partsCostTransparency: true,
          dedicatedSupport: true,
        },
      },
    ])
    .returning();

  const planByName = (n: string) => plans.find((p) => p.name === n)!;

  const centers = await db.select().from(serviceCentersTable);
  const vendors = await db.select().from(vendorsTable);

  console.log("Seeding subscriptions...");
  type SubSeed = {
    kind: "center" | "vendor" | "owner" | "organization";
    id: string;
    name: string;
    plan: typeof plans[number];
    startMonthsAgo: number;
    status?: "active" | "cancelled" | "past_due";
  };

  const subSeeds: SubSeed[] = [];
  centers.slice(0, 3).forEach((c, i) => {
    subSeeds.push({
      kind: "center",
      id: c.id,
      name: c.name,
      plan: i === 0 ? planByName("Center Pro") : planByName("Center Basic"),
      startMonthsAgo: 5 - i,
    });
  });
  vendors.slice(0, 4).forEach((v, i) => {
    subSeeds.push({
      kind: "vendor",
      id: v.id,
      name: v.name,
      plan: i % 2 === 0 ? planByName("Vendor Plus") : planByName("Vendor Storefront"),
      startMonthsAgo: 4 - i,
      status: i === 3 ? "past_due" : "active",
    });
  });
  subSeeds.push({
    kind: "owner",
    id: "owner-marcus-hale",
    name: "Marcus Hale",
    plan: planByName("Owner Premium"),
    startMonthsAgo: 3,
  });
  subSeeds.push({
    kind: "owner",
    id: "owner-zainab-bello",
    name: "Zainab Bello",
    plan: planByName("Owner Premium"),
    startMonthsAgo: 6,
    status: "cancelled",
  });

  const now = new Date();
  for (const s of subSeeds) {
    const startedAt = new Date(now);
    startedAt.setMonth(startedAt.getMonth() - s.startMonthsAgo);
    const currentPeriodEnd = new Date(now);
    currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
    const cancelledAt = s.status === "cancelled" ? new Date(now.getTime() - 86400000 * 14) : null;

    const [sub] = await db
      .insert(subscriptionsTable)
      .values({
        subscriberKind: s.kind,
        subscriberId: s.id,
        subscriberName: s.name,
        planId: s.plan.id,
        status: s.status ?? "active",
        startedAt,
        currentPeriodEnd,
        cancelledAt,
      })
      .returning();

    const monthsActive = s.status === "cancelled" ? s.startMonthsAgo - 1 : s.startMonthsAgo + 1;
    const payments = [];
    for (let i = 0; i < monthsActive; i++) {
      const paidAt = new Date(startedAt);
      paidAt.setMonth(paidAt.getMonth() + i);
      if (paidAt > now) break;
      payments.push({
        subscriptionId: sub.id,
        amount: s.plan.priceMonthly,
        paidAt,
      });
    }
    if (payments.length > 0) {
      await db.insert(subscriptionPaymentsTable).values(payments);
    }
  }

  // ───── Demo fleet: MTN Ghana ─────
  console.log("Seeding demo fleet organization (MTN Ghana)...");
  await db.delete(organizationPreferredCentersTable);
  await db.delete(organizationMembersTable);
  // Detach any existing fleet vehicles before we drop the parent org rows
  // so the FK doesn't block deletion on re-seed.
  await db
    .update(vehiclesTable)
    .set({ organizationId: null, assignedDriverPhone: null })
    .where(eq(vehiclesTable.ownerPhone, "+233 24 100 0001"));
  await db.delete(organizationsTable);

  const [mtn] = await db
    .insert(organizationsTable)
    .values({
      name: "MTN Ghana",
      slug: "mtn-ghana",
      industry: "Telecommunications",
      contactName: "Akosua Mensah",
      contactPhone: "+233 24 100 0001",
      contactEmail: "fleet@mtn.com.gh",
      billingAddress: "Independence Avenue, Ridge",
      city: "Accra",
      region: "Greater Accra",
      logoUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/9/93/New-mtn-logo.jpg/320px-New-mtn-logo.jpg",
      // MTN routes parts-order spend through the finance team by default;
      // the per-member override on Yaa lets her bypass the queue.
      requireFinanceApproval: true,
    })
    .returning();

  await db.insert(organizationMembersTable).values([
    {
      organizationId: mtn.id,
      phone: "+233 24 100 0001",
      name: "Akosua Mensah",
      role: "admin",
    },
    {
      organizationId: mtn.id,
      phone: "+233 24 100 0004",
      name: "Ama Asante",
      role: "finance",
    },
    {
      organizationId: mtn.id,
      phone: "+233 24 100 0002",
      name: "Kwame Boateng",
      role: "driver",
      canCheckoutDirectly: false,
    },
    {
      organizationId: mtn.id,
      phone: "+233 24 100 0003",
      name: "Yaa Owusu",
      role: "driver",
      canCheckoutDirectly: true,
    },
  ]);

  const allCenters = await db.select().from(serviceCentersTable);
  if (allCenters.length >= 2) {
    await db.insert(organizationPreferredCentersTable).values(
      allCenters.slice(0, 2).map((c) => ({
        organizationId: mtn.id,
        serviceCenterId: c.id,
      })),
    );
  }

  await db.insert(vehiclesTable).values([
    {
      organizationId: mtn.id,
      ownerName: mtn.name,
      ownerPhone: mtn.contactPhone,
      brand: "Toyota",
      model: "Hilux",
      year: 2022,
      plateNumber: "GR 4421-22",
      color: "MTN Yellow",
      mileage: 48500,
      engineType: "2.4L Diesel",
      insuranceProvider: "Enterprise Insurance",
      assignedDriverPhone: "+233 24 100 0002",
    },
    {
      organizationId: mtn.id,
      ownerName: mtn.name,
      ownerPhone: mtn.contactPhone,
      brand: "Toyota",
      model: "Hilux",
      year: 2023,
      plateNumber: "GR 7781-23",
      color: "MTN Yellow",
      mileage: 21200,
      engineType: "2.4L Diesel",
      insuranceProvider: "Enterprise Insurance",
      assignedDriverPhone: "+233 24 100 0003",
    },
    {
      organizationId: mtn.id,
      ownerName: mtn.name,
      ownerPhone: mtn.contactPhone,
      brand: "Nissan",
      model: "NV350 Urvan",
      year: 2021,
      plateNumber: "GR 1102-21",
      color: "White",
      mileage: 72100,
      engineType: "2.5L Diesel",
      insuranceProvider: "Enterprise Insurance",
    },
    {
      organizationId: mtn.id,
      ownerName: mtn.name,
      ownerPhone: mtn.contactPhone,
      brand: "Ford",
      model: "Ranger",
      year: 2024,
      plateNumber: "GR 9981-24",
      color: "MTN Yellow",
      mileage: 8500,
      engineType: "2.0L Diesel",
      insuranceProvider: "Enterprise Insurance",
    },
  ]);

  // Subscribe MTN Ghana to Fleet Pro so the demo unlocks parts-cost
  // transparency and dedicated support out of the box.
  const fleetPro = planByName("Fleet Pro");
  const fpStarted = new Date(now);
  fpStarted.setMonth(fpStarted.getMonth() - 2);
  const fpEnd = new Date(now);
  fpEnd.setMonth(fpEnd.getMonth() + 1);
  const [mtnSub] = await db
    .insert(subscriptionsTable)
    .values({
      subscriberKind: "organization",
      subscriberId: mtn.id,
      subscriberName: mtn.name,
      planId: fleetPro.id,
      status: "active",
      startedAt: fpStarted,
      currentPeriodEnd: fpEnd,
    })
    .returning();
  await db.insert(subscriptionPaymentsTable).values([
    { subscriptionId: mtnSub.id, amount: fleetPro.priceMonthly, paidAt: fpStarted },
    {
      subscriptionId: mtnSub.id,
      amount: fleetPro.priceMonthly,
      paidAt: new Date(fpStarted.getTime() + 30 * 86400000),
    },
  ]);

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
