import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";

type Payment = {
  id: string;
  provider: string;
  transactionId: string;
  purpose: string;
  purposeRef: string | null;
  amount: number;
  email: string;
  phone: string | null;
  description: string;
  status: "pending" | "successful" | "failed";
  providerCode: string | null;
  providerReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

type FilterKey = "" | "pending" | "successful" | "failed" | "amount_mismatch";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "successful", label: "Successful" },
  { key: "failed", label: "Failed" },
  { key: "amount_mismatch", label: "Amount mismatch" },
];

const STATUS_TONE: Record<Payment["status"], string> = {
  pending: "bg-amber-100 text-amber-900",
  successful: "bg-emerald-100 text-emerald-900",
  failed: "bg-red-100 text-red-900",
};

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function PaymentsAdminPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>("pending");
  const { data, isLoading } = useQuery<{
    payswitchConfigured: boolean;
    payments: Payment[];
  }>({
    queryKey: ["admin", "payments", filter],
    queryFn: () =>
      fetch(`/api/admin/payments${filter ? `?status=${filter}` : ""}`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 15_000,
  });
  const { data: summary } = useQuery<{
    stuckCount: number;
    threshold: number;
    staleAfterMs: number;
  }>({
    queryKey: ["admin", "payments", "stuck-summary"],
    queryFn: () =>
      fetch(`/api/admin/payments/stuck-summary`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 15_000,
  });
  const [busy, setBusy] = useState<string | null>(null);
  const rows = data?.payments ?? [];

  const stuckCount = summary?.stuckCount ?? 0;
  const stuckThreshold = summary?.threshold ?? 0;
  const staleAfterMs = summary?.staleAfterMs ?? 0;
  const staleMinutes = summary ? Math.round(staleAfterMs / 60_000) : 0;
  const showStuckBanner = stuckThreshold > 0 && stuckCount >= stuckThreshold;

  const isStale = (p: Payment): boolean =>
    p.status === "pending" &&
    staleAfterMs > 0 &&
    Date.now() - new Date(p.createdAt).getTime() >= staleAfterMs;
  const firstStaleId = rows.find(isStale)?.id ?? null;

  const goToStuck = () => {
    setFilter("pending");
    const target = firstStaleId
      ? `payment-row-${firstStaleId}`
      : "payment-rows";
    window.requestAnimationFrame(() => {
      document
        .getElementById(target)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };

  const recheck = async (id: string) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/payments/${id}/recheck`, {
        method: "POST",
        credentials: "include",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        outcome?: { kind: string; reason?: string };
      };
      if (!res.ok) {
        toast.error(json.error ?? "Re-check failed");
        return;
      }
      const kind = json.outcome?.kind ?? "unknown";
      const reason = json.outcome?.reason ? ` — ${json.outcome.reason}` : "";
      toast.success(`Re-checked: ${kind}${reason}`);
      void qc.invalidateQueries({ queryKey: ["admin", "payments"] });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-8 space-y-6">
      <PageHeader
        title="Payment transactions"
        description={
          data
            ? data.payswitchConfigured
              ? "Background reconciler re-verifies pending charges every few minutes. Use Re-check now to force an immediate verification."
              : "PaySwitch credentials not configured — Re-check is unavailable until credentials are set."
            : ""
        }
      />
      {summary && (
        <Card
          className={
            showStuckBanner
              ? "border-amber-300 bg-amber-50"
              : "border-border bg-muted/40"
          }
        >
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            {showStuckBanner ? (
              <AlertTriangle className="size-5 text-amber-700 shrink-0" />
            ) : (
              <Clock className="size-5 text-muted-foreground shrink-0" />
            )}
            <div className="flex-1 min-w-[12rem]">
              {showStuckBanner ? (
                <>
                  <p className="font-semibold text-amber-900">
                    {stuckCount} payment{stuckCount === 1 ? "" : "s"} stuck in
                    &lsquo;pending&rsquo; &gt; {staleMinutes} min — likely
                    PaySwitch outage
                  </p>
                  <p className="text-xs text-amber-800">
                    This is at or above the alert threshold of {stuckThreshold}.
                    Super admins have been notified.
                  </p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    {stuckCount} payment{stuckCount === 1 ? "" : "s"} stuck in
                    &lsquo;pending&rsquo; &gt; {staleMinutes} min
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Below the alert threshold of {stuckThreshold}. The
                    background reconciler re-verifies these automatically.
                  </p>
                </>
              )}
            </div>
            {stuckCount > 0 && (
              <Button
                size="sm"
                variant="outline"
                className={
                  showStuckBanner
                    ? "border-amber-400 text-amber-900 hover:bg-amber-100"
                    : ""
                }
                onClick={goToStuck}
              >
                View stuck payments
              </Button>
            )}
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-sm">Filter:</span>
        {FILTERS.map((f) => (
          <Button
            key={f.key || "all"}
            variant={filter === f.key ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </Button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && rows.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No payment transactions match this filter.
          </CardContent>
        </Card>
      )}
      <div id="payment-rows" className="space-y-2 scroll-mt-4">
        {rows.map((p) => {
          const tone = STATUS_TONE[p.status];
          const isAmountMismatch =
            p.status === "failed" &&
            (p.providerReason ?? "").startsWith("amount_mismatch:");
          const stale = isStale(p);
          return (
            <Card
              key={p.id}
              id={`payment-row-${p.id}`}
              className={stale ? "border-amber-300 bg-amber-50/60 scroll-mt-4" : "scroll-mt-4"}
            >
              <CardContent className="py-4 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold">
                      {p.purpose}{" "}
                      <span className="text-muted-foreground font-normal">
                        · txn {p.transactionId}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {p.purposeRef ? `${p.purposeRef.slice(0, 8)} · ` : ""}
                      {formatDateTime(p.createdAt)} · {ageOf(p.createdAt)}
                      {stale && (
                        <span className="ml-1 text-amber-700 font-medium">
                          · stuck
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isAmountMismatch && (
                      <Badge className="bg-red-100 text-red-900">
                        Amount mismatch
                      </Badge>
                    )}
                    <Badge className={tone}>{p.status}</Badge>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-sm">
                  <div>
                    Amount:{" "}
                    <span className="font-semibold">
                      {formatCurrency(p.amount / 100)}
                    </span>
                  </div>
                  <div className="truncate">Email: {p.email}</div>
                  {p.phone && <div>Phone: {p.phone}</div>}
                </div>
                <p className="text-xs text-muted-foreground">{p.description}</p>
                {(p.providerCode || p.providerReason) && (
                  <p className="text-xs">
                    <span className="text-muted-foreground">Provider: </span>
                    <span className="font-mono">
                      {p.providerCode ?? "—"} · {p.providerReason ?? "—"}
                    </span>
                  </p>
                )}
                {p.completedAt && (
                  <p className="text-xs text-muted-foreground">
                    Completed {formatDateTime(p.completedAt)}
                  </p>
                )}
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      busy === p.id ||
                      !data?.payswitchConfigured ||
                      p.status === "successful"
                    }
                    onClick={() => recheck(p.id)}
                  >
                    <RefreshCw className="size-3 mr-1" />
                    {busy === p.id ? "Re-checking…" : "Re-check now"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground pt-2">
        Re-check runs the same verification + settlement path the background
        reconciler uses, so the outcome here is the canonical one.
      </p>
    </div>
  );
}
