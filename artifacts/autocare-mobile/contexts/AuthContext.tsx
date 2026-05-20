import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { getStoredToken, setStoredToken } from "@/lib/token-store";
import {
  effectiveRoleFor,
  type Role,
} from "@/lib/roles";

type LooseUser = {
  id: string;
  email: string;
  name: string;
  phone?: string | null;
  role: string;
  approvalStatus?: string;
  kycStatus?: string;
  requestedRole?: string | null;
  sessionToken?: string | null;
  [k: string]: unknown;
};

type LoginResult =
  | { ok: true; user: LooseUser }
  | { ok: false; status: number; error: string; reason?: string; note?: string | null };

type SignupBody = {
  name: string;
  email: string;
  password: string;
  phone: string;
  notificationChannels?: string[];
  requestedRole?: string;
  applicantData?: Record<string, unknown>;
};

type AuthState = {
  user: LooseUser | null;
  token: string | null;
  loading: boolean;
  role: Role;
  setRoleOverride: (role: Role | null) => void;
  currentOrgId: string | null;
  setCurrentOrgId: (id: string | null) => void;
  login: (email: string, password: string) => Promise<LoginResult>;
  signup: (body: SignupBody) => Promise<LoginResult>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

let _apiBase = "";
export function configureAuthApiBase(base: string): void {
  _apiBase = base.replace(/\/+$/, "");
}

async function apiFetch(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Response> {
  const { token, headers, ...rest } = init;
  const h = new Headers(headers);
  if (!h.has("content-type") && rest.body) h.set("content-type", "application/json");
  h.set("accept", "application/json");
  if (token) h.set("authorization", `Bearer ${token}`);
  return fetch(`${_apiBase}${path}`, { ...rest, headers: h });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<LooseUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [roleOverride, setRoleOverrideState] = useState<Role | null>(null);
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const persistToken = useCallback(async (t: string | null) => {
    setToken(t);
    await setStoredToken(t);
  }, []);

  const refresh = useCallback(async () => {
    const t = token ?? (await getStoredToken());
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const res = await apiFetch("/api/auth/me", { token: t });
      if (res.ok) {
        const me = (await res.json()) as LooseUser;
        setUser(me);
        setToken(t);
      } else {
        await persistToken(null);
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, [token, persistToken]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<LoginResult> => {
      const res = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: email.trim().toLowerCase(), password }),
      });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: (body["error"] as string) ?? "Login failed",
          reason: body["reason"] as string | undefined,
          note: (body["note"] as string | null | undefined) ?? null,
        };
      }
      const u = body as unknown as LooseUser;
      const t = (u.sessionToken as string | undefined) ?? null;
      if (t) await persistToken(t);
      setUser(u);
      await queryClient.invalidateQueries();
      return { ok: true, user: u };
    },
    [persistToken, queryClient],
  );

  const signup = useCallback(
    async (body: SignupBody): Promise<LoginResult> => {
      const res = await apiFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          ...body,
          email: body.email.trim().toLowerCase(),
          notificationChannels: body.notificationChannels ?? ["email"],
        }),
      });
      const respBody = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          error: (respBody["error"] as string) ?? "Signup failed",
        };
      }
      const u = respBody as unknown as LooseUser;
      const t = (u.sessionToken as string | undefined) ?? null;
      if (t) await persistToken(t);
      setUser(u);
      await queryClient.invalidateQueries();
      return { ok: true, user: u };
    },
    [persistToken, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch("/api/auth/logout", { method: "POST", token });
    } catch {
      /* ignore */
    }
    await persistToken(null);
    setUser(null);
    setRoleOverrideState(null);
    setCurrentOrgIdState(null);
    await queryClient.clear();
  }, [token, persistToken, queryClient]);

  const role = useMemo<Role>(
    () => effectiveRoleFor(user?.role, roleOverride),
    [user?.role, roleOverride],
  );

  const setRoleOverride = useCallback((r: Role | null) => {
    setRoleOverrideState(r);
  }, []);

  const setCurrentOrgId = useCallback((id: string | null) => {
    setCurrentOrgIdState(id);
  }, []);

  const value: AuthState = {
    user,
    token,
    loading,
    role,
    setRoleOverride,
    currentOrgId,
    setCurrentOrgId,
    login,
    signup,
    logout,
    refresh,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
