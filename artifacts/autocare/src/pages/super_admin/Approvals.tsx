import { useEffect, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  CheckCircle2,
  XCircle,
  FileText,
  Clock,
  History,
  StickyNote,
  Send,
  Loader2,
  Mail,
} from "lucide-react";

type ApprovalEvent = {
  id: string;
  userId: string;
  actorUserId: string | null;
  actorName: string | null;
  action:
    | "applied"
    | "approved"
    | "rejected"
    | "kyc_submitted"
    | "kyc_verified"
    | "kyc_rejected"
    | "note";
  note: string | null;
  internal: boolean;
  createdAt: string;
};

const ACTION_LABEL: Record<ApprovalEvent["action"], string> = {
  applied: "Applied",
  approved: "Approved",
  rejected: "Rejected",
  kyc_submitted: "KYC submitted",
  kyc_verified: "KYC verified",
  kyc_rejected: "KYC rejected",
  note: "Internal note",
};

const ACTION_TONE: Record<ApprovalEvent["action"], string> = {
  applied: "bg-muted text-muted-foreground",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-destructive/15 text-destructive",
  kyc_submitted: "bg-muted text-muted-foreground",
  kyc_verified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  kyc_rejected: "bg-destructive/15 text-destructive",
  note: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
};

type AuthedUserRow = {
  id: string;
  email: string;
  name: string;
  role: string;
  phone: string | null;
  approvalStatus: string;
  approvalNote: string | null;
  kycStatus: string;
  kycNote: string | null;
  requestedRole: string | null;
  applicantData?: Record<string, unknown> | null;
  kycDocuments?: Array<{
    key: string;
    label: string;
    url: string;
    scanStatus?: "pending" | "clean" | "infected" | "error";
    scanCheckedAt?: string;
    scanDetails?: string;
  }> | null;
  createdAt: string;
};

type ApprovalsPage = {
  items: AuthedUserRow[];
  nextCursor: string | null;
};

const ROLE_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "owner", label: "Car owner" },
  { value: "center", label: "Service center" },
  { value: "vendor", label: "Parts vendor" },
  { value: "delivery", label: "Delivery agent" },
  { value: "fleet", label: "Fleet / institution" },
  { value: "renter", label: "Renter" },
] as const;

const SORT_OPTIONS = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "role", label: "By role" },
] as const;

type SortValue = (typeof SORT_OPTIONS)[number]["value"];

async function fetchApprovals(params: {
  state: string;
  role: string;
  q: string;
  sort: SortValue;
  cursor?: string;
}): Promise<ApprovalsPage> {
  const qs = new URLSearchParams({
    state: params.state,
    sort: params.sort,
    limit: "25",
  });
  if (params.role && params.role !== "all") qs.set("role", params.role);
  if (params.q.trim()) qs.set("q", params.q.trim());
  if (params.cursor) qs.set("cursor", params.cursor);
  const res = await fetch(`/api/admin/approvals?${qs.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Failed to load");
  return res.json();
}

export default function ApprovalsPage() {
  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Account approvals"
        description="Review self-signup applications and KYC submissions."
      />
      <Tabs defaultValue="applications">
        <TabsList>
          <TabsTrigger value="applications">Applications</TabsTrigger>
          <TabsTrigger value="kyc">KYC submissions</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
        </TabsList>
        <TabsContent value="applications" className="mt-4">
          <ApprovalsList kind="applications" />
        </TabsContent>
        <TabsContent value="kyc" className="mt-4">
          <ApprovalsList kind="kyc" />
        </TabsContent>
        <TabsContent value="rejected" className="mt-4">
          <ApprovalsList kind="rejected" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ApprovalsList({ kind }: { kind: "applications" | "kyc" | "rejected" }) {
  const [rows, setRows] = useState<AuthedUserRow[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<AuthedUserRow | null>(null);
  const [reason, setReason] = useState("");
  const [historyFor, setHistoryFor] = useState<AuthedUserRow | null>(null);

  const [role, setRole] = useState<string>("all");
  const [sort, setSort] = useState<SortValue>("newest");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");

  const state = useMemo(
    () =>
      kind === "kyc" ? "kyc_pending" : kind === "rejected" ? "rejected" : "pending",
    [kind],
  );

  useEffect(() => {
    const id = window.setTimeout(() => setQ(searchInput), 250);
    return () => window.clearTimeout(id);
  }, [searchInput]);

  async function reload() {
    setRows(null);
    setNextCursor(null);
    try {
      const page = await fetchApprovals({ state, role, q, sort });
      setRows(page.items);
      setNextCursor(page.nextCursor);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
      setRows([]);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchApprovals({ state, role, q, sort, cursor: nextCursor });
      setRows((prev) => (prev ? [...prev, ...page.items] : page.items));
      setNextCursor(page.nextCursor);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, role, q, sort]);

  async function decide(row: AuthedUserRow, action: "approve" | "reject" | "verify", note?: string) {
    setBusy(row.id);
    try {
      const url = kind === "kyc" ? `/api/admin/kyc/${row.id}` : `/api/admin/approvals/${row.id}`;
      const body =
        kind === "kyc"
          ? { decision: action === "approve" || action === "verify" ? "verify" : "reject", note: note ?? null }
          : { decision: action === "approve" ? "approve" : "reject", note: note ?? null };
      const res = await fetch(url, {
        method: "PATCH",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(b.error ?? "Failed");
      }
      toast.success(action === "approve" || action === "verify" ? "Approved." : "Rejected.");
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(null);
      setRejectFor(null);
      setReason("");
    }
  }

  async function resend(row: AuthedUserRow) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/admin/approvals/${row.id}/resend-email`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error ?? "Failed to resend");
      }
      if (body.sent) {
        toast.success("Email resent.");
      } else if (body.reason === "not_configured") {
        toast.success("Email queued (delivery not configured in this environment).");
      } else if (body.reason === "no_recipient") {
        toast.error("User has no email on file.");
      } else {
        toast.error("Email could not be delivered. Check server logs.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to resend");
    } finally {
      setBusy(null);
    }
  }

  const filters = (
    <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
      <Input
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder="Search by name, email, or phone…"
        className="sm:max-w-xs"
      />
      <Select value={role} onValueChange={setRole}>
        <SelectTrigger className="sm:w-56">
          <SelectValue placeholder="All roles" />
        </SelectTrigger>
        <SelectContent>
          {ROLE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={sort} onValueChange={(v) => setSort(v as SortValue)}>
        <SelectTrigger className="sm:w-44">
          <SelectValue placeholder="Sort" />
        </SelectTrigger>
        <SelectContent>
          {SORT_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  const hasFilters = role !== "all" || q.trim().length > 0;
  const emptyMessage = hasFilters
    ? "No applicants match these filters."
    : kind === "kyc"
      ? "No KYC submissions waiting for review."
      : kind === "rejected"
        ? "No rejected applications."
        : "No pending applications.";

  return (
    <div className="space-y-3">
      {filters}
      {rows === null && (
        <div className="text-sm text-muted-foreground">Loading…</div>
      )}
      {rows !== null && rows.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {emptyMessage}
          </CardContent>
        </Card>
      )}
      {rows?.map((row) => (
        <Card key={row.id}>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-0.5">
                <div className="font-semibold flex items-center gap-2">
                  {row.name}
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {row.requestedRole ?? row.role}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {row.email} {row.phone ? `· ${row.phone}` : ""}
                </div>
                <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {new Date(row.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setHistoryFor(row)}
                >
                  <History className="h-4 w-4 mr-1" /> History
                </Button>
                {kind !== "rejected" && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => decide(row, kind === "kyc" ? "verify" : "approve")}
                      disabled={busy === row.id}
                    >
                      <CheckCircle2 className="h-4 w-4 mr-1" /> {kind === "kyc" ? "Verify" : "Approve"}
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setRejectFor(row)}
                      disabled={busy === row.id}
                    >
                      <XCircle className="h-4 w-4 mr-1" /> Reject
                    </Button>
                  </>
                )}
                {(kind === "rejected" ||
                  row.approvalStatus !== "pending" ||
                  row.kycStatus === "verified" ||
                  row.kycStatus === "rejected") && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => resend(row)}
                    disabled={busy === row.id}
                    title="Re-send the latest decision email to this applicant"
                  >
                    <Mail className="h-4 w-4 mr-1" /> Resend email
                  </Button>
                )}
              </div>
            </div>

            {kind !== "kyc" && row.applicantData && Object.keys(row.applicantData).length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Application details</summary>
                <pre className="mt-2 p-2 rounded bg-muted/50 overflow-auto">
                  {JSON.stringify(row.applicantData, null, 2)}
                </pre>
              </details>
            )}

            {kind === "kyc" && row.kycDocuments && row.kycDocuments.length > 0 && (
              <div className="grid sm:grid-cols-3 gap-2">
                {row.kycDocuments.map((d) => {
                  // Reviewer-side gate: never render the actual image for a
                  // document that isn't `clean`. Anything still pending, in
                  // error, or quarantined as infected gets a placeholder so a
                  // reviewer cannot accidentally download an unscanned blob.
                  const scan = d.scanStatus ?? "pending";
                  if (scan !== "clean") {
                    return (
                      <div
                        key={d.key}
                        className="block rounded-md border bg-card overflow-hidden"
                      >
                        <div className="aspect-[4/3] bg-muted flex items-center justify-center text-[11px] text-muted-foreground px-2 text-center">
                          {scan === "infected"
                            ? "Flagged by malware scanner — quarantined."
                            : scan === "error"
                              ? "Security scan errored. Ask applicant to re-upload."
                              : "Awaiting security scan…"}
                        </div>
                        <div className="px-2 py-1.5 text-[11px] flex items-center gap-1.5">
                          <FileText className="h-3 w-3" /> {d.label}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <a
                      key={d.key}
                      href={d.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-md border bg-card hover:border-primary/40 overflow-hidden"
                    >
                      <div className="aspect-[4/3] bg-muted flex items-center justify-center">
                        <img src={d.url} alt={d.label} className="w-full h-full object-cover" />
                      </div>
                      <div className="px-2 py-1.5 text-[11px] flex items-center gap-1.5">
                        <FileText className="h-3 w-3" /> {d.label}
                      </div>
                    </a>
                  );
                })}
              </div>
            )}

            {kind === "rejected" && (row.approvalNote || row.kycNote) && (
              <div className="text-xs text-destructive">
                Reason: {row.approvalNote ?? row.kycNote}
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {rows && rows.length > 0 && nextCursor && (
        <div className="flex justify-center pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadMore}
            disabled={loadingMore}
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-4 w-4 mr-1 animate-spin" /> Loading…
              </>
            ) : (
              "Load more"
            )}
          </Button>
        </div>
      )}

      <HistoryDialog
        applicant={historyFor}
        onClose={() => setHistoryFor(null)}
      />

      <Dialog open={!!rejectFor} onOpenChange={(o) => !o && setRejectFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejectFor?.name}</DialogTitle>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="Reason (shown to the applicant)…"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectFor(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => rejectFor && decide(rejectFor, "reject", reason.trim() || undefined)}
              disabled={!!busy}
            >
              Confirm rejection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HistoryDialog({
  applicant,
  onClose,
}: {
  applicant: AuthedUserRow | null;
  onClose: () => void;
}) {
  const [events, setEvents] = useState<ApprovalEvent[] | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!applicant) {
      setEvents(null);
      setNote("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/approvals/${applicant.id}/events`, {
          credentials: "include",
        });
        if (!res.ok) throw new Error("Failed to load history");
        const data = (await res.json()) as ApprovalEvent[];
        if (!cancelled) setEvents(data);
      } catch (err) {
        if (!cancelled) {
          toast.error(err instanceof Error ? err.message : "Failed to load history");
          setEvents([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applicant]);

  async function addNote() {
    if (!applicant || !note.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/approvals/${applicant.id}/notes`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ error: "Failed" }));
        throw new Error(b.error ?? "Failed");
      }
      const added = (await res.json()) as ApprovalEvent;
      setEvents((prev) => (prev ? [...prev, added] : [added]));
      setNote("");
      toast.success("Note added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!applicant} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            History · {applicant?.name}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
            {events === null && (
              <div className="text-sm text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading history…
              </div>
            )}
            {events && events.length === 0 && (
              <div className="text-sm text-muted-foreground">
                No events recorded yet.
              </div>
            )}
            {events?.map((ev) => (
              <div
                key={ev.id}
                className="flex gap-3 text-sm border-l-2 border-muted pl-3"
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${ACTION_TONE[ev.action]}`}
                    >
                      {ACTION_LABEL[ev.action]}
                    </span>
                    {ev.internal && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground inline-flex items-center gap-1">
                        <StickyNote className="h-3 w-3" /> internal
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {new Date(ev.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {ev.note && (
                    <div className="text-sm whitespace-pre-wrap break-words">
                      {ev.note}
                    </div>
                  )}
                  <div className="text-[11px] text-muted-foreground">
                    by {ev.actorName ?? "system"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t pt-3">
            <div className="text-xs font-medium text-muted-foreground inline-flex items-center gap-1">
              <StickyNote className="h-3 w-3" /> Add an internal note
            </div>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="Only visible to staff on this audit trail…"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={addNote} disabled={!note.trim() || saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Send className="h-4 w-4 mr-1" />
                )}
                Save note
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
