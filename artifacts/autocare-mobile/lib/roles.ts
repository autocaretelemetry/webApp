export type Role =
  | "owner"
  | "center"
  | "renter"
  | "vendor"
  | "delivery"
  | "fleet"
  | "admin"
  | "super_admin";

export const ALL_ROLES: Role[] = [
  "owner",
  "center",
  "renter",
  "vendor",
  "delivery",
  "fleet",
  "admin",
  "super_admin",
];

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Vehicle Owner",
  center: "Service Center",
  renter: "Renter",
  vendor: "Parts Vendor",
  delivery: "Delivery Agent",
  fleet: "Fleet Operator",
  admin: "Admin",
  super_admin: "Super Admin",
};

export const ROLE_TAGLINE: Record<Role, string> = {
  owner: "Keep every vehicle service-ready",
  center: "Run your workshop end-to-end",
  renter: "Browse, book and drive away",
  vendor: "List parts and fulfil orders",
  delivery: "Track and complete deliveries",
  fleet: "Operate your fleet at scale",
  admin: "Operate the platform",
  super_admin: "Oversee everything",
};

/**
 * Effective role for a logged-in user. Super admin can impersonate any
 * other role via the profile switcher; everyone else is clamped to their
 * authenticated role.
 */
export function effectiveRoleFor(
  authRole: string | undefined,
  override: Role | null,
): Role {
  if (authRole === "super_admin") return override ?? "super_admin";
  if (authRole && (ALL_ROLES as string[]).includes(authRole)) {
    return authRole as Role;
  }
  return "owner";
}
