# AutoCare

Connected automotive service platform that pairs vehicle owners with service centers — owners track their vehicles, book services, and approve invoices; centers triage incoming requests, assign mechanics, and bill customers.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/autocare run dev` — run the AutoCare web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5, Zod validation, contract-first via OpenAPI
- DB: PostgreSQL + Drizzle ORM
- Web: React 19 + Vite, wouter, TanStack Query, shadcn/ui, Tailwind v4, framer-motion, recharts, sonner
- API codegen: Orval (React Query hooks + Zod schemas from OpenAPI)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for the API contract
- `lib/api-client-react/src/generated/` — generated hooks (`useGetBooking`, `getGetBookingQueryKey`, etc.) and Zod schemas
- `lib/db/src/schema.ts` — Drizzle schema for vehicles, service_centers, mechanics, bookings, booking_events, invoices
- `lib/db/src/schema/subscriptionPlans.ts` — `PlanLimits` type + `DEFAULT_PLAN_LIMITS`; `subscription_plans.limits` jsonb is the source of truth for enforced entitlements
- `lib/db/src/schema/users.ts` — adds `approvalStatus`, `approvalNote`, `kycStatus`, `kycNote`, `kycDocuments` (jsonb), `requestedRole`, `applicantData` (jsonb) for self-signup + KYC onboarding
- `artifacts/api-server/src/routes/onboarding.ts` — `POST /me/kyc`, `GET /admin/approvals?state=`, `PATCH /admin/approvals/:userId`, `PATCH /admin/kyc/:userId`, and the `requireKycVerified` middleware
- `artifacts/autocare/src/pages/Signup.tsx` — public role-picker signup form
- `artifacts/autocare/src/pages/onboarding/{Kyc,Rejected}.tsx` — KYC upload + rejection screens
- `artifacts/autocare/src/pages/super_admin/Approvals.tsx` — super-admin applications / KYC / rejected tabs
- `artifacts/api-server/src/lib/entitlements.ts` — `getEntitlements(kind,id)`, `getOwnerEntitlementsForVehicle(vehicleId)`, `featuredSubscriberIds(kind, ids)`; every plan-gated server action goes through here
- `lib/db/src/schema/drivers.ts` — chauffeur profiles attached to with-driver listings (scoped by ownerPhone)
- `lib/db/src/schema/tripLocations.ts` — append-only GPS pings for live rental tracking (source: device/owner/admin/sim)
- `lib/db/src/schema/rentalIncidents.ts` — theft/accident/breakdown/SOS reports tied to a rental booking
- `lib/db/src/schema/organizations.ts` — fleet `organizations`, `organization_members` (admin|driver), `organization_preferred_centers` (M2M); `vehicles.organizationId` + `vehicles.assignedDriverPhone` attach a vehicle to a fleet
- `artifacts/api-server/src/routes/organizations.ts` — fleet endpoints (signup, CRUD, members, preferred-centers PUT, fleet vehicles, dashboard, parts-spend); guarded by `requireOrgMember`; intentionally outside OpenAPI (single client, plain Express + Zod)
- `artifacts/autocare/src/lib/fleet-api.ts` — React Query hooks for fleet endpoints (plain fetch, not codegen)
- `artifacts/autocare/src/pages/fleet/{Dashboard,Vehicles,Drivers,Centers,Settings,Safety,Orders}.tsx` — fleet-role UI (Orders = parts-order approval queue)
- `lib/db/src/schema/fleetPartsOrders.ts` — org-scoped parts orders (`pending_finance|approved|paid|rejected`) with item snapshot, requester, approver, payer, rejection reason
- `organizations.requireFinanceApproval` (bool) + `organization_members.canCheckoutDirectly` (bool) — org-level approval toggle and per-member bypass override
- `lib/db/src/schema/fleetTracking.ts` — `fleet_trip_locations` (vehicle-scoped GPS pings) and `fleet_incidents` (vehicle-scoped safety events); both distinct from the rental-booking-scoped `tripLocations`/`rentalIncidents` tables
- `artifacts/autocare/src/pages/RegisterFleet.tsx` — public "Register your fleet" signup
- `artifacts/autocare/src/pages/rentals/Drivers.tsx` — owner-facing driver CRUD
- `artifacts/autocare/src/pages/admin/Renters.tsx` — admin renter directory + KYC approve/reject
- `artifacts/autocare/src/pages/admin/Safety.tsx` — admin live-trip + incident triage (Google Maps deep links + inline SVG trail)
- `artifacts/autocare/src/pages/rentals/MyRentals.tsx` — renter "Report incident" dialog (geolocation-capable)
- `lib/db/src/seed.ts` — demo data (3 centers, 5 mechanics, 2 vehicles, 5 bookings, 3 invoices)
- `artifacts/api-server/src/routes/` — Express route handlers per resource
- `artifacts/autocare/src/index.css` — warm-industrial theme tokens (orange primary, teal secondary, concrete-beige background)
- `artifacts/autocare/src/lib/role.ts` — owner/center role switch persisted to localStorage
- `artifacts/autocare/src/components/AppShell.tsx` — top bar + role-adaptive sidebar
- `artifacts/autocare/src/pages/{owner,center,shared}/` — role-scoped and shared pages

## Architecture decisions

- Single app, two roles: a localStorage-backed role switch (`owner` | `center`) drives navigation and what actions are available on shared pages like booking detail — no separate logins for the MVP.
- Contract-first: every API change goes OpenAPI → codegen → server route + client hook. Server handlers consume the same generated Zod schemas, so request/response types cannot drift from the contract.
- Booking lifecycle is one finite-state machine guarded server-side (`requested → accepted → in_progress → awaiting_approval → approved → completed`, with `cancelled`/`rejected` terminal branches); UI surfaces only the actions legal for the current state and role.
- Generated React Query hooks require an explicit `queryKey` when `enabled` is conditional — always pair `{ enabled, queryKey: getXQueryKey(id) }`. Invalidate via the same `getXQueryKey` helper after mutations.
- A rental car carries `rentalModes: ('self_drive' | 'with_driver')[]` (at least one). Any listing that includes `with_driver` MUST have a valid `driverId` belonging to the same `ownerPhone`; the server validates and the UI prevents otherwise. Dropping `with_driver` on update nulls `driverId` automatically. With-driver bookings use `withDriverDailyRate` (falling back to `dailyRate` when unset).
- Renter KYC minimum is a government ID photo; the driver's licence is optional for everyone. Use `isProfileReadyForBooking` for the base gate and `isProfileReadyForMode(profile, mode)` to require licence info only for self-drive bookings.
- KYC approval is admin-only: `PATCH /renter-profiles/:id` returns **403** when a non-admin includes `kycStatus` in the body. The renter `UpsertRenterProfileInput` doesn't expose the field at all.
- All rental tracking + incident endpoints are guarded server-side. `authorizeBookingAccess` in `routes/rentals.ts` lets through (1) admin/super_admin, (2) the booking's renter (matched by `req.user.phone`), or (3) the car owner (matched by `rentalCarsTable.ownerPhone`). Use it for any new endpoint that touches a single booking's tracking, incident, or signature data — don't add new IDOR-prone routes without it.
- Incidents derive `reportedBy` from the verified relationship, not the request body — the client cannot spoof it. When the renter ships GPS in the body, the server inserts a `trip_locations` ping and uses those coords as `lastKnown*`; otherwise it falls back to the most recent ping.
- Fleet members have four roles (`ORG_MEMBER_ROLES` in `lib/db/src/schema/organizations.ts`): **admin** (full control), **finance** (parts-order approval + billing visibility), **manager** (places parts orders, manages day-to-day), **driver** (assigned vehicles + parts requests). The sidebar is trimmed per role by `fleetNavFor()` in `AppShell.tsx` — drivers only see Dashboard, Vehicles, Marketplace, Parts Orders; admins see everything.
- Parts-order approval workflow is org-scoped, not vendor-scoped. When `organizations.requireFinanceApproval` is on, manager/driver cart checkouts route through the fleet branch in `Checkout.tsx` and create a `fleet_parts_orders` row in `pending_finance` status. `organization_members.canCheckoutDirectly` is a per-member override that lets a specific manager/driver bypass the queue. Admins and finance always bypass. The button label in checkout flips between **"Pay now"** and **"Submit for finance approval"** based on the resolved permission. Endpoints (`POST/GET /organizations/:orgId/parts-orders`, `.../pay`, `.../reject`) live in `routes/organizations.ts` and use `canCheckoutDirectly()` + `isFinanceLevel()` helpers. Vendor-side fulfilment is intentionally NOT wired — "paid" represents both approval + settlement on the fleet ledger; the demo stops there. The Orders page (`pages/fleet/Orders.tsx`) has pending/paid/rejected/all tabs with **Approve & pay** and **Reject (with reason)** actions for finance/admin; everyone else sees only the orders they submitted (filtered server-side).
- Fleet management is a first-class subscriber tier (`subscriberKind = "organization"`). Orgs have a many-to-many **preferred-pool** of service centers. `requireOrgMember(req, res, orgId, minRole?)` is the single auth helper — platform admins synthesize an `admin` membership for support without being added to the members table. Fleet routes are deliberately **outside OpenAPI** (same precedent as the maintenance-history CSV/PDF route): they're consumed by one client, so we hit plain Express + Zod with React Query and skip the codegen churn. Quotas enforced today: org `maxFleetVehicles` on `POST /organizations/:orgId/vehicles` (402 quota_exceeded), `partsCostTransparency` gating `GET /organizations/:orgId/parts-spend`, `canExportHistory` gating both fleet maintenance-history routes (org-wide + per-vehicle), and `priorityBooking` from Fleet Pro flows into `POST /bookings` for org-attached vehicles (ORed with the owner-subscription value so either path can upgrade the booking). `POST /bookings` also enforces the preferred-pool: if `vehicle.organizationId` is set, the chosen center must be in `organization_preferred_centers` (platform admins can override). `dedicatedSupport` is a UI/marketing flag (no server gate). Free-tier default is `{ maxFleetVehicles: 3 }`.
- Subscription plans carry both free-form `features` (marketing copy on the plan card) and `limits` (machine-enforced `PlanLimits`). Server gates only ever read `limits` — never parse `features`. Quotas enforced today: center `maxBookingsPerMonth` on `POST /bookings` (402 quota_exceeded), vendor `maxPartsListed` on `POST /vendors/:vendorId/parts`, owner `priorityBooking` materialised onto `bookings.priority` at create time, owner `canExportHistory` gating the CSV export. `featuredPlacement` floats centers/vendors to the top of their directories. Free-tier defaults live in `FREE_LIMITS` inside `entitlements.ts`. `getEntitlements` orders by `subscriptions.startedAt DESC` so multiple active subs resolve deterministically to the newest plan.
- Maintenance-history export lives outside OpenAPI by design. Two sibling routes — `GET /vehicles/:vehicleId/maintenance-history.csv` and `.pdf` — share a single handler factory (`maintenanceHistoryHandler(format)`) because Express 5's path-to-regexp rejects inline regex like `:format(csv|pdf)`. Both require auth, allow only the matched owner (by `req.user.phone === vehicle.ownerPhone`) or admin, and 402 when the owner's plan lacks `canExportHistory`. The PDF is streamed via `pdfkit` (kept external in `build.mjs` along with `fontkit` and `brotli` because their CJS helper resolution breaks under esbuild bundling). The owner UI exposes "Export PDF" and "Export CSV" buttons on the vehicle detail page; both hit the route with `fetch(..., { credentials: "include" })` and trigger a Blob download.
- Fleet maintenance-history export mirrors the owner version with two scopes: org-wide rollup at `GET /organizations/:orgId/maintenance-history.{csv,pdf}` (admin-only, includes a Vehicle column / per-section header) and per-vehicle at `GET /organizations/:orgId/vehicles/:vehicleId/maintenance-history.{csv,pdf}` (admin **or** the assigned driver, via `requireOrgVehicle`). Implemented in `routes/organizations.ts` with a shared `buildHistoryRows` + `sendHistoryCsv` / `sendHistoryPdf` pair. Both routes gate on `canExportHistory` (402 `entitlement_required` when the org's plan doesn't include it; platform admins bypass). Hard-capped at 5000 rows with a "truncated" footer to bound memory and CPU. The Fleet UI exposes "Export CSV" / "Export PDF" in the Dashboard header (fleet-wide) and on each Fleet Vehicles row (per vehicle); both reuse `downloadFleetHistory()` in `lib/fleet-api.ts`.

## Product

- **Owner experience**: dashboard with status breakdown and reminders, vehicle garage, service-center browser, multi-step booking flow, booking timeline, invoice approval + payment.
- **Service-center experience**: control-panel dashboard, incoming-requests queue, active jobs board, mechanic roster, accept/assign-mechanic/create-invoice/complete workflow.
- **Shared**: bookings list with status filters, booking detail with role-aware actions, invoice detail.
- **Admin rentals safety**: Renters page (KYC queue + history) and Safety & Tracking page (live trip list with freshness badges, SVG trip trail viewer, incident triage with one-tap "Open in Google Maps" deep links — no Leaflet dependency).
- **Renter incident reporting**: MyRentals exposes "Report incident" on confirmed/active bookings; dialog captures browser geolocation (opt-in) and posts it alongside the report so admins see a fresh `lastKnown` ping.
- **Fleet experience** (`role = "fleet"`): org admins manage their fleet from a dedicated dashboard (KPIs + reminders + parts-spend chart when on Fleet Pro), Vehicles page (add/assign drivers), Team & Drivers page (invite by phone with one of 4 roles + per-member direct-checkout toggle), Preferred Centers (multi-select from the global directory), Safety & Tracking (live last-known positions + incident triage with Google Maps deep links), Settings (org profile + **Require finance approval** toggle), and a Parts Orders queue with pending/paid/rejected tabs. Fleet users also access the shared Parts Marketplace (via `buyersOnly` which now allows `fleet`); checkout there routes through the org's approval workflow. Public signup at `/register-fleet`. Demo seed: "MTN Ghana" with 4 vehicles, admin (Akosua, fleet@autocare.test/fleet1234), finance (Ama, finance@autocare.test/finance1234), 2 drivers (Kwame canCheckoutDirectly=false, Yaa=true), 2 preferred centers, subscribed to Fleet Pro, `requireFinanceApproval=true`.

## Onboarding & approvals

- Self-signup at `/signup` lets anyone apply as one of: car owner, renter, service center, parts vendor, delivery agent, or fleet/institution. The form is two-step (role picker → role-specific details) and posts to `POST /auth/signup` with `requestedRole` + `applicantData`.
- Applicants are inserted with `approvalStatus=pending` + `kycStatus=not_submitted` and DO NOT receive a session cookie. They cannot sign in until a super admin approves them.
- Super admin reviews queues at `/super-admin/approvals` with tabs for Applications, KYC submissions, and Rejected. Approve provisions the matching directory row (service-center / vendor / delivery-agent / organisation with the applicant as `admin` member / renter-profile shell) keyed by phone; reject stores `approvalNote` shown back to the applicant on next login attempt.
- After approval, the user lands on `/onboarding/kyc` with a role-specific checklist (gov ID + selfie for everyone; driver's licence for renters & delivery; business registration for centers/vendors; org reg + sample vehicle reg for fleet). Uploads reuse `@workspace/object-storage-web` `useUpload` and store as `/api/storage{objectPath}`. Resubmitting flips `kycStatus` back to `submitted` for re-review.
- Server enforcement: `routes/onboarding.ts` exports a `requireKycVerified` middleware mounted in `routes/index.ts` AFTER auth/storage/onboarding/landing-content but BEFORE every other resource router. Anonymous traffic and admin/super_admin bypass; everyone else gets 403 `{reason}` until verified.
- Login enforcement: `POST /auth/login` returns 403 with `{reason:"pending"}` or `{reason:"rejected", note}` for non-approved users; Login.tsx parses these into banner UX instead of the generic toast.
- Grandfathering: existing seeded demo accounts are backfilled to `approved`+`verified` via `seedUsers.ts` so the demo experience is unchanged. New legacy `POST /auth/signup` calls (no `requestedRole` — used by the rentals quick-signup flow) still auto-approve as `owner` and issue a cookie so existing flows keep working.

## User preferences

- Warm-industrial workshop aesthetic; no emojis anywhere in UI; lucide-react for icons.

## Gotchas

- After editing `lib/db/src/schema.ts`, run `pnpm run typecheck:libs` once so other packages pick up new declarations.
- After editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before touching server routes or web hooks.
- When adding a new `PlanLimits` field, you MUST: (1) extend the TS type + `DEFAULT_PLAN_LIMITS` in `lib/db/src/schema/subscriptionPlans.ts`, (2) extend `PlanLimits` in `lib/api-spec/openapi.yaml` and run codegen, (3) backfill every plan-seed `limits` object in `scripts/src/seedPlatform.ts`, and (4) update `EMPTY_LIMITS` + `LIMIT_LABEL` in `artifacts/autocare/src/pages/admin/Plans.tsx`. Skipping any of these breaks typecheck via the generated Zod schema.
- Do not hand-edit files under `lib/api-client-react/src/generated/` — they are overwritten by codegen.
- Conditional query hooks must include both `enabled` and `queryKey` in the `query` option, otherwise TypeScript will reject them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
