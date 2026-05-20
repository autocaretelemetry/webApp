import { pgTable, uuid, text, timestamp, primaryKey, boolean } from "drizzle-orm/pg-core";
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
  // When true, parts orders submitted by managers/drivers go to the finance
  // queue for approval+payment instead of letting the requester checkout
  // directly. Per-member overrides via `canCheckoutDirectly` still apply.
  requireFinanceApproval: boolean("require_finance_approval").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Allowed values for `organization_members.role` (stored as text to avoid
// migrations when adding new ones). Kept here so the server and seeds share
// one list.
export const ORG_MEMBER_ROLES = ["admin", "finance", "manager", "driver"] as const;
export type OrgMemberRole = (typeof ORG_MEMBER_ROLES)[number];

export const organizationMembersTable = pgTable(
  "organization_members",
  {
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizationsTable.id, { onDelete: "cascade" }),
    phone: text("phone").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull().default("driver"),
    // Per-member override: when the org requires finance approval, this lets
    // a trusted manager or driver still checkout directly. Admins and finance
    // are always allowed regardless of this flag.
    canCheckoutDirectly: boolean("can_checkout_directly").notNull().default(false),
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
