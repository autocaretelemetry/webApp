import { Link, useLocation } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useCart, updateQuantity, removeFromCart, setCartScope } from "@/lib/cart";
import { formatCurrency } from "@/lib/format";
import { ShoppingCart, Trash2, Plus, Minus, Package, Store, Wrench, X } from "lucide-react";

export default function Cart() {
  const { lines, subtotal, vendorIds, scope } = useCart();
  const [, navigate] = useLocation();

  const shippingFee = subtotal > 200 ? 0 : subtotal > 0 ? 12 : 0;
  const total = subtotal + shippingFee;

  const linesByVendor = vendorIds.map((vid) => ({
    vendorId: vid,
    vendorName: lines.find((l) => l.vendorId === vid)?.vendorName ?? "Vendor",
    lines: lines.filter((l) => l.vendorId === vid),
  }));

  if (lines.length === 0) {
    return (
      <div className="space-y-8 animate-in fade-in-50 duration-500">
        <PageHeader
          title={scope ? "Job parts cart" : "Your Cart"}
          description={
            scope
              ? `For booking #${scope.bookingId.slice(0, 8)}. Add parts the owner should approve.`
              : "Review and check out the parts you need."
          }
        />
        <div className="py-16 text-center bg-muted/30 rounded-lg border border-dashed">
          <ShoppingCart className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <p className="text-muted-foreground mb-4">Your cart is empty.</p>
          <Link href={scope ? `/marketplace?bookingId=${scope.bookingId}&mechanicId=${scope.mechanicId}` : "/marketplace"}>
            <Button>Browse marketplace</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title={scope ? "Job parts cart" : "Your Cart"}
        description={`${lines.length} item${lines.length === 1 ? "" : "s"} from ${vendorIds.length} vendor${vendorIds.length === 1 ? "" : "s"}.`}
      />

      {scope && (
        <Card className="border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30">
          <CardContent className="p-4 text-sm flex items-start gap-3">
            <Wrench className="h-5 w-5 text-indigo-700 dark:text-indigo-300 mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-indigo-900 dark:text-indigo-200">
                Parts request for booking #{scope.bookingId.slice(0, 8)}
              </p>
              <p className="text-indigo-700 dark:text-indigo-300 mt-0.5">
                Submitting will send these orders to the owner for approval before any vendor ships.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setCartScope(null);
                navigate("/cart");
              }}
              className="gap-1.5 text-indigo-900 dark:text-indigo-200"
            >
              <X className="h-3.5 w-3.5" /> Exit job mode
            </Button>
          </CardContent>
        </Card>
      )}

      {vendorIds.length > 1 && (
        <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900">
          <CardContent className="p-4 text-sm">
            <strong>Heads up:</strong> Each vendor ships its own order. You'll see one order per vendor at checkout.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          {linesByVendor.map((group) => (
            <Card key={group.vendorId}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-sm font-semibold mb-3 pb-3 border-b">
                  <Store className="h-4 w-4 text-primary" />
                  {group.vendorName}
                </div>
                <div className="space-y-4">
                  {group.lines.map((line) => (
                    <div key={line.partId} className="flex gap-3">
                      <div className="w-16 h-16 rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                        {line.imageUrl ? (
                          <img src={line.imageUrl} alt={line.name} className="w-full h-full object-cover" />
                        ) : (
                          <Package className="h-6 w-6 text-muted-foreground/40" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <Link href={`/marketplace/${line.partId}`}>
                          <p className="font-medium hover:text-primary cursor-pointer truncate">{line.name}</p>
                        </Link>
                        <p className="text-xs text-muted-foreground font-mono">{line.sku}</p>
                        <p className="text-sm font-semibold text-primary mt-1">{formatCurrency(line.unitPrice)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <div className="flex items-center border rounded-md">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(line.partId, line.quantity - 1)}
                          >
                            <Minus className="h-3 w-3" />
                          </Button>
                          <span className="w-7 text-center text-sm font-medium">{line.quantity}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => updateQuantity(line.partId, line.quantity + 1)}
                            disabled={line.quantity >= line.stock}
                          >
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:text-destructive"
                          onClick={() => removeFromCart(line.partId)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="h-fit sticky top-4">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold text-lg">Order summary</h2>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span className="font-medium">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Shipping</span>
                <span className="font-medium">
                  {shippingFee === 0 ? "Free" : formatCurrency(shippingFee)}
                </span>
              </div>
              <div className="pt-2 border-t flex justify-between text-base">
                <span className="font-semibold">Total</span>
                <span className="font-bold text-primary">{formatCurrency(total)}</span>
              </div>
            </div>
            <Button className="w-full" size="lg" onClick={() => navigate("/checkout")}>
              {scope ? "Send to owner for approval" : "Proceed to checkout"}
            </Button>
            <Link href={scope ? `/marketplace?bookingId=${scope.bookingId}&mechanicId=${scope.mechanicId}` : "/marketplace"}>
              <Button variant="outline" className="w-full">Keep shopping</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
