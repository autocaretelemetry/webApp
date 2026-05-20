import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "../app";

// Sanity coverage for task #48: every router under src/routes/ that exposes
// service data must reject anonymous traffic with 401. The list below is a
// representative slice (one endpoint per router) — not exhaustive, but it
// catches regressions when someone adds a router and forgets the auth gate.
const PROTECTED: Array<{ method: "get" | "post"; path: string; body?: unknown }> = [
  { method: "get", path: "/api/vehicles" },
  { method: "get", path: "/api/service-centers" },
  { method: "get", path: "/api/mechanics" },
  { method: "get", path: "/api/dashboard/owner" },
  { method: "get", path: "/api/parts" },
  { method: "get", path: "/api/orders" },
  { method: "get", path: "/api/vendors" },
  { method: "get", path: "/api/drivers" },
  { method: "get", path: "/api/retainers" },
  { method: "get", path: "/api/notifications?ownerPhone=%2B233000000000" },
  { method: "get", path: "/api/subscription-plans" },
  { method: "get", path: "/api/admin/overview" },
  { method: "get", path: "/api/revenue/overview" },
  { method: "get", path: "/api/bookings" },
  { method: "get", path: "/api/invoices" },
  { method: "get", path: "/api/rental-cars" },
  { method: "get", path: "/api/delivery-agents" },
  { method: "post", path: "/api/push/subscriptions", body: {} },
];

const PUBLIC_OK: Array<{ method: "get"; path: string }> = [
  { method: "get", path: "/api/catalog/service-types" },
  { method: "get", path: "/api/catalog/part-categories" },
  { method: "get", path: "/api/push/vapid-public-key" },
  { method: "get", path: "/api/healthz" },
  { method: "get", path: "/api/landing-content" },
];

describe("route access — anonymous requests", () => {
  it.each(PROTECTED)("$method $path returns 401 without a session cookie", async ({ method, path, body }) => {
    const req = request(app)[method](path);
    const res = body ? await req.send(body) : await req.send();
    expect(res.status).toBe(401);
  });

  it.each(PUBLIC_OK)("$method $path remains anonymous-accessible", async ({ method, path }) => {
    const res = await request(app)[method](path).send();
    // 200, 204 or 503 (push key when VAPID isn't configured) are all
    // acceptable — what matters is that the request was NOT rejected by the
    // auth gate.
    expect(res.status).not.toBe(401);
  });
});
