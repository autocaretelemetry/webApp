import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrder,
  useUpdateOrderStatus,
  useApproveAndPayOrder,
  useAuthorizeCenterPayOrder,
  useCenterPayOrder,
  useListDeliveryAgents,
  type UpdateOrderStatusInputStatus,
} from "@workspace/api-client-react";
import {
  getGetOrderQueryKey,
  getListOrdersQueryKey,
  getGetVendorDashboardQueryKey,
  getListDeliveryAgentsQueryKey,
  getGetBookingQueryKey,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { PaymentBadge } from "@/components/PaymentBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { useRole, useDeliveryAgentId } from "@/lib/role";
import { useMyFleetOrgs } from "@/lib/fleet-api";
import {
  ArrowLeft,
  Package,
  Truck,
  CheckCircle,
  X,
  Store,
  Wrench,
  ThumbsDown,
  User,
  CreditCard,
  Building2,
  Receipt,
} from "lucide-react";
import { toast } from "sonner";

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { role } = useRole();
  const deliveryAgentId = useDeliveryAgentId();
  const queryClient = useQueryClient();
  const [tracking, setTracking] = useState("");
  const [pickedAgent, setPickedAgent] = useState<string>("");

  const { data: order, isLoading } = useGetOrder(id ?? "", {
    query: { enabled: !!id, queryKey: getGetOrderQueryKey(id ?? "") },
  });
  const updateStatus = useUpdateOrderStatus();
  const approveAndPay = useApproveAndPayOrder();
  const authorizeCenterPay = useAuthorizeCenterPayOrder();
  const centerPay = useCenterPayOrder();

  // Delivery agents near the delivery city/region, fetched only when needed.
  const needsAgents =
    role === "vendor" && !!order && order.status === "confirmed";
  const agentParams: { city?: string; region?: string } = {};
  if (order?.deliveryCity) agentParams.city = order.deliveryCity;
  if (order?.deliveryRegion) agentParams.region = order.deliveryRegion;
  const { data: agents } = useListDeliveryAgents(agentParams, {
    query: { enabled: needsAgents, queryKey: getListDeliveryAgentsQueryKey(agentParams) },
  });

  useEffect(() => {
    if (order?.deliveryAgentId) setPickedAgent(order.deliveryAgentId);
  }, [order?.deliveryAgentId]);

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!order) return <div className="p-8">Order not found.</div>;

  // "Owner" gating for the proposal-approval card. Fleet members are
  // refined by their org membership: admin/finance always qualify, and a
  // manager/driver only when their canCheckoutDirectly override is on.
  // Other fleet members see a read-only notice instead of action buttons.
  // Server-side authorizeProposalAction remains the final gate.
  const { data: fleetOrgsData } = useMyFleetOrgs();
  const fleetMembership = fleetOrgsData?.organizations?.[0];
  const fleetCanApprove =
    !!fleetMembership &&
    (fleetMembership.myRole === "admin" ||
      fleetMembership.myRole === "finance" ||
      // canCheckoutDirectly is the per-member override exposed via the org
      fleetOrgsData?.organizations?.[0]?.myRole !== undefined &&
        (fleetMembership as { canCheckoutDirectly?: boolean })
          .canCheckoutDirectly === true);
  const fleetNeedsApproval =
    role === "fleet" && !!fleetMembership && !fleetCanApprove;
  const isOwner =
    role === "owner" ||
    role === "admin" ||
    role === "super_admin" ||
    (role === "fleet" && fleetCanApprove);
  const isVendor = role === "vendor";
  const isCenter = role === "center";
  const isDelivery = role === "delivery";
  const isMyDelivery = isDelivery && deliveryAgentId && order.deliveryAgentId === deliveryAgentId;

  const isOnHand = order.fulfillmentKind === "on_hand";

  const invalidateAfterMutation = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) }),
      queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
      order.vendorId
        ? queryClient.invalidateQueries({ queryKey: getGetVendorDashboardQueryKey(order.vendorId) })
        : Promise.resolve(),
      order.bookingId
        ? queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(order.bookingId) })
        : Promise.resolve(),
    ]);

  const handleApproveAndPay = async () => {
    try {
      await approveAndPay.mutateAsync({ orderId: order.id });
      await invalidateAfterMutation();
      toast.success("Payment sent to the vendor. Stock reserved.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to approve and pay.");
    }
  };

  const handleAuthorizeCenterPay = async () => {
    try {
      await authorizeCenterPay.mutateAsync({ orderId: order.id });
      await invalidateAfterMutation();
      toast.success("Authorized — the service center will settle with the vendor and bill you.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to authorize center payment.");
    }
  };

  const handleCenterPay = async () => {
    try {
      await centerPay.mutateAsync({ orderId: order.id });
      await invalidateAfterMutation();
      toast.success("Vendor paid. Cost will be added to the service invoice.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to pay vendor.");
    }
  };

  const paymentBusy =
    approveAndPay.isPending || authorizeCenterPay.isPending || centerPay.isPending;

  const advance = async (next: UpdateOrderStatusInputStatus, extra: { trackingCode?: string | null; deliveryAgentId?: string | null } = {}) => {
    try {
      await updateStatus.mutateAsync({
        orderId: order.id,
        data: {
          status: next,
          trackingCode: extra.trackingCode ?? (next === "shipped" && tracking.trim() ? tracking.trim() : null),
          deliveryAgentId: extra.deliveryAgentId ?? null,
        },
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetOrderQueryKey(order.id) }),
        queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() }),
        order.vendorId
          ? queryClient.invalidateQueries({ queryKey: getGetVendorDashboardQueryKey(order.vendorId) })
          : Promise.resolve(),
        order.bookingId
          ? queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(order.bookingId) })
          : Promise.resolve(),
      ]);
      const labels: Record<string, string> = {
        placed: "Order approved and sent to the vendor.",
        confirmed: "Order confirmed.",
        shipped: "Order marked as shipped.",
        delivered: "Order delivered.",
        cancelled: "Order cancelled.",
      };
      toast.success(labels[next] ?? `Order moved to ${next}.`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to update order.";
      toast.error(msg);
    }
  };

  const timeline = [
    order.proposedAt ? { at: order.proposedAt, label: "Mechanic proposed parts" } : null,
    order.rejectedAt ? { at: order.rejectedAt, label: "Owner rejected the request" } : null,
    order.approvedAt ? { at: order.approvedAt, label: "Owner approved the request" } : null,
    !order.proposedAt ? { at: order.placedAt, label: "Order placed" } : null,
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
          (
            <span className="flex items-center gap-3 flex-wrap">
              <span>Order #{order.id.slice(0, 8)}</span>
              <OrderStatusBadge status={order.status} />
              <PaymentBadge
                status={order.paymentStatus ?? "unpaid"}
                authorized={order.centerPayAuthorized}
              />
            </span>
          ) as unknown as string
        }
        description={
          order.status === "proposed"
            ? `Proposed ${order.proposedAt ? formatDateTime(order.proposedAt) : ""} by ${order.mechanic?.name ?? "mechanic"}`
            : `Placed ${formatDateTime(order.placedAt)} by ${order.buyerName}`
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {order.bookingSummary && (
            <Card>
              <CardContent className="p-5 flex items-start gap-3">
                <Wrench className="h-5 w-5 text-primary mt-0.5" />
                <div className="flex-1 text-sm">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
                    Linked to job
                  </p>
                  <Link href={`/bookings/${order.bookingSummary.id}`}>
                    <p className="font-semibold hover:text-primary cursor-pointer">
                      {order.bookingSummary.serviceType}
                    </p>
                  </Link>
                  <p className="text-muted-foreground">
                    {order.bookingSummary.vehicleLabel} · Booking #{order.bookingSummary.id.slice(0, 8)}
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

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
          {isOnHand ? (
            <Card>
              <CardContent className="p-5 space-y-3 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  <Building2 className="h-4 w-4 text-primary" />
                  Service-center shop
                </div>
                <p>{order.sellerCenter?.name ?? "Service center"}</p>
                <p className="text-muted-foreground">{order.sellerCenter?.phone}</p>
                <p className="text-muted-foreground whitespace-pre-line">
                  {order.sellerCenter?.address}
                </p>
                {order.sellerCenter?.city && (
                  <p className="text-xs text-muted-foreground">
                    {order.sellerCenter.city}
                    {order.sellerCenter.region ? `, ${order.sellerCenter.region}` : ""}
                  </p>
                )}
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Parts are on hand at the service center — no shipping or delivery.
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="p-5 space-y-3 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  <Store className="h-4 w-4 text-primary" />
                  Vendor
                </div>
                <p>{order.vendor?.name ?? "Vendor"}</p>
                <p className="text-muted-foreground">{order.vendor?.phone}</p>
                <p className="text-muted-foreground">{order.vendor?.address}</p>
                {order.vendor?.city && (
                  <p className="text-xs text-muted-foreground">
                    {order.vendor.city}{order.vendor.region ? `, ${order.vendor.region}` : ""}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {!isOnHand && (
            <Card>
              <CardContent className="p-5 space-y-2 text-sm">
                <div className="flex items-center justify-between mb-1 gap-2">
                  <p className="font-semibold">Ship to</p>
                  {order.shippingAddressLabel && (
                    <span
                      className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                      title="Picked from your saved addresses"
                    >
                      {order.shippingAddressLabel}
                    </span>
                  )}
                </div>
                <p>{order.buyerName}</p>
                <p className="text-muted-foreground">{order.buyerPhone}</p>
                <p className="text-muted-foreground whitespace-pre-line">{order.shippingAddress}</p>
                {(order.deliveryCity || order.deliveryRegion) && (
                  <p className="text-xs text-muted-foreground">
                    {order.deliveryCity}{order.deliveryRegion ? `, ${order.deliveryRegion}` : ""}
                  </p>
                )}
                {order.notes && (
                  <div className="pt-2 mt-2 border-t">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-sm">{order.notes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {isOnHand && order.notes && (
            <Card>
              <CardContent className="p-5 space-y-1 text-sm">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Notes</p>
                <p>{order.notes}</p>
              </CardContent>
            </Card>
          )}

          {!isOnHand && order.deliveryAgent && (
            <Card>
              <CardContent className="p-5 space-y-1 text-sm">
                <div className="flex items-center gap-2 font-semibold">
                  <Truck className="h-4 w-4 text-primary" /> Delivery agent
                </div>
                <p>{order.deliveryAgent.name}</p>
                <p className="text-muted-foreground">{order.deliveryAgent.phone}</p>
                <p className="text-xs text-muted-foreground">
                  {order.deliveryAgent.vehicleType} · {order.deliveryAgent.city}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Fleet manager/driver without override — read-only notice */}
          {fleetNeedsApproval && order.status === "proposed" && (
            <Card className="border-muted">
              <CardContent className="p-5 space-y-2">
                <p className="font-semibold flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  Requires finance approval
                </p>
                <p className="text-xs text-muted-foreground">
                  This parts request is waiting for a fleet admin or finance
                  member to approve and pick a payment route.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Owner approval for proposed orders — pick a payment route */}
          {isOwner && order.status === "proposed" && (
            <Card className="border-primary/40">
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Approve parts request</p>
                <p className="text-xs text-muted-foreground">
                  {isOnHand
                    ? "Your mechanic proposed parts the service center has on hand. Pick how you want them paid for."
                    : "Your mechanic proposed these parts for the job. Pick how you want the vendor paid."}
                </p>
                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handleApproveAndPay}
                    disabled={paymentBusy || updateStatus.isPending}
                    className="gap-2 justify-start"
                  >
                    <CreditCard className="h-4 w-4" />
                    <span className="flex-1 text-left">
                      {isOnHand
                        ? `Approve & pay center — ${formatCurrency(order.total)}`
                        : `Approve & pay vendor — ${formatCurrency(order.total)}`}
                    </span>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleAuthorizeCenterPay}
                    disabled={paymentBusy || updateStatus.isPending}
                    className="gap-2 justify-start"
                  >
                    <Building2 className="h-4 w-4" />
                    <span className="flex-1 text-left">
                      {isOnHand
                        ? "Add to final invoice — pay with the job"
                        : "Let service center pay — added to final invoice"}
                    </span>
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => advance("cancelled")}
                    disabled={paymentBusy || updateStatus.isPending}
                    className="gap-2 justify-start text-muted-foreground hover:text-destructive"
                  >
                    <ThumbsDown className="h-4 w-4" /> Reject this request
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Service center: pay the vendor on the owner's behalf.
              Center-sourced (on_hand) orders never enter this state — the
              authorize-center-pay endpoint stamps paid_by_center directly
              because the center IS the seller. */}
          {isCenter &&
            !isOnHand &&
            order.centerPayAuthorized &&
            order.paymentStatus === "unpaid" &&
            order.status !== "cancelled" && (
              <Card className="border-primary/40">
                <CardContent className="p-5 space-y-3">
                  <p className="font-semibold flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-primary" /> Settle with vendor
                  </p>
                  <p className="text-xs text-muted-foreground">
                    The vehicle owner authorized you to pay the vendor for this order. The
                    cost is rolled into the service invoice you'll bill them for at job
                    completion.
                  </p>
                  <Button
                    onClick={handleCenterPay}
                    disabled={paymentBusy}
                    className="gap-2 justify-start w-full"
                  >
                    <CreditCard className="h-4 w-4" />
                    Pay vendor — {formatCurrency(order.total)}
                  </Button>
                </CardContent>
              </Card>
            )}

          {/* Center: order is settled, will appear on the invoice */}
          {isCenter &&
            order.paymentStatus === "paid_by_center" &&
            !order.invoicedAt && (
              <Card>
                <CardContent className="p-5 space-y-1 text-sm">
                  <p className="font-semibold flex items-center gap-2">
                    <Receipt className="h-4 w-4 text-primary" /> Will appear on invoice
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatCurrency(order.total)} paid to vendor. These parts are
                    automatically added to the service invoice when you issue it.
                  </p>
                </CardContent>
              </Card>
            )}

          {/* Center: already invoiced */}
          {isCenter && order.invoicedAt && (
            <Card>
              <CardContent className="p-5 space-y-1 text-sm">
                <p className="font-semibold flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-primary" /> Billed on invoice
                </p>
                <p className="text-xs text-muted-foreground">
                  Parts cost included on the invoice issued {formatDateTime(order.invoicedAt)}.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Vendor fulfillment — never shown for on_hand orders. */}
          {isVendor && !isOnHand && (order.status === "placed" || order.status === "confirmed") && (
            <Card>
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold">Fulfillment</p>
                {order.status === "placed" && (
                  <div className="flex flex-col gap-2">
                    <Button onClick={() => advance("confirmed")} disabled={updateStatus.isPending} className="gap-2 justify-start">
                      <CheckCircle className="h-4 w-4" /> Confirm order
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => advance("cancelled")}
                      disabled={updateStatus.isPending}
                      className="gap-2 justify-start"
                    >
                      <X className="h-4 w-4" /> Cancel
                    </Button>
                  </div>
                )}
                {order.status === "confirmed" && (
                  <>
                    <div>
                      <Label className="text-xs">Assign a delivery agent</Label>
                      {agents && agents.length > 0 ? (
                        <Select value={pickedAgent} onValueChange={setPickedAgent}>
                          <SelectTrigger className="mt-1">
                            <SelectValue placeholder="Pick an agent" />
                          </SelectTrigger>
                          <SelectContent>
                            {agents.map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name} — {a.vehicleType} · {a.city}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-1">
                          No active agents found near {order.deliveryCity || "this area"}.
                        </p>
                      )}
                    </div>
                    <div>
                      <Label htmlFor="track" className="text-xs">Tracking code (optional)</Label>
                      <Input
                        id="track"
                        value={tracking}
                        onChange={(e) => setTracking(e.target.value)}
                        placeholder="e.g. NG-1Z999"
                        className="mt-1"
                      />
                    </div>
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={() => advance("shipped", { deliveryAgentId: pickedAgent })}
                        disabled={updateStatus.isPending || !pickedAgent}
                        className="gap-2 justify-start"
                      >
                        <Truck className="h-4 w-4" /> Mark as shipped
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => advance("cancelled")}
                        disabled={updateStatus.isPending}
                        className="gap-2 justify-start"
                      >
                        <X className="h-4 w-4" /> Cancel
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Delivery agent action */}
          {isMyDelivery && order.status === "shipped" && (
            <Card className="border-primary/40">
              <CardContent className="p-5 space-y-3">
                <p className="font-semibold flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" /> Your delivery
                </p>
                <p className="text-xs text-muted-foreground">
                  Mark this order delivered once the service center receives it.
                </p>
                <Button onClick={() => advance("delivered")} disabled={updateStatus.isPending} className="gap-2 justify-start w-full">
                  <CheckCircle className="h-4 w-4" /> Mark delivered
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
