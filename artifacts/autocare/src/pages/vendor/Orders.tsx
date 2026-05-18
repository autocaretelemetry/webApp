import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListVendors, useListOrders, type OrderStatus } from "@workspace/api-client-react";
import { getListOrdersQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatRelative } from "@/lib/format";
import { ShoppingBag } from "lucide-react";

const STATUSES: ("All" | OrderStatus)[] = ["All", "placed", "confirmed", "shipped", "delivered", "cancelled"];

export default function VendorOrders() {
  const { data: vendors } = useListVendors();
  const vendor = vendors?.[0];
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>("All");

  const { data: orders, isLoading } = useListOrders(
    { vendorId: vendor?.id ?? "" },
    {
      query: {
        enabled: !!vendor,
        queryKey: getListOrdersQueryKey({ vendorId: vendor?.id ?? "" }),
      },
    },
  );

  const filtered = useMemo(() => {
    if (!orders) return [];
    if (filter === "All") return orders;
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  if (!vendor) return <div className="p-8">Loading...</div>;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Fulfillment queue"
        description="Confirm, ship, and deliver marketplace orders."
      />

      <div className="flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Badge
            key={s}
            variant={filter === s ? "default" : "outline"}
            className="cursor-pointer capitalize"
            onClick={() => setFilter(s)}
          >
            {s}
          </Badge>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center bg-muted/30 rounded-lg border border-dashed">
          <ShoppingBag className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-muted-foreground">No orders in this state.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`}>
              <Card className="cursor-pointer hover:shadow-md transition-all">
                <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-muted-foreground">#{o.id.slice(0, 8)}</span>
                      <OrderStatusBadge status={o.status} />
                      <Badge variant="outline" className="text-xs capitalize">{o.buyerKind}</Badge>
                    </div>
                    <p className="font-semibold">{o.buyerName}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.itemsCount ?? 0} item{(o.itemsCount ?? 0) === 1 ? "" : "s"} · {o.shippingAddress.split(",")[0]} · {formatRelative(o.placedAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-primary">{formatCurrency(o.total)}</p>
                    {o.trackingCode && (
                      <p className="text-xs text-muted-foreground font-mono">Tracking {o.trackingCode}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
