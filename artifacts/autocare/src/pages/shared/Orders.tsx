import { useState, useMemo } from "react";
import { Link } from "wouter";
import { useListOrders } from "@workspace/api-client-react";
import { getListOrdersQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { formatCurrency, formatRelative } from "@/lib/format";
import { useRole } from "@/lib/role";
import { useAuth } from "@/lib/auth";
import { ShoppingBag } from "lucide-react";

const STATUSES = ["All", "placed", "confirmed", "shipped", "delivered", "cancelled"] as const;

export default function Orders() {
  const { role } = useRole();
  const { user } = useAuth();
  const [filter, setFilter] = useState<(typeof STATUSES)[number]>("All");
  // Admin and vendor both see every order; owner/center are scoped to the
  // signed-in user via the server-side `mine=true` filter (matches on the
  // session phone, never on a display-name string). The route guard already
  // blocks every other role — but if anything else ever slips through,
  // treat it as "no buyer identity" and short-circuit the query so we never
  // accidentally fetch the unfiltered list.
  const isAdmin = role === "admin" || role === "super_admin";
  const isAdminOrVendor = isAdmin || role === "vendor";
  const hasBuyerScope = isAdminOrVendor || !!user;
  const params = isAdminOrVendor ? undefined : { mine: true };
  const { data: orders, isLoading } = useListOrders(params, {
    query: { enabled: hasBuyerScope, queryKey: getListOrdersQueryKey(params) },
  });

  const filtered = useMemo(() => {
    if (!orders) return [];
    if (filter === "All") return orders;
    return orders.filter((o) => o.status === filter);
  }, [orders, filter]);

  const heading = isAdmin || role === "vendor" ? "All orders" : "My orders";
  const description = isAdmin
    ? "Every parts order across every buyer and vendor."
    : role === "vendor"
      ? "All orders across the marketplace. Use the vendor portal to fulfill yours."
      : "Track parts you've ordered from marketplace vendors.";

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title={heading}
        description={description}
        actions={
          <Link href="/marketplace">
            <Button>Browse marketplace</Button>
          </Link>
        }
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
          <p className="text-muted-foreground">No orders found.</p>
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
                    <p className="font-medium">{o.vendor?.name ?? "Vendor"}</p>
                    <p className="text-sm text-muted-foreground">
                      {o.buyerName} · {o.itemsCount ?? 0} item{(o.itemsCount ?? 0) === 1 ? "" : "s"} · placed {formatRelative(o.placedAt)}
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
