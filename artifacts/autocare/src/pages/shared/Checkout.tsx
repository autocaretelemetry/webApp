import { useEffect, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateOrder, useGetBooking, useListOrders, getListOrdersQueryKey as genGetListOrdersQueryKey } from "@workspace/api-client-react";
import { getListOrdersQueryKey, getListPartsQueryKey, getGetBookingQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCart, clearCart, setCartScope } from "@/lib/cart";
import { useRole, useFleetOrgId } from "@/lib/role";
import { useAuth } from "@/lib/auth";
import {
  useCreateFleetPartsOrder,
  useMyFleetOrgs,
  useFleetAddresses,
  useCreateFleetAddress,
  useTouchFleetAddress,
  type FleetAddress,
} from "@/lib/fleet-api";
import {
  useMyAddresses,
  useCreateAddress,
  useTouchAddress,
  type SavedAddress,
} from "@/lib/addresses-api";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { ArrowLeft, Loader2, ShieldCheck, Wrench } from "lucide-react";

export default function Checkout() {
  const { role } = useRole();
  const { lines, sellerGroups, subtotal, scope } = useCart();
  const isProposal = !!scope;
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  // For proposals, look up the booking to use the owner + service center for
  // buyer + delivery address.
  const { data: scopeBooking } = useGetBooking(scope?.bookingId ?? "", {
    query: { enabled: !!scope, queryKey: getGetBookingQueryKey(scope?.bookingId ?? "") },
  });

  const buyerKind: "owner" | "center" = isProposal ? "owner" : role === "center" ? "center" : "owner";
  // Direct-buy prefill comes from the logged-in user (name + phone). We no
  // longer use a hard-coded persona; address starts blank and the buyer
  // fills it in. Proposal mode overrides these from the booking + center
  // in the effect below. Fleet has its own org-scoped branch further down.
  const { user } = useAuth();

  const [buyerName, setBuyerName] = useState(user?.name ?? "");
  const [buyerPhone, setBuyerPhone] = useState(user?.phone ?? "");
  const [shippingAddress, setShippingAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [deliveryCity, setDeliveryCity] = useState("");
  const [deliveryRegion, setDeliveryRegion] = useState("");

  // Fleet org context (needs to be known before resolving which address
  // book applies). The full fleet permissions block lives further down.
  const fleetOrgId = useFleetOrgId();
  const isFleetIntent = role === "fleet" && !isProposal;

  // Saved address book: signed-in direct buyers get a dropdown of their
  // personal saved entries; fleet checkout gets the org-scoped book
  // (HQ / branches) every member sees. Skipped in proposal mode —
  // proposals always ship to the booking's service center.
  const { data: savedAddresses } = useMyAddresses(
    !isProposal && !isFleetIntent && !!user,
  );
  const { data: fleetAddressesResp } = useFleetAddresses(
    fleetOrgId,
    !isProposal && isFleetIntent,
  );
  const fleetAddresses = fleetAddressesResp?.addresses;
  // Unified view: which book are we showing this checkout? Fleet wins
  // when the role is fleet, otherwise the personal book. This keeps the
  // dropdown + auto-preselect logic below source-agnostic.
  const addressBook: Array<FleetAddress | SavedAddress> | undefined =
    isFleetIntent ? fleetAddresses : savedAddresses;
  const createAddress = useCreateAddress();
  const touchAddress = useTouchAddress();
  const createFleetAddress = useCreateFleetAddress(fleetOrgId);
  const touchFleetAddress = useTouchFleetAddress(fleetOrgId);
  // "" = use a new address (inline form), otherwise the saved address id.
  const [selectedAddressId, setSelectedAddressId] = useState<string>("");
  const [didPickSaved, setDidPickSaved] = useState(false);
  const [saveNewAddress, setSaveNewAddress] = useState(false);
  const [newAddressLabel, setNewAddressLabel] = useState("");

  // Auth resolves asynchronously — once the user lands, backfill any
  // contact field the operator hasn't started editing yet.
  useEffect(() => {
    if (isProposal) return;
    if (user?.name) setBuyerName((prev) => (prev ? prev : user.name));
    if (user?.phone) setBuyerPhone((prev) => (prev ? prev : user.phone ?? ""));
  }, [isProposal, user?.name, user?.phone]);

  // Direct-buy address prefill: pull the buyer's most recent non-proposal
  // order (server-scoped to the signed-in user via `mine=true`) and reuse
  // its shipping address so repeat buyers don't retype it. Skipped in
  // proposal mode — proposals always ship to the booking's service center.
  // Also skipped once the user has any saved address book entries — the
  // dropdown below takes over so we don't fight its preselection.
  const { data: myOrders } = useListOrders(
    { mine: true },
    {
      query: {
        enabled: !isProposal && !!user,
        staleTime: 60_000,
        queryKey: genGetListOrdersQueryKey({ mine: true }),
      },
    },
  );
  useEffect(() => {
    if (isProposal) return;
    if (savedAddresses && savedAddresses.length > 0) return;
    if (!myOrders || myOrders.length === 0) return;
    // Direct-buy lineage only: proposal-origin orders carry a bookingId +
    // mechanicId (their ship-to is the service center, not the buyer's),
    // and remain identifiable even after they transition `proposed → placed`.
    // We must skip them so the buyer doesn't get a workshop address back.
    const lastDirect = myOrders.find(
      (o) => !o.bookingId && !o.mechanicId && !!o.shippingAddress,
    );
    if (!lastDirect) return;
    setShippingAddress((prev) => (prev ? prev : lastDirect.shippingAddress));
    if (lastDirect.deliveryCity) {
      setDeliveryCity((prev) => (prev ? prev : lastDirect.deliveryCity ?? ""));
    }
    if (lastDirect.deliveryRegion) {
      setDeliveryRegion((prev) => (prev ? prev : lastDirect.deliveryRegion ?? ""));
    }
  }, [isProposal, myOrders, savedAddresses]);

  // Apply a saved address into the form fields. Memo-free — called from
  // the dropdown onValueChange and from the auto-preselect effect below.
  // Works for both personal and fleet entries (same shape).
  const applySavedAddress = (a: SavedAddress | FleetAddress) => {
    // Fleet entries are org-level, so don't overwrite the requester's
    // name/phone with the address's recipient — keep the signed-in
    // member's details so the order audit trail stays accurate.
    if (!isFleetIntent) {
      setBuyerName(a.recipientName);
      setBuyerPhone(a.recipientPhone);
    }
    setShippingAddress(a.addressLine);
    setDeliveryCity(a.city ?? "");
    setDeliveryRegion(a.region ?? "");
  };

  // Auto-preselect the default (or most-recently-used) saved address once
  // the list arrives. We only run this once per session so a buyer who
  // explicitly picks "Add new address" keeps the blank form.
  useEffect(() => {
    if (isProposal) return;
    if (didPickSaved) return;
    if (!addressBook || addressBook.length === 0) return;
    // Server returns them already sorted (default → most-recently-used).
    const preferred = addressBook[0];
    setSelectedAddressId(preferred.id);
    applySavedAddress(preferred);
    setDidPickSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProposal, addressBook, didPickSaved]);

  // When the booking loads in proposal mode, prefill from owner + service center.
  useEffect(() => {
    if (isProposal && scopeBooking) {
      // Owner contact comes from the vehicle owner; fall back to the
      // logged-in user (e.g. when the owner field is empty for some reason).
      const ownerName = scopeBooking.vehicle?.ownerName ?? user?.name ?? "";
      const ownerPhone = scopeBooking.vehicle?.ownerPhone ?? user?.phone ?? "";
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

  // Fleet branch: when the active role is "fleet", parts checkout routes
  // through the org-scoped finance-approval workflow instead of creating
  // vendor orders directly. `fleetOrgId` + `isFleetIntent` are declared
  // higher up so the address-book hooks can use them.
  const { data: mine, isLoading: mineLoading } = useMyFleetOrgs();
  const fleetOrg = mine?.organizations.find((o) => o.id === fleetOrgId) ?? null;
  const isFleet = isFleetIntent;
  const fleetReady = !isFleet || !!fleetOrg;
  const canPayDirectly = !isFleet
    ? true
    : !!fleetOrg &&
      (fleetOrg.myRole === "admin" ||
        fleetOrg.myRole === "finance" ||
        !fleetOrg.requireFinanceApproval ||
        !!fleetOrg.myCanCheckoutDirectly);
  const createFleetOrder = useCreateFleetPartsOrder(fleetOrgId);

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

  // Group cart lines by seller (vendor OR service-center shop). One order
  // per seller; center-sourced groups skip shipping entirely.
  const linesBySeller = sellerGroups;

  const placeOrders = async () => {
    if (!buyerName.trim() || !buyerPhone.trim() || !shippingAddress.trim()) {
      toast.error("Please fill in all contact and shipping fields.");
      return;
    }
    if (isFleet && !fleetReady) {
      toast.error("Loading your organization — please try again in a moment.");
      return;
    }
    setSubmitting(true);
    try {
      if (isFleet) {
        // Fleet checkout doesn't yet support center-sourced (on-hand) parts —
        // those flow through per-seller direct buy. Refuse a mixed cart up
        // front instead of silently dropping the center lines.
        if (lines.some((l) => l.sellerKind === "center")) {
          toast.error(
            "Fleet checkout doesn't support service-center on-hand parts yet. " +
              "Please remove those items (they can be purchased directly from the part page).",
          );
          setSubmitting(false);
          return;
        }
        // Persist a brand-new entry to the org book BEFORE submitting, so
        // a subsequent crash doesn't leave the fleet without the entry.
        // Mutation gate matches the server: admin/finance/manager only.
        const memberRole = fleetOrg?.myRole ?? null;
        const canEditAddressBook =
          memberRole === "admin" ||
          memberRole === "finance" ||
          memberRole === "manager";
        let fleetTouchTargetId: string | null = selectedAddressId || null;
        if (
          fleetOrgId &&
          !selectedAddressId &&
          saveNewAddress &&
          canEditAddressBook
        ) {
          try {
            const created = await createFleetAddress.mutateAsync({
              label: newAddressLabel.trim() || "Shipping address",
              recipientName: buyerName.trim(),
              recipientPhone: buyerPhone.trim(),
              addressLine: shippingAddress.trim(),
              city: deliveryCity.trim(),
              region: deliveryRegion.trim(),
              isDefault: true,
            });
            fleetTouchTargetId = created.id;
          } catch {
            toast.error(
              "Could not save address to the fleet book; order will still go through.",
            );
          }
        }
        // Single fleet parts order rolls up all cart lines; finance/admin
        // (or a member with the direct-checkout override) can pay now,
        // everyone else submits for approval.
        // Fleet API recomputes totalAmount strictly as sum(unitPrice * qty)
        // over the submitted items and rejects mismatches, so we exclude
        // shipping AND any center-sourced lines (those still go through the
        // per-seller direct-order flow below in non-fleet mode and aren't
        // supported on the fleet finance-approval path).
        const fleetItems = lines
          .filter((l) => l.sellerKind === "vendor")
          .map((l) => ({
            partId: l.partId,
            vendorId: l.sellerId,
            vendorName: l.sellerName,
            name: l.name,
            sku: l.sku,
            unitPrice: l.unitPrice,
            quantity: l.quantity,
            imageUrl: l.imageUrl,
          }));
        const fleetTotal = fleetItems.reduce(
          (s, it) => s + it.unitPrice * it.quantity,
          0,
        );
        await createFleetOrder.mutateAsync({
          items: fleetItems,
          totalAmount: fleetTotal,
          shippingAddress: shippingAddress.trim(),
          deliveryCity: deliveryCity.trim() || null,
          deliveryRegion: deliveryRegion.trim() || null,
          notes: notes.trim() || null,
          mode: canPayDirectly ? "pay_now" : "submit_for_approval",
        });
        // Bump lastUsedAt so the next visit preselects this address.
        // Best-effort — failure shouldn't block the success path.
        if (fleetTouchTargetId && fleetOrgId) {
          try {
            await touchFleetAddress.mutateAsync(fleetTouchTargetId);
          } catch {
            /* non-fatal */
          }
        }
        clearCart();
        toast.success(
          canPayDirectly
            ? "Order paid. Vendors will fulfil shortly."
            : "Order submitted for finance approval.",
        );
        navigate("/fleet/orders");
        return;
      }
      // If the buyer is filling in a brand-new address and ticked
      // "Save to address book", persist it BEFORE creating the orders so
      // a subsequent crash doesn't leave them without the entry. The new
      // address is automatically marked default (book may be empty too).
      // (Fleet branch handles its own save+touch above and `return`s.)
      let touchTargetId: string | null = selectedAddressId || null;
      if (!isProposal && user && !selectedAddressId && saveNewAddress) {
        try {
          const created = await createAddress.mutateAsync({
            label: newAddressLabel.trim() || "Shipping address",
            recipientName: buyerName.trim(),
            recipientPhone: buyerPhone.trim(),
            addressLine: shippingAddress.trim(),
            city: deliveryCity.trim(),
            region: deliveryRegion.trim(),
            isDefault: true,
          });
          touchTargetId = created.id;
        } catch {
          // Don't block the order if save fails — surface a soft toast.
          toast.error("Could not save address to your book; order will still go through.");
        }
      }
      const results = [];
      for (const group of linesBySeller) {
        const order = await createOrder.mutateAsync({
          data: {
            vendorId: group.sellerKind === "vendor" ? group.sellerId : null,
            sellerCenterId: group.sellerKind === "center" ? group.sellerId : null,
            buyerKind,
            buyerName: buyerName.trim(),
            buyerPhone: buyerPhone.trim(),
            shippingAddress: shippingAddress.trim(),
            notes: notes.trim() || null,
            deliveryCity: deliveryCity.trim() || null,
            deliveryRegion: deliveryRegion.trim() || null,
            // Link the order back to the saved address book entry the
            // buyer picked (or just created), so the order detail page
            // can surface its friendly label ("Home", "Workshop", …).
            shippingAddressId: !isProposal ? touchTargetId : null,
            items: group.lines.map((l) => ({ partId: l.partId, quantity: l.quantity })),
            ...(isProposal && scope
              ? {
                  bookingId: scope.bookingId,
                  mechanicId: scope.mechanicId,
                }
              : {}),
          },
        });
        results.push(order);
      }
      clearCart();
      if (isProposal) setCartScope(null);
      // Bump the saved address's lastUsedAt so the next checkout
      // preselects it again. Best-effort — failure shouldn't block.
      if (touchTargetId) {
        try {
          await touchAddress.mutateAsync(touchTargetId);
        } catch {
          /* non-fatal */
        }
      }
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

  const totalAcrossVendors = linesBySeller.reduce((sum: number, g) => {
    const itemsTotal = g.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
    const shipping =
      g.sellerKind === "center" ? 0 : itemsTotal > 200 ? 0 : 12;
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
              {!isProposal && user && addressBook && addressBook.length > 0 && (
                <div>
                  <Label htmlFor="saved-addr">Ship to</Label>
                  <Select
                    value={selectedAddressId || "__new__"}
                    onValueChange={(value) => {
                      setDidPickSaved(true);
                      if (value === "__new__") {
                        setSelectedAddressId("");
                        setShippingAddress("");
                        setDeliveryCity("");
                        setDeliveryRegion("");
                        return;
                      }
                      setSelectedAddressId(value);
                      const picked = addressBook.find((a) => a.id === value);
                      if (picked) applySavedAddress(picked);
                      setSaveNewAddress(false);
                      setNewAddressLabel("");
                    }}
                  >
                    <SelectTrigger id="saved-addr" className="mt-1.5">
                      <SelectValue placeholder="Pick a saved address" />
                    </SelectTrigger>
                    <SelectContent>
                      {addressBook.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.label}
                          {a.isDefault ? " · Default" : ""} — {a.addressLine}
                          {a.city ? `, ${a.city}` : ""}
                        </SelectItem>
                      ))}
                      <SelectItem value="__new__">+ Add new address</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground mt-1.5">
                    {isFleetIntent ? (
                      <>
                        Shared with your fleet — manage entries in{" "}
                        <Link href="/fleet/settings" className="underline">
                          fleet settings
                        </Link>
                        .
                      </>
                    ) : (
                      <>
                        Manage your address book from your{" "}
                        <Link href="/profile" className="underline">profile</Link>.
                      </>
                    )}
                  </p>
                </div>
              )}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">{buyerKind === "center" ? "Shop name" : "Owner name"}</Label>
                  <Input
                    id="name"
                    value={buyerName}
                    onChange={(e) => setBuyerName(e.target.value)}
                    className="mt-1.5"
                    readOnly={!isProposal}
                  />
                </div>
                <div>
                  <Label htmlFor="phone">Phone</Label>
                  <Input
                    id="phone"
                    value={buyerPhone}
                    onChange={(e) => setBuyerPhone(e.target.value)}
                    className="mt-1.5"
                    readOnly={!isProposal}
                  />
                </div>
              </div>
              {!isProposal && (
                <p className="text-xs text-muted-foreground -mt-2">
                  Buyer name and phone come from your account — manage them in your profile.
                </p>
              )}
              <div>
                <Label htmlFor="addr">{isProposal ? "Delivery address (service center)" : "Shipping address"}</Label>
                <Textarea id="addr" rows={2} value={shippingAddress} onChange={(e) => setShippingAddress(e.target.value)} className="mt-1.5" />
              </div>
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
              {!isProposal && user && !selectedAddressId &&
                // Drivers can't write to the fleet book, so don't tease the save option.
                (!isFleetIntent ||
                  (fleetOrg?.myRole &&
                    fleetOrg.myRole !== "driver")) && (
                <div className="border rounded-md p-3 bg-muted/30 space-y-2">
                  <label className="flex items-center gap-2 text-sm cursor-pointer">
                    <Checkbox
                      checked={saveNewAddress}
                      onCheckedChange={(v) => setSaveNewAddress(v === true)}
                    />
                    {isFleetIntent
                      ? "Save this to the fleet address book for next time"
                      : "Save this to my address book for next time"}
                  </label>
                  {saveNewAddress && (
                    <div>
                      <Label htmlFor="new-addr-label" className="text-xs">Label</Label>
                      <Input
                        id="new-addr-label"
                        placeholder="Home, Garage, Workshop…"
                        value={newAddressLabel}
                        onChange={(e) => setNewAddressLabel(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  )}
                </div>
              )}
              <div>
                <Label htmlFor="notes">Notes for the vendor (optional)</Label>
                <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1.5" placeholder="Delivery instructions, fitment questions, etc." />
              </div>
            </CardContent>
          </Card>

          {linesBySeller.map((group) => {
            const itemsTotal = group.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
            const shipping =
              group.sellerKind === "center" ? 0 : itemsTotal > 200 ? 0 : 12;
            return (
              <Card key={group.sellerKey}>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between mb-3 pb-3 border-b">
                    <p className="font-semibold">
                      {group.sellerName}
                      {group.sellerKind === "center" && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          (on-hand at service center)
                        </span>
                      )}
                    </p>
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
                      <span>{group.sellerKind === "center" ? "Pickup" : "Shipping"}</span>
                      <span>{shipping === 0 ? "Free" : formatCurrency(shipping)}</span>
                    </div>
                    <div className="flex justify-between font-semibold pt-1">
                      <span>Seller total</span>
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
                ? `Send ${linesBySeller.length === 1 ? "request" : `${linesBySeller.length} requests`}`
                : `Place ${linesBySeller.length === 1 ? "order" : `${linesBySeller.length} orders`}`}
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
            <Button
              className="w-full"
              size="lg"
              onClick={placeOrders}
              disabled={submitting || (isFleet && (mineLoading || !fleetReady))}
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isProposal ? (
                "Send to owner"
              ) : isFleet && !fleetReady ? (
                "Loading organisation..."
              ) : isFleet && !canPayDirectly ? (
                "Submit for finance approval"
              ) : isFleet ? (
                "Pay now"
              ) : (
                "Place order"
              )}
            </Button>
            {isFleet && !canPayDirectly && (
              <p className="text-xs text-amber-700 dark:text-amber-300 text-center flex items-center justify-center gap-1.5">
                <ShieldCheck className="h-3.5 w-3.5" />
                Your org requires finance approval before vendors are paid.
              </p>
            )}
            <p className="text-xs text-muted-foreground text-center">
              {isProposal
                ? "Owner approval required before vendors ship. Stock is reserved at approval, not now."
                : isFleet && canPayDirectly
                  ? "Payment is recorded on the fleet ledger; vendors will fulfil shortly."
                  : "No card needed for this demo — invoiced on delivery."}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
