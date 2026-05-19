import { pgTable, uuid, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const renterProfilesTable = pgTable(
  "renter_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    email: text("email"),
    address: text("address"),
    dateOfBirth: text("date_of_birth"),
    // KYC documents — store as URLs (image hosting handled out of band).
    driverLicenseNumber: text("driver_license_number"),
    driverLicenseUrl: text("driver_license_url"),
    idDocumentType: text("id_document_type"),
    idDocumentUrl: text("id_document_url"),
    selfieUrl: text("selfie_url"),
    // Platform-level KYC status (separate from any per-booking owner review).
    kycStatus: text("kyc_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phoneIdx: uniqueIndex("renter_profiles_phone_idx").on(t.phone),
  }),
);

export type RenterProfile = typeof renterProfilesTable.$inferSelect;
