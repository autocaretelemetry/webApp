import { Link } from "wouter";
import { useGetAdminOverview } from "@workspace/api-client-react";
import { getGetAdminOverviewQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  Car,
  Building2,
  Users,
  Store,
  Package,
  Truck,
  CalendarDays,
  ShoppingBag,
  Receipt,
  ShieldCheck,
} from "lucide-react";

function Stat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
        </div>
        <Icon className="h-7 w-7 text-primary/40" />
      </CardContent>
    </Card>
  );
}

export default function AdminDashboard() {
  const { data, isLoading } = useGetAdminOverview({
    query: { queryKey: getGetAdminOverviewQueryKey() },
  });

  if (isLoading || !data) return <div className="p-8">Loading platform overview...</div>;

  const c = data.counts;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-500 pb-12">
      <PageHeader
        title={
          (
            <span className="flex items-center gap-2">
              <ShieldCheck className="h-6 w-6 text-primary" />
              Platform overview
            </span>
          ) as unknown as string
        }
        description="Every vehicle, center, vendor, mechanic, agent, booking, and order on AutoCare."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Vehicles" value={c.vehicles} icon={Car} />
        <Stat label="Service Centers" value={c.serviceCenters} icon={Building2} />
        <Stat label="Mechanics" value={c.mechanics} icon={Users} />
        <Stat label="Vendors" value={c.vendors} icon={Store} />
        <Stat label="Parts in catalog" value={c.parts} icon={Package} />
        <Stat
          label="Delivery Agents"
          value={`${c.activeDeliveryAgents ?? c.deliveryAgents} / ${c.deliveryAgents}`}
          icon={Truck}
        />
        <Stat label="Bookings" value={c.bookings} icon={CalendarDays} />
        <Stat label="Parts Orders" value={c.orders} icon={ShoppingBag} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold flex items-center gap-2">
              <Receipt className="h-4 w-4 text-primary" /> Revenue
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">Invoices paid</p>
                <p className="text-xl font-bold">{formatCurrency(data.revenue.invoicesPaid)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Parts orders (gross)</p>
                <p className="text-xl font-bold">{formatCurrency(data.revenue.ordersPlaced)}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Booking status breakdown</h2>
            <div className="flex flex-wrap gap-2">
              {data.bookingStatusBreakdown.length === 0 && (
                <p className="text-sm text-muted-foreground">No bookings yet.</p>
              )}
              {data.bookingStatusBreakdown.map((row) => (
                <div
                  key={row.status}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/30 text-sm"
                >
                  <StatusBadge status={row.status as any} type="booking" />
                  <span className="font-semibold">{row.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-3">
            <h2 className="font-semibold">Order status breakdown</h2>
            <div className="flex flex-wrap gap-2">
              {data.orderStatusBreakdown.length === 0 && (
                <p className="text-sm text-muted-foreground">No orders yet.</p>
              )}
              {data.orderStatusBreakdown.map((row) => (
                <div
                  key={row.status}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-md border bg-muted/30 text-sm"
                >
                  <OrderStatusBadge status={row.status as any} />
                  <span className="font-semibold">{row.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary" /> Recent bookings
              </h2>
              <Link href="/bookings" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            {data.recentBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No bookings yet.</p>
            ) : (
              <div className="space-y-2">
                {data.recentBookings.map((b) => (
                  <Link key={b.id} href={`/bookings/${b.id}`}>
                    <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-muted/40 cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{b.serviceType}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(b.requestedAt)}
                        </p>
                      </div>
                      <StatusBadge status={b.status as any} type="booking" />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-primary" /> Recent parts orders
              </h2>
              <Link href="/orders" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            {data.recentOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No orders yet.</p>
            ) : (
              <div className="space-y-2">
                {data.recentOrders.map((o) => (
                  <Link key={o.id} href={`/orders/${o.id}`}>
                    <div className="flex items-center justify-between p-2.5 rounded-md hover:bg-muted/40 cursor-pointer transition-colors">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          #{o.id.slice(0, 8)} · {o.buyerName}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatCurrency(o.total)} · {formatDateTime(o.placedAt)}
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
    </div>
  );
}
