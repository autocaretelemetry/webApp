import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Saved-shipping-address book lives outside the OpenAPI contract (same
// precedent as the fleet routes): single client, plain fetch + React
// Query so we skip codegen churn. Always go through the proxy at the
// app's BASE_URL — never call the API service port directly.

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
      /* non-JSON */
    }
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type SavedAddress = {
  id: string;
  label: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  city: string;
  region: string;
  isDefault: boolean;
  sortOrder: number | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavedAddressInput = {
  label: string;
  recipientName: string;
  recipientPhone: string;
  addressLine: string;
  city?: string;
  region?: string;
  isDefault?: boolean;
  sortOrder?: number | null;
};

export const myAddressesKey = ["me", "addresses"] as const;

export function useMyAddresses(enabled = true) {
  return useQuery({
    queryKey: myAddressesKey,
    queryFn: () => request<SavedAddress[]>("/me/addresses"),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SavedAddressInput) =>
      request<SavedAddress>("/me/addresses", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: myAddressesKey });
    },
  });
}

export function useUpdateAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SavedAddressInput> }) =>
      request<SavedAddress>(`/me/addresses/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: myAddressesKey });
    },
  });
}

export function useDeleteAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<void>(`/me/addresses/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: myAddressesKey });
    },
  });
}

// Bulk manual reorder. The server treats the array as the new visible
// order — index 0 becomes the buyer's top pick. Default still floats
// above manually-sorted entries, matching the existing precedence.
export function useReorderAddresses() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) =>
      request<SavedAddress[]>("/me/addresses/reorder", {
        method: "POST",
        body: JSON.stringify({ ids }),
      }),
    onSuccess: (rows) => {
      qc.setQueryData(myAddressesKey, rows);
    },
  });
}

// Bump lastUsedAt + promote to default. Called after a successful direct-
// buy checkout so the next visit preselects the address the buyer just
// shipped to.
export function useTouchAddress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request<SavedAddress>(`/me/addresses/${id}/touch`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: myAddressesKey });
    },
  });
}
