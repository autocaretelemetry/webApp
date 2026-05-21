import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Car,
  CheckCircle2,
  Clock,
  Mail,
  Phone,
  Search,
  ShieldAlert,
  ShieldCheck,
  Users,
  XCircle,
} from "lucide-react";

type OwnerRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  approvalStatus: "pending" | "approved" | "rejected";
  approvalNote: string | null;
  kycStatus: "not_submitted" | "submitted" | "verified" | "rejected";
  createdAt: string;
  active: boolean;
  vehicleCount: number;
};

const STATUS_META: Record<
  OwnerRow["approvalStatus"],
  { label: string; cls: string }
> = {
  approved: {
    label: "Active",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  pending: {
    label: "Pending",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  rejected: {
    label: "Suspended",
    cls: "bg-destructive/15 text-destructive",
  },
};

const KYC_META: Record<OwnerRow["kycStatus"], { label: string; cls: string }> = {
  verified: {
    label: "KYC verified",
    cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  },
  submitted: {
    label: "KYC under review",
    cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  not_submitted: {
    label: "KYC missing",
    cls: "bg-muted text-muted-foreground",
  },
  rejected: {
    label: "KYC rejected",
    cls: "bg-destructive/15 text-destructive",
  },
};

async function loadOwners(): Promise<OwnerRow[]> {
  const res = await fetch("/api/admin/owners", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load owners");
  return res.json();
}

export default function AdminOwners() {
  const [owners, setOwners] = useState<OwnerRow[] | null>(null);
  const [tab, setTab] = useState<"active" | "suspended" | "all">("active");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [suspendFor, setSuspendFor] = useState<OwnerRow | null>(null);
  const [reason, setReason] = useState("");

  async function reload() {
    try {
      const rows = await loadOwners();
      setOwners(rows);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
      setOwners([]);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  const filtered = useMemo(() => {
    const list = owners ?? [];
    const q = search.trim().toLowerCase();
    return list.filter((o) => {
      if (tab === "active" && o.approvalStatus !== "approved") return false;
      if (tab === "suspended" && o.approvalStatus !== "rejected") return false;
      if (!q) return true;
      return (
        o.name.toLowerCase().includes(q) ||
        o.email.toLowerCase().includes(q) ||
        (o.phone ?? "").toLowerCase().includes(q)
      );
    });
  }, [owners, tab, search]);

  const activeCount = (owners ?? []).filter((o) => o.approvalStatus === "approved").length;
  const suspendedCount = (owners ?? []).filter((o) => o.approvalStatus === "rejected").length;
  const totalVehicles = (owners ?? []).reduce((n, o) => n + o.vehicleCount, 0);

  async function setStatus(row: OwnerRow, approvalStatus: "approved" | "rejected", note?: string) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/admin/users/${row.id}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalStatus, note: note ?? undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(body.error ?? "Failed");
      }
      toast.success(approvalStatus === "approved" ? "Owner reinstated." : "Owner suspended.");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusyId(null);
      setSuspendFor(null);
      setReason("");
    }
  }

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Car owners"
        description="Active vehicle owners on the platform, plus suspended accounts."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active owners" value={activeCount} icon={ShieldCheck} accent="text-emerald-600" />
        <Stat label="Suspended" value={suspendedCount} icon={ShieldAlert} accent="text-destructive" />
        <Stat label="Total owners" value={(owners ?? []).length} icon={Users} accent="text-blue-600" />
        <Stat label="Vehicles registered" value={totalVehicles} icon={Car} accent="text-primary" />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, email, or phone"
            className="pl-8"
          />
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="active">Active ({activeCount})</TabsTrigger>
          <TabsTrigger value="suspended">Suspended ({suspendedCount})</TabsTrigger>
          <TabsTrigger value="all">All ({(owners ?? []).length})</TabsTrigger>
        </TabsList>
      </Tabs>

      {owners === null && (
        <p className="text-sm text-muted-foreground py-8 text-center">Loading…</p>
      )}
      {owners !== null && filtered.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No owners match.
          </CardContent>
        </Card>
      )}
      {filtered.map((o) => {
        const status = STATUS_META[o.approvalStatus];
        const kyc = KYC_META[o.kycStatus];
        return (
          <Card key={o.id}>
            <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
              <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-semibold shrink-0">
                {o.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{o.name}</p>
                <p className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                  <span className="inline-flex items-center gap-1">
                    <Mail className="h-3 w-3" /> {o.email}
                  </span>
                  {o.phone && (
                    <span className="inline-flex items-center gap-1">
                      <Phone className="h-3 w-3" /> {o.phone}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" /> joined {new Date(o.createdAt).toLocaleDateString()}
                  </span>
                </p>
                {o.approvalStatus === "rejected" && o.approvalNote && (
                  <p className="text-xs text-destructive mt-1">
                    Reason: {o.approvalNote}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 text-xs bg-muted px-2 py-0.5 rounded">
                  <Car className="h-3 w-3" /> {o.vehicleCount} vehicle{o.vehicleCount === 1 ? "" : "s"}
                </span>
                <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${kyc.cls}`}>
                  {kyc.label}
                </span>
                <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${status.cls}`}>
                  {status.label}
                </span>
                {o.approvalStatus === "approved" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setSuspendFor(o)}
                    disabled={busyId === o.id}
                    className="text-destructive hover:text-destructive"
                  >
                    <XCircle className="h-4 w-4 mr-1" /> Suspend
                  </Button>
                ) : o.approvalStatus === "rejected" ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStatus(o, "approved")}
                    disabled={busyId === o.id}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-1" /> Reinstate
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!suspendFor} onOpenChange={(o) => !o && setSuspendFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Suspend {suspendFor?.name}</DialogTitle>
            <DialogDescription>
              The owner will be blocked from signing in. They will see this reason on their next login attempt.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Reason (shown to the owner)…"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSuspendFor(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => suspendFor && setStatus(suspendFor, "rejected", reason.trim() || undefined)}
              disabled={!!busyId}
            >
              Confirm suspension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
