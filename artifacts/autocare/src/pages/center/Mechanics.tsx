import { useListServiceCenters, useListMechanicsForCenter, getListMechanicsForCenterQueryKey } from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { MechanicCard } from "@/components/MechanicCard";
import { Users } from "lucide-react";

export default function Mechanics() {
  // Hardcoded to first center for demo as per instructions
  const { data: centers, isLoading: isLoadingCenters } = useListServiceCenters();
  const firstCenterId = centers?.[0]?.id;

  const { data: mechanics, isLoading: isLoadingMechanics } = useListMechanicsForCenter(
    firstCenterId || "",
    { query: { enabled: !!firstCenterId, queryKey: getListMechanicsForCenterQueryKey(firstCenterId || "") } }
  );

  const isLoading = isLoadingCenters || isLoadingMechanics;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader 
        title="Our Mechanics" 
        description="Your workshop's roster of professionals."
      />

      {isLoading ? (
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : mechanics && mechanics.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {mechanics.map(mechanic => (
            <MechanicCard key={mechanic.id} mechanic={mechanic} />
          ))}
        </div>
      ) : (
        <div className="text-center py-12 border border-dashed rounded-lg">
          <Users className="mx-auto h-12 w-12 text-muted-foreground/50 mb-4" />
          <h3 className="text-lg font-semibold">No mechanics found</h3>
          <p className="text-muted-foreground">Add mechanics to your roster to assign them to jobs.</p>
        </div>
      )}
    </div>
  );
}
