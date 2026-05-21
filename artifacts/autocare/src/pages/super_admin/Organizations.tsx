import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, Users, Truck, MapPin, ShieldCheck } from "lucide-react";

const API = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

type AdminOrg = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  city: string | null;
  region: string | null;
  kycStatus: string;
  requireFinanceApproval: boolean;
  createdAt: string;
  memberCount: number;
  vehicleCount: number;
  preferredCenterCount: number;
  planName: string | null;
};

async function fetchOrgs(): Promise<AdminOrg[]> {
  const res = await fetch(`${API}/admin/organizations`, { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to load organizations (${res.status})`);
  const body = (await res.json()) as { organizations: AdminOrg[] };
  return body.organizations;
}

function kycTone(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "verified" || status === "approved") return "default";
  if (status === "rejected") return "destructive";
  return "secondary";
}

export default function SuperAdminOrganizations() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin", "organizations"],
    queryFn: fetchOrgs,
  });

  const orgs = data ?? [];

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Institutions & Fleets"
        description="Every organization registered on AutoCare with vehicles, team size, preferred service centers, and active subscription."
      />

      {isLoading && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">Loading organizations…</CardContent>
        </Card>
      )}

      {error && (
        <Card>
          <CardContent className="p-6 text-sm text-destructive">
            Failed to load organizations.
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && orgs.length === 0 && (
        <Card>
          <CardContent className="p-6 text-sm text-muted-foreground">
            No organizations have signed up yet.
          </CardContent>
        </Card>
      )}

      {orgs.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {orgs.map((o) => (
            <Card key={o.id} className="overflow-hidden">
              <CardContent className="p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                      <h3 className="font-semibold text-foreground truncate">{o.name}</h3>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {o.industry ?? "Fleet"} · joined {new Date(o.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant={kycTone(o.kycStatus)} className="capitalize shrink-0">
                    {o.kycStatus}
                  </Badge>
                </div>

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <Users className="h-4 w-4 mx-auto text-muted-foreground" />
                    <p className="text-lg font-semibold mt-1">{o.memberCount}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Members</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <Truck className="h-4 w-4 mx-auto text-muted-foreground" />
                    <p className="text-lg font-semibold mt-1">{o.vehicleCount}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Vehicles</p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2">
                    <MapPin className="h-4 w-4 mx-auto text-muted-foreground" />
                    <p className="text-lg font-semibold mt-1">{o.preferredCenterCount}</p>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Centers</p>
                  </div>
                </div>

                <div className="space-y-1 text-sm">
                  <p className="text-foreground">
                    <span className="text-muted-foreground">Contact:</span> {o.contactName} · {o.contactPhone}
                  </p>
                  {o.contactEmail && (
                    <p className="text-xs text-muted-foreground truncate">{o.contactEmail}</p>
                  )}
                  {(o.city || o.region) && (
                    <p className="text-xs text-muted-foreground">
                      {[o.city, o.region].filter(Boolean).join(", ")}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-border">
                  <Badge variant={o.planName ? "default" : "outline"} className="text-xs">
                    {o.planName ?? "Free tier"}
                  </Badge>
                  {o.requireFinanceApproval && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      <ShieldCheck className="h-3 w-3" />
                      Finance approval
                    </Badge>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
