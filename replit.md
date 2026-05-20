# AutoCare

Connected automotive service platform pairing vehicle owners, renters, service centers, parts vendors, delivery agents, and fleet operators.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — API server (port 5000)
- `pnpm --filter @workspace/autocare run dev` — web app
- `pnpm run typecheck` — full typecheck
- `pnpm run build` — typecheck + build
- `pnpm run test` — run all workspace test suites
- `pnpm --filter @workspace/api-spec run codegen` — regen hooks + Zod schemas from OpenAPI
- `pnpm --filter @workspace/db run push` — push DB schema (dev only)
- Required env: `DATABASE_URL`

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Zod, contract-first OpenAPI
- DB: PostgreSQL + Drizzle ORM
- Web: React 19 + Vite, wouter, TanStack Query, shadcn/ui, Tailwind v4, framer-motion, recharts, sonner
- Codegen: Orval (React Query hooks + Zod schemas)
- Build: esbuild (CJS bundle)

## Where things live

### Contracts & shared libs
- `lib/api-spec/openapi.yaml` — single source of truth for the API contract
- `lib/api-client-react/src/generated/` — generated hooks (`useGetBooking`, `getGetBookingQueryKey`, …) and Zod schemas (do NOT hand-edit)
- `lib/db/src/schema.ts` — core Drizzle schema (vehicles, service_centers, mechanics, bookings, booking_events, invoices)
- `lib/db/src/schema/users.ts` — auth + onboarding (`approvalStatus`, `kycStatus`, `kycDocuments`, `requestedRole`, `applicantData`)
- `lib/db/src/schema/subscriptionPlans.ts` — `PlanLimits` type + `DEFAULT_PLAN_LIMITS`; the jsonb `limits` column is the source of truth for enforced entitlements
- `lib/db/src/schema/drivers.ts` — chauffeur profiles (scoped by ownerPhone)
- `lib/db/src/schema/{tripLocations,rentalIncidents}.ts` — rental-booking-scoped GPS pings + safety reports
- `lib/db/src/schema/organizations.ts` — `organizations`, `organization_members`, `organization_preferred_centers`; `vehicles.organizationId` + `vehicles.assignedDriverPhone`
- `lib/db/src/schema/fleetTracking.ts` — vehicle-scoped fleet GPS + incidents (distinct from rental-booking-scoped tables)
- `lib/db/src/schema/fleetPartsOrders.ts` — org-scoped parts orders with approval workflow
- `lib/db/src/seed.ts` — demo data

### Server
- `artifacts/api-server/src/routes/` — Express handlers per resource
- `artifacts/api-server/src/lib/entitlements.ts` — `getEntitlements(kind,id)`, `getOwnerEntitlementsForVehicle`, `featuredSubscriberIds`; every plan-gated action goes through here
- `artifacts/api-server/src/routes/onboarding.ts` — KYC submit, super-admin approval queues, `requireKycVerified` middleware
- `artifacts/api-server/src/routes/organizations.ts` — fleet endpoints (intentionally outside OpenAPI; plain Express + Zod)
- `artifacts/api-server/src/lib/email.ts` — SendGrid wrapper for approval/KYC decision emails
- `artifacts/api-server/src/lib/kycScanner.ts` — ClamAV + heuristic upload scanner
- `artifacts/api-server/src/routes/rentals.access.test.ts` + `bookings.access.test.ts` — vitest IDOR/access-isolation coverage

### Web
- `artifacts/autocare/src/index.css` — warm-industrial theme tokens
- `artifacts/autocare/src/lib/role.ts` — role switch (owner/center/renter/fleet/vendor/delivery) persisted to localStorage
- `artifacts/autocare/src/lib/fleet-api.ts` — React Query hooks for fleet endpoints (plain fetch, not codegen)
- `artifacts/autocare/src/components/AppShell.tsx` — top bar + role-adaptive sidebar; `fleetNavFor()` trims by org role
- `artifacts/autocare/src/pages/{owner,center,shared,renter,fleet,onboarding,admin,super_admin,rentals}/` — role-scoped UI
- `artifacts/autocare/src/pages/Signup.tsx` — public role-picker signup; honours `?role=`
- `artifacts/autocare/src/pages/Login.tsx` — honours `?next=` (sanitised; must start with `/`, not `//`)
- `artifacts/autocare/src/pages/RegisterFleet.tsx` — public fleet signup

## Architecture decisions

### Foundations
- **Contract-first**: every API change goes OpenAPI → codegen → server route + client hook. Server handlers consume the generated Zod schemas, so types cannot drift. Exceptions (intentionally outside OpenAPI, single-client + plain Express+Zod): the maintenance-history CSV/PDF routes and all fleet endpoints.
- **Role switch is localStorage-backed**, driving navigation and which actions appear on shared pages. Renter and fleet are first-class roles with their own dashboards and trimmed sidebars (`RENTER_NAV`, `fleetNavFor()`).
- **Booking lifecycle** is a finite-state machine guarded server-side (`requested → accepted → in_progress → awaiting_approval → approved → completed`, with `cancelled`/`rejected` terminals); UI only surfaces legal transitions.
- **Conditional query hooks** require both `enabled` and an explicit `queryKey` — always pair `{ enabled, queryKey: getXQueryKey(id) }`. Invalidate via the same helper.

### Rentals
- A car carries `rentalModes: ('self_drive' | 'with_driver')[]`. `with_driver` requires a `driverId` owned by the same `ownerPhone`; dropping `with_driver` nulls `driverId`. With-driver bookings use `withDriverDailyRate` (falls back to `dailyRate`).
- Renter KYC minimum is a government ID photo; licence is optional. Use `isProfileReadyForBooking` for the base gate and `isProfileReadyForMode(profile, mode)` to require licence for self-drive.
- KYC approval is admin-only: `PATCH /renter-profiles/:id` returns **403** when a non-admin sends `kycStatus`. `UpsertRenterProfileInput` doesn't expose the field at all.
- `authorizeBookingAccess` in `routes/rentals.ts` is the single auth helper for any single-booking tracking/incident/signature endpoint — admin OR booking renter (by `req.user.phone`) OR car owner (by `ownerPhone`). Do not add new IDOR-prone routes without it.
- Incidents derive `reportedBy` from the verified relationship, not the request body. Renter-submitted GPS becomes a `trip_locations` ping + `lastKnown*`.
- **Owner/chauffeur PII redaction**: `GET /rental-cars` and `GET /rental-cars/:id` strip `ownerPhone`/`ownerEmail`/driver contact unless caller is admin, the car's owner, or a renter with a booking on the car in `contract_pending|awaiting_payment|confirmed|active|completed` (constants `OWNER_PII_BOOKING_STATUSES` / `DRIVER_PII_BOOKING_STATUSES` in `routes/rentals.ts`). Per-row owner self-unredact preserves "My Listings".
- **Share-link CTA** (`pages/rentals/SharedCar.tsx`) branches on auth: anonymous → Create renter account + Sign in (both `?next=/rentals/<id>`); signed-in non-renter → disabled "Switch to renter"; renter no-KYC → finish KYC; renter ready → book.

### Service bookings & parts orders
- `routes/bookings.ts` + `routes/invoices.ts` enforce ownership via `authorizeServiceBooking(req, res, bookingId)` — admin, vehicle owner (by phone), or center staff (`center_staff` table). Owner-only actions: approve/pay invoice. Center-only: status transitions, assign mechanic, create invoice. List endpoints are scoped per caller.
- `POST /orders` derives buyer identity from `req.user` (direct buy) or the booking's vehicle owner (proposal), never from the body — buyer name/phone can't be spoofed. `GET /orders?mine=true` scopes by session phone; only admin/vendor see the unfiltered list. Direct-buy checkout prefills shipping from the buyer's most recent direct-buy order (filter is `!bookingId && !mechanicId`, not status-based, so proposal orders never leak the service-center address).

### Subscriptions & entitlements
- Plans carry `features` (marketing copy on the plan card) and `limits` (`PlanLimits`, machine-enforced). Server gates only ever read `limits`. `getEntitlements` orders by `subscriptions.startedAt DESC` so multiple active subs resolve to the newest plan deterministically. Free-tier defaults live in `FREE_LIMITS` inside `entitlements.ts`.
- Quotas enforced today:
  - center `maxBookingsPerMonth` → `POST /bookings` (402 quota_exceeded)
  - vendor `maxPartsListed` → `POST /vendors/:vendorId/parts`
  - owner `priorityBooking` materialised on `bookings.priority` at create (ORed with org Fleet Pro when vehicle is org-attached)
  - owner `canExportHistory` → maintenance-history CSV/PDF
  - org `maxFleetVehicles` → `POST /organizations/:orgId/vehicles`
  - org `partsCostTransparency` → `GET /organizations/:orgId/parts-spend`
  - org `canExportHistory` → both fleet maintenance-history routes
- `featuredPlacement` floats centers/vendors to top of their directories. `dedicatedSupport` is a UI/marketing flag (no server gate).

### Fleet (organizations)
- `subscriberKind = "organization"`. Orgs have a many-to-many **preferred-pool** of service centers; `POST /bookings` enforces the pool when `vehicle.organizationId` is set (platform admins can override).
- `requireOrgMember(req, res, orgId, minRole?)` is the single fleet auth helper — platform admins synthesize an `admin` membership.
- Org member roles (`ORG_MEMBER_ROLES`): **admin** (full), **finance** (parts-order approval + billing), **manager** (places orders, day-to-day), **driver** (assigned vehicles + parts requests).
- **Parts-order approval** is org-scoped: when `organizations.requireFinanceApproval` is on, manager/driver checkouts create a `fleet_parts_orders` row in `pending_finance`. `organization_members.canCheckoutDirectly` overrides per-member. Admins + finance always bypass. Vendor-side fulfilment is intentionally NOT wired — "paid" represents approval + ledger settlement; the demo stops there.
- **Maintenance-history export** (CSV + PDF) at owner scope (`/vehicles/:vehicleId/maintenance-history.{csv,pdf}`) and fleet scope (`/organizations/:orgId/...` + per-vehicle, latter allows assigned driver). PDF streamed via `pdfkit` (external in `build.mjs` along with `fontkit`+`brotli` due to CJS resolution under esbuild). Hard cap 5000 rows. Two separate routes per format because Express 5 path-to-regexp rejects `:format(csv|pdf)`.

## Product

- **Owner**: dashboard with status breakdown + reminders, garage, center browser, multi-step booking, timeline, invoice approval + payment.
- **Service center**: control-panel dashboard, incoming-requests queue, active jobs, mechanic roster, accept/assign/invoice/complete workflow.
- **Renter**: dashboard (active/upcoming trips, KYC, lifetime spend), browse cars, MyRentals with incident reporting (opt-in geolocation).
- **Admin rentals**: Renters (KYC queue + history); Safety & Tracking (live trip list with freshness badges, SVG trail viewer, incident triage with Google Maps deep links — no Leaflet).
- **Fleet** (`role = "fleet"`): Dashboard (KPIs + reminders + parts-spend chart when on Fleet Pro), Vehicles (add/assign drivers), Team & Drivers (invite by phone + per-member direct-checkout toggle), Preferred Centers, Safety & Tracking, Settings (`Require finance approval` toggle), Parts Orders queue. Also accesses the shared Parts Marketplace via `buyersOnly` (now allows `fleet`).
- **Demo accounts** (`*@autocare.test`): owner/renter/center/vendor/delivery/admin/super_admin (password = `<role>1234`); fleet — admin Akosua (`fleet@autocare.test`), finance Ama (`finance@autocare.test`), drivers Kwame (cannot checkout directly) and Yaa (can). Demo fleet "MTN Ghana" has 4 vehicles, 2 preferred centers, Fleet Pro subscription, `requireFinanceApproval=true`.

## Onboarding & approvals

- **Self-signup at `/signup`**: anyone applies as owner / renter / center / vendor / delivery / fleet. Form is role picker → role-specific details → `POST /auth/signup` with `requestedRole` + `applicantData`. Applicants get `approvalStatus=pending` + `kycStatus=not_submitted` and **no** session cookie until a super admin approves.
- **Legacy `/auth/signup`** (no `requestedRole`, used by the rentals quick-signup) still auto-approves as `owner` and issues a cookie, so existing demo flows keep working. Seeded demo accounts are backfilled to `approved`+`verified` by `seedUsers.ts`.
- **Super-admin queues** at `/super-admin/approvals` (tabs: Applications / KYC / Rejected). Approve provisions the matching directory row (center / vendor / delivery / org with applicant as `admin` / renter-profile shell) keyed by phone; reject stores `approvalNote` shown on next login attempt.
- **Approved users land on `/onboarding/kyc`** with a role-specific checklist (gov ID + selfie for everyone; licence for renters & delivery; business reg for centers/vendors; org reg + sample vehicle reg for fleet). Uploads go through `@workspace/object-storage-web` `useUpload` and store as `/api/storage{objectPath}`. Resubmit flips `kycStatus` back to `submitted`.
- **Server enforcement**: `requireKycVerified` is mounted in `routes/index.ts` AFTER auth/storage/onboarding/landing-content but BEFORE every other resource router. Anonymous + admin/super_admin bypass; everyone else gets 403 `{reason}` until verified. `POST /auth/login` returns 403 `{reason:"pending"|"rejected", note?}` for non-approved users; `Login.tsx` shows banner UX.
- **Decision emails**: `PATCH /admin/approvals/:userId` + `PATCH /admin/kyc/:userId` fire a transactional email (approved / rejected / KYC verified / KYC rejected) via `lib/email.ts`. Fire-and-forget; failure never blocks the decision. Set `SENDGRID_API_KEY` (+ optional `EMAIL_FROM`) to enable delivery; without it the message is logged and `sendEmail` returns `{ok:false, reason:"not_configured"}`.
- **KYC upload hardening** (`POST /me/kyc`): every submitted URL runs through `validateKycDocumentUrl` which (1) rejects anything not `/api/storage/objects/...` or `/objects/...`, (2) confirms the object exists in our private bucket via `getObjectEntityFile()`, (3) re-enforces `contentType ∈ {jpeg,png,webp}` and `size ≤ 10 MB` from GCS metadata (constants exported from `routes/storage.ts` as `ALLOWED_UPLOAD_MIME` / `MAX_UPLOAD_BYTES`). Validated docs are passed to `scanKycDocument` (`lib/kycScanner.ts`): ClamAV via `CLAMAV_HOST`+`CLAMAV_PORT`/`CLAMAV_SOCKET` when set (fail-closed; 503 if unreachable), with a local EICAR + magic-byte / MIME-mismatch heuristic always running first because clamd doesn't catch rename attacks. Infected uploads are moved to `quarantine/` via `objectStorageService.quarantineObjectEntity` and never referenced from the user row. Docs carry `scanStatus` / `scanCheckedAt` / `scanDetails`; the super-admin Approvals UI hides anything with `scanStatus !== 'clean'`. Scanner backend is pluggable (swap `getClam`/`scanStream` for VirusTotal/Cloudmersive without touching the route).

## User preferences

- Warm-industrial workshop aesthetic; no emojis anywhere in UI; lucide-react for icons.

## Gotchas

- After editing `lib/db/src/schema.ts`, run `pnpm run typecheck:libs` once so other packages pick up new declarations.
- After editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before touching server routes or web hooks.
- Adding a new `PlanLimits` field requires four edits: (1) the TS type + `DEFAULT_PLAN_LIMITS` in `lib/db/src/schema/subscriptionPlans.ts`, (2) `PlanLimits` in `lib/api-spec/openapi.yaml` + codegen, (3) every plan-seed `limits` in `scripts/src/seedPlatform.ts`, (4) `EMPTY_LIMITS` + `LIMIT_LABEL` in `pages/admin/Plans.tsx`. Missing any breaks typecheck via the generated Zod schema.
- Do not hand-edit files under `lib/api-client-react/src/generated/` — they're overwritten.
- Conditional query hooks must include both `enabled` and `queryKey`, otherwise TS rejects them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
