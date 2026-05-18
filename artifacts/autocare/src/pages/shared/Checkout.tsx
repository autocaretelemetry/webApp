import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateOrder, useGetBooking } from "@workspace/api-client-react";
import { getListOrdersQueryKey, getListPartsQueryKey, getGetBookingQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCart, clearCart, setCartScope } from "@/lib/cart";
import { getBuyerProfile, useRole } from "@/lib/role";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Wrench } from "lucide-react";

export default function Checkout() {
  const { role } = useRole();
  const { lines, vendorIds, subtotal, scope } = useCart();
  const isProposal = !!scope;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // For proposals, look up the booking to use the owner + service center for
  // buyer + delivery address.
  const { data: scopeBooking } = useGetBooking(scope?.bookingId ?? "", {
    query: { enabled: !!scope, queryKey: getGetBookingQueryKey(scope?.bookingId ?? "") },
  });

  const buyerKind: "owner" | "center" = isProposal ? "owner" : role === "center" ? "center" : "owner";
  const fallbackProfile = getBuyerProfile();

  const [buyerName, setBuyerName] = useState(fallbackProfile.name);
  const [buyerPhone, setBuyerPhone] = useState(fallbackProfile.phone);
  const [shippingAddress, setShippingAddress] = useState(fallbackProfile.address);
  const [notes, setNotes] = useState("");
  const [deliveryCity, setDeliveryCity] = useState(fallbackProfile.city);
  const [deliveryRegion, setDeliveryRegion] = useState(fallbackProfile.region);

  // When the booking loads in proposal mode, prefill from owner + service center.
  useEffect(() => {
    if (isProposal && scopeBooking) {
      // Owner contact comes from the vehicle owner; fall back to demo persona.
      const ownerName = scopeBooking.vehicle?.ownerName ?? fallbackProfile.name;
      const ownerPhone = scopeBooking.vehicle?.ownerPhone ?? fallbackProfile.phone;
      setBuyerName(ownerName);
      setBuyerPhone(ownerPhone);
      // Delivery goes to the service center where the mechanic works.
      const center = scopeBooking.serviceCenter;
      if (center) {
        setShippingAddress(center.address);
        if (center.city) setDeliveryCity(center.city);
        if (center.region) setDeliveryRegion(center.region);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProposal, scopeBooking]);

  const createOrder = useCreateOrder();
  const [submitting, setSubmitting] = useState(false);

  if (lines.length === 0) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <PageHeader title="Checkout" />
        <p className="text-muted-foreground">Your cart is empty.</p>
        <Link href="/marketplace">
          <Button>Browse marketplace</Button>
        </Link>
      </div>
    );
  }

  const linesByVendor = vendorIds.map((vid) => ({
    vendorId: vid,
    vendorName: lines.find((l) => l.vendorId === vid)?.vendorName ?? "Vendor",
    lines: lines.filter((l) => l.vendorId === vid),
  }));

  const placeOrders = async () => {
    if (!buyerName.trim() || !buyerPhone.trim() || !shippingAddress.trim()) {
      toast.error("Please fill in all contact and shipping fields.");
      return;
    }
    setSubmitting(true);
    try {
      const results = [];
      for (const group of linesByVendor) {
        const order = await createOrder.mutateAsync({
          data: {
            vendorId: group.vendorId,
            buyerKind,
            buyerName: buyerName.trim(),
            buyerPhone: buyerPhone.trim(),
            shippingAddress: shippingAddress.trim(),
            notes: notes.trim() || null,
            items: group.lines.map((l) => ({ partId: l.partId, quantity: l.quantity })),
            ...(isProposal && scope
              ? {
                  bookingId: scope.bookingId,
                  mechanicId: scope.mechanicId,
                  deliveryCity: deliveryCity || null,
                  deliveryRegion: deliveryRegion || null,
                }
              : {}),
          },
        });
        results.push(order);
      }
      clearCart();
      if (isProposal) setCartScope(null);
      await queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListPartsQueryKey() });
      if (isProposal && scope) {
        await queryClient.invalidateQueries({ queryKey: getGetBookingQueryKey(scope.bookingId) });
      }
      const message = isProposal
        ? results.length === 1
          ? "Parts request sent to the owner for approval."
          : `${results.length} parts requests sent to the owner.`
        : results.length === 1
          ? "Order placed."
          : `${results.length} orders placed across vendors.`;
      toast.success(message);
      if (results.length === 1) navigate(`/orders/${results[0].id}`);
      else if (isProposal && scope) navigate(`/bookings/${scope.bookingId}`);
      else navigate("/orders");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to place order.";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const totalAcrossVendors = linesByVendor.reduce((sum, g) => {
    const itemsTotal = g.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const shipping = itemsTotal > 200 ? 0 : 12;
    return sum + itemsTotal + shipping;
  }, 0);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <Button variant="ghost" size="sm" onClick={() => navigate("/cart")} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to cart
      </Button>
      <PageHeader
        title={isProposal ? "Request owner approval" : "Checkout"}
        description={
          isProposal
            ? "Confirm the parts list and delivery address. The owner will approve before vendors are paid."
            : "Confirm your shipping details and place your order."
        }
      />

      {isProposal && (
        <Card className="border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30">
          <CardContent className="p-4 text-sm flex items-start gap-3">
            <Wrench className="h-5 w-5 text-indigo-700 dark:text-indigo-300 mt-0.5 flex-shrink-0" />
            <div>
              <p className="font-medium text-indigo-900 dark:text-indigo-200">
                Proposal for booking #{scope?.bookingId.slice(0, 8)}
              </p>
              <p className="text-indigo-700 dark:text-indigo-300 mt-0.5">
                Parts ship to the service center after the owner approves.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold">{isProposal ? "Owner & delivery" : "Contact & shipping"}</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">{buyerKind === "center" ? "Shop name" : "Owner name"}</Label>
                  <Input id="name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className="mt-1.5" />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input id="phone" value={buyerPhone} onChange={(e) => setBuyerPhone(e.target.value)} className="mt-1.5" />
                </div>
              </div>
              <div>
                <Label htmlFor="addr">{isProposal ? "Delivery address (service center)" : "Shipping address"}</Label>
                <Textarea id="addr" rows={2} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} className="mt-1.5" />
              </div>
              {isProposal && (
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="city">City</Label>
                    <Input id="city" value={deliveryCity ?? ""} onChange={(e) => setDeliveryCity(e.target.value)} className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="region">Region / State</Label>
                    <Input id="region" value={deliveryRegion ?? ""} onChange={(e) => setDeliveryRegion(e.target.value)} className="mt-1.5" />
                  </div>
                </div>
              )}
              <div>
                <Label htmlFor="notes">Notes for the vendor (optional)</Label>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" placeholder="Delivery instructions, fitment questions, etc." />
              </div>
            </CardContent>
          </Card>

          {linesByVendor.map((group) => {
            const itemsTotal = group.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
            const shipping = itemsTotal > 200 ? 0 : 12;
            return (
              <Card key={group.vendorId}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b">
                    <p className="font-semibold">{group.vendorName}</p>
                    <span className="text-xs text-muted-foreground">{group.lines.length} item{group.lines.length === 1 ? "" : "s"}</span>
                  </div>
                  <div className="space-y-2 text-sm">
                    {group.lines.map((l) => (
                      <div key={l.partId} className="flex justify-between">
                        <span>
                          {l.name}{" "}
                          <span className="text-muted-foreground">× {l.quantity}</span>
                        </span>
                        <span className="font-medium">{formatCurrency(l.quantity * l.unitPrice)}</span>
                      </div>
                    ))}
                    <div className="pt-2 mt-2 border-t flex justify-between text-muted-foreground">
                      <span>Shipping</span>
                      <span>{shipping === 0 ? "Free" : formatCurrency(shipping)}</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-1">
                      <span>Vendor total</span>
                      <span>{formatCurrency(itemsTotal + shipping)}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="h-fit sticky top-4">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold text-lg">
              {isProposal
                ? `Send ${linesByVendor.length === 1 ? "request" : `${linesByVendor.length} requests`}`
                : `Place ${linesByVendor.length === 1 ? "order" : `${linesByVendor.length} orders`}`}
            </h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Items subtotal</span>
                <span>{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-base font-bold pt-2 border-t">
                <span>Grand total</span>
                <span className="text-primary">{formatCurrency(totalAcrossVendors)}</span>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={placeOrders} disabled={submitting}>
              {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isProposal ? "Send to owner" : "Place order"}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              {isProposal
                ? "Owner approval required before vendors ship. Stock is reserved at approval, not now."
                : "No card needed for this demo — invoiced on delivery."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
