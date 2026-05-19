import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getCurrentUser,
  login as loginApi,
  logout as logoutApi,
  type AuthedUser,
} from "@workspace/api-client-react";
import { getRole, setRole, type Role } from "@/lib/role";

type AuthState = {
  user: AuthedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthedUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  async function refresh() {
    try {
      const me = await getCurrentUser();
      setUser(me);
      // Sync the active "view" role with the authed identity. Super admins
      // start as themselves but can impersonate other roles via the switcher.
      setRole(me.role as Role);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  // Role lock: only super_admin may impersonate other roles via the
  // localStorage-backed switcher. For everyone else, clamp the active "view"
  // role to their authenticated identity and re-clamp if the value ever
  // diverges (e.g. devtools tampering, `storage` event from another tab).
  useEffect(() => {
    if (!user || user.role === "super_admin") return;
    const enforce = () => {
      if (getRole() !== user.role) setRole(user.role as Role);
    };
    enforce();
    window.addEventListener("rolechange", enforce);
    window.addEventListener("storage", enforce);
    return () => {
      window.removeEventListener("rolechange", enforce);
      window.removeEventListener("storage", enforce);
    };
  }, [user]);

  async function login(email: string, password: string) {
    const me = await loginApi({ email, password });
    setUser(me);
    setRole(me.role as Role);
    await queryClient.invalidateQueries();
    return me;
  }

  async function logout() {
    try {
      await logoutApi();
    } finally {
      setUser(null);
      queryClient.clear();
    }
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
