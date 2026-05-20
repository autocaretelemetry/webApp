import { useEffect } from "react";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Building2, Car, Wrench, DollarSign, Bell, Lock, Crown, AlertTriangle, FileText, FileSpreadsheet } from "lucide-react";
import { useFleetOrgId, setFleetOrgId } from "@/lib/role";
import {
  useMyFleetOrgs,
  useFleetDashboard,
  useFleetPartsSpend,
  downloadFleetHistory,
} from "@/lib/fleet-api";
import { toast } from "sonner";
import { formatCurrency, formatRelative } from "@/lib/format";

export default function FleetDashboard() {
  const orgId = useFleetOrgId();
  const { data: mine, isLoading: loadingMine } = useMyFleetOrgs();
  const { data: dash, isLoading: loadingDash, error } = useFleetDashboard(orgId);

  // Auto-pick the first org membership so a fresh session has something
  // to show without the user having to fiddle with localStorage. Also
  // self-heal when localStorage holds a stale orgId (e.g. after a reseed
  // or when the signed-in user no longer belongs to that org) — otherwise
  // the dashboard would 404 on every reload.
  useEffect(() => {
    if (!mine || mine.organizations.length === 0) return;
    const valid = mine.organizations.some((o) => o.id === orgId);
    if (!valid) setFleetOrgId(mine.organizations[0].id);
  }, [orgId, mine]);

  const partsEnabled = !!dash?.limits.partsCostTransparency;
  const { data: parts } = useFleetPartsSpend(orgId, partsEnabled);

  if (loadingMine) return <div className="p-8">Loading fleet...</div>;

  if (!mine || mine.organizations.length === 0) {
    return (
      <div className="p-8 space-y-4 max-w-xl mx-auto text-center">
        <Building2 className="h-10 w-10 mx-auto text-muted-foreground" />
        <h2 className="text-2xl font-semibold">No fleet organisation linked</h2>
        <p className="text-muted-foreground">
          You're not yet a member of any fleet organisation. Register one to get started.
        </p>
        <Link href="/register-fleet">
          <Button>Register your fleet</Button>
        </Link>
      </div>
    );
  }

  if (loadingDash) return <div className="p-8">Loading dashboard...</div>;
  if (error || !dash) {
    return (
      <div className="p-8 text-sm text-destructive">
        Could not load fleet dashboard: {(error as Error | null)?.message ?? "unknown error"}
      </div>
    );
  }

  const quota =
    dash.counts.maxVehicles === null
      ? "Unlimited"
      : `${dash.counts.vehicles} / ${dash.counts.maxVehicles}`;
  const overQuota =
    dash.counts.maxVehicles !== null && dash.counts.vehicles >= dash.counts.maxVehicles;

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      <PageHeader
        title={dash.organization.name}
        description={dash.organization.industry ?? "Fleet operations"}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await downloadFleetHistory({
                    orgId: orgId!,
                    format: "csv",
                    filename: `${dash.organization.slug}-fleet-history`,
                  });
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <FileSpreadsheet className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  await downloadFleetHistory({
                    orgId: orgId!,
                    format: "pdf",
                    filename: `${dash.organization.slug}-fleet-history`,
                  });
                } catch (e) {
                  toast.error((e as Error).message);
                }
              }}
            >
              <FileText className="h-4 w-4 mr-1" /> Export PDF
            </Button>
            <Link href="/fleet/vehicles">
              <Button variant="outline">Manage vehicles</Button>
            </Link>
            <Link href="/fleet/centers">
              <Button>Preferred centers</Button>
            </Link>
          </>
        }
      />

      {/* Org picker for multi-org admins */}
      {mine && mine.organizations.length > 1 ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Viewing:</span>
          <select
            value={orgId ?? ""}
            onChange={(e) => setFleetOrgId(e.target.value)}
            className="border rounded px-2 py-1 bg-background"
          >
            {mine.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          label="Fleet vehicles"
          value={String(dash.counts.vehicles)}
          sub={quota}
          icon={Car}
          alert={overQuota}
        />
        <KpiCard
          label="Open jobs"
          value={String(dash.counts.openJobs)}
          sub={`${dash.counts.completedJobs} completed`}
          icon={Wrench}
        />
        <KpiCard
          label="Total spend"
          value={formatCurrency(dash.counts.totalSpend)}
          sub={`${dash.counts.invoiceCount} invoices`}
          icon={DollarSign}
        />
        <KpiCard
          label="Plan"
          value={dash.limits.dedicatedSupport ? "Fleet Pro" : dash.limits.maxFleetVehicles ? "Fleet Starter" : "Free"}
          sub={dash.limits.dedicatedSupport ? "Dedicated support" : "Upgrade for more"}
          icon={Crown}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center gap-2">
            <Bell className="h-4 w-4" />
            <CardTitle>Reminders due</CardTitle>
          </CardHeader>
          <CardContent>
            {dash.reminders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No reminders right now. Nice.</p>
            ) : (
              <ul className="divide-y">
                {dash.reminders.slice(0, 8).map((r, i) => (
                  <li
                    key={`${r.vehicle.id}-${r.kind}-${i}`}
                    className="py-2 flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-medium text-sm">{r.label}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.vehicle.year} {r.vehicle.brand} {r.vehicle.model} · {r.vehicle.plateNumber}
                      </div>
                    </div>
                    <Badge variant="outline">
                      {r.dueAt ? formatRelative(r.dueAt) : "no due date"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(dash.openByStatus).length === 0 ? (
              <p className="text-sm text-muted-foreground">No bookings yet.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {Object.entries(dash.openByStatus).map(([status, n]) => (
                  <li key={status} className="flex items-center justify-between">
                    <span className="capitalize">{status.replace(/_/g, " ")}</span>
                    <span className="tabular-nums font-medium">{n}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            <CardTitle>Parts-cost transparency</CardTitle>
          </div>
          {!partsEnabled ? (
            <Badge variant="outline" className="gap-1">
              <Lock className="h-3 w-3" /> Fleet Pro
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {!partsEnabled ? (
            <p className="text-sm text-muted-foreground">
              Upgrade to Fleet Pro to see a per-invoice breakdown of parts vs labour
              for every job billed to this fleet.
            </p>
          ) : !parts ? (
            <p className="text-sm text-muted-foreground">Loading parts spend...</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Parts</div>
                  <div className="text-xl font-semibold">{formatCurrency(parts.totalParts)}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Labour</div>
                  <div className="text-xl font-semibold">{formatCurrency(parts.totalLabour)}</div>
                </div>
              </div>
              {parts.lines.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-left p-2">Description</th>
                        <th className="text-left p-2 w-24">Category</th>
                        <th className="text-right p-2 w-32">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parts.lines.slice(0, 20).map((li, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2">{li.description}</td>
                          <td className="p-2 capitalize">{li.category}</td>
                          <td className="p-2 text-right tabular-nums">{formatCurrency(li.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {overQuota ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Vehicle cap reached. Upgrade your Fleet plan to add more vehicles.
        </div>
      ) : null}
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  alert,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof Car;
  alert?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${alert ? "text-amber-600" : "text-muted-foreground"}`} />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${alert ? "text-amber-700" : ""}`}>{value}</div>
        {sub ? <div className="text-xs text-muted-foreground mt-1">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}
