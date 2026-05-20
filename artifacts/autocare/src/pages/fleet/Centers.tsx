import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Store, Star, Check } from "lucide-react";
import { toast } from "sonner";
import { useFleetOrgId } from "@/lib/role";
import {
  useFleetPreferredCenters,
  useReplacePreferredCenters,
} from "@/lib/fleet-api";
import { useListServiceCenters } from "@workspace/api-client-react";

export default function FleetCentersPage() {
  const orgId = useFleetOrgId();
  const { data: preferred, isLoading: loadingPref } = useFleetPreferredCenters(orgId);
  const { data: allCenters, isLoading: loadingAll } = useListServiceCenters();
  const replace = useReplacePreferredCenters(orgId);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const initialised = useMemo(() => new Set((preferred?.centers ?? []).map((c) => c.id)), [preferred]);

  // Sync selection from server on first load / refetch.
  useEffect(() => {
    setSelected(initialised);
  }, [initialised]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const save = async () => {
    try {
      await replace.mutateAsync(Array.from(selected));
      toast.success("Preferred centers updated.");
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  if (!orgId) return <div className="p-8 text-sm text-muted-foreground">No org selected.</div>;
  if (loadingPref || loadingAll) return <div className="p-8">Loading service centers...</div>;

  const list = (allCenters ?? []).filter((c) =>
    `${c.name} ${c.city ?? ""} ${c.region ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
  );

  const dirty =
    selected.size !== initialised.size ||
    Array.from(selected).some((id) => !initialised.has(id));

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Preferred service centers"
        description="Drivers can only book at centers in your preferred pool."
        actions={
          <Button onClick={save} disabled={!dirty || replace.isPending}>
            {replace.isPending ? "Saving..." : `Save (${selected.size})`}
          </Button>
        }
      />

      <Input
        placeholder="Filter by name, city or region..."
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-md"
      />

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {list.map((c) => {
          const isSelected = selected.has(c.id);
          return (
            <Card
              key={c.id}
              className={`cursor-pointer transition ${
                isSelected ? "ring-2 ring-primary" : "hover:bg-muted/40"
              }`}
              onClick={() => toggle(c.id)}
            >
              <CardContent className="py-4 flex gap-3">
                <div className="rounded-md bg-muted h-12 w-12 flex items-center justify-center">
                  <Store className="h-6 w-6 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{c.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {c.city}
                    {c.region ? `, ${c.region}` : ""}
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-500" />
                    <span>{Number(c.rating ?? 0).toFixed(1)}</span>
                    <span className="text-muted-foreground">({c.reviewsCount ?? 0})</span>
                  </div>
                </div>
                {isSelected ? (
                  <Badge className="gap-1">
                    <Check className="h-3 w-3" /> Preferred
                  </Badge>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
        {list.length === 0 ? (
          <div className="text-sm text-muted-foreground col-span-full py-8 text-center">
            No matching centers.
          </div>
        ) : null}
      </div>
    </div>
  );
}
