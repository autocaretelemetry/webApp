import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

// Fleet endpoints intentionally live outside the OpenAPI contract (same
// pattern as the maintenance-history CSV/PDF route): they're consumed
// only by this single web client, so we hit them with plain fetch +
// React Query and keep codegen churn down. Always go through the proxy
// at the app's BASE_URL — never call the API service port directly.

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const message =
      (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : null) ?? `Request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ───── Types (mirroring server payload shape) ─────

export type FleetOrg = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  billingAddress: string | null;
  city: string | null;
  region: string | null;
  logoUrl: string | null;
  myRole?: "admin" | "driver";
};

export type FleetMember = {
  organizationId: string;
  phone: string;
  name: string;
  role: "admin" | "driver";
  createdAt: string;
};

export type FleetVehicle = {
  id: string;
  organizationId: string | null;
  brand: string;
  model: string;
  year: number;
  plateNumber: string;
  color: string;
  mileage: number;
  insuranceProvider: string | null;
  imageUrl: string | null;
  assignedDriverPhone: string | null;
};

export type FleetServiceCenter = {
  id: string;
  name: string;
  city: string;
  region: string;
  rating: number;
  reviewCount: number;
  imageUrl?: string | null;
};

export type FleetReminder = {
  kind: string;
  label: string;
  dueAt: string | null;
  vehicle: FleetVehicle;
};

export type FleetBooking = {
  id: string;
  status: string;
  vehicleId: string;
  serviceCenterId: string;
  scheduledFor: string | null;
  requestedAt: string;
};

export type FleetLimits = {
  maxBookingsPerMonth: number | null;
  maxPartsListed: number | null;
  featuredPlacement: boolean;
  canExportHistory: boolean;
  priorityBooking: boolean;
  maxFleetVehicles: number | null;
  partsCostTransparency: boolean;
  dedicatedSupport: boolean;
};

export type FleetDashboard = {
  organization: FleetOrg;
  limits: FleetLimits;
  counts: {
    vehicles: number;
    maxVehicles: number | null;
    openJobs: number;
    completedJobs: number;
    totalSpend: number;
    invoiceCount: number;
  };
  openByStatus: Record<string, number>;
  reminders: FleetReminder[];
  recentBookings: FleetBooking[];
};

export type FleetPartsSpend = {
  totalParts: number;
  totalLabour: number;
  lines: Array<{ invoiceId: string; description: string; amount: number; category: string }>;
};

// ───── Queries ─────

export function useMyFleetOrgs(): UseQueryResult<{ organizations: FleetOrg[] }> {
  return useQuery({
    queryKey: ["fleet", "mine"],
    queryFn: () => request<{ organizations: FleetOrg[] }>("/organizations/mine"),
  });
}

export function useFleetDashboard(orgId: string | null) {
  return useQuery({
    queryKey: ["fleet", "dashboard", orgId],
    queryFn: () => request<FleetDashboard>(`/organizations/${orgId}/dashboard`),
    enabled: !!orgId,
  });
}

export function useFleetVehicles(orgId: string | null) {
  return useQuery({
    queryKey: ["fleet", "vehicles", orgId],
    queryFn: () => request<{ vehicles: FleetVehicle[] }>(`/organizations/${orgId}/vehicles`),
    enabled: !!orgId,
  });
}

export function useFleetMembers(orgId: string | null) {
  return useQuery({
    queryKey: ["fleet", "members", orgId],
    queryFn: () => request<{ members: FleetMember[] }>(`/organizations/${orgId}/members`),
    enabled: !!orgId,
  });
}

export function useFleetPreferredCenters(orgId: string | null) {
  return useQuery({
    queryKey: ["fleet", "centers", orgId],
    queryFn: () => request<{ centers: FleetServiceCenter[] }>(`/organizations/${orgId}/preferred-centers`),
    enabled: !!orgId,
  });
}

export function useFleetPartsSpend(orgId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["fleet", "parts-spend", orgId],
    queryFn: () => request<FleetPartsSpend>(`/organizations/${orgId}/parts-spend`),
    enabled: !!orgId && enabled,
    retry: false,
  });
}

// ───── Mutations ─────

export function useCreateFleetOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<FleetOrg>) =>
      request<FleetOrg>("/organizations", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "mine"] }),
  });
}

export function useUpdateFleetOrg(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<FleetOrg>) =>
      request<FleetOrg>(`/organizations/${orgId}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet", "mine"] });
      qc.invalidateQueries({ queryKey: ["fleet", "dashboard", orgId] });
    },
  });
}

export function useUpsertFleetMember(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { phone: string; name: string; role: "admin" | "driver" }) =>
      request(`/organizations/${orgId}/members`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "members", orgId] }),
  });
}

export function useRemoveFleetMember(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) =>
      request(`/organizations/${orgId}/members/${encodeURIComponent(phone)}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "members", orgId] }),
  });
}

export function useReplacePreferredCenters(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (serviceCenterIds: string[]) =>
      request(`/organizations/${orgId}/preferred-centers`, {
        method: "PUT",
        body: JSON.stringify({ serviceCenterIds }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "centers", orgId] }),
  });
}

export function useCreateFleetVehicle(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<FleetVehicle> & { brand: string; model: string; year: number; plateNumber: string; color: string }) =>
      request<FleetVehicle>(`/organizations/${orgId}/vehicles`, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fleet", "vehicles", orgId] });
      qc.invalidateQueries({ queryKey: ["fleet", "dashboard", orgId] });
    },
  });
}

// ───── Safety & Tracking ─────

export type FleetTripPing = {
  id: string;
  vehicleId: string;
  lat: number;
  lng: number;
  speedKph: number | null;
  accuracyMeters: number | null;
  source: string;
  note: string | null;
  recordedAt: string;
};

export type FleetIncident = {
  id: string;
  vehicleId: string;
  organizationId: string;
  kind: "accident" | "breakdown" | "theft" | "sos";
  status: "open" | "investigating" | "resolved";
  reportedBy: "driver" | "admin";
  reporterPhone: string | null;
  notes: string | null;
  adminNotes: string | null;
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  lastKnownAt: string | null;
  reportedAt: string;
  resolvedAt: string | null;
};

export type FleetSafetySnapshot = {
  vehicles: Array<{
    id: string;
    brand: string;
    model: string;
    year: number;
    plateNumber: string;
    assignedDriverPhone: string | null;
    lastPing: FleetTripPing | null;
  }>;
  incidents: FleetIncident[];
};

export function useFleetSafety(orgId: string | null) {
  return useQuery({
    queryKey: ["fleet", "safety", orgId],
    queryFn: () => request<FleetSafetySnapshot>(`/organizations/${orgId}/safety`),
    enabled: !!orgId,
    retry: false,
  });
}

export function useReportFleetIncident(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      vehicleId,
      body,
    }: {
      vehicleId: string;
      body: { kind: FleetIncident["kind"]; notes?: string; lat?: number; lng?: number };
    }) =>
      request<FleetIncident>(
        `/organizations/${orgId}/vehicles/${vehicleId}/incidents`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "safety", orgId] }),
  });
}

export function usePostFleetLocation(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      vehicleId,
      body,
    }: {
      vehicleId: string;
      body: { lat: number; lng: number; speedKph?: number; accuracyMeters?: number; note?: string };
    }) =>
      request<FleetTripPing>(
        `/organizations/${orgId}/vehicles/${vehicleId}/locations`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "safety", orgId] }),
  });
}

export function useUpdateFleetIncident(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      incidentId,
      body,
    }: {
      incidentId: string;
      body: { status?: FleetIncident["status"]; adminNotes?: string };
    }) =>
      request<FleetIncident>(`/organizations/${orgId}/incidents/${incidentId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "safety", orgId] }),
  });
}

// Trigger a Blob download for a fleet maintenance-history export. Used
// by per-vehicle and org-wide export buttons. Cookie-authenticated.
export async function downloadFleetHistory(opts: {
  orgId: string;
  vehicleId?: string;
  format: "csv" | "pdf";
  filename: string;
}): Promise<void> {
  const base = opts.vehicleId
    ? `/api/organizations/${opts.orgId}/vehicles/${opts.vehicleId}/maintenance-history.${opts.format}`
    : `/api/organizations/${opts.orgId}/maintenance-history.${opts.format}`;
  const res = await fetch(base, { credentials: "include" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${opts.filename}.${opts.format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useUpdateFleetVehicle(orgId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ vehicleId, body }: { vehicleId: string; body: Partial<FleetVehicle> }) =>
      request<FleetVehicle>(`/organizations/${orgId}/vehicles/${vehicleId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fleet", "vehicles", orgId] }),
  });
}
