/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the AutoCare API server (e.g.
   * `https://autocare-api.onrender.com`). Leave unset for single-origin
   * deployments (Replit) where the proxy serves the API under `/api` on the
   * same domain as the web app.
   */
  readonly VITE_API_BASE_URL?: string;
}
