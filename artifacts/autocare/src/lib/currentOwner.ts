import { useListVehicles } from "@workspace/api-client-react";
import { getListVehiclesQueryKey } from "@/lib/queryKeys";

/**
 * Derive the "current vehicle owner" identity from the first vehicle in the
 * system. The MVP has a single owner persona per browser/session (the
 * "Owner" role tab), so the first vehicle's `ownerName` / `ownerPhone` is
 * authoritative. Returns `null` until at least one vehicle exists, which
 * is what gates the retainer subscribe flow.
 */
export function useCurrentVehicleOwner(): {
  name: string;
  phone: string;
} | null {
  const { data } = useListVehicles({
    query: { queryKey: getListVehiclesQueryKey() },
  });
  const v = data?.[0];
  if (!v || !v.ownerPhone) return null;
  return { name: v.ownerName, phone: v.ownerPhone };
}
