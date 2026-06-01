import { setBaseUrl } from "@workspace/api-client-react";

// Where the AutoCare API lives.
//
// - On Replit (and any single-origin deploy) the reverse proxy serves the API
//   under `/api` on the same domain as the web app, so no origin is needed.
// - On split-domain deploys (e.g. Render: a Static Site for the web app + a
//   separate Web Service for the API) set `VITE_API_BASE_URL` at build time to
//   the API server's absolute origin and every request is sent there instead.
const configuredOrigin = (import.meta.env.VITE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

// Base path the web app is served under (Vite `base`), trailing slash stripped.
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Configured external API origin (e.g. `https://autocare-api.onrender.com`),
 * or `""` when the API is same-origin. Use this to absolutise an already
 * `/api`-prefixed path without duplicating the `/api` segment.
 */
export const API_ORIGIN = configuredOrigin;

/**
 * Root URL for API requests. Points at the configured external origin's `/api`
 * when set, otherwise at the same-origin proxy. Used by hand-written fetch
 * helpers and download links that live outside the generated OpenAPI client.
 */
export const API_ROOT = configuredOrigin
  ? `${configuredOrigin}/api`
  : `${basePath}/api`;

/**
 * Configure the generated Orval client's base URL. Call once at app startup,
 * before any hook fires. When `VITE_API_BASE_URL` is set the generated hooks
 * (which use root-relative `/api/...` paths) are redirected to the external
 * API origin; otherwise they keep hitting the same-origin proxy.
 */
export function configureApiBaseUrl(): void {
  if (configuredOrigin) {
    setBaseUrl(configuredOrigin);
  }
}
