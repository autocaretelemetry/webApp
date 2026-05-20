import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListRenterProfiles,
  useGetRenterProfile,
  useUpdateRenterProfile,
  useListRentalBookings,
  type RenterProfileSummary,
} from "@workspace/api-client-react";
import {
  getListRenterProfilesQueryKey,
  getGetRenterProfileQueryKey,
  getListRentalBookingsQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatDateTime, resolveImageUrl } from "@/lib/format";
import {
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Phone,
  Mail,
  IdCard,
  ShieldCheck,
  ShieldAlert,
  Car,
  Search,
} from "lucide-react";
import { toast } from "sonner";

const KYC_META: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending review", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  verified: { label: "Verified", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  rejected: { label: "Rejected", cls: "bg-destructive/15 text-destructive" },
};

export default function AdminRenters() {
  const queryClient = useQueryClient();
  const { data: renters } = useListRenterProfiles(
    {},
    { query: { queryKey: getListRenterProfilesQueryKey() } },
  );
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const list = renters ?? [];
    const q = search.trim().toLowerCase();
    const matchesSearch = (r: RenterProfileSummary) =>
      !q || r.name.toLowerCase().includes(q) || r.phone.toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q);
    if (tab === "pending") return list.filter((r) => r.kycStatus === "pending" && matchesSearch(r));
    return list.filter(matchesSearch);
  }, [renters, tab, search]);

  const pendingCount = (renters ?? []).filter((r) => r.kycStatus === "pending").length;
  const verifiedCount = (renters ?? []).filter((r) => r.kycStatus === "verified").length;
  const activeRenters = (renters ?? []).filter((r) => r.activeBookings > 0).length;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListRenterProfilesQueryKey() });

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Renters"
        description="Verify KYC documents, view rental history, and triage renter accounts."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Pending review" value={pendingCount} icon={Clock} accent="text-amber-600" />
        <Stat label="Verified" value={verifiedCount} icon={ShieldCheck} accent="text-emerald-600" />
        <Stat label="With active trip" value={activeRenters} icon={Car} accent="text-primary" />
        <Stat label="Total renters" value={(renters ?? []).length} icon={Users} accent="text-blue-600" />
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, phone, or email"
            className="pl-8"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="pending">Pending KYC ({pendingCount})</TabsTrigger>
          <TabsTrigger value="all">All renters ({(renters ?? []).length})</TabsTrigger>
        </TabsList>

        <TabsContent value={tab} className="mt-4 space-y-3">
          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground py-8 text-center">No renters match.</p>
          )}
          {filtered.map((r) => (
            <RenterRow key={r.id} renter={r} onOpen={() => setOpenId(r.id)} />
          ))}
        </TabsContent>
      </Tabs>

      {openId && (
        <RenterDetailDialog
          renterId={openId}
          onClose={() => setOpenId(null)}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

function RenterRow({ renter, onOpen }: { renter: RenterProfileSummary; onOpen: () => void }) {
  const meta = KYC_META[renter.kycStatus] ?? KYC_META.pending;
  return (
    <Card>
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
          {renter.name.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold">{renter.name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" /> {renter.phone}</span>
            {renter.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" /> {renter.email}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <DocPill ok={!!renter.hasIdDocument} label="ID" />
          <DocPill ok={!!renter.hasDriverLicense} label="Licence" />
          <DocPill ok={!!renter.hasSelfie} label="Selfie" />
        </div>
        <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${meta.cls}`}>
          {meta.label}
        </span>
        <div className="text-right text-xs text-muted-foreground min-w-[80px]">
          <p>{renter.bookingCount} booking{renter.bookingCount === 1 ? "" : "s"}</p>
          {renter.activeBookings > 0 && <p className="text-emerald-600 font-medium">{renter.activeBookings} active</p>}
        </div>
        <Button size="sm" variant="outline" onClick={onOpen}>Open</Button>
      </CardContent>
    </Card>
  );
}

function DocPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${
        ok
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
      {label}
    </span>
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

function RenterDetailDialog({
  renterId,
  onClose,
  onChanged,
}: {
  renterId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: renter, isLoading } = useGetRenterProfile(renterId, {
    query: { enabled: true, queryKey: getGetRenterProfileQueryKey(renterId) },
  });
  const bookingParams = { renterId };
  const { data: bookings } = useListRentalBookings(bookingParams, {
    query: { enabled: true, queryKey: getListRentalBookingsQueryKey(bookingParams) },
  });
  const update = useUpdateRenterProfile();

  const setStatus = async (status: "verified" | "rejected" | "pending") => {
    try {
      await update.mutateAsync({ renterId, data: { kycStatus: status } });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetRenterProfileQueryKey(renterId) }),
        queryClient.invalidateQueries({ queryKey: getListRenterProfilesQueryKey() }),
      ]);
      onChanged();
      toast.success(
        status === "verified" ? "Renter approved." : status === "rejected" ? "KYC rejected." : "Reset to pending.",
      );
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update KYC."));
    }
  };

  const meta = renter ? KYC_META[renter.kycStatus] ?? KYC_META.pending : null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{renter?.name ?? "Renter"}</DialogTitle>
          <DialogDescription>
            Review the renter's KYC submissions, then approve or reject.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {renter && (
          <div className="space-y-4">
            <Card>
              <CardContent className="p-4 grid sm:grid-cols-2 gap-3 text-sm">
                <Info icon={Phone} label="Phone" value={renter.phone} />
                <Info icon={Mail} label="Email" value={renter.email ?? "—"} />
                <Info icon={IdCard} label="ID type" value={renter.idDocumentType ?? "—"} />
                <Info icon={IdCard} label="Licence #" value={renter.driverLicenseNumber ?? "—"} />
                <Info icon={Clock} label="Date of birth" value={renter.dateOfBirth ? formatDate(renter.dateOfBirth) : "—"} />
                <Info icon={ShieldCheck} label="KYC status" value={meta?.label ?? renter.kycStatus} />
              </CardContent>
            </Card>

            <div className="grid sm:grid-cols-3 gap-3">
              <DocPreview label="Government ID" url={renter.idDocumentUrl} />
              <DocPreview label="Driver's licence" url={renter.driverLicenseUrl} />
              <DocPreview label="Selfie" url={renter.selfieUrl} />
            </div>

            <div className="flex flex-wrap gap-2 border-t pt-4">
              {renter.kycStatus !== "verified" && (
                <Button onClick={() => setStatus("verified")} disabled={update.isPending} className="gap-1.5">
                  <ShieldCheck className="h-4 w-4" /> Approve KYC
                </Button>
              )}
              {renter.kycStatus !== "rejected" && (
                <Button variant="outline" onClick={() => setStatus("rejected")} disabled={update.isPending} className="gap-1.5 text-destructive hover:text-destructive">
                  <ShieldAlert className="h-4 w-4" /> Reject
                </Button>
              )}
              {renter.kycStatus !== "pending" && (
                <Button variant="ghost" onClick={() => setStatus("pending")} disabled={update.isPending}>
                  Reset to pending
                </Button>
              )}
            </div>

            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                <Car className="h-4 w-4" /> Bookings ({bookings?.length ?? 0})
              </h3>
              <div className="space-y-2">
                {(bookings ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">No bookings on file.</p>
                )}
                {(bookings ?? []).map((b) => (
                  <div key={b.id} className="text-xs bg-muted/40 rounded p-2 flex items-center justify-between gap-2">
                    <span>
                      <span className="font-medium">{b.carLabel}</span>{" "}
                      · {formatDate(b.startDate)} → {formatDate(b.endDate)}
                    </span>
                    <span className="uppercase tracking-wide text-[10px] px-1.5 py-0.5 bg-background rounded">
                      {b.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Info({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5" />
      <div>
        <p className="text-[11px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="font-medium">{value}</p>
      </div>
    </div>
  );
}

function DocPreview({ label, url }: { label: string; url: string | null | undefined }) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">{label}</p>
      {url ? (
        <a
          href={resolveImageUrl(url)}
          target="_blank"
          rel="noreferrer"
          className="block aspect-video bg-muted rounded overflow-hidden hover:ring-2 hover:ring-primary"
        >
          <img src={resolveImageUrl(url)} alt={label} className="w-full h-full object-cover" />
        </a>
      ) : (
        <div className="aspect-video bg-muted rounded flex items-center justify-center text-muted-foreground text-xs">
          Not uploaded
        </div>
      )}
      {/* uploaded timestamp not currently stored per-doc */}
      <p className="text-[10px] text-muted-foreground">{url ? formatDateTime(new Date().toISOString()).slice(0, 0) : ""}</p>
    </div>
  );
}
