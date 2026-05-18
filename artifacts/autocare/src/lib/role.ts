import { useState, useEffect } from "react";

export type Role = "owner" | "center" | "vendor";

const ROLE_KEY = "autocare_role";

export function getRole(): Role {
  const stored = localStorage.getItem(ROLE_KEY);
  if (stored === "owner" || stored === "center" || stored === "vendor") {
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

export function getBuyerProfile() {
  const role = getRole();
  if (role === "center") {
    return {
      buyerKind: "center" as const,
      name: "Redline Performance Center",
      phone: "(555) 410-9920",
      address: "880 Foundry Court, Bay 3, Indianapolis, IN",
    };
  }
  return {
    buyerKind: "owner" as const,
    name: "Marcus Hale",
    phone: "(555) 201-1932",
    address: "412 Birchwood Ave, Cleveland, OH 44102",
  };
}
