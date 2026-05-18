import { useMemo, useState } from "react";
import { Link } from "wouter";
import {
  useListParts,
  useListPartCategories,
  useListVendors,
} from "@workspace/api-client-react";
import { PageHeader } from "@/components/PageHeader";
import { PartCard } from "@/components/PartCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCart } from "@/lib/cart";
import { ShoppingCart, Search, Store } from "lucide-react";

export default function Marketplace() {
  const [category, setCategory] = useState<string>("All");
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState<string>("All");
  const { itemCount } = useCart();

  const params: { category?: string; brand?: string; search?: string } = {};
  if (category !== "All") params.category = category;
  if (brand !== "All") params.brand = brand;
  if (search.trim().length > 0) params.search = search.trim();

  const { data: parts, isLoading } = useListParts(params);
  const { data: categories } = useListPartCategories();
  const { data: vendors } = useListVendors();

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    parts?.forEach((p) => set.add(p.brand));
    return ["All", ...[...set].sort()];
  }, [parts]);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Marketplace"
        description="Browse OEM and aftermarket parts from trusted vendors."
        actions={
          <Link href="/cart">
            <Button variant="outline" className="gap-2">
              <ShoppingCart className="h-4 w-4" />
              Cart
              {itemCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold h-5 min-w-5 px-1.5">
                  {itemCount}
                </span>
              )}
            </Button>
          </Link>
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by part name, SKU, or description"
          className="pl-9"
        />
      </div>

      <div className="space-y-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Category</p>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant={category === "All" ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setCategory("All")}
            >
              All
            </Badge>
            {categories?.map((c) => (
              <Badge
                key={c.category}
                variant={category === c.category ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setCategory(c.category)}
              >
                {c.category} <span className="ml-1 opacity-60">{c.count}</span>
              </Badge>
            ))}
          </div>
        </div>

        {brandOptions.length > 2 && (
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wide">Brand</p>
            <div className="flex flex-wrap gap-2">
              {brandOptions.map((b) => (
                <Badge
                  key={b}
                  variant={brand === b ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setBrand(b)}
                >
                  {b}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </div>

      {vendors && vendors.length > 0 && (
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-3 text-sm font-medium">
            <Store className="h-4 w-4 text-primary" />
            Trusted Vendors
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => (
              <div key={v.id} className="text-sm">
                <span className="font-semibold">{v.name}</span>
                <span className="text-muted-foreground"> · {v.partsCount ?? 0} parts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-72 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : parts && parts.length > 0 ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {parts.map((p) => (
            <PartCard key={p.id} part={p} />
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
          No parts match your filters.
        </div>
      )}
    </div>
  );
}
