import { useState } from "react";
import { useParams, Link, useLocation } from "wouter";
import { useGetPart } from "@workspace/api-client-react";
import { getGetPartQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Package, ShoppingCart, Plus, Minus, Store, Truck, ShieldCheck, ArrowLeft } from "lucide-react";
import { formatCurrency, resolveImageUrl } from "@/lib/format";
import { addToCart } from "@/lib/cart";
import { toast } from "sonner";

export default function PartDetail() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [qty, setQty] = useState(1);

  const { data: part, isLoading } = useGetPart(id ?? "", {
    query: { enabled: !!id, queryKey: getGetPartQueryKey(id ?? "") },
  });

  if (isLoading) return <div className="p-8">Loading...</div>;
  if (!part) return <div className="p-8">Part not found.</div>;

  const outOfStock = part.stock === 0;

  const handleAdd = () => {
    addToCart(part, qty);
    toast.success(`Added ${qty} × ${part.name} to cart`);
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <Button variant="ghost" size="sm" onClick={() => navigate("/marketplace")} className="gap-1.5">
        <ArrowLeft className="h-4 w-4" /> Back to marketplace
      </Button>

      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-square rounded-lg bg-muted overflow-hidden border">
          {part.imageUrl ? (
            <img src={resolveImageUrl(part.imageUrl)} alt={part.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Package className="h-24 w-24 text-muted-foreground/40" />
            </div>
          )}
        </div>

        <div className="space-y-5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary">{part.category}</Badge>
              <Badge variant="outline">{part.brand}</Badge>
            </div>
            <h1 className="text-3xl font-bold tracking-tight">{part.name}</h1>
            <p className="text-sm text-muted-foreground mt-1 font-mono">SKU {part.sku}</p>
          </div>

          <p className="text-base text-foreground/80">{part.description}</p>

          <div className="flex items-baseline gap-3">
            <span className="text-4xl font-bold text-primary">{formatCurrency(part.price)}</span>
            <span className={outOfStock ? "text-sm text-destructive font-medium" : "text-sm text-muted-foreground"}>
              {outOfStock ? "Out of stock" : `${part.stock} in stock`}
            </span>
          </div>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Store className="h-4 w-4 text-primary" />
                <span className="font-semibold">{part.vendor?.name ?? "Vendor"}</span>
                <span className="text-muted-foreground">{part.vendor?.address}</span>
              </div>
              {part.compatibleBrands.length > 0 && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">Fits these vehicle brands</p>
                  <div className="flex flex-wrap gap-1.5">
                    {part.compatibleBrands.map((b) => (
                      <Badge key={b} variant="outline" className="text-xs">{b}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <div className="flex items-center border rounded-md">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                disabled={outOfStock}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="w-10 text-center font-medium">{qty}</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQty((q) => Math.min(part.stock, q + 1))}
                disabled={outOfStock || qty >= part.stock}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={handleAdd} disabled={outOfStock} className="flex-1 gap-2">
              <ShoppingCart className="h-4 w-4" />
              Add to cart · {formatCurrency(qty * part.price)}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-2">
            <div className="flex items-start gap-2 text-sm">
              <Truck className="h-4 w-4 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Free shipping</p>
                <p className="text-xs text-muted-foreground">On orders over $200</p>
              </div>
            </div>
            <div className="flex items-start gap-2 text-sm">
              <ShieldCheck className="h-4 w-4 text-primary mt-0.5" />
              <div>
                <p className="font-medium">Fitment guarantee</p>
                <p className="text-xs text-muted-foreground">Or your money back</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
