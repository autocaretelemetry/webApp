import { useListMechanics, useListServiceCenters } from "@workspace/api-client-react";
import { getListMechanicsQueryKey, getListServiceCentersQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Wrench, Star, Award } from "lucide-react";

export default function AdminMechanics() {
  const { data: mechanics, isLoading } = useListMechanics({
    query: { queryKey: getListMechanicsQueryKey() },
  });
  const { data: centers } = useListServiceCenters(undefined, {
    query: { queryKey: getListServiceCentersQueryKey() },
  });

  const centerName = (id: string) => centers?.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Mechanics"
        description={`${mechanics?.length ?? 0} mechanics across all service centers.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-3 sm:grid-cols-2">
        {mechanics?.map((m) => (
          <Card key={m.id}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-11 w-11 rounded-full bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                {m.avatarUrl ? (
                  <img src={m.avatarUrl} alt={m.name} className="w-full h-full object-cover" />
                ) : (
                  <Wrench className="h-5 w-5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold truncate">{m.name}</p>
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
            </CardContent>
          </Card>
        ))}
        {mechanics && mechanics.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No mechanics registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
