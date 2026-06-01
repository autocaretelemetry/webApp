import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { Percent, Wrench, Package, Car, Save } from "lucide-react";
import { toast } from "sonner";
import { API_ROOT } from "../../lib/api-base";

// Commission endpoints intentionally live outside OpenAPI (single client,
// super-admin only) — call them with plain fetch through the proxy.
const API = API_ROOT;
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON */ }
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string"
        ? (body as { error: string }).error
        : `Request failed (${res.status})`;
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

type SaleKind = "service_invoice" | "parts_order" | "rental_booking";

interface CommissionRate {
  saleKind: SaleKind;
  percent: number;
  updatedAt: string | null;
}

interface LedgerEntry {
  id: string;
  saleKind: SaleKind;
  saleId: string;
  sellerKind: string;
  sellerId: string;
  grossAmount: number;
  percent: number;
  commissionAmount: number;
  netToSeller: number;
  createdAt: string;
}

interface LedgerTotals {
  saleKind: SaleKind;
  gross: number;
  commission: number;
  count: number;
}

const KIND_META: Record<SaleKind, { label: string; sub: string; icon: typeof Wrench }> = {
  service_invoice: {
    label: "Service invoices",
    sub: "Skim taken from each service-center payout when an owner pays an invoice.",
    icon: Wrench,
  },
  parts_order: {
    label: "Parts orders",
    sub: "Skim from vendor or service-center shop sales (direct buys and approved proposals).",
    icon: Package,
  },
  rental_booking: {
    label: "Rental bookings",
    sub: "Skim from the car owner's payout once a renter pays for a trip.",
    icon: Car,
  },
};

export default function Commissions() {
  const queryClient = useQueryClient();

  const ratesQuery = useQuery({
    queryKey: ["commission-rates"],
    queryFn: () => request<CommissionRate[]>("/admin/commission-rates"),
  });

  const ledgerQuery = useQuery({
    queryKey: ["commission-ledger"],
    queryFn: () =>
      request<{ entries: LedgerEntry[]; totals: LedgerTotals[] }>(
        "/admin/commission-ledger",
      ),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Platform commissions"
        description="Set the percentage AutoCare keeps from every non-subscription sale. The cut is deducted from the seller's payout when the transaction is paid."
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {(Object.keys(KIND_META) as SaleKind[]).map((kind) => {
          const rate =
            ratesQuery.data?.find((r) => r.saleKind === kind) ?? {
              saleKind: kind,
              percent: 0,
              updatedAt: null,
            };
          return (
            <RateCard
              key={kind}
              rate={rate}
              onSaved={async () => {
                await queryClient.invalidateQueries({ queryKey: ["commission-rates"] });
              }}
            />
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Totals to date</CardTitle>
        </CardHeader>
        <CardContent>
          {ledgerQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {(Object.keys(KIND_META) as SaleKind[]).map((kind) => {
                const t = ledgerQuery.data?.totals.find((x) => x.saleKind === kind);
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                return (
                  <div
                    key={kind}
                    className="rounded-md border bg-muted/30 p-4 space-y-1.5"
                  >
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Icon className="h-4 w-4 text-primary" />
                      {meta.label}
                    </div>
                    <p className="text-2xl font-bold text-primary">
                      {formatCurrency(t?.commission ?? 0)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      from {formatCurrency(t?.gross ?? 0)} gross · {t?.count ?? 0} sale
                      {(t?.count ?? 0) === 1 ? "" : "s"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent commission entries</CardTitle>
        </CardHeader>
        <CardContent>
          {ledgerQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : ledgerQuery.data?.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No commissions recorded yet. As paid sales come in, they will appear here.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr className="border-b">
                    <th className="text-left py-2 pr-3">When</th>
                    <th className="text-left py-2 pr-3">Sale</th>
                    <th className="text-left py-2 pr-3">Seller</th>
                    <th className="text-right py-2 pr-3">Gross</th>
                    <th className="text-right py-2 pr-3">Rate</th>
                    <th className="text-right py-2 pr-3">Commission</th>
                    <th className="text-right py-2">Net to seller</th>
                  </tr>
                </thead>
                <tbody>
                  {ledgerQuery.data?.entries.map((e) => (
                    <tr key={e.id} className="border-b last:border-0">
                      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(e.createdAt)}
                      </td>
                      <td className="py-2 pr-3">{KIND_META[e.saleKind]?.label ?? e.saleKind}</td>
                      <td className="py-2 pr-3 text-xs">
                        <span className="uppercase tracking-wide text-muted-foreground">
                          {e.sellerKind}
                        </span>
                        <span className="block font-mono text-[11px]">{e.sellerId.slice(0, 12)}…</span>
                      </td>
                      <td className="py-2 pr-3 text-right">{formatCurrency(e.grossAmount)}</td>
                      <td className="py-2 pr-3 text-right">{e.percent.toFixed(2)}%</td>
                      <td className="py-2 pr-3 text-right font-medium text-primary">
                        {formatCurrency(e.commissionAmount)}
                      </td>
                      <td className="py-2 text-right">{formatCurrency(e.netToSeller)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function RateCard({
  rate,
  onSaved,
}: {
  rate: CommissionRate;
  onSaved: () => Promise<void>;
}) {
  const meta = KIND_META[rate.saleKind];
  const Icon = meta.icon;
  const [draft, setDraft] = useState(String(rate.percent));

  useEffect(() => {
    setDraft(String(rate.percent));
  }, [rate.percent]);

  const save = useMutation({
    mutationFn: (percent: number) =>
      request<CommissionRate>(`/admin/commission-rates/${rate.saleKind}`, {
        method: "PUT",
        body: JSON.stringify({ percent }),
        headers: { "Content-Type": "application/json" },
      }),
    onSuccess: async () => {
      toast.success(`${meta.label} rate updated`);
      await onSaved();
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Failed to save";
      toast.error(message);
    },
  });

  const onSubmit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      toast.error("Enter a percentage between 0 and 100.");
      return;
    }
    save.mutate(+n.toFixed(2));
  };

  const dirty = String(rate.percent) !== draft;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {meta.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{meta.sub}</p>
        <div className="space-y-1.5">
          <Label htmlFor={`rate-${rate.saleKind}`}>Commission %</Label>
          <div className="relative">
            <Input
              id={`rate-${rate.saleKind}`}
              type="number"
              inputMode="decimal"
              step="0.1"
              min={0}
              max={100}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="pr-8"
            />
            <Percent className="h-3.5 w-3.5 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          </div>
          {rate.updatedAt && (
            <p className="text-[11px] text-muted-foreground">
              Last changed {formatDateTime(rate.updatedAt)}
            </p>
          )}
        </div>
        <Button
          size="sm"
          className="w-full gap-1.5"
          disabled={!dirty || save.isPending}
          onClick={onSubmit}
        >
          <Save className="h-3.5 w-3.5" />
          {save.isPending ? "Saving…" : "Save"}
        </Button>
      </CardContent>
    </Card>
  );
}
