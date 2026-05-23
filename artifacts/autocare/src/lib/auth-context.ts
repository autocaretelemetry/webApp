import { createContext, useContext } from "react";
import type { AuthedUser } from "@workspace/api-client-react";

export type AuthState = {
  user: AuthedUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthedUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};

// Kept in its own non-component module on purpose. Co-locating this with
// the AuthProvider component in auth.tsx breaks Vite Fast Refresh: when an
// unrelated descendant hot-updates and HMR walks back through auth.tsx,
// the module re-evaluates and createContext() produces a new identity. The
// live <AuthProvider> tree still holds the OLD context, so every useContext
// call against the NEW one returns null and throws.
export const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
