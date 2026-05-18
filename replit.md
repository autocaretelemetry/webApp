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

## Product

- **Owner experience**: dashboard with status breakdown and reminders, vehicle garage, service-center browser, multi-step booking flow, booking timeline, invoice approval + payment.
- **Service-center experience**: control-panel dashboard, incoming-requests queue, active jobs board, mechanic roster, accept/assign-mechanic/create-invoice/complete workflow.
- **Shared**: bookings list with status filters, booking detail with role-aware actions, invoice detail.

## User preferences

- Warm-industrial workshop aesthetic; no emojis anywhere in UI; lucide-react for icons.

## Gotchas

- After editing `lib/db/src/schema.ts`, run `pnpm run typecheck:libs` once so other packages pick up new declarations.
- After editing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before touching server routes or web hooks.
- Do not hand-edit files under `lib/api-client-react/src/generated/` — they are overwritten by codegen.
- Conditional query hooks must include both `enabled` and `queryKey` in the `query` option, otherwise TypeScript will reject them.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
