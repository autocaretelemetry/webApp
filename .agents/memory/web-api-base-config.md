---
name: Web configurable API origin (split-domain)
description: How the AutoCare web app targets a same-origin vs. external API origin, and the render-time pitfall to keep in mind.
---

# Configurable web API origin

The web app supports two deploy shapes from one build: same-origin (Replit proxy, `/api`) and split-domain (e.g. Render: static site + separate API service). `artifacts/autocare/src/lib/api-base.ts` is the single source of truth: `VITE_API_BASE_URL` (build-time) → external origin; unset → same-origin. It exports `API_ROOT` (root for hand-written `/api` calls) and `API_ORIGIN` (origin or `""`), and `configureApiBaseUrl()` (sets the Orval client base) called once in `main.tsx`.

**Why:** generated Orval hooks route via `setBaseUrl`, but hand-written `fetch()` calls, download `href`s, and **rendered media** do not — they must be routed explicitly or they hit the wrong origin under split-domain.

**How to apply — every kind of API/media URL sink must be covered, not just fetch:**
- Hand-written `fetch(...)` / download links → build from `API_ROOT` (drop the literal `/api`; `API_ROOT` already includes it).
- Stored media rendered in `<img src>` AND in `<a href>` (KYC docs, listing docs open-links) → wrap in `resolveImageUrl()` from `lib/format.ts`. It passes absolute URLs through, returns `""` for empty, prepends `API_ROOT` for storage paths, and `API_ORIGIN` for already-`/api`-prefixed values. Bundled static imports (e.g. Landing logo) must NOT be re-wrapped.
- Persisted upload paths (the `onChange(\`/api/storage…\`)` lines) stay **relative** — origin is added at render time by `resolveImageUrl`, so the DB never stores an environment-specific origin.

**Audit before claiming done:** grep for `fetch("/api`, `href={…url}`, and `<img src={…}` across `artifacts/autocare/src`; the only allowed bare `/api` literals are comments, the persisted onChange storage lines, and the two helper files. A reviewer caught media `href`s and direct `<img>` sinks three separate times — fetch-only sweeps miss them.

**Known gap (intentional):** cross-origin cookie auth (`credentials:"include"` + cookie sessions) needs server CORS + `SameSite=None; Secure` cookies for true two-origin operation; not yet implemented.

## Deploying off Replit (Render etc.)

Two shapes — prefer **single-service**:
- **Single Node service (recommended):** the API server serves the built web SPA from the same origin. `app.ts` `resolveWebDistDir()` locates `artifacts/autocare/dist/public` and adds `express.static` + an SPA fallback, gated off when `NODE_ENV==="development"` (Replit dev keeps web on the Vite server). Same origin → the cross-origin cookie gap above is moot. Stock root `pnpm run build` + `pnpm start` now deploy this (see "Render gotchas" below); the explicit `--filter` web+api build is equivalent.
- **Split-domain:** static web site + separate API service; requires the unfinished CORS + cookie work, so login won't persist.

**Why these bite:**
- The web `vite.config.ts` historically threw on missing `PORT` (and `BASE_PATH`) even for a static `vite build`; a Static-Site/CI build has no server and no env wiring, so it failed. Fix: enforce `PORT` only when `command === "serve"`, and require `BASE_PATH` only in `serve` (build defaults it to `/`). See the "Render gotchas" section below for the current rule.
- The root build *used to* build *every* artifact incl. mobile (expo) + mockup-sandbox, so any one failing killed the deploy. That is why root `pnpm run build` was rescoped to web+api only (`build:all` keeps the build-everything behavior) — see "Render gotchas" below.
- SPA fallback must skip the API: guard with segment-aware, case-insensitive `^/api(?:/|$)` (not `startsWith("/api")`, which false-matches `/apiary`) and mount it AFTER the `/api` router.

**Render gotchas learned the hard way:**
- Committing a `render.yaml` does NOT reconfigure an already-existing manually-created Render service — it only applies to Blueprint-created services. A manual service keeps whatever build/start command was set in its dashboard. So the fix must either be applied in the dashboard OR baked into the repo's own root scripts.
- Because the user's manual service was pinned to root `pnpm run build`, the durable fix was to make the ROOT scripts deploy-safe: `pnpm run build` now full-typechecks then builds ONLY autocare web + api-server (mobile/expo + mockup-sandbox are typechecked but not built); `pnpm run build:all` keeps the build-everything behavior; root `pnpm start` runs the api-server. So a stock `pnpm run build` + `pnpm start` deploys the single service with zero dashboard edits.
- `vite.config.ts` defaults `BASE_PATH` to `/` for `command !== "serve"` (build) so a production build needs no env wiring; `serve` (Replit dev) still requires it.
