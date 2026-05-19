import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Application user accounts. One account is provisioned per role for the demo
 * (owner, center, vendor, delivery, admin, super_admin); a real deployment
 * would let people sign up themselves.
 *
 * `passwordHash` stores `scrypt(password, salt)` as `salt:hash` (both hex).
 */
export const usersTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  phone: text("phone"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
