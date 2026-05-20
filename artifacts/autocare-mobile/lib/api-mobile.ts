import { getStoredToken } from "@/lib/token-store";

let _base = "";

export function setMobileApiBase(base: string): void {
  _base = base.replace(/\/+$/, "");
}

export function getMobileApiBase(): string {
  return _base;
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  const token = await getStoredToken();
  const headers = new Headers(init.headers);
  if (!headers.has("accept")) headers.set("accept", "application/json");
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (token) headers.set("authorization", `Bearer ${token}`);
  try {
    const res = await fetch(`${_base}${path}`, { ...init, headers });
    let parsed: unknown = null;
    const text = await res.text();
    if (text.length) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!res.ok) {
      const err =
        (parsed && typeof parsed === "object" && (parsed as Record<string, unknown>)["error"]) ||
        `HTTP ${res.status}`;
      return { ok: false, status: res.status, data: parsed as T, error: String(err) };
    }
    return { ok: true, status: res.status, data: parsed as T };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: e instanceof Error ? e.message : "Network error" };
  }
}
