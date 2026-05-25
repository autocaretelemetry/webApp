import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2 } from "lucide-react";

type Payout = {
  id: string;
  saleKind: string;
  saleId: string;
  sellerKind: string;
  sellerId: string;
  sellerName: string;
  grossAmount: number;
  commissionAmount: number;
  netAmount: number;
  status: "needs_account" | "pending" | "paid" | "failed";
  attempts: number;
  lastError: string | null;
  reference: string | null;
  manualNote: string | null;
  createdAt: string;
  paidAt: string | null;
  lastAttemptAt: string | null;
  account: {
    kind: "bank" | "momo";
    accountName: string;
    accountNumber: string;
    bank?: string;
    network?: string;
  } | null;
};

const STATUS_LABEL: Record<Payout["status"], { label: string; tone: string }> = {
  needs_account: { label: "Needs account", tone: "bg-amber-100 text-amber-900" },
  pending: { label: "Pending", tone: "bg-slate-100 text-slate-900" },
  paid: { label: "Paid", tone: "bg-emerald-100 text-emerald-900" },
  failed: { label: "Failed", tone: "bg-red-100 text-red-900" },
};

export default function PayoutsAdminPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("");
  const { data, isLoading } = useQuery<{ disburseConfigured: boolean; payouts: Payout[] }>({
    queryKey: ["admin", "payouts", filter],
    queryFn: () =>
      fetch(`/api/admin/payouts${filter ? `?status=${filter}` : ""}`, { credentials: "include" })
        .then((r) => r.json()),
  });
  const rows = data?.payouts ?? [];

  const retry = async (id: string) => {
    const res = await fetch(`/api/admin/payouts/${id}/retry`, {
      method: "POST",
      credentials: "include",
    });
    if (res.ok) {
      toast.success("Retry attempted");
      void qc.invalidateQueries({ queryKey: ["admin", "payouts"] });
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error ?? "Retry failed");
    }
  };

  const markPaid = async (id: string) => {
    const reference = window.prompt("PaySwitch / bank reference for this manual settlement:");
    if (!reference) return;
    const note = window.prompt("Optional note:") ?? undefined;
    const res = await fetch(`/api/admin/payouts/${id}/mark-paid`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference, note }),
    });
    if (res.ok) {
      toast.success("Marked paid");
      void qc.invalidateQueries({ queryKey: ["admin", "payouts"] });
    } else {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(err.error ?? "Mark-paid failed");
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      <PageHeader
        title="Seller payouts"
        description={
          data
            ? data.disburseConfigured
              ? "PaySwitch Direct Pay configured — auto-disbursement runs on every successful sale."
              : "Disbursement creds not configured — every payout queues for manual settlement."
            : ""
        }
      />
      <div className="flex gap-2 items-center">
        <span className="text-sm">Filter:</span>
        {["", "needs_account", "pending", "failed", "paid"].map((f) => (
          <Button
            key={f || "all"}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f || "All"}
          </Button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && rows.length === 0 && (
        <Card><CardContent className="py-6 text-sm text-muted-foreground">No payouts.</CardContent></Card>
      )}
      <div className="space-y-2">
        {rows.map((p) => {
          const meta = STATUS_LABEL[p.status];
          return (
            <Card key={p.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">{p.sellerName} <span className="text-muted-foreground font-normal">· {p.sellerKind}</span></p>
                    <p className="text-xs text-muted-foreground">
                      {p.saleKind} · {p.saleId.slice(0, 8)} · {formatDateTime(p.createdAt)}
                    </p>
                  </div>
                  <Badge className={meta.tone}>{meta.label}</Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div>Gross: <span className="font-semibold">{formatCurrency(p.grossAmount)}</span></div>
                  <div>Commission: <span className="font-semibold">{formatCurrency(p.commissionAmount)}</span></div>
                  <div>Net to seller: <span className="font-semibold">{formatCurrency(p.netAmount)}</span></div>
                </div>
                {p.account ? (
                  <p className="text-xs text-muted-foreground">
                    {p.account.kind === "momo"
                      ? `MoMo (${p.account.network}) · ${p.account.accountName} · ${p.account.accountNumber}`
                      : `Bank (${p.account.bank}) · ${p.account.accountName} · ${p.account.accountNumber}`}
                  </p>
                ) : (
                  <p className="text-xs text-amber-700">No payout destination on file.</p>
                )}
                {p.lastError && <p className="text-xs text-red-700">Last error: {p.lastError}</p>}
                {p.reference && <p className="text-xs text-emerald-700">Settled · ref {p.reference}</p>}
                {p.status !== "paid" && (
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" onClick={() => retry(p.id)}>
                      <RefreshCw className="size-3 mr-1" /> Retry
                    </Button>
                    <Button size="sm" onClick={() => markPaid(p.id)}>
                      <CheckCircle2 className="size-3 mr-1" /> Mark paid
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground pt-2">
        Manual mark-paid records the bank/MoMo reference so the audit trail stays
        intact even when settlement happens outside PaySwitch.
      </p>
      <Input className="hidden" />
    </div>
  );
}
