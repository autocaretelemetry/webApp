import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { CheckCircle2, XCircle, FileText, Clock } from "lucide-react";

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
  kycDocuments?: Array<{ key: string; label: string; url: string }> | null;
  createdAt: string;
};

async function fetchApprovals(state: string): Promise<AuthedUserRow[]> {
  const res = await fetch(`/api/admin/approvals?state=${state}`, { credentials: "include" });
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
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectFor, setRejectFor] = useState<AuthedUserRow | null>(null);
  const [reason, setReason] = useState("");

  const state = kind === "kyc" ? "kyc_pending" : kind === "rejected" ? "rejected" : "pending";

  async function reload() {
    try {
      setRows(await fetchApprovals(state));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load");
    }
  }

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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

  if (!rows) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          {kind === "kyc"
            ? "No KYC submissions waiting for review."
            : kind === "rejected"
              ? "No rejected applications."
              : "No pending applications."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {rows.map((row) => (
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
              {kind !== "rejected" && (
                <div className="flex items-center gap-2">
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
                </div>
              )}
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
                {row.kycDocuments.map((d) => (
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
                ))}
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
