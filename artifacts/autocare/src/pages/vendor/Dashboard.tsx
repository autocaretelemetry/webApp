import { Link } from "wouter";
import {
  useListVendors,
  useGetVendorDashboard,
  useListOrders,
} from "@workspace/api-client-react";
import {
  getGetVendorDashboardQueryKey,
  getListOrdersQueryKey,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { StatusBreakdownChart } from "@/components/StatusBreakdownChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, AlertTriangle, ShoppingBag, DollarSign, Plus } from "lucide-react";
import { formatCurrency, formatRelative } from "@/lib/format";

export default function VendorDashboard() {
  const { data: vendors } = useListVendors();
  const vendor = vendors?.[0];

  const { data: dashboard } = useGetVendorDashboard(vendor?.id ?? "", {
    query: {
      enabled: !!vendor,
      queryKey: getGetVendorDashboardQueryKey(vendor?.id ?? ""),
    },
  });
  const { data: orders } = useListOrders(
    { vendorId: vendor?.id ?? "" },
    {
      query: {
        enabled: !!vendor,
        queryKey: getListOrdersQueryKey({ vendorId: vendor?.id ?? "" }),
      },
    },
  );

  if (!vendor) return <div className="p-8">Loading...</div>;

  const recent = (orders ?? []).slice(0, 5);

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500">
      <PageHeader
        title={vendor.name}
        description="Vendor control panel — manage your catalog and fulfill marketplace orders."
        actions={
          <Link href="/vendor/parts/new">
            <Button className="gap-1.5"><Plus className="h-4 w-4" /> Add part</Button>
          </Link>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Catalog</CardTitle>
            <Package className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.partsCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">parts listed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Low stock</CardTitle>
            <AlertTriangle className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.lowStockCount ?? 0}</div>
            <p className="text-xs text-muted-foreground">5 or fewer in stock</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open orders</CardTitle>
            <ShoppingBag className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.openOrders ?? 0}</div>
            <p className="text-xs text-muted-foreground">need attention</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Revenue (Month)</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(dashboard?.revenueThisMonth ?? 0)}</div>
            <p className="text-xs text-muted-foreground">excluding cancellations</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {dashboard && dashboard.statusBreakdown.length > 0 && (
          <StatusBreakdownChart data={dashboard.statusBreakdown} title="Order pipeline" />
        )}

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">Recent orders</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 space-y-3">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No orders yet.</p>
            ) : (
              recent.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`}>
                  <div className="flex items-center justify-between p-2 -mx-2 rounded-md hover:bg-muted/40 cursor-pointer">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">#{o.id.slice(0, 8)}</span>
                        <OrderStatusBadge status={o.status} />
                      </div>
                      <p className="text-sm truncate">{o.buyerName}</p>
                      <p className="text-xs text-muted-foreground">{formatRelative(o.placedAt)}</p>
                    </div>
                    <p className="font-semibold">{formatCurrency(o.total)}</p>
                  </div>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
