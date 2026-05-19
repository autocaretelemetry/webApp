import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";

export const notificationsTable = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerPhone: text("owner_phone").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    vehicleId: uuid("vehicle_id"),
    bookingId: uuid("booking_id"),
    dedupeKey: text("dedupe_key").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_owner_dedupe_uq").on(t.ownerPhone, t.dedupeKey),
    index("notifications_owner_created_idx").on(t.ownerPhone, t.createdAt),
  ],
);

export type Notification = typeof notificationsTable.$inferSelect;
