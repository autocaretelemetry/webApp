import { useGetRevenueOverview } from "@workspace/api-client-react";
import { getGetRevenueOverviewQueryKey } from "@/lib/queryKeys";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency, formatDateTime } from "@/lib/format";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from "recharts";
import { TrendingUp, Users, Receipt, ShoppingBag, BadgePercent } from "lucide-react";

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

const KIND_STYLES: Record<string, { label: string; cls: string }> = {
  subscription: { label: "Subscription", cls: "bg-primary/10 text-primary" },
  booking_commission: { label: "Booking commission", cls: "bg-emerald-100 text-emerald-700" },
  order_commission: { label: "Order commission", cls: "bg-amber-100 text-amber-700" },
};

function formatMonth(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

export default function AdminRevenue() {
  const { data, isLoading } = useGetRevenueOverview({
    query: { queryKey: getGetRevenueOverviewQueryKey() },
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6 animate-in fade-in-50 duration-500">
        <PageHeader title="Revenue" description="MRR, commissions, and 6-month trend." />
        <p>Loading...</p>
      </div>
    );
  }

  const chartData = data.monthly.map((m) => ({
    name: formatMonth(m.month),
    Subscriptions: Math.round(m.subscriptions),
    "Booking commissions": Math.round(m.bookingCommissions),
    "Order commissions": Math.round(m.orderCommissions),
  }));

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Revenue"
        description={`Subscription MRR plus ${Math.round(data.commissionRate * 100)}% commission on paid bookings and delivered orders.`}
      />

      <div className="grid gap-3 md:grid-cols-4">
        <Stat
          label="Current MRR"
          value={formatCurrency(data.mrr)}
          sub={`${data.activeSubscriptions} active subscribers`}
          icon={TrendingUp}
        />
        <Stat
          label="Subscription revenue (6mo)"
          value={formatCurrency(data.totals.subscriptions)}
          icon={Users}
        />
        <Stat
          label="Commissions (6mo)"
          value={formatCurrency(data.totals.bookingCommissions + data.totals.orderCommissions)}
          sub={`Bookings ${formatCurrency(data.totals.bookingCommissions)} · Orders ${formatCurrency(data.totals.orderCommissions)}`}
          icon={BadgePercent}
        />
        <Stat label="Total revenue (6mo)" value={formatCurrency(data.totals.total)} icon={Receipt} />
      </div>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold mb-3">Revenue by month</p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip
                  formatter={(value: number) => formatCurrency(value)}
                  contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Subscriptions" stackId="rev" fill="hsl(var(--primary))" />
                <Bar dataKey="Booking commissions" stackId="rev" fill="hsl(var(--chart-2, 142 70% 45%))" />
                <Bar dataKey="Order commissions" stackId="rev" fill="hsl(var(--chart-3, 38 95% 55%))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-semibold mb-3">Recent payments</p>
          {data.recentPayments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <div className="divide-y">
              {data.recentPayments.map((p) => {
                const meta = KIND_STYLES[p.kind] ?? { label: p.kind, cls: "bg-muted" };
                const Icon =
                  p.kind === "subscription"
                    ? Users
                    : p.kind === "order_commission"
                      ? ShoppingBag
                      : Receipt;
                return (
                  <div key={p.id} className="flex items-center gap-3 py-3">
                    <div className="h-9 w-9 rounded-md bg-muted text-foreground/70 flex items-center justify-center flex-shrink-0">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.label}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(p.paidAt)}</p>
                    </div>
                    <span className={`text-[10px] uppercase px-1.5 py-0.5 rounded ${meta.cls}`}>
                      {meta.label}
                    </span>
                    <p className="font-semibold tabular-nums">{formatCurrency(p.amount)}</p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
