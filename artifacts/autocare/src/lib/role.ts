import { useState, useEffect } from "react";

export type Role =
  | "owner"
  | "renter"
  | "center"
  | "vendor"
  | "delivery"
  | "fleet"
  | "admin"
  | "super_admin";

const ROLE_KEY = "autocare_role";
const DELIVERY_AGENT_ID_KEY = "autocare_delivery_agent_id";
const FLEET_ORG_ID_KEY = "autocare_fleet_org_id";

export function getRole(): Role {
  const stored = localStorage.getItem(ROLE_KEY);
  if (
    stored === "owner" ||
    stored === "renter" ||
    stored === "center" ||
    stored === "vendor" ||
    stored === "delivery" ||
    stored === "fleet" ||
    stored === "admin" ||
    stored === "super_admin"
  ) {
    return stored;
  }
  return "owner";
}

export function getFleetOrgId(): string | null {
  return localStorage.getItem(FLEET_ORG_ID_KEY);
}

export function setFleetOrgId(id: string | null) {
  if (id) localStorage.setItem(FLEET_ORG_ID_KEY, id);
  else localStorage.removeItem(FLEET_ORG_ID_KEY);
  window.dispatchEvent(new Event("fleetorgchange"));
}

export function useFleetOrgId() {
  const [id, setId] = useState<string | null>(getFleetOrgId());
  useEffect(() => {
    const onChange = () => setId(getFleetOrgId());
    window.addEventListener("fleetorgchange", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("fleetorgchange", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return id;
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

export type BuyerProfile = {
  buyerKind: "owner" | "center";
  name: string;
  phone: string;
  address: string;
  city: string;
  region: string;
};

// Marcus Hale / Apex Auto Works represent the demo personas for the two
// marketplace buyer roles (owner + center). Every other role — renter,
// vendor, delivery, fleet, admin, super_admin — gets `null` so we never
// silently hand them owner-scoped order data via a hard-coded persona.
// Callers MUST handle the null case (e.g. with a role guard upstream).
export function getBuyerProfile(): BuyerProfile | null {
  const role = getRole();
  if (role === "center") {
    return {
      buyerKind: "center",
      name: "Apex Auto Works",
      phone: "+234 805 410 9920",
      address: "24 Old Aba Road, Port Harcourt",
      city: "Port Harcourt",
      region: "Rivers",
    };
  }
  if (role === "owner") {
    return {
      buyerKind: "owner",
      name: "Marcus Hale",
      phone: "+234 802 201 1932",
      address: "412 Birchwood Avenue, Ikoyi, Lagos",
      city: "Lagos",
      region: "Lagos",
    };
  }
  return null;
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
