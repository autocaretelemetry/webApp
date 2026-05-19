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
import { Textarea } from "@/components/ui/textarea";
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
  CheckCircle2,
  XCircle,
  Clock,
  PenLine,
  ScrollText,
  IdCard,
  ShieldCheck,
  PlayCircle,
  CheckSquare,
  Phone,
  User,
  KeyRound,
} from "lucide-react";
import { toast } from "sonner";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending_review: { label: "Pending review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive" },
  contract_pending: { label: "Awaiting signatures", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  awaiting_payment: { label: "Awaiting payment", cls: "bg-blue-500/15 text-blue-700 dark:text-blue-300" },
  confirmed: { label: "Confirmed", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  active: { label: "Trip in progress", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  completed: { label: "Completed", cls: "bg-muted text-muted-foreground" },
  cancelled: { label: "Cancelled", cls: "bg-destructive/15 text-destructive" },
};

export default function ListingRequests() {
  const queryClient = useQueryClient();
  const { profile } = useRenterProfile();

  const params = { ownerPhone: profile.phone };
  const { data: bookings, isLoading } = useListRentalBookings(params, {
    query: { queryKey: getListRentalBookingsQueryKey(params) },
  });
  const update = useUpdateRentalBooking();

  const sorted = useMemo(
    () => (bookings ?? []).slice().sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt)),
    [bookings],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, signing: 0, active: 0, total: sorted.length };
    sorted.forEach((b) => {
      if (b.status === "pending_review") c.pending++;
      if (b.status === "contract_pending" || b.status === "awaiting_payment") c.signing++;
      if (b.status === "confirmed" || b.status === "active") c.active++;
    });
    return c;
  }, [sorted]);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListRentalBookingsQueryKey() });

  const review = async (id: string, decision: "approve" | "reject", notes?: string) => {
    try {
      await update.mutateAsync({
        rentalBookingId: id,
        data: { ownerReview: { decision, notes } },
      });
      await invalidate();
      toast.success(decision === "approve" ? "Approved. Contract generated for both parties." : "Booking rejected.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to submit review."));
    }
  };

  const sign = async (id: string, name: string) => {
    try {
      await update.mutateAsync({
        rentalBookingId: id,
        data: { sign: { party: "owner", name } },
      });
      await invalidate();
      toast.success("Signed.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to sign."));
    }
  };

  const advance = async (id: string, status: "active" | "completed") => {
    try {
      await update.mutateAsync({ rentalBookingId: id, data: { status } });
      await invalidate();
      toast.success(status === "active" ? "Trip started." : "Trip completed.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update."));
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Requests on my cars"
        description={`Booking requests on cars listed under ${profile.phone}. Review each renter's KYC, approve, and co-sign the contract.`}
        actions={
          <Link href="/rentals/my-listings">
            <Button variant="outline" className="gap-2"><KeyRound className="h-4 w-4" /> My listings</Button>
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Pending review" value={counts.pending} accent="text-amber-600" icon={Clock} />
        <Stat label="Awaiting signatures / payment" value={counts.signing} accent="text-blue-600" icon={ScrollText} />
        <Stat label="Active / confirmed" value={counts.active} accent="text-emerald-600" icon={CheckCircle2} />
        <Stat label="Total requests" value={counts.total} accent="text-primary" icon={Car} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && sorted.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center">
              <Car className="h-6 w-6" />
            </div>
            <p className="font-medium">No booking requests yet.</p>
            <p className="text-sm text-muted-foreground">When someone requests one of your cars, it'll show up here.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {sorted.map((b) => (
          <RequestRow
            key={b.id}
            booking={b}
            ownerName={profile.name}
            pending={update.isPending}
            onReview={(decision, notes) => review(b.id, decision, notes)}
            onSign={(name) => sign(b.id, name)}
            onAdvance={(status) => advance(b.id, status)}
          />
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, accent, icon: Icon }: { label: string; value: number; accent: string; icon: React.ComponentType<{ className?: string }> }) {
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

function RequestRow({
  booking: b,
  ownerName,
  pending,
  onReview,
  onSign,
  onAdvance,
}: {
  booking: RentalBooking;
  ownerName: string;
  pending: boolean;
  onReview: (decision: "approve" | "reject", notes?: string) => void;
  onSign: (name: string) => void;
  onAdvance: (status: "active" | "completed") => void;
}) {
  const meta = STATUS_META[b.status] ?? STATUS_META.pending_review;
  const [kycOpen, setKycOpen] = useState(false);
  const [contractOpen, setContractOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState("");
  const [signOpen, setSignOpen] = useState(false);
  const [signName, setSignName] = useState(ownerName);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-start gap-4">
          <div className="h-20 w-28 rounded-md bg-muted overflow-hidden flex-shrink-0 hidden sm:block">
            {b.carImageUrl ? <img src={b.carImageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-muted-foreground"><Car className="h-7 w-7" /></div>}
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold">{b.carLabel || "Rental"}</h3>
              <span className={`inline-flex text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
              {b.renter?.kycStatus === "verified" && (
                <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" /> KYC verified
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <User className="h-3.5 w-3.5" /> {b.renterName} · <Phone className="h-3.5 w-3.5" /> {b.renterPhone}
            </p>
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Calendar className="h-3.5 w-3.5" />
              {formatDate(b.startDate)} → {formatDate(b.endDate)} · {b.days} day{b.days === 1 ? "" : "s"}
            </p>
            {b.notes && <p className="text-xs italic text-muted-foreground">"{b.notes}"</p>}
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="font-bold text-primary">{formatCurrency(b.total)}</p>
            {b.paymentMethod && (
              <p className="text-[11px] text-muted-foreground mt-1">
                {b.paymentMethod === "online" ? "Online" : "Cash on pickup"}
                {b.paymentStatus === "paid" ? " · paid" : ""}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-1 border-t">
          {b.renter && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setKycOpen(true)}>
              <IdCard className="h-3.5 w-3.5" /> Review KYC
            </Button>
          )}
          {b.status === "pending_review" && (
            <>
              <Button size="sm" className="gap-1.5" onClick={() => onReview("approve")} disabled={pending}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Approve & generate contract
              </Button>
              <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setRejectOpen(true)} disabled={pending}>
                <XCircle className="h-3.5 w-3.5" /> Reject
              </Button>
            </>
          )}
          {b.contractText && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setContractOpen(true)}>
              <ScrollText className="h-3.5 w-3.5" /> View contract
            </Button>
          )}
          {b.status === "contract_pending" && !b.ownerSignedAt && (
            <Button size="sm" className="gap-1.5" onClick={() => setSignOpen(true)} disabled={pending}>
              <PenLine className="h-3.5 w-3.5" /> Sign as owner
            </Button>
          )}
          {b.status === "contract_pending" && b.ownerSignedAt && !b.renterSignedAt && (
            <span className="text-xs text-muted-foreground">Signed — waiting for renter.</span>
          )}
          {b.status === "confirmed" && (
            <Button size="sm" className="gap-1.5" onClick={() => onAdvance("active")} disabled={pending}>
              <PlayCircle className="h-3.5 w-3.5" /> Mark trip started
              {b.paymentMethod === "cash_on_pickup" && b.paymentStatus !== "paid" && " (cash received)"}
            </Button>
          )}
          {b.status === "active" && (
            <Button size="sm" className="gap-1.5" onClick={() => onAdvance("completed")} disabled={pending}>
              <CheckSquare className="h-3.5 w-3.5" /> Mark completed
            </Button>
          )}
        </div>
      </CardContent>

      {/* KYC dialog */}
      <Dialog open={kycOpen} onOpenChange={setKycOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Renter KYC — {b.renterName}</DialogTitle>
            <DialogDescription>
              Verify documents before approving. AutoCare keeps these records linked to the booking.
            </DialogDescription>
          </DialogHeader>
          {b.renter ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <Field label="Full name" value={b.renter.name} />
                <Field label="Phone" value={b.renter.phone} />
                <Field label="Email" value={b.renter.email ?? "—"} />
                <Field label="Date of birth" value={b.renter.dateOfBirth ?? "—"} />
                <Field label="Address" value={b.renter.address ?? "—"} className="col-span-2" />
                <Field label="Licence number" value={b.renter.driverLicenseNumber ?? "—"} />
                <Field label="ID type" value={b.renter.idDocumentType ?? "—"} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <DocImg label="Driver's licence" url={b.renter.driverLicenseUrl} />
                <DocImg label="ID document" url={b.renter.idDocumentUrl} />
                <DocImg label="Selfie" url={b.renter.selfieUrl} />
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No renter profile attached.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Reject dialog */}
      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject booking</DialogTitle>
            <DialogDescription>Tell the renter why so they can improve their next request.</DialogDescription>
          </DialogHeader>
          <Textarea rows={3} value={rejectNotes} onChange={(e) => setRejectNotes(e.target.value)} placeholder="e.g. KYC documents unclear, dates not available." />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => {
                onReview("reject", rejectNotes.trim() || undefined);
                setRejectOpen(false);
              }}
              disabled={pending}
            >
              Reject booking
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Contract dialog */}
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

      {/* Sign dialog */}
      <Dialog open={signOpen} onOpenChange={setSignOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Sign the rental contract</DialogTitle>
            <DialogDescription>Type your full legal name to digitally sign this agreement.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="ownerSignName">Your full name</Label>
            <Input id="ownerSignName" value={signName} onChange={(e) => setSignName(e.target.value)} />
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

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-sm">{value}</p>
    </div>
  );
}

function DocImg({ label, url }: { label: string; url?: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="aspect-[4/3] rounded-md bg-muted border overflow-hidden">
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            <img src={url} alt={label} className="w-full h-full object-cover" />
          </a>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">Not provided</div>
        )}
      </div>
    </div>
  );
}
