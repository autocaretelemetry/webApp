import { useState } from "react";
import { useParams, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetOrder, useUpdateOrderStatus, type OrderStatus } from "@workspace/api-client-react";
import { getGetOrderQueryKey, getListOrdersQueryKey, getGetVendorDashboardQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useRole } from "@/lib/role";
import { ArrowLeft, Package, Truck, CheckCircle, X, Store } from "lucide-react";
import { toast } from "sonner";

const NEXT_BY_STATUS: Record<OrderStatus, { next: OrderStatus; label: string; icon: typeof Truck }[]> = {
  placed: [
    { next: "confirmed", label: "Confirm order", icon: CheckCircle },
    { next: "cancelled", label: "Cancel", icon: X },
  ],
  confirmed: [
    { next: "shipped", label: "Mark as shipped", icon: Truck },
    { next: "cancelled", label: "Cancel", icon: X },
  ],
  shipped: [{ next: "delivered", label: "Mark delivered", icon: CheckCircle }],
  delivered: [],
  cancelled: [],
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { role } = useRole();
  const queryClient = useQueryClient();
  const [tracking, setTracking] = useState("");

  const { data: order, isLoading } = useGetOrder(id ?? "", {
    query: { enabled: !!id, queryKey: getGetOrderQueryKey(id ?? "") },
  });
  const updateStatus = useUpdateOrderStatus();

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!order) return <div className="p-8">Order not found.</div>;

  const isVendor = role === "vendor";
  const transitions = NEXT_BY_STATUS[order.status];

  const advance = async (next: OrderStatus) => {
    try {
      await updateStatus.mutateAsync({
        orderId: order.id,
        data: {
          status: next,
          trackingCode: next === "shipped" && tracking.trim() ? tracking.trim() : null,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) }),
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetVendorDashboardQueryKey(order.vendorId) }),
      ]);
      toast.success(`Order moved to ${next}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update order.";
      toast.error(msg);
    }
  };

  const timeline = [
    { at: order.placedAt, label: "Order placed" },
    order.confirmedAt ? { at: order.confirmedAt, label: "Confirmed by vendor" } : null,
    order.shippedAt
      ? { at: order.shippedAt, label: `Shipped${order.trackingCode ? ` · ${order.trackingCode}` : ""}` }
      : null,
    order.deliveredAt ? { at: order.deliveredAt, label: "Delivered" } : null,
    order.cancelledAt ? { at: order.cancelledAt, label: "Cancelled" } : null,
  ].filter((e): e is { at: string; label: string } => e !== null);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <Button variant="ghost" size="sm" onClick={() => navigate("/orders")} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> All orders
      </Button>

      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <span>Order #{order.id.slice(0, 8)}</span>
            <OrderStatusBadge status={order.status} />
          </span> as unknown as string
        }
        description={`Placed ${formatDateTime(order.placedAt)} by ${order.buyerName}`}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5">
              <div className="flex items-center gap-2 mb-4 pb-3 border-b">
                <Package className="h-4 w-4 text-primary" />
                <h2 className="font-semibold">Items</h2>
              </div>
              <div className="space-y-4">
                {order.items.map((line) => (
                  <div key={line.id} className="flex gap-3">
                    <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                      {line.snapshot.imageUrl ? (
                        <img src={line.snapshot.imageUrl} alt={line.snapshot.name} className="w-full h-full object-cover" />
                      ) : (
                        <Package className="h-6 w-6 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{line.snapshot.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{line.snapshot.sku}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        {formatCurrency(line.unitPrice)} × {line.quantity}
                      </p>
                    </div>
                    <p className="font-semibold">{formatCurrency(line.lineTotal)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t mt-4 pt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span>{formatCurrency(order.itemsTotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shipping</span>
                  <span>{order.shippingFee === 0 ? "Free" : formatCurrency(order.shippingFee)}</span>
                </div>
                <div className="flex justify-between text-base font-bold pt-1.5 border-t">
                  <span>Total</span>
                  <span className="text-primary">{formatCurrency(order.total)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5">
              <h2 className="font-semibold mb-3">Timeline</h2>
              <div className="space-y-3">
                {timeline.map((event, idx) => (
                  <div key={idx} className="flex gap-3 text-sm">
                    <div className="h-2 w-2 rounded-full bg-primary mt-1.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">{event.label}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(event.at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 space-y-3 text-sm">
              <div className="flex items-center gap-2 font-semibold">
                <Store className="h-4 w-4 text-primary" />
                Vendor
              </div>
              <p>{order.vendor?.name ?? "Vendor"}</p>
              <p className="text-muted-foreground">{order.vendor?.phone}</p>
              <p className="text-muted-foreground">{order.vendor?.address}</p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-2 text-sm">
              <p className="font-semibold mb-1">Ship to</p>
              <p>{order.buyerName}</p>
              <p className="text-muted-foreground">{order.buyerPhone}</p>
              <p className="text-muted-foreground whitespace-pre-line">{order.shippingAddress}</p>
              {order.notes && (
                <div className="pt-2 mt-2 border-t">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                  <p className="text-sm">{order.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {isVendor && transitions.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Fulfillment</p>
                {order.status === "confirmed" && (
                  <div>
                    <Label htmlFor="track" className="text-xs">Tracking code (optional)</Label>
                    <Input
                      id="track"
                      value={tracking}
                      onChange={(e) => setTracking(e.target.value)}
                      placeholder="e.g. 1Z999AA10123456784"
                      className="mt-1"
                    />
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  {transitions.map((t) => {
                    const Icon = t.icon;
                    const isCancel = t.next === "cancelled";
                    return (
                      <Button
                        key={t.next}
                        variant={isCancel ? "outline" : "default"}
                        onClick={() => advance(t.next)}
                        disabled={updateStatus.isPending}
                        className="gap-2 justify-start"
                      >
                        <Icon className="h-4 w-4" />
                        {t.label}
                      </Button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
