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
import { db, usersTable } from "@workspace/db";

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
      })
      .onConflictDoUpdate({
        target: usersTable.email,
        set: { passwordHash, name: s.name, role: s.role, phone: s.phone ?? null, active: true },
      });
    console.log(`Seeded ${s.role} -> ${s.email}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
