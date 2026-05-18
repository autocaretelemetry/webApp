import { Link } from "wouter";
import {
  useGetDeliveryAgent,
  useListOrders,
} from "@workspace/api-client-react";
import {
  getGetDeliveryAgentQueryKey,
  getListOrdersQueryKey,
} from "@/lib/queryKeys";
import { useDeliveryAgentId } from "@/lib/role";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { Truck, CheckCircle, Package, UserPlus } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/format";

export default function DeliveryDashboard() {
  const agentId = useDeliveryAgentId();

  const { data: agent } = useGetDeliveryAgent(agentId ?? "", {
    query: { enabled: !!agentId, queryKey: getGetDeliveryAgentQueryKey(agentId ?? "") },
  });

  const ordersParams = agentId ? { deliveryAgentId: agentId } : {};
  const { data: orders } = useListOrders(ordersParams, {
    query: { enabled: !!agentId, queryKey: getListOrdersQueryKey(ordersParams) },
  });

  if (!agentId) {
    return (
      <div className="space-y-6 animate-in fade-in-50 duration-500 max-w-xl">
        <PageHeader
          title="Welcome, courier"
          description="Register a delivery profile to start receiving parts handoffs from vendors."
        />
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <div className="h-14 w-14 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              <Truck className="h-7 w-7" />
            </div>
            <p className="text-muted-foreground">
              You're not signed in as a delivery agent on this device yet.
            </p>
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

  const active = orders?.filter((o) => o.status === "shipped") ?? [];
  const upcoming = orders?.filter((o) => o.status === "confirmed") ?? [];
  const done = orders?.filter((o) => o.status === "delivered") ?? [];

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title={agent ? `Hi, ${agent.name.split(" ")[0]}` : "Delivery dashboard"}
        description={agent ? `Active in ${agent.city}, ${agent.region}.` : ""}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">In transit</p>
              <p className="text-2xl font-bold mt-1">{active.length}</p>
            </div>
            <Truck className="h-8 w-8 text-primary/40" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Ready to pick up</p>
              <p className="text-2xl font-bold mt-1">{upcoming.length}</p>
            </div>
            <Package className="h-8 w-8 text-primary/40" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Completed</p>
              <p className="text-2xl font-bold mt-1">
                {agent?.completedDeliveries ?? done.length}
              </p>
            </div>
            <CheckCircle className="h-8 w-8 text-primary/40" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              <Truck className="h-4 w-4 text-primary" /> Active runs
            </h2>
            <Link href="/delivery/orders">
              <Button variant="ghost" size="sm">View all</Button>
            </Link>
          </div>
          {active.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No active deliveries right now.
            </p>
          ) : (
            <div className="space-y-3">
              {active.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`}>
                  <div className="flex items-center justify-between p-3 rounded-md border hover:border-primary/40 hover:bg-muted/30 cursor-pointer transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium truncate">
                        {o.vendor?.name ?? "Vendor"} → {o.buyerName}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {o.shippedAt ? `Picked up ${formatDateTime(o.shippedAt)}` : ""} · {formatCurrency(o.total)}
                      </p>
                    </div>
                    <OrderStatusBadge status={o.status} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
