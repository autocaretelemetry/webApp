import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  useListParts,
  useListPartCategories,
  useListVendors,
  useGetBooking,
} from "@workspace/api-client-react";
import { getGetBookingQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { PartCard } from "@/components/PartCard";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useCart, setCartScope } from "@/lib/cart";
import { ShoppingCart, Search, Store, Wrench, X, MapPin } from "lucide-react";

export default function Marketplace() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const queryParams = useMemo(() => new URLSearchParams(search), [search]);
  const bookingId = queryParams.get("bookingId");
  const mechanicId = queryParams.get("mechanicId");

  // When opened from a booking, fetch it to derive city/region for proximity
  // and set the cart scope so the cart becomes per-job.
  const { data: booking } = useGetBooking(bookingId ?? "", {
    query: { enabled: !!bookingId, queryKey: getGetBookingQueryKey(bookingId ?? "") },
  });

  useEffect(() => {
    if (bookingId && mechanicId && booking) {
      const label = `${booking.serviceType} · ${booking.vehicle?.brand ?? ""} ${booking.vehicle?.model ?? ""}`.trim();
      setCartScope({ bookingId, mechanicId, bookingLabel: label });
    }
  }, [bookingId, mechanicId, booking]);

  const [category, setCategory] = useState<string>("All");
  const [searchText, setSearchText] = useState("");
  const [brand, setBrand] = useState<string>("All");
  const { itemCount, scope } = useCart();

  const nearCity = booking?.serviceCenter?.city ?? undefined;
  const nearRegion = booking?.serviceCenter?.region ?? undefined;

  const params: {
    category?: string;
    brand?: string;
    search?: string;
    nearCity?: string;
    nearRegion?: string;
  } = {};
  if (category !== "All") params.category = category;
  if (brand !== "All") params.brand = brand;
  if (searchText.trim().length > 0) params.search = searchText.trim();
  if (nearCity) params.nearCity = nearCity;
  if (nearRegion) params.nearRegion = nearRegion;

  const { data: parts, isLoading } = useListParts(params);
  const { data: categories } = useListPartCategories();
  const vendorsParams = nearCity || nearRegion ? { nearCity, nearRegion } : {};
  const { data: vendors } = useListVendors(vendorsParams);

  const brandOptions = useMemo(() => {
    const set = new Set<string>();
    parts?.forEach((p) => set.add(p.brand));
    return ["All", ...[...set].sort()];
  }, [parts]);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Marketplace"
        description={
          scope
            ? `Ordering parts for ${scope.bookingLabel || "this job"}.`
            : "Browse OEM and aftermarket parts from trusted vendors."
        }
        actions={
          <Link href="/cart">
            <Button variant="outline" className="gap-2">
              <ShoppingCart className="h-4 w-4" />
              {scope ? "Job cart" : "Cart"}
              {itemCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-semibold h-5 min-w-5 px-1.5">
                  {itemCount}
                </span>
              )}
            </Button>
          </Link>
        }
      />

      {scope && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50 dark:border-indigo-900 dark:bg-indigo-950/30 p-4 flex items-start gap-3">
          <Wrench className="h-5 w-5 text-indigo-700 dark:text-indigo-300 mt-0.5 flex-shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-indigo-900 dark:text-indigo-200">
              Building a parts request for booking #{scope.bookingId.slice(0, 8)}
            </p>
            <p className="text-indigo-700 dark:text-indigo-300 mt-0.5">
              The owner will approve before any vendor is paid. Shipping is set to the service center automatically.
              {nearCity ? ` Showing vendors near ${nearCity} first.` : ""}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCartScope(null);
              navigate("/marketplace");
            }}
            className="gap-1.5 text-indigo-900 dark:text-indigo-200"
          >
            <X className="h-3.5 w-3.5" /> Exit job mode
          </Button>
        </div>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
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
            {nearCity ? `Vendors near ${nearCity}` : "Trusted Vendors"}
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => (
              <div key={v.id} className="text-sm">
                <span className="font-semibold">{v.name}</span>
                {v.city && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 ml-1">
                    <MapPin className="h-3 w-3" /> {v.city}
                  </span>
                )}
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
