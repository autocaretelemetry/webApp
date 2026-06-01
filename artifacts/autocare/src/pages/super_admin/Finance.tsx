import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import { API_ROOT } from "../../lib/api-base";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Wrench,
  Package,
  Car,
  TrendingUp,
  BadgePercent,
  Banknote,
  AlertCircle,
} from "lucide-react";

type SaleKind = "service_invoice" | "parts_order" | "rental_booking";
type PayoutStatus = "needs_account" | "pending" | "paid" | "failed";

interface FinanceSummary {
  windowDays: number;
  gmv: {
    byDay: Array<{
      date: string;
      service_invoice: number;
      parts_order: number;
      rental_booking: number;
      total: number;
    }>;
    byKind: Array<{ kind: SaleKind; gross: number; count: number }>;
    windowTotal: number;
  };
  commission: {
    lifetimeTotal: number;
    windowTotal: number;
    byKind: Array<{ kind: string; amount: number }>;
  };
  payouts: {
    byStatus: Array<{ status: string; count: number; amount: number }>;
  };
  topSellers: Array<{
    sellerKind: string;
    sellerId: string;
    sellerName: string;
    grossAmount: number;
    netAmount: number;
    count: number;
  }>;
}

const KIND_META: Record<SaleKind, { label: string; color: string; icon: typeof Wrench }> = {
  service_invoice: { label: "Service invoices", color: "#f26a0d", icon: Wrench },
  parts_order: { label: "Parts orders", color: "#3d5a66", icon: Package },
  rental_booking: { label: "Rental bookings", color: "#7c9885", icon: Car },
};

const PAYOUT_STATUS_META: Record<PayoutStatus, { label: string; color: string; tone: string }> = {
  paid: { label: "Paid", color: "#10b981", tone: "bg-emerald-100 text-emerald-900" },
  pending: { label: "Pending", color: "#64748b", tone: "bg-slate-100 text-slate-900" },
  needs_account: {
    label: "Needs account",
    color: "#f59e0b",
    tone: "bg-amber-100 text-amber-900",
  },
  failed: { label: "Failed", color: "#ef4444", tone: "bg-red-100 text-red-900" },
};

function formatDay(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const API = API_ROOT;

export default function Finance() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useQuery<FinanceSummary>({
    queryKey: ["super-admin", "finance-summary", days],
    queryFn: async () => {
      const res = await fetch(`${API}/admin/finance-summary?days=${days}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed (${res.status})`);
      return (await res.json()) as FinanceSummary;
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance dashboard"
        description="GMV, commissions, payouts, and top sellers — read-only aggregations across the live ledgers."
      />

      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Window:</span>
        {[7, 30, 90].map((d) => (
          <Button
            key={d}
            size="sm"
            variant={days === d ? "default" : "outline"}
            onClick={() => setDays(d)}
          >
            Last {d} days
          </Button>
        ))}
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Stat
              label={`GMV · last ${data.windowDays}d`}
              value={formatCurrency(data.gmv.windowTotal)}
              icon={TrendingUp}
            />
            <Stat
              label={`Commission · last ${data.windowDays}d`}
              value={formatCurrency(data.commission.windowTotal)}
              sub={`Lifetime ${formatCurrency(data.commission.lifetimeTotal)}`}
              icon={BadgePercent}
            />
            <Stat
              label="Payouts paid"
              value={formatCurrency(payoutAmount(data.payouts.byStatus, "paid"))}
              sub={`${payoutCount(data.payouts.byStatus, "paid")} payouts`}
              icon={Banknote}
            />
            <Stat
              label="Payouts at risk"
              value={formatCurrency(
                payoutAmount(data.payouts.byStatus, "failed") +
                  payoutAmount(data.payouts.byStatus, "needs_account"),
              )}
              sub={`${
                payoutCount(data.payouts.byStatus, "failed") +
                payoutCount(data.payouts.byStatus, "needs_account")
              } need attention`}
              icon={AlertCircle}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>GMV by sale kind · last {data.windowDays} days</CardTitle>
            </CardHeader>
            <CardContent>
              {data.gmv.windowTotal === 0 ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  No successful charges in this window yet.
                </p>
              ) : (
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data.gmv.byDay} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="date" tickFormatter={formatDay} fontSize={11} />
                      <YAxis fontSize={11} tickFormatter={(v) => `₵${Math.round(Number(v))}`} />
                      <Tooltip
                        formatter={(v: number) => formatCurrency(Number(v))}
                        labelFormatter={(l: string) => formatDay(l)}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="service_invoice"
                        stackId="a"
                        fill={KIND_META.service_invoice.color}
                        name={KIND_META.service_invoice.label}
                      />
                      <Bar
                        dataKey="parts_order"
                        stackId="a"
                        fill={KIND_META.parts_order.color}
                        name={KIND_META.parts_order.label}
                      />
                      <Bar
                        dataKey="rental_booking"
                        stackId="a"
                        fill={KIND_META.rental_booking.color}
                        name={KIND_META.rental_booking.label}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                {(Object.keys(KIND_META) as SaleKind[]).map((k) => {
                  const row = data.gmv.byKind.find((r) => r.kind === k);
                  const meta = KIND_META[k];
                  const Icon = meta.icon;
                  return (
                    <div key={k} className="rounded-md border bg-muted/30 p-3 space-y-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Icon className="h-4 w-4" style={{ color: meta.color }} />
                        {meta.label}
                      </div>
                      <p className="text-xl font-bold">{formatCurrency(row?.gross ?? 0)}</p>
                      <p className="text-xs text-muted-foreground">
                        {row?.count ?? 0} sale{(row?.count ?? 0) === 1 ? "" : "s"}
                      </p>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Payout status (lifetime)</CardTitle>
              </CardHeader>
              <CardContent>
                <PayoutBreakdown rows={data.payouts.byStatus} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Top sellers by net payout</CardTitle>
              </CardHeader>
              <CardContent>
                {data.topSellers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No payouts recorded yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                        <tr className="border-b">
                          <th className="text-left py-2 pr-3">Seller</th>
                          <th className="text-right py-2 pr-3">Sales</th>
                          <th className="text-right py-2 pr-3">Gross</th>
                          <th className="text-right py-2">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topSellers.map((s) => (
                          <tr
                            key={`${s.sellerKind}:${s.sellerId}`}
                            className="border-b last:border-0"
                          >
                            <td className="py-2 pr-3">
                              <div className="font-medium">{s.sellerName}</div>
                              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                                {s.sellerKind.replace("_", " ")}
                              </div>
                            </td>
                            <td className="py-2 pr-3 text-right">{s.count}</td>
                            <td className="py-2 pr-3 text-right">
                              {formatCurrency(s.grossAmount)}
                            </td>
                            <td className="py-2 text-right font-semibold">
                              {formatCurrency(s.netAmount)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <Card>
      <CardContent className="p-5 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold mt-1">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <Icon className="h-7 w-7 text-primary/40" />
      </CardContent>
    </Card>
  );
}

function payoutAmount(rows: Array<{ status: string; amount: number }>, status: PayoutStatus): number {
  return rows.find((r) => r.status === status)?.amount ?? 0;
}
function payoutCount(rows: Array<{ status: string; count: number }>, status: PayoutStatus): number {
  return rows.find((r) => r.status === status)?.count ?? 0;
}

function PayoutBreakdown({
  rows,
}: {
  rows: Array<{ status: string; count: number; amount: number }>;
}) {
  const knownStatuses: PayoutStatus[] = ["paid", "pending", "needs_account", "failed"];
  const data = knownStatuses.map((s) => {
    const row = rows.find((r) => r.status === s);
    return {
      status: s,
      label: PAYOUT_STATUS_META[s].label,
      color: PAYOUT_STATUS_META[s].color,
      count: row?.count ?? 0,
      amount: row?.amount ?? 0,
    };
  });
  const hasAny = data.some((d) => d.count > 0);
  if (!hasAny) {
    return <p className="text-sm text-muted-foreground">No payouts recorded yet.</p>;
  }
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
      <div className="h-52">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data.filter((d) => d.amount > 0)}
              dataKey="amount"
              nameKey="label"
              innerRadius={45}
              outerRadius={75}
              paddingAngle={2}
            >
              {data
                .filter((d) => d.amount > 0)
                .map((d) => (
                  <Cell key={d.status} fill={d.color} />
                ))}
            </Pie>
            <Tooltip formatter={(v: number) => formatCurrency(Number(v))} />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="space-y-2">
        {data.map((d) => (
          <div key={d.status} className="flex items-center justify-between gap-2 text-sm">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                style={{ backgroundColor: d.color }}
              />
              <Badge className={PAYOUT_STATUS_META[d.status as PayoutStatus].tone}>
                {d.label}
              </Badge>
            </div>
            <div className="text-right">
              <div className="font-semibold">{formatCurrency(d.amount)}</div>
              <div className="text-xs text-muted-foreground">
                {d.count} payout{d.count === 1 ? "" : "s"}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
