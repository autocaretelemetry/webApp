import { pgTable, uuid, text, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const KYC_STATUSES = [
  "not_submitted",
  "submitted",
  "verified",
  "rejected",
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export type KycDocument = { key: string; url: string; label: string };

export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone"),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  // Account-level lifecycle. Approval gates sign-in; KYC gates app access
  // once signed in. Both default to approved+verified so existing/seeded
  // rows are grandfathered.
  approvalStatus: text("approval_status").notNull().default("approved"),
  approvalNote: text("approval_note"),
  kycStatus: text("kyc_status").notNull().default("verified"),
  kycNote: text("kyc_note"),
  kycDocuments: jsonb("kyc_documents").$type<KycDocument[]>(),
  // What the applicant asked to become at signup (`role` is set only after
  // approval). Frozen at signup time so admins see the original ask.
  requestedRole: text("requested_role"),
  // Free-form role-specific signup payload captured for the approver to read
  // (business name, vehicle count, region, etc.).
  applicantData: jsonb("applicant_data").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
