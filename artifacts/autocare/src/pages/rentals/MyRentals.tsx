import { useMemo } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRentalBookings,
  useUpdateRentalBooking,
} from "@workspace/api-client-react";
import { getListRentalBookingsQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { useRenterProfile } from "@/lib/profile";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import { Calendar, Car, LifeBuoy, XCircle, CheckCircle2, Clock, PlayCircle } from "lucide-react";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  requested: { label: "Awaiting confirmation", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Clock },
  confirmed: { label: "Confirmed", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: CheckCircle2 },
  active: { label: "In progress", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: PlayCircle },
  completed: { label: "Completed", cls: "bg-muted text-muted-foreground", icon: CheckCircle2 },
  cancelled: { label: "Cancelled", cls: "bg-destructive/15 text-destructive", icon: XCircle },
};

export default function MyRentals() {
  const queryClient = useQueryClient();
  const { profile } = useRenterProfile();
  const params = { renterPhone: profile.phone };
  const { data: bookings, isLoading } = useListRentalBookings(params, {
    query: { queryKey: getListRentalBookingsQueryKey(params) },
  });
  const update = useUpdateRentalBooking();

  const sorted = useMemo(
    () => (bookings ?? []).slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [bookings],
  );

  const cancel = async (id: string) => {
    try {
      await update.mutateAsync({ rentalBookingId: id, data: { status: "cancelled" } });
      await queryClient.invalidateQueries({ queryKey: getListRentalBookingsQueryKey() });
      toast.success("Rental cancelled.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to cancel rental."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="My rentals"
        description={`Rentals booked under ${profile.phone}. Manage upcoming and active trips.`}
        actions={
          <Link href="/rentals">
            <Button variant="outline" className="gap-2"><Car className="h-4 w-4" /> Browse rentals</Button>
          </Link>
        }
      />

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && sorted.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center">
              <Car className="h-6 w-6" />
            </div>
            <p className="font-medium">No rentals yet.</p>
            <Link href="/rentals">
              <Button>Browse rentals</Button>
            </Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {sorted.map((b) => {
          const meta = STATUS_META[b.status] ?? STATUS_META.requested;
          const Icon = meta.icon;
          const canCancel = b.status === "requested" || b.status === "confirmed";
          return (
            <Card key={b.id}>
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{b.carLabel || "Rental car"}</h3>
                    <span className={`inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${meta.cls}`}>
                      <Icon className="h-3 w-3" /> {meta.label}
                    </span>
                    {b.purpose === "loaner" && (
                      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-primary/15 text-primary">
                        <LifeBuoy className="h-3 w-3" /> Loaner
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Calendar className="h-3.5 w-3.5" />
                    {formatDate(b.startDate)} → {formatDate(b.endDate)} ({b.days} day{b.days === 1 ? "" : "s"})
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="font-bold text-primary">{formatCurrency(b.total)}</p>
                </div>
                {canCancel && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => cancel(b.id)}
                    disabled={update.isPending}
                  >
                    Cancel
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
