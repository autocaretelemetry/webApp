import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";

// Audit log for every invocation of the service-reminder generator —
// in-process tick, manual admin trigger, or external scheduled deployment.
// Lets platform admins see when reminders last ran and whether the run
// succeeded without having to tail server logs.
export const reminderRunsTable = pgTable(
  "reminder_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // "scheduler" = in-process interval, "manual" = admin endpoint,
    // "external" = invoked by `scripts/runReminders.ts` (Replit
    // Scheduled Deployment or any other external cron).
    trigger: text("trigger").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // "success" once finishedAt is set without an error, "error" when
    // the generator threw. Rows with status="running" and no finishedAt
    // indicate a crashed run and are surfaced to admins as such.
    status: text("status").notNull().default("running"),
    createdCount: integer("created_count").notNull().default(0),
    errorMessage: text("error_message"),
  },
  (t) => [index("reminder_runs_started_idx").on(t.startedAt)],
);

export type ReminderRun = typeof reminderRunsTable.$inferSelect;
export type ReminderRunTrigger = "scheduler" | "manual" | "external";
