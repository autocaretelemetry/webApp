/**
 * Seed demo accounts — one per role plus a super admin.
 * Idempotent: upserts on email so re-runs just refresh the password hash.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts run seed:users
 */
import {
  randomBytes,
  scryptSync,
} from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  db,
  usersTable,
  serviceCentersTable,
  vendorsTable,
  centerStaffTable,
  vendorStaffTable,
} from "@workspace/db";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

type Seed = {
  email: string;
  password: string;
  name: string;
  role: string;
  phone?: string;
};

const SEEDS: Seed[] = [
  {
    email: "owner@autocare.test",
    password: "owner1234",
    name: "Marcus Hale",
    role: "owner",
    phone: "+234 802 201 1932",
  },
  {
    email: "center@autocare.test",
    password: "center1234",
    name: "Apex Auto Works",
    role: "center",
    phone: "+234 805 410 9920",
  },
  {
    email: "vendor@autocare.test",
    password: "vendor1234",
    name: "PartsPro Lagos",
    role: "vendor",
    phone: "+234 807 654 0011",
  },
  {
    email: "renter@autocare.test",
    password: "renter1234",
    name: "Tunde Bakare",
    role: "renter",
    phone: "+234 803 545 8821",
  },
  {
    email: "delivery@autocare.test",
    password: "delivery1234",
    name: "Femi Adebayo",
    role: "delivery",
    phone: "+234 803 119 4422",
  },
  {
    email: "fleet@autocare.test",
    password: "fleet1234",
    name: "Akosua Mensah",
    role: "fleet",
    phone: "+233 24 100 0001",
  },
  {
    email: "driver@autocare.test",
    password: "driver1234",
    name: "Kwame Boateng",
    role: "fleet",
    phone: "+233 24 100 0002",
  },
  {
    email: "finance@autocare.test",
    password: "finance1234",
    name: "Ama Asante",
    role: "fleet",
    phone: "+233 24 100 0004",
  },
  {
    email: "admin@autocare.test",
    password: "admin1234",
    name: "Adaeze Okafor",
    role: "admin",
    phone: "+234 806 220 7700",
  },
  {
    email: "superadmin@autocare.test",
    password: "super1234",
    name: "AutoCare Root",
    role: "super_admin",
    phone: "+234 809 999 0000",
  },
];

async function main() {
  for (const s of SEEDS) {
    const passwordHash = hashPassword(s.password);
    await db
      .insert(usersTable)
      .values({
        email: s.email.toLowerCase(),
        passwordHash,
        name: s.name,
        role: s.role,
        phone: s.phone ?? null,
        active: true,
        // Grandfather every seeded demo account — they bypass the new
        // self-signup / KYC funnel entirely.
        approvalStatus: "approved",
        kycStatus: "verified",
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: {
          passwordHash,
          name: s.name,
          role: s.role,
          phone: s.phone ?? null,
          active: true,
          approvalStatus: "approved",
          kycStatus: "verified",
          emailVerifiedAt: new Date(),
          phoneVerifiedAt: new Date(),
        },
      });
    console.log(`Seeded ${s.role} -> ${s.email}`);

    // Link demo center/vendor accounts into the staff tables so
    // self-service subscription (and any other staff-scoped lookup) can
    // resolve their business identity. Without this they only show as
    // "owner" (phone-based) on /billing/subscribe and end up subscribing to
    // the wrong audience's plans.
    const [seededUser] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, s.email.toLowerCase()));
    if (!seededUser) continue;

    if (s.role === "center") {
      // Prefer a center whose name matches the user's name; otherwise fall
      // back to the first seeded center so the demo never dead-ends.
      let [center] = await db
        .select({ id: serviceCentersTable.id, name: serviceCentersTable.name })
        .from(serviceCentersTable)
        .where(eq(serviceCentersTable.name, s.name));
      if (!center) {
        [center] = await db
          .select({ id: serviceCentersTable.id, name: serviceCentersTable.name })
          .from(serviceCentersTable)
          .limit(1);
      }
      if (center) {
        await db
          .insert(centerStaffTable)
          .values({
            centerId: center.id,
            userId: seededUser.id,
            name: s.name,
            email: s.email.toLowerCase(),
            phone: s.phone ?? null,
            role: "owner",
            active: true,
          })
          .onConflictDoUpdate({
            target: [centerStaffTable.centerId, centerStaffTable.email],
            set: {
              userId: seededUser.id,
              name: s.name,
              phone: s.phone ?? null,
              role: "owner",
              active: true,
            },
          });
        console.log(`  linked ${s.email} -> center ${center.name}`);
      }
    } else if (s.role === "vendor") {
      let [vendor] = await db
        .select({ id: vendorsTable.id, name: vendorsTable.name })
        .from(vendorsTable)
        .where(eq(vendorsTable.name, s.name));
      if (!vendor) {
        [vendor] = await db
          .select({ id: vendorsTable.id, name: vendorsTable.name })
          .from(vendorsTable)
          .limit(1);
      }
      if (vendor) {
        await db
          .insert(vendorStaffTable)
          .values({
            vendorId: vendor.id,
            userId: seededUser.id,
            name: s.name,
            email: s.email.toLowerCase(),
            phone: s.phone ?? null,
            role: "owner",
            active: true,
          })
          .onConflictDoUpdate({
            target: [vendorStaffTable.vendorId, vendorStaffTable.email],
            set: {
              userId: seededUser.id,
              name: s.name,
              phone: s.phone ?? null,
              role: "owner",
              active: true,
            },
          });
        console.log(`  linked ${s.email} -> vendor ${vendor.name}`);
      }
    }
  }
  // Backfill: before `renter` became a first-class role, applicants who
  // applied as renters were stored as `role=owner`. Promote any such rows
  // to `role=renter` so they land on the renter dashboard after sign-in.
  const promoted = await db
    .update(usersTable)
    .set({ role: "renter" })
    .where(
      and(
        eq(usersTable.requestedRole, "renter"),
        eq(usersTable.role, "owner"),
      ),
    )
    .returning({ id: usersTable.id });
  if (promoted.length > 0) {
    console.log(`Promoted ${promoted.length} renter applicant(s) from owner -> renter`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
