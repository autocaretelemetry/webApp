import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getCurrentUser,
  login as loginApi,
  logout as logoutApi,
  type AuthedUser,
} from "@workspace/api-client-react";
import { getRole, setRole, type Role } from "@/lib/role";
import { AuthContext, useAuth } from "@/lib/auth-context";

// Re-export so existing `import { useAuth } from "@/lib/auth"` keeps working.
export { useAuth };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  function effectiveRoleFor(me: AuthedUser): Role {
    // Super admin doesn't have a dashboard of its own — it operates as an
    // admin by default and can impersonate any other role via the switcher.
    // Preserve a previously chosen impersonation if it's a valid base role.
    if (me.role === "super_admin") {
      // Super admin can impersonate any role; preserve a previously chosen
      // view including `super_admin` itself so the landing-page editor and
      // other super-admin-only screens remain reachable.
      return getRole();
    }
    return me.role as Role;
  }

  async function refresh() {
    try {
      const me = await getCurrentUser();
      setUser(me);
      setRole(effectiveRoleFor(me));
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
    setRole(effectiveRoleFor(me));
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

