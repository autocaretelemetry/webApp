import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRentalBookings,
  useUpdateRentalBooking,
  type RentalBooking,
} from "@workspace/api-client-react";
import { getListRentalBookingsQueryKey } from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { useRenterProfile } from "@/lib/profile";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import {
  Calendar,
  Car,
  LifeBuoy,
  XCircle,
  CheckCircle2,
  Clock,
  PlayCircle,
  ScrollText,
  PenLine,
  CreditCard,
  Banknote,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; cls: string; icon: typeof Clock }> = {
  pending_review: { label: "Awaiting owner review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300", icon: Clock },
  rejected: { label: "Declined by owner", cls: "bg-destructive/15 text-destructive", icon: XCircle },
  contract_pending: { label: "Sign contract", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: ScrollText },
  awaiting_payment: { label: "Awaiting payment", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300", icon: CreditCard },
  confirmed: { label: "Confirmed", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: CheckCircle2 },
  active: { label: "Trip in progress", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", icon: PlayCircle },
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

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListRentalBookingsQueryKey() });

  const cancel = async (id: string) => {
    try {
      await update.mutateAsync({ rentalBookingId: id, data: { status: "cancelled" } });
      await invalidate();
      toast.success("Rental cancelled.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to cancel rental."));
    }
  };

  const sign = async (booking: RentalBooking, name: string) => {
    try {
      await update.mutateAsync({
        rentalBookingId: booking.id,
        data: { sign: { party: "renter", name } },
      });
      await invalidate();
      toast.success("Contract signed.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to sign contract."));
    }
  };

  const pay = async (booking: RentalBooking, method: "online" | "cash_on_pickup") => {
    try {
      await update.mutateAsync({
        rentalBookingId: booking.id,
        data: {
          payment: { method, markPaid: method === "online" },
        },
      });
      await invalidate();
      toast.success(method === "online" ? "Payment received. Booking confirmed." : "Pickup confirmed. You'll pay on collection.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to record payment."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="My rentals"
        description={`Rentals booked under ${profile.phone}. Track approvals, sign contracts, and pay here.`}
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
            <Link href="/rentals"><Button>Browse rentals</Button></Link>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {sorted.map((b) => (
          <RentalRow
            key={b.id}
            booking={b}
            onCancel={() => cancel(b.id)}
            onSign={(name) => sign(b, name)}
            onPay={(method) => pay(b, method)}
            pending={update.isPending}
          />
        ))}
      </div>
    </div>
  );
}

function RentalRow({
  booking: b,
  onCancel,
  onSign,
  onPay,
  pending,
}: {
  booking: RentalBooking;
  onCancel: () => void;
  onSign: (name: string) => void;
  onPay: (method: "online" | "cash_on_pickup") => void;
  pending: boolean;
}) {
  const meta = STATUS_META[b.status] ?? STATUS_META.pending_review;
  const Icon = meta.icon;
  const canCancel = ["pending_review", "contract_pending", "awaiting_payment", "confirmed"].includes(b.status);
  const [contractOpen, setContractOpen] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState(b.renterName);

  return (
    <Card>
      <CardContent className="p-4 flex flex-col sm:flex-row gap-4">
        <div className="h-24 w-32 rounded-md bg-muted overflow-hidden flex-shrink-0 hidden sm:block">
          {b.carImageUrl ? (
            <img src={b.carImageUrl} alt={b.carLabel ?? ""} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Car className="h-8 w-8" /></div>
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
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
            {b.paymentStatus === "paid" && (
              <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                Paid
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5" />
            {formatDate(b.startDate)} → {formatDate(b.endDate)} · {b.days} day{b.days === 1 ? "" : "s"}
          </p>
          <p className="text-xs text-muted-foreground">
            Owner: {b.ownerName ?? "—"}{b.ownerPhone ? ` · ${b.ownerPhone}` : ""}
          </p>
          {b.status === "rejected" && b.ownerReviewNotes && (
            <p className="text-xs text-destructive">Reason: {b.ownerReviewNotes}</p>
          )}

          {/* Action row */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            {b.contractText && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setContractOpen(true)}>
                <ScrollText className="h-3.5 w-3.5" /> View contract
              </Button>
            )}
            {b.status === "contract_pending" && !b.renterSignedAt && (
              <Button size="sm" className="gap-1.5" onClick={() => setSignOpen(true)} disabled={pending}>
                <PenLine className="h-3.5 w-3.5" /> Sign as renter
              </Button>
            )}
            {b.status === "contract_pending" && b.renterSignedAt && !b.ownerSignedAt && (
              <span className="text-xs text-muted-foreground">Signed — waiting for owner.</span>
            )}
            {b.status === "awaiting_payment" && (
              <>
                <Button size="sm" className="gap-1.5" onClick={() => onPay("online")} disabled={pending}>
                  <CreditCard className="h-3.5 w-3.5" /> Pay online ({formatCurrency(b.total)})
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onPay("cash_on_pickup")} disabled={pending}>
                  <Banknote className="h-3.5 w-3.5" /> Cash on pickup
                </Button>
              </>
            )}
            {canCancel && (
              <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={onCancel} disabled={pending}>
                Cancel
              </Button>
            )}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs text-muted-foreground">Total</p>
          <p className="font-bold text-primary">{formatCurrency(b.total)}</p>
          {b.paymentMethod && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {b.paymentMethod === "online" ? "Online" : "Cash on pickup"}
            </p>
          )}
        </div>
      </CardContent>

      <Dialog open={contractOpen} onOpenChange={setContractOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Rental agreement</DialogTitle>
            <DialogDescription>
              Generated {b.contractGeneratedAt ? formatDateTime(b.contractGeneratedAt) : "—"}.
            </DialogDescription>
          </DialogHeader>
          <pre className="text-xs whitespace-pre-wrap max-h-[60vh] overflow-y-auto bg-muted/40 p-4 rounded font-mono">
{b.contractText}
          </pre>
          <div className="text-xs text-muted-foreground border-t pt-3 space-y-1">
            <p>Renter signature: {b.renterSignatureName ? `${b.renterSignatureName} (${formatDateTime(b.renterSignedAt)})` : "— not yet signed —"}</p>
            <p>Owner signature: {b.ownerSignatureName ? `${b.ownerSignatureName} (${formatDateTime(b.ownerSignedAt)})` : "— not yet signed —"}</p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign the rental contract</DialogTitle>
            <DialogDescription>
              Type your full legal name. Submitting is the digital equivalent of signing the agreement.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="signName">Your full name</Label>
            <Input id="signName" value={signName} onChange={(e) => setSignName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSignOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!signName.trim()) {
                  toast.error("Type your name to sign.");
                  return;
                }
                onSign(signName.trim());
                setSignOpen(false);
              }}
              disabled={pending}
            >
              <PenLine className="h-3.5 w-3.5 mr-1.5" /> Sign agreement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
