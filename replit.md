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
- `artifacts/api-server/src/lib/entitlements.ts` — `getEntitlements(kind,id)`, `getOwnerEntitlementsForVehicle(vehicleId)`, `featuredSubscriberIds(kind, ids)`; every plan-gated server action goes through here
- `lib/db/src/schema/drivers.ts` — chauffeur profiles attached to with-driver listings (scoped by ownerPhone)
- `lib/db/src/schema/tripLocations.ts` — append-only GPS pings for live rental tracking (source: device/owner/admin/sim)
- `lib/db/src/schema/rentalIncidents.ts` — theft/accident/breakdown/SOS reports tied to a rental booking
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
- Subscription plans carry both free-form `features` (marketing copy on the plan card) and `limits` (machine-enforced `PlanLimits`). Server gates only ever read `limits` — never parse `features`. Quotas enforced today: center `maxBookingsPerMonth` on `POST /bookings` (402 quota_exceeded), vendor `maxPartsListed` on `POST /vendors/:vendorId/parts`, owner `priorityBooking` materialised onto `bookings.priority` at create time, owner `canExportHistory` gating the CSV export. `featuredPlacement` floats centers/vendors to the top of their directories. Free-tier defaults live in `FREE_LIMITS` inside `entitlements.ts`. `getEntitlements` orders by `subscriptions.startedAt DESC` so multiple active subs resolve deterministically to the newest plan.
- Maintenance-history export lives outside OpenAPI by design. Two sibling routes — `GET /vehicles/:vehicleId/maintenance-history.csv` and `.pdf` — share a single handler factory (`maintenanceHistoryHandler(format)`) because Express 5's path-to-regexp rejects inline regex like `:format(csv|pdf)`. Both require auth, allow only the matched owner (by `req.user.phone === vehicle.ownerPhone`) or admin, and 402 when the owner's plan lacks `canExportHistory`. The PDF is streamed via `pdfkit` (kept external in `build.mjs` along with `fontkit` and `brotli` because their CJS helper resolution breaks under esbuild bundling). The owner UI exposes "Export PDF" and "Export CSV" buttons on the vehicle detail page; both hit the route with `fetch(..., { credentials: "include" })` and trigger a Blob download.

## Product

- **Owner experience**: dashboard with status breakdown and reminders, vehicle garage, service-center browser, multi-step booking flow, booking timeline, invoice approval + payment.
- **Service-center experience**: control-panel dashboard, incoming-requests queue, active jobs board, mechanic roster, accept/assign-mechanic/create-invoice/complete workflow.
- **Shared**: bookings list with status filters, booking detail with role-aware actions, invoice detail.
- **Admin rentals safety**: Renters page (KYC queue + history) and Safety & Tracking page (live trip list with freshness badges, SVG trip trail viewer, incident triage with one-tap "Open in Google Maps" deep links — no Leaflet dependency).
- **Renter incident reporting**: MyRentals exposes "Report incident" on confirmed/active bookings; dialog captures browser geolocation (opt-in) and posts it alongside the report so admins see a fresh `lastKnown` ping.

## User preferences

- Warm-industrial workshop aesthetic; no emojis anywhere in UI; lucide-react for icons.

## Gotchas

- After editing `lib/db/src/schema.ts`, run `pnpm run typecheck:libs` once so other packages pick up new declarations.
- After editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before touching server routes or web hooks.
- Do not hand-edit files under `lib/api-client-react/src/generated/` — they are overwritten by codegen.
- Conditional query hooks must include both `enabled` and `queryKey` in the `query` option, otherwise TypeScript will reject them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
