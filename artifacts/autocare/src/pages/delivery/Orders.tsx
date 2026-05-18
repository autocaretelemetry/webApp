import { useState } from "react";
import { Link } from "wouter";
import { useListOrders, type OrderStatus } from "@workspace/api-client-react";
import { getListOrdersQueryKey } from "@/lib/queryKeys";
import { useDeliveryAgentId } from "@/lib/role";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { Truck, Package, UserPlus } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/format";

const FILTERS: { value: "all" | OrderStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "confirmed", label: "Pickup" },
  { value: "shipped", label: "In transit" },
  { value: "delivered", label: "Delivered" },
];

export default function DeliveryOrders() {
  const agentId = useDeliveryAgentId();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["value"]>("all");

  const ordersParams: { deliveryAgentId?: string; status?: OrderStatus } = {};
  if (agentId) ordersParams.deliveryAgentId = agentId;
  if (filter !== "all") ordersParams.status = filter;

  const { data: orders } = useListOrders(ordersParams, {
    query: { enabled: !!agentId, queryKey: getListOrdersQueryKey(ordersParams) },
  });

  if (!agentId) {
    return (
      <div className="space-y-6 animate-in fade-in-50 duration-500 max-w-xl">
        <PageHeader title="My deliveries" />
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <Truck className="h-10 w-10 text-muted-foreground/40 mx-auto" />
            <p className="text-muted-foreground">Register a delivery profile to view your assignments.</p>
            <Link href="/delivery/register">
              <Button className="gap-2">
                <UserPlus className="h-4 w-4" /> Create delivery profile
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader title="My deliveries" description="Every order currently assigned to you." />

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Badge
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Badge>
        ))}
      </div>

      {!orders || orders.length === 0 ? (
        <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
          No deliveries match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((o) => (
            <Link key={o.id} href={`/orders/${o.id}`}>
              <Card className="hover:border-primary/40 cursor-pointer transition-colors">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <Package className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">
                      {o.vendor?.name ?? "Vendor"} → {o.buyerName}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {o.shippingAddress}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.itemsCount ?? 0} items · {formatCurrency(o.total)}
                      {o.shippedAt ? ` · shipped ${formatDateTime(o.shippedAt)}` : ""}
                    </p>
                  </div>
                  <OrderStatusBadge status={o.status} />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
