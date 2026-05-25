import { sql } from "drizzle-orm";
import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const APPROVAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// Channels we can deliver decision notifications over. Stored on the user so
// each applicant can opt out of email or WhatsApp independently. Defaults to
// both so behaviour is unchanged for existing rows.
export const NOTIFICATION_CHANNELS = ["email", "whatsapp"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];
export const DEFAULT_NOTIFICATION_CHANNELS: NotificationChannel[] = [
  "email",
  "whatsapp",
];

export const KYC_STATUSES = [
  "not_submitted",
  "submitted",
  "verified",
  "rejected",
] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];

export const KYC_DOC_SCAN_STATUSES = [
  "pending",
  "clean",
  "infected",
  "error",
] as const;
export type KycDocScanStatus = (typeof KYC_DOC_SCAN_STATUSES)[number];

export type KycDocument = {
  key: string;
  url: string;
  label: string;
  // Malware-scan state for the underlying GCS object. Reviewers must only
  // ever see documents in `clean` state — anything else is either still
  // queued, quarantined, or had a transient scan error.
  scanStatus?: KycDocScanStatus;
  scanCheckedAt?: string;
  scanDetails?: string;
  // Per-document rejection feedback. When a reviewer marks a specific
  // document as unclear/missing/expired, `rejectionReason` is the message
  // the applicant sees on their KYC page so they know which exact doc to
  // re-upload. Re-submitting via POST /me/kyc rebuilds the doc array from
  // scratch, so these fields naturally clear on the next submission.
  rejectionReason?: string;
  rejectedAt?: string;
};

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
  // Per-user preference for decision notifications. Stored as a Postgres
  // text[] (e.g. `{email,whatsapp}`) and read by `fireDecisionNotifications`
  // to skip channels the user has opted out of.
  notificationChannels: text("notification_channels")
    .array()
    .$type<NotificationChannel[]>()
    .notNull()
    .default(sql`ARRAY['email','whatsapp']::text[]`),
  // Tracks decision-email delivery so reviewers can see when the last
  // approval/rejection/KYC outcome email was dispatched (initial send or
  // resend) and how many times it has been sent in total.
  lastDecisionEmailAt: timestamp("last_decision_email_at", { withTimezone: true }),
  decisionEmailCount: integer("decision_email_count").notNull().default(0),
  // Timestamp of the last super-admin "resend decision email" action for
  // this user. Persisted (rather than held in a process-local Map) so the
  // one-resend-per-minute cooldown survives API restarts and is honoured
  // across multiple server instances.
  lastResendEmailAt: timestamp("last_resend_email_at", { withTimezone: true }),
  // Per-channel contact verification — set when the applicant proves they
  // own the address by entering the one-time code we sent them at signup.
  // Used by `fireDecisionNotifications` to skip channels we never confirmed
  // so the four pre-sign-in decision notices don't silently bounce or land
  // in a stranger's inbox. Legacy/seeded rows are backfilled (see
  // `scripts/src/seedUsers.ts`) so existing behaviour is unchanged.
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  // Pending verification codes per channel. Stored as hashes — the
  // plaintext code is only ever in the email/WhatsApp body. Each entry
  // carries `expiresAt` (codes are short-lived), `lastSentAt` (drives the
  // resend cooldown), and `attempts` (caps brute-force tries before the
  // applicant must request a fresh code).
  pendingVerifications: jsonb("pending_verifications").$type<PendingVerifications>(),
  // Personal payout destination — used when this user is the seller (rental
  // car owner). Service centers and vendors keep their own destinations on
  // the directory tables.
  payoutAccount: jsonb("payout_account").$type<PayoutAccountShape>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type PendingVerificationEntry = {
  codeHash: string;
  expiresAt: string;
  lastSentAt: string;
  attempts: number;
};

export type PendingVerifications = Partial<
  Record<NotificationChannel, PendingVerificationEntry>
>;

type PayoutAccountShape = {
  kind: "bank" | "momo";
  accountName: string;
  accountNumber: string;
  bank?: string;
  network?: string;
};

export type User = typeof usersTable.$inferSelect;
