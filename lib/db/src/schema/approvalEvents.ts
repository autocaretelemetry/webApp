import { pgTable, uuid, text, boolean, timestamp, index } from "drizzle-orm/pg-core";

export const APPROVAL_EVENT_ACTIONS = [
  "applied",
  "approved",
  "rejected",
  "kyc_submitted",
  "kyc_verified",
  "kyc_rejected",
  "note",
] as const;
export type ApprovalEventAction = (typeof APPROVAL_EVENT_ACTIONS)[number];

export const approvalEventsTable = pgTable(
  "approval_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    actorUserId: uuid("actor_user_id"),
    actorName: text("actor_name"),
    action: text("action").notNull(),
    note: text("note"),
    internal: boolean("internal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("approval_events_user_created_idx").on(t.userId, t.createdAt),
  ],
);

export type ApprovalEvent = typeof approvalEventsTable.$inferSelect;
