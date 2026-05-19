import { useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useListRentalCars } from "@workspace/api-client-react";
import { getListRentalCarsQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency, resolveImageUrl } from "@/lib/format";
import { Car, MapPin, Users, Cog, Fuel, Plus, ArrowRight, LifeBuoy } from "lucide-react";

export default function RentalsBrowse() {
  const search = useSearch();
  const loanerFor = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("loaner");
  }, [search]);

  const [city, setCity] = useState<string>("all");
  const [q, setQ] = useState("");

  const params = { status: "approved" };
  const { data: cars, isLoading } = useListRentalCars(params, {
    query: { queryKey: getListRentalCarsQueryKey(params) },
  });

  const cities = useMemo(() => {
    const set = new Set<string>();
    (cars ?? []).forEach((c) => set.add(c.city));
    return ["all", ...[...set].sort()];
  }, [cars]);

  const filtered = useMemo(() => {
    return (cars ?? []).filter((c) => {
      if (city !== "all" && c.city !== city) return false;
      if (q) {
        const hay = `${c.brand} ${c.model} ${c.color} ${c.city}`.toLowerCase();
        if (!hay.includes(q.toLowerCase())) return false;
      }
      return true;
    });
  }, [cars, city, q]);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Rent a car"
        description={
          loanerFor
            ? "Pick a loaner to drive while your car is in the shop."
            : "Daily rentals from AutoCare and verified car owners."
        }
        actions={
          <Link href="/rentals/list-yours">
            <Button variant="outline" className="gap-2">
              <Plus className="h-4 w-4" /> List your car
            </Button>
          </Link>
        }
      />

      {loanerFor && (
        <div className="flex items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm">
          <LifeBuoy className="h-4 w-4 text-primary" />
          <span className="text-muted-foreground">
            Loaner mode — bookings made here will be linked to your service job.
          </span>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search brand, model, color…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={city} onValueChange={setCity}>
          <SelectTrigger className="sm:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {cities.map((c) => (
              <SelectItem key={c} value={c}>
                {c === "all" ? "All cities" : c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading rentals…</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => (
          <Card key={c.id} className="overflow-hidden flex flex-col">
            <div className="aspect-video bg-muted relative overflow-hidden">
              {c.imageUrl ? (
                <img
                  src={resolveImageUrl(c.imageUrl)}
                  alt={`${c.brand} ${c.model}`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Car className="h-10 w-10" />
                </div>
              )}
              <span
                className={`absolute top-2 left-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded ${
                  c.ownerKind === "platform"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {c.ownerKind === "platform" ? "AutoCare fleet" : "Owner-listed"}
              </span>
            </div>
            <CardContent className="p-4 flex-1 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold leading-tight">
                    {c.year} {c.brand} {c.model}
                  </h3>
                  <p className="text-xs text-muted-foreground">{c.color}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-primary">
                    {formatCurrency(c.dailyRate)}
                  </p>
                  <p className="text-[10px] text-muted-foreground -mt-0.5">/ day</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> {c.city}
                </span>
                <span className="flex items-center gap-1">
                  <Users className="h-3 w-3" /> {c.seats} seats
                </span>
                <span className="flex items-center gap-1">
                  <Cog className="h-3 w-3" /> {c.transmission}
                </span>
                <span className="flex items-center gap-1">
                  <Fuel className="h-3 w-3" /> {c.fuelType}
                </span>
              </div>
              <div className="mt-auto pt-3">
                <Link
                  href={`/rentals/${c.id}${loanerFor ? `?loaner=${loanerFor}` : ""}`}
                >
                  <Button className="w-full gap-2">
                    View & book <ArrowRight className="h-4 w-4" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}
        {!isLoading && filtered.length === 0 && (
          <div className="col-span-full py-12 text-center text-muted-foreground bg-muted/30 rounded-lg border border-dashed">
            No rental cars match your filters.
          </div>
        )}
      </div>
    </div>
  );
}
