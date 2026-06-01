import { resolveImageUrl } from "@/lib/format";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListMechanics,
  useListServiceCenters,
  useUpdateMechanic,
  useDeleteMechanic,
} from "@workspace/api-client-react";
import {
  getListMechanicsQueryKey,
  getListServiceCentersQueryKey,
  getGetMechanicQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { AdminEntityActions } from "@/components/admin/AdminEntityActions";
import { Wrench, Star, Award } from "lucide-react";
import { toast } from "sonner";

export default function AdminMechanics() {
  const queryClient = useQueryClient();
  const { data: mechanics, isLoading } = useListMechanics(
    { includeInactive: true },
    { query: { queryKey: getListMechanicsQueryKey({ includeInactive: true }) } },
  );
  const { data: centers } = useListServiceCenters(
    { includeInactive: true },
    { query: { queryKey: getListServiceCentersQueryKey({ includeInactive: true }) } },
  );
  const update = useUpdateMechanic();
  const remove = useDeleteMechanic();

  const centerName = (id: string) => centers?.find((c) => c.id === id)?.name ?? "—";

  const invalidate = (mechanicId: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListMechanicsQueryKey() }),
      queryClient.invalidateQueries({
        queryKey: getListMechanicsQueryKey({ includeInactive: true }),
      }),
      queryClient.invalidateQueries({ queryKey: getGetMechanicQueryKey(mechanicId) }),
    ]);

  const toggleActive = async (mechanicId: string, nextActive: boolean) => {
    try {
      await update.mutateAsync({ mechanicId, data: { active: nextActive } });
      await invalidate(mechanicId);
      toast.success(nextActive ? "Mechanic reactivated." : "Mechanic suspended.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update mechanic."));
    }
  };

  const deleteMechanic = async (mechanicId: string, name: string) => {
    try {
      await remove.mutateAsync({ mechanicId });
      await invalidate(mechanicId);
      toast.success(`${name} deleted.`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete mechanic."));
    }
  };

  const busy = update.isPending || remove.isPending;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Mechanics"
        description={`${mechanics?.length ?? 0} mechanics across all service centers. Suspended mechanics are hidden from center managers.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-3">
        {mechanics?.map((m) => (
          <Card key={m.id} className={m.active ? "" : "opacity-60"}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                {m.avatarUrl ? (
                  <img src={resolveImageUrl(m.avatarUrl)} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <Wrench className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate">{m.name}</p>
                  {!m.active && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                      Suspended
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {m.specialization} · {centerName(m.serviceCenterId)}
                </p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {m.rating.toFixed(1)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Award className="h-3 w-3" /> {m.completedJobs} jobs
                  </span>
                  <span>{m.yearsExperience}y exp</span>
                </div>
              </div>
              <AdminEntityActions
                entityLabel="Mechanic"
                active={m.active ?? true}
                busy={busy}
                onToggleActive={(next) => toggleActive(m.id, next)}
                onDelete={() => deleteMechanic(m.id, m.name)}
              />
            </CardContent>
          </Card>
        ))}
        {mechanics && mechanics.length === 0 && (
          <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No mechanics registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
