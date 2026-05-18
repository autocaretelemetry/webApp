import { useListVendors } from "@workspace/api-client-react";
import { getListVendorsQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Store, Phone, MapPin, Star } from "lucide-react";

export default function AdminVendors() {
  const { data: vendors, isLoading } = useListVendors(undefined, {
    query: { queryKey: getListVendorsQueryKey() },
  });

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Vendors"
        description={`${vendors?.length ?? 0} parts vendors on the platform.`}
      />

      {isLoading && <p>Loading...</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {vendors?.map((v) => (
          <Card key={v.id}>
            <CardContent className="p-5 flex items-start gap-3">
              <div className="h-12 w-12 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0 overflow-hidden">
                {v.logoUrl ? (
                  <img src={v.logoUrl} alt={v.name} className="w-full h-full object-cover" />
                ) : (
                  <Store className="h-6 w-6" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold truncate">{v.name}</h3>
                  <span className="text-xs flex items-center gap-1 text-muted-foreground flex-shrink-0">
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
