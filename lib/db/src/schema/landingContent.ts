import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";

// Single-row table (id always "default") that holds every editable bit of
// the public landing page. Storing the rich lists (roles, features) as JSONB
// keeps the super-admin editor flexible without per-field migrations.
export const landingContentTable = pgTable("landing_content", {
  id: text("id").primaryKey().default("default"),

  brandName: text("brand_name").notNull().default("AutoCare"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").notNull().default("#E25A1C"),

  signInLabel: text("sign_in_label").notNull().default("Sign in"),
  getStartedLabel: text("get_started_label").notNull().default("Get started"),

  heroEyebrow: text("hero_eyebrow")
    .notNull()
    .default("Connected automotive service platform"),
  heroTitle: text("hero_title")
    .notNull()
    .default("One platform for every side of your garage."),
  heroSubtitle: text("hero_subtitle")
    .notNull()
    .default(
      "AutoCare pairs vehicle owners with service centers, parts vendors, and delivery agents. Track maintenance, book service, approve invoices, and keep the whole workshop moving — without leaving the app.",
    ),
  heroCtaLabel: text("hero_cta_label")
    .notNull()
    .default("Sign in to your account"),
  heroImageUrl: text("hero_image_url"),

  rolesHeading: text("roles_heading").notNull().default("Built for every role"),
  roles: jsonb("roles")
    .$type<Array<{ icon: string; title: string; desc: string }>>()
    .notNull()
    .default([
      { icon: "car", title: "Vehicle owners", desc: "Track every car you own, book service from trusted centers, and approve invoices before you pay." },
      { icon: "building", title: "Service centers", desc: "Triage incoming requests, assign mechanics, and bill customers — all from one operations board." },
      { icon: "package", title: "Parts vendors", desc: "List parts to a connected marketplace and fulfill orders from owners and centers in one place." },
      { icon: "truck", title: "Delivery agents", desc: "Pick up parts orders, run routes, and update statuses on the go." },
      { icon: "shield", title: "Platform admins", desc: "Onboard centers, vendors, and agents; manage plans, subscriptions, and revenue." },
    ]),

  featuresHeading: text("features_heading")
    .notNull()
    .default("Everything you need to run the workshop."),
  featuresSubtitle: text("features_subtitle")
    .notNull()
    .default(
      "From the first request to the final receipt, AutoCare keeps owners, centers, vendors, and agents on the same page.",
    ),
  features: jsonb("features")
    .$type<string[]>()
    .notNull()
    .default([
      "Time + mileage service reminders, delivered in-app and via push",
      "WhatsApp alerts to centers for new jobs, approved invoices, and payments",
      "Booking lifecycle protected by a finite-state machine, end-to-end",
      "Connected marketplace for parts, with cart and checkout for both owners and centers",
      "Peer-to-peer car rentals with KYC, KYV, and admin moderation",
    ]),

  footerText: text("footer_text")
    .notNull()
    .default("© AutoCare. All rights reserved."),
  footerSignInLabel: text("footer_sign_in_label").notNull().default("Sign in"),

  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type LandingContent = typeof landingContentTable.$inferSelect;
