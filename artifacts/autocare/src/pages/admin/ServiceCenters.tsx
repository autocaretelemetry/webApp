import { Link } from "wouter";
import { useListServiceCenters } from "@workspace/api-client-react";
import { getListServiceCentersQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Building2, Phone, MapPin, Star } from "lucide-react";

export default function AdminServiceCenters() {
  const { data: centers, isLoading } = useListServiceCenters(undefined, {
    query: { queryKey: getListServiceCentersQueryKey() },
  });

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Service Centers"
        description={`${centers?.length ?? 0} centers on the platform.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-4">
        {centers?.map((c) => (
          <Link key={c.id} href={`/service-centers/${c.id}`}>
            <Card className="hover:border-primary/40 cursor-pointer transition-colors">
              <CardContent className="p-5 flex items-start gap-4">
                <div className="h-12 w-12 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Building2 className="h-6 w-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-semibold truncate">{c.name}</h3>
                    <span className="text-xs flex items-center gap-1 text-muted-foreground flex-shrink-0">
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
              </CardContent>
            </Card>
          </Link>
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
