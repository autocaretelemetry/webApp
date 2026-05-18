import {
  db,
  pool,
  platformStaffTable,
  subscriptionPlansTable,
  subscriptionsTable,
  subscriptionPaymentsTable,
  serviceCentersTable,
  vendorsTable,
} from "@workspace/db";

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
      },
      {
        name: "Center Pro",
        audience: "center",
        priceMonthly: 45000,
        features: ["Unlimited bookings", "Priority placement", "Phone support", "Analytics"],
      },
      {
        name: "Vendor Storefront",
        audience: "vendor",
        priceMonthly: 12000,
        features: ["Up to 100 parts listed", "Marketplace listing"],
      },
      {
        name: "Vendor Plus",
        audience: "vendor",
        priceMonthly: 35000,
        features: ["Unlimited parts", "Featured placement", "Sales analytics"],
      },
      {
        name: "Owner Premium",
        audience: "owner",
        priceMonthly: 2500,
        features: ["Service reminders", "Priority booking", "Maintenance history export"],
      },
    ])
    .returning();

  const planByName = (n: string) => plans.find((p) => p.name === n)!;

  const centers = await db.select().from(serviceCentersTable);
  const vendors = await db.select().from(vendorsTable);

  console.log("Seeding subscriptions...");
  type SubSeed = {
    kind: "center" | "vendor" | "owner";
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

  console.log("Done.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
