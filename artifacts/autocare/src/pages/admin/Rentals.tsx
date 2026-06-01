import { resolveImageUrl } from "@/lib/format";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRentalCars,
  useUpdateRentalCar,
  useDeleteRentalCar,
  useListRentalBookings,
  useUpdateRentalBooking,
} from "@workspace/api-client-react";
import {
  getListRentalCarsQueryKey,
  getListRentalBookingsQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  Car,
  MapPin,
  Phone,
  CheckCircle2,
  XCircle,
  Trash2,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminRentals() {
  const queryClient = useQueryClient();
  const carParams = { includeInactive: true };
  const { data: cars } = useListRentalCars(carParams, {
    query: { queryKey: getListRentalCarsQueryKey(carParams) },
  });
  const { data: bookings } = useListRentalBookings(
    {},
    { query: { queryKey: getListRentalBookingsQueryKey() } },
  );
  const update = useUpdateRentalCar();
  const remove = useDeleteRentalCar();
  const updateBooking = useUpdateRentalBooking();

  const NEXT_STATUS: Record<string, { next: "active" | "completed"; label: string } | null> = {
    confirmed: { next: "active", label: "Mark active" },
    active: { next: "completed", label: "Complete" },
  };

  const advanceBooking = async (id: string, next: "active" | "completed", label: string) => {
    try {
      await updateBooking.mutateAsync({ rentalBookingId: id, data: { status: next } });
      await queryClient.invalidateQueries({ queryKey: getListRentalBookingsQueryKey() });
      toast.success(`${label} succeeded.`);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update rental."));
    }
  };

  const cancelBooking = async (id: string) => {
    try {
      await updateBooking.mutateAsync({ rentalBookingId: id, data: { status: "cancelled" } });
      await queryClient.invalidateQueries({ queryKey: getListRentalBookingsQueryKey() });
      toast.success("Rental cancelled.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to cancel rental."));
    }
  };

  const [tab, setTab] = useState<"pending" | "all" | "bookings">("pending");

  const pending = useMemo(() => (cars ?? []).filter((c) => c.status === "pending"), [cars]);
  const all = useMemo(() => cars ?? [], [cars]);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getListRentalCarsQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListRentalCarsQueryKey(carParams) }),
    ]);

  const setStatus = async (id: string, status: "approved" | "unavailable" | "pending", label: string) => {
    try {
      await update.mutateAsync({ carId: id, data: { status } });
      await invalidate();
      toast.success(label);
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update listing."));
    }
  };

  const del = async (id: string) => {
    try {
      await remove.mutateAsync({ carId: id });
      await invalidate();
      toast.success("Listing removed.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to delete listing."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Rentals"
        description="Approve owner-listed cars, manage the fleet, and watch live bookings."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Pending review" value={pending.length} icon={Clock} accent="text-amber-600" />
        <Stat label="Live listings" value={all.filter((c) => c.status === "approved").length} icon={ShieldCheck} accent="text-emerald-600" />
        <Stat label="Total bookings" value={(bookings ?? []).length} icon={Car} accent="text-primary" />
        <Stat
          label="Active rentals"
          value={(bookings ?? []).filter((b) => b.status === "active" || b.status === "confirmed").length}
          icon={CheckCircle2}
          accent="text-blue-600"
        />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending ({pending.length})</TabsTrigger>
          <TabsTrigger value="all">All cars ({all.length})</TabsTrigger>
          <TabsTrigger value="bookings">Bookings ({(bookings ?? []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="mt-4">
          <CarGrid
            cars={pending}
            actions={(c) => (
              <>
                <Button size="sm" className="gap-1" onClick={() => setStatus(c.id, "approved", "Listing approved.")} disabled={update.isPending}>
                  <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button size="sm" variant="outline" className="gap-1 text-destructive hover:text-destructive" onClick={() => setStatus(c.id, "unavailable", "Listing rejected.")} disabled={update.isPending}>
                  <XCircle className="h-3.5 w-3.5" /> Reject
                </Button>
              </>
            )}
            emptyMessage="No listings waiting for review."
          />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <CarGrid
            cars={all}
            actions={(c) => (
              <>
                {c.status !== "approved" && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatus(c.id, "approved", "Listing live.")}>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Make live
                  </Button>
                )}
                {c.status === "approved" && (
                  <Button size="sm" variant="outline" className="gap-1" onClick={() => setStatus(c.id, "unavailable", "Listing marked unavailable.")}>
                    <XCircle className="h-3.5 w-3.5" /> Unavailable
                  </Button>
                )}
                <Button size="sm" variant="ghost" className="gap-1 text-destructive hover:text-destructive" onClick={() => del(c.id)} disabled={remove.isPending}>
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </>
            )}
            emptyMessage="No rental cars."
          />
        </TabsContent>

        <TabsContent value="bookings" className="mt-4 space-y-3">
          {(bookings ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">No rental bookings yet.</p>
          )}
          {(bookings ?? []).map((b) => {
            const advance = NEXT_STATUS[b.status];
            const canCancel = ["pending_review", "contract_pending", "awaiting_payment", "confirmed"].includes(b.status);
            return (
              <Card key={b.id}>
                <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold">{b.carLabel || "Rental"}</p>
                    <p className="text-xs text-muted-foreground">
                      {b.renterName} · {b.renterPhone}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(b.startDate)} → {formatDate(b.endDate)} · {b.days} day{b.days === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-muted text-muted-foreground">
                    {b.status}
                  </span>
                  <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-secondary text-secondary-foreground">
                    {b.purpose}
                  </span>
                  <div className="font-semibold text-primary text-right">{formatCurrency(b.total)}</div>
                  <div className="flex items-center gap-2">
                    {advance && (
                      <Button
                        size="sm"
                        onClick={() => advanceBooking(b.id, advance.next, advance.label)}
                        disabled={updateBooking.isPending}
                      >
                        {advance.label}
                      </Button>
                    )}
                    {canCancel && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        onClick={() => cancelBooking(b.id)}
                        disabled={updateBooking.isPending}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-md bg-muted flex items-center justify-center ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CarGrid({
  cars,
  actions,
  emptyMessage,
}: {
  cars: Array<{
    id: string;
    brand: string;
    model: string;
    year: number;
    color: string;
    plateNumber: string;
    city: string;
    ownerKind: string;
    ownerName: string;
    ownerPhone: string;
    dailyRate: number;
    status: string;
    imageUrl?: string | null;
    description?: string | null;
  }>;
  actions: (c: { id: string; status: string }) => React.ReactNode;
  emptyMessage: string;
}) {
  if (cars.length === 0) {
    return <p className="text-sm text-muted-foreground py-8 text-center">{emptyMessage}</p>;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {cars.map((c) => (
        <Card key={c.id}>
          <CardContent className="p-4 flex gap-3">
            <div className="h-24 w-32 rounded-md bg-muted overflow-hidden flex-shrink-0">
              {c.imageUrl ? (
                <img src={resolveImageUrl(c.imageUrl)} alt={c.model} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                  <Car className="h-8 w-8" />
                </div>
              )}
            </div>
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold leading-tight">{c.year} {c.brand} {c.model}</p>
                <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                  c.ownerKind === "platform" ? "bg-primary/15 text-primary" : "bg-secondary text-secondary-foreground"
                }`}>
                  {c.ownerKind === "platform" ? "Fleet" : "Owner"}
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{c.color} · {c.plateNumber}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><MapPin className="h-3 w-3" /> {c.city}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1"><Phone className="h-3 w-3" /> {c.ownerName} · {c.ownerPhone}</p>
              <p className="text-sm font-semibold text-primary mt-1">{formatCurrency(c.dailyRate)} <span className="text-[10px] text-muted-foreground">/day</span></p>
              <div className="flex flex-wrap gap-2 pt-2">
                {actions(c)}
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
