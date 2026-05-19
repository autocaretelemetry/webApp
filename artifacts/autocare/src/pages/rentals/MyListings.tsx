import { useMemo } from "react";
import { Link } from "wouter";
import { useListRentalCars, useListRentalBookings } from "@workspace/api-client-react";
import {
  getListRentalCarsQueryKey,
  getListRentalBookingsQueryKey,
} from "@/lib/queryKeys";
import { useRenterProfile } from "@/lib/profile";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { Plus, Car, MapPin, Calendar, ShieldCheck, Clock, XCircle, Share2 } from "lucide-react";
import { toast } from "sonner";
import { shareUrlForCar } from "@/pages/rentals/SharedCar";

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string; icon: typeof ShieldCheck }> = {
    approved: { label: "Live", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: ShieldCheck },
    pending: { label: "Pending review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Clock },
    unavailable: { label: "Unavailable", cls: "bg-destructive/15 text-destructive", icon: XCircle },
  };
  const s = map[status] ?? map.pending;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${s.cls}`}>
      <Icon className="h-3 w-3" /> {s.label}
    </span>
  );
}

function ShareRow({ carId, disabled }: { carId: string; disabled: boolean }) {
  const url = shareUrlForCar(carId);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Share link copied. Send it to anyone — no AutoCare account needed to view.");
    } catch {
      toast.error("Couldn't copy automatically — long-press the link to copy.");
    }
  };
  if (disabled) {
    return (
      <p className="text-xs text-muted-foreground pt-1">
        Sharing will be enabled once AutoCare approves this listing.
      </p>
    );
  }
  return (
    <div className="flex items-center gap-2 pt-2">
      <Link href={`/share/cars/${carId}`}>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Share2 className="h-3.5 w-3.5" /> Preview
        </Button>
      </Link>
      <Button
        type="button"
        variant="default"
        size="sm"
        className="gap-1.5 flex-1"
        onClick={copy}
      >
        <Share2 className="h-3.5 w-3.5" /> Copy share link
      </Button>
    </div>
  );
}

export default function MyListings() {
  const { profile } = useRenterProfile();
  const params = { includeInactive: true };
  const { data: allCars, isLoading } = useListRentalCars(params, {
    query: { queryKey: getListRentalCarsQueryKey(params) },
  });

  const myCars = useMemo(
    () =>
      (allCars ?? []).filter(
        (c) => c.ownerKind === "user" && c.ownerPhone === profile.phone,
      ),
    [allCars, profile.phone],
  );

  const carIds = useMemo(() => new Set(myCars.map((c) => c.id)), [myCars]);
  const { data: allBookings } = useListRentalBookings(
    {},
    { query: { queryKey: getListRentalBookingsQueryKey() } },
  );
  const bookingsForCar = useMemo(() => {
    const m = new Map<string, number>();
    (allBookings ?? []).forEach((b) => {
      if (carIds.has(b.carId)) m.set(b.carId, (m.get(b.carId) ?? 0) + 1);
    });
    return m;
  }, [allBookings, carIds]);

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="My rental listings"
        description={`Cars listed by ${profile.name}. AutoCare reviews every listing before it goes live.`}
        actions={
          <Link href="/rentals/list-yours">
            <Button className="gap-2">
              <Plus className="h-4 w-4" /> List another car
            </Button>
          </Link>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && myCars.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center">
              <Car className="h-6 w-6" />
            </div>
            <p className="font-medium">You haven't listed a car yet.</p>
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              Turn idle wheels into income. Listings are reviewed within 24 hours.
            </p>
            <Link href="/rentals/list-yours">
              <Button className="gap-2"><Plus className="h-4 w-4" /> List your car</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {myCars.map((c) => (
          <Card key={c.id} className="overflow-hidden">
            <div className="aspect-video bg-muted">
              {c.imageUrl ? (
                <img src={c.imageUrl} alt={`${c.brand} ${c.model}`} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Car className="h-10 w-10" />
                </div>
              )}
            </div>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="font-semibold leading-tight">
                    {c.year} {c.brand} {c.model}
                  </h3>
                  <p className="text-xs text-muted-foreground">{c.color} · {c.plateNumber}</p>
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{c.city}</span>
                <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />Listed {formatDate(c.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <div>
                  <p className="text-xs text-muted-foreground">Daily rate</p>
                  <p className="font-semibold text-primary">{formatCurrency(c.dailyRate)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground text-right">Bookings</p>
                  <p className="font-semibold text-right">{bookingsForCar.get(c.id) ?? 0}</p>
                </div>
              </div>
              <ShareRow carId={c.id} disabled={c.status !== "approved"} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
