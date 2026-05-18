import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useUpdateServiceCenter,
  useDeleteServiceCenter,
} from "@workspace/api-client-react";
import {
  getListServiceCentersQueryKey,
  getGetServiceCenterQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { AdminEntityActions } from "@/components/admin/AdminEntityActions";
import { Building2, Phone, MapPin, Star } from "lucide-react";
import { toast } from "sonner";

export default function AdminServiceCenters() {
  const queryClient = useQueryClient();
  const { data: centers, isLoading } = useListServiceCenters(
    { includeInactive: true },
    { query: { queryKey: getListServiceCentersQueryKey({ includeInactive: true }) } },
  );
  const update = useUpdateServiceCenter();
  const remove = useDeleteServiceCenter();

  const invalidate = (centerId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListServiceCentersQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getListServiceCentersQueryKey({ includeInactive: true }),
      }),
      queryClient.invalidateQueries({ queryKey: getGetServiceCenterQueryKey(centerId) }),
    ]);

  const toggleActive = async (centerId: string, nextActive: boolean) => {
    try {
      await update.mutateAsync({ centerId, data: { active: nextActive } });
      await invalidate(centerId);
      toast.success(nextActive ? "Service center reactivated." : "Service center suspended.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update service center."));
    }
  };

  const deleteCenter = async (centerId: string, name: string) => {
    try {
      await remove.mutateAsync({ centerId });
      await invalidate(centerId);
      toast.success(`${name} deleted.`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete service center."));
    }
  };

  const busy = update.isPending || remove.isPending;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Service Centers"
        description={`${centers?.length ?? 0} centers on the platform. Suspended centers are hidden from owners.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-4">
        {centers?.map((c) => (
          <Card key={c.id} className={c.active ? "" : "opacity-60"}>
            <CardContent className="p-5 flex items-start gap-4">
              <Link href={`/service-centers/${c.id}`} className="flex items-start gap-4 flex-1 min-w-0 hover:opacity-90">
                <div className="h-12 w-12 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold truncate">{c.name}</h3>
                    {!c.active && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                        Suspended
                      </span>
                    )}
                    <span className="ml-auto text-xs flex items-center gap-1 text-muted-foreground flex-shrink-0">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                      {c.rating.toFixed(1)} · {c.reviewsCount} reviews
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {c.address}
                    {c.city ? ` · ${c.city}, ${c.region}` : ""}
                  </p>
                  <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Phone className="h-3 w-3" /> {c.phone}
                  </p>
                  {c.specialties.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {c.specialties.slice(0, 5).map((s) => (
                        <span
                          key={s}
                          className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded bg-muted text-muted-foreground"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
              <AdminEntityActions
                entityLabel="Service Center"
                active={c.active ?? true}
                busy={busy}
                onToggleActive={(next) => toggleActive(c.id, next)}
                onDelete={() => deleteCenter(c.id, c.name)}
              />
            </CardContent>
          </Card>
        ))}
        {centers && centers.length === 0 && (
          <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No service centers registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
