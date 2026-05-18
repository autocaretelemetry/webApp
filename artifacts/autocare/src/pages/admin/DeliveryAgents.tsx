import { useQueryClient } from "@tanstack/react-query";
import {
  useListDeliveryAgents,
  useUpdateDeliveryAgent,
} from "@workspace/api-client-react";
import { getListDeliveryAgentsQueryKey, getGetDeliveryAgentQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Truck, Phone, MapPin, Star, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";

export default function AdminDeliveryAgents() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useListDeliveryAgents(undefined, {
    query: { queryKey: getListDeliveryAgentsQueryKey() },
  });
  const update = useUpdateDeliveryAgent();

  const toggleActive = async (agentId: string, nextActive: boolean) => {
    try {
      await update.mutateAsync({ agentId, data: { active: nextActive } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListDeliveryAgentsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetDeliveryAgentQueryKey(agentId) }),
      ]);
      toast.success(nextActive ? "Agent reactivated." : "Agent deactivated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update agent.");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Delivery Agents"
        description={`${agents?.length ?? 0} couriers registered. Deactivated agents are hidden from vendors when picking a courier.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-3">
        {agents?.map((a) => (
          <Card key={a.id} className={a.active ? "" : "opacity-60"}>
            <CardContent className="p-4 flex items-center gap-4">
              <div className="h-11 w-11 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                <Truck className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-semibold truncate">{a.name}</p>
                  {!a.active && (
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">
                      Inactive
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" /> {a.phone}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="h-3 w-3" /> {a.city}, {a.region}
                  </span>
                  <span>{a.vehicleType}</span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" /> {a.rating.toFixed(1)}
                  </span>
                  <span>{a.completedDeliveries} deliveries</span>
                </div>
              </div>
              <Button
                size="sm"
                variant={a.active ? "outline" : "default"}
                onClick={() => toggleActive(a.id, !a.active)}
                disabled={update.isPending}
                className="gap-1.5 flex-shrink-0"
              >
                {a.active ? (
                  <>
                    <ToggleRight className="h-4 w-4" /> Deactivate
                  </>
                ) : (
                  <>
                    <ToggleLeft className="h-4 w-4" /> Reactivate
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        ))}
        {agents && agents.length === 0 && (
          <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No delivery agents registered yet.
          </div>
        )}
      </div>
    </div>
  );
}
