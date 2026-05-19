import { useState, useEffect } from "react";

export type Role =
  | "owner"
  | "center"
  | "vendor"
  | "delivery"
  | "admin"
  | "super_admin";

const ROLE_KEY = "autocare_role";
const DELIVERY_AGENT_ID_KEY = "autocare_delivery_agent_id";

export function getRole(): Role {
  const stored = localStorage.getItem(ROLE_KEY);
  if (
    stored === "owner" ||
    stored === "center" ||
    stored === "vendor" ||
    stored === "delivery" ||
    stored === "admin" ||
    stored === "super_admin"
  ) {
    return stored;
  }
  return "owner";
}

export function setRole(role: Role) {
  localStorage.setItem(ROLE_KEY, role);
  window.dispatchEvent(new Event("rolechange"));
  // Cart scope is role-aware (see lib/cart.ts) — nudge any mounted useCart
  // hooks so they re-read scope/lines for the new role.
  window.dispatchEvent(new Event("cartchange"));
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

// Marcus Hale represents the single demo owner persona for purchases.
// In a real app this would come from authenticated user context.
export function getBuyerProfile() {
  const role = getRole();
  if (role === "center") {
    return {
      buyerKind: "center" as const,
      name: "Apex Auto Works",
      phone: "+234 805 410 9920",
      address: "24 Old Aba Road, Port Harcourt",
      city: "Port Harcourt",
      region: "Rivers",
    };
  }
  return {
    buyerKind: "owner" as const,
    name: "Marcus Hale",
    phone: "+234 802 201 1932",
    address: "412 Birchwood Avenue, Ikoyi, Lagos",
    city: "Lagos",
    region: "Lagos",
  };
}

export function getDeliveryAgentId(): string | null {
  return localStorage.getItem(DELIVERY_AGENT_ID_KEY);
}

export function setDeliveryAgentId(id: string | null) {
  if (id) localStorage.setItem(DELIVERY_AGENT_ID_KEY, id);
  else localStorage.removeItem(DELIVERY_AGENT_ID_KEY);
  window.dispatchEvent(new Event("deliveryagentchange"));
}

export function useDeliveryAgentId() {
  const [id, setId] = useState<string | null>(getDeliveryAgentId());
  useEffect(() => {
    const onChange = () => setId(getDeliveryAgentId());
    window.addEventListener("deliveryagentchange", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("deliveryagentchange", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return id;
}
