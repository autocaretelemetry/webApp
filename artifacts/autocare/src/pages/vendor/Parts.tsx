import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListVendors,
  useListPartsForVendor,
  useUpdatePart,
  type Part,
} from "@workspace/api-client-react";
import {
  getListPartsForVendorQueryKey,
  getListPartsQueryKey,
  getGetPartQueryKey,
  getGetVendorDashboardQueryKey,
} from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { toast } from "sonner";
import { Plus, Package, Save } from "lucide-react";

function StockEditor({ part, vendorId }: { part: Part; vendorId: string }) {
  const [stock, setStock] = useState(part.stock);
  const [price, setPrice] = useState(part.price);
  const update = useUpdatePart();
  const queryClient = useQueryClient();

  const dirty = stock !== part.stock || price !== part.price;

  const save = async () => {
    try {
      await update.mutateAsync({ partId: part.id, data: { stock, price } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getListPartsForVendorQueryKey(vendorId) }),
        queryClient.invalidateQueries({ queryKey: getListPartsQueryKey() }),
        queryClient.invalidateQueries({ queryKey: getGetPartQueryKey(part.id) }),
        queryClient.invalidateQueries({ queryKey: getGetVendorDashboardQueryKey(vendorId) }),
      ]);
      toast.success(`Updated ${part.name}.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const toggleActive = async () => {
    try {
      await update.mutateAsync({ partId: part.id, data: { active: !part.active } });
      await queryClient.invalidateQueries({ queryKey: getListPartsForVendorQueryKey(vendorId) });
      await queryClient.invalidateQueries({ queryKey: getListPartsQueryKey() });
      toast.success(part.active ? "Part hidden from marketplace." : "Part listed on marketplace.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Update failed.");
    }
  };

  return (
    <div className="flex items-end gap-2 flex-wrap">
      <div>
        <label className="text-xs text-muted-foreground">Price</label>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={price}
          onChange={(e) => setPrice(Number(e.target.value))}
          className="w-24 h-9"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground">Stock</label>
        <Input
          type="number"
          min={0}
          value={stock}
          onChange={(e) => setStock(Math.max(0, Math.floor(Number(e.target.value))))}
          className="w-20 h-9"
        />
      </div>
      <Button size="sm" onClick={save} disabled={!dirty || update.isPending} className="gap-1">
        <Save className="h-3.5 w-3.5" /> Save
      </Button>
      <Button size="sm" variant="outline" onClick={toggleActive} disabled={update.isPending}>
        {part.active ? "Unlist" : "Relist"}
      </Button>
    </div>
  );
}

export default function VendorParts() {
  const { data: vendors } = useListVendors();
  const vendor = vendors?.[0];

  const { data: parts, isLoading } = useListPartsForVendor(vendor?.id ?? "", {
    query: {
      enabled: !!vendor,
      queryKey: getListPartsForVendorQueryKey(vendor?.id ?? ""),
    },
  });

  if (!vendor) return <div className="p-8">Loading...</div>;

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="My catalog"
        description="Manage stock, pricing, and listing visibility for your parts."
        actions={
          <Link href="/vendor/parts/new">
            <Button className="gap-1.5"><Plus className="h-4 w-4" /> Add part</Button>
          </Link>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : !parts || parts.length === 0 ? (
        <div className="py-16 text-center bg-muted/30 rounded-lg border border-dashed">
          <Package className="h-10 w-10 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-muted-foreground mb-4">No parts listed yet.</p>
          <Link href="/vendor/parts/new">
            <Button>Add your first part</Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {parts.map((p) => (
            <Card key={p.id}>
              <CardContent className="p-4 flex items-start gap-4 flex-wrap">
                <div className="w-20 h-20 rounded-md bg-muted overflow-hidden flex-shrink-0 flex items-center justify-center">
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <Package className="h-6 w-6 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Badge variant="secondary" className="text-xs">{p.category}</Badge>
                    <Badge variant="outline" className="text-xs">{p.brand}</Badge>
                    {!p.active && <Badge className="text-xs bg-gray-200 text-gray-700">Unlisted</Badge>}
                    {p.active && p.stock <= 5 && p.stock > 0 && (
                      <Badge className="text-xs bg-amber-500 text-white">Low stock</Badge>
                    )}
                    {p.active && p.stock === 0 && (
                      <Badge className="text-xs bg-gray-700 text-white">Out of stock</Badge>
                    )}
                  </div>
                  <Link href={`/marketplace/${p.id}`}>
                    <p className="font-semibold hover:text-primary cursor-pointer">{p.name}</p>
                  </Link>
                  <p className="text-xs text-muted-foreground font-mono">{p.sku}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">List price {formatCurrency(p.price)}</p>
                </div>
                <StockEditor part={p} vendorId={vendor.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
