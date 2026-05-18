import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendors,
  useUpdateVendor,
  useDeleteVendor,
} from "@workspace/api-client-react";
import { getListVendorsQueryKey, getGetVendorQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { AdminEntityActions } from "@/components/admin/AdminEntityActions";
import { Store, Phone, MapPin, Star } from "lucide-react";
import { toast } from "sonner";

export default function AdminVendors() {
  const queryClient = useQueryClient();
  const { data: vendors, isLoading } = useListVendors(
    { includeInactive: true },
    { query: { queryKey: getListVendorsQueryKey({ includeInactive: true }) } },
  );
  const update = useUpdateVendor();
  const remove = useDeleteVendor();

  const invalidate = (vendorId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListVendorsQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getListVendorsQueryKey({ includeInactive: true }),
      }),
      queryClient.invalidateQueries({ queryKey: getGetVendorQueryKey(vendorId) }),
    ]);

  const toggleActive = async (vendorId: string, nextActive: boolean) => {
    try {
      await update.mutateAsync({ vendorId, data: { active: nextActive } });
      await invalidate(vendorId);
      toast.success(nextActive ? "Vendor reactivated." : "Vendor suspended.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update vendor."));
    }
  };

  const deleteVendor = async (vendorId: string, name: string) => {
    try {
      await remove.mutateAsync({ vendorId });
      await invalidate(vendorId);
      toast.success(`Vendor ${name} deleted.`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete vendor."));
    }
  };

  const busy = update.isPending || remove.isPending;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Vendors"
        description={`${vendors?.length ?? 0} parts vendors on the platform. Suspended vendors are hidden from buyers.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {vendors?.map((v) => (
          <Card key={v.id} className={v.active ? "" : "opacity-60"}>
            <CardContent className="p-5 flex items-start gap-3">
              <div className="h-12 w-12 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                {v.logoUrl ? (
                  <img src={v.logoUrl} alt={v.name} className="w-full h-full object-cover" />
                ) : (
                  <Store className="h-6 w-6" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold truncate">{v.name}</h3>
                  {!v.active && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                      Suspended
                    </span>
                  )}
                  <span className="ml-auto text-xs flex items-center gap-1 text-muted-foreground flex-shrink-0">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {v.rating.toFixed(1)}
                  </span>
                </div>
                {v.bio && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{v.bio}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {v.city || v.address}
                </p>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Phone className="h-3 w-3" /> {v.phone}
                </p>
                <div className="mt-3">
                  <AdminEntityActions
                    entityLabel="Vendor"
                    active={v.active ?? true}
                    busy={busy}
                    onToggleActive={(next) => toggleActive(v.id, next)}
                    onDelete={() => deleteVendor(v.id, v.name)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
        {vendors && vendors.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No vendors registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
