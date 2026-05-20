import { pgTable, uuid, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { serviceCentersTable } from "./serviceCenters";

export const organizationsTable = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  industry: text("industry"),
  contactName: text("contact_name").notNull(),
  contactPhone: text("contact_phone").notNull(),
  contactEmail: text("contact_email"),
  billingAddress: text("billing_address"),
  city: text("city"),
  region: text("region"),
  logoUrl: text("logo_url"),
  kycStatus: text("kyc_status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("driver"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.phone] }) }),
);

export const organizationPreferredCentersTable = pgTable(
  "organization_preferred_centers",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    serviceCenterId: uuid("service_center_id")
      .notNull()
      .references(() => serviceCentersTable.id, { onDelete: "cascade" }),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.serviceCenterId] }) }),
);

export type Organization = typeof organizationsTable.$inferSelect;
export type OrganizationMember = typeof organizationMembersTable.$inferSelect;
export type OrganizationPreferredCenter =
  typeof organizationPreferredCentersTable.$inferSelect;
