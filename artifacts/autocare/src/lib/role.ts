import { useState, useEffect } from "react";

export type Role = "owner" | "center";

const ROLE_KEY = "autocare_role";

export function getRole(): Role {
  const stored = localStorage.getItem(ROLE_KEY);
  if (stored === "owner" || stored === "center") {
    return stored;
  }
  return "owner";
}

export function setRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role);
  window.dispatchEvent(new Event("rolechange"));
}

export function useRole() {
  const [role, setRoleState] = useState<Role>(getRole());

  useEffect(() => {
    const handleRoleChange = () => setRoleState(getRole());
    window.addEventListener("rolechange", handleRoleChange);
    return () => window.removeEventListener("rolechange", handleRoleChange);
  }, []);

  const changeRole = (newRole: Role) => {
    setRole(newRole);
  };

  return { role, setRole: changeRole };
}
