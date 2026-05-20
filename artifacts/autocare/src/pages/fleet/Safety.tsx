import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFleetOrgId } from "@/lib/role";
import {
  useFleetSafety,
  useReportFleetIncident,
  useUpdateFleetIncident,
  type FleetIncident,
} from "@/lib/fleet-api";
import { formatRelative } from "@/lib/format";
import { AlertTriangle, MapPin, Navigation, ShieldAlert, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

const KIND_LABEL: Record<FleetIncident["kind"], string> = {
  accident: "Accident",
  breakdown: "Breakdown",
  theft: "Theft",
  sos: "SOS",
};

const STATUS_VARIANT: Record<
  FleetIncident["status"],
  "default" | "secondary" | "outline"
> = {
  open: "default",
  investigating: "secondary",
  resolved: "outline",
};

export default function FleetSafetyPage() {
  const orgId = useFleetOrgId();
  const { data, isLoading, error } = useFleetSafety(orgId);

  if (!orgId) return <div className="p-8 text-sm text-muted-foreground">No org selected.</div>;
  if (isLoading) return <div className="p-8">Loading safety overview...</div>;
  if (error)
    return (
      <div className="p-8 text-sm text-destructive">
        Could not load safety data: {(error as Error).message}
      </div>
    );
  if (!data) return null;

  const open = data.incidents.filter((i) => i.status !== "resolved");
  const resolved = data.incidents.filter((i) => i.status === "resolved");

  return (
    <div className="space-y-8 animate-in fade-in-50 duration-300">
      <PageHeader
        title="Safety & Tracking"
        description="Last-known locations across your fleet and any open incidents."
      />

      {open.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 p-3 text-sm flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          {open.length} open incident{open.length === 1 ? "" : "s"} need attention.
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Navigation className="h-4 w-4" />
          <CardTitle>Live fleet positions</CardTitle>
        </CardHeader>
        <CardContent>
          {data.vehicles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No vehicles in this fleet yet.
            </p>
          ) : (
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Vehicle</th>
                    <th className="text-left p-2">Driver</th>
                    <th className="text-left p-2">Last seen</th>
                    <th className="text-left p-2">Location</th>
                    <th className="text-right p-2 w-40">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.vehicles.map((v) => (
                    <tr key={v.id} className="border-t">
                      <td className="p-2">
                        <div className="font-medium">
                          {v.year} {v.brand} {v.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {v.plateNumber}
                        </div>
                      </td>
                      <td className="p-2 text-xs">
                        {v.assignedDriverPhone ?? (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {v.lastPing ? (
                          formatRelative(v.lastPing.recordedAt)
                        ) : (
                          <span className="text-muted-foreground">no telemetry</span>
                        )}
                      </td>
                      <td className="p-2 text-xs">
                        {v.lastPing ? (
                          <a
                            className="inline-flex items-center gap-1 text-primary hover:underline"
                            href={`https://www.google.com/maps?q=${v.lastPing.lat},${v.lastPing.lng}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <MapPin className="h-3 w-3" />
                            {v.lastPing.lat.toFixed(4)}, {v.lastPing.lng.toFixed(4)}
                          </a>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 text-right">
                        <ReportIncidentDialog orgId={orgId} vehicleId={v.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <ShieldAlert className="h-4 w-4" />
          <CardTitle>Incidents ({open.length} open)</CardTitle>
        </CardHeader>
        <CardContent>
          {data.incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents reported. Nice.</p>
          ) : (
            <div className="space-y-3">
              {[...open, ...resolved].map((inc) => (
                <IncidentRow
                  key={inc.id}
                  inc={inc}
                  orgId={orgId}
                  plate={
                    data.vehicles.find((v) => v.id === inc.vehicleId)?.plateNumber ?? "—"
                  }
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function ReportIncidentDialog({
  orgId,
  vehicleId,
}: {
  orgId: string;
  vehicleId: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FleetIncident["kind"]>("breakdown");
  const [notes, setNotes] = useState("");
  const [includeLocation, setIncludeLocation] = useState(true);
  const report = useReportFleetIncident(orgId);

  async function submit() {
    let lat: number | undefined;
    let lng: number | undefined;
    if (includeLocation && "geolocation" in navigator) {
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 }),
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch {
        // Geolocation denied/failed — fall through and submit without it.
      }
    }
    try {
      await report.mutateAsync({ vehicleId, body: { kind, notes, lat, lng } });
      toast.success("Incident reported");
      setOpen(false);
      setNotes("");
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          Report incident
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Report incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium">Type</label>
            <Select value={kind} onValueChange={(v) => setKind(v as FleetIncident["kind"])}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABEL) as FleetIncident["kind"][]).map((k) => (
                  <SelectItem key={k} value={k}>
                    {KIND_LABEL[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">Notes</label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What happened?"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={includeLocation}
              onChange={(e) => setIncludeLocation(e.target.checked)}
            />
            Attach my current location
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={report.isPending}>
            {report.isPending ? "Reporting..." : "Submit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncidentRow({
  inc,
  orgId,
  plate,
}: {
  inc: FleetIncident;
  orgId: string;
  plate: string;
}) {
  const update = useUpdateFleetIncident(orgId);
  const [adminNotes, setAdminNotes] = useState(inc.adminNotes ?? "");

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[inc.status]}>{inc.status}</Badge>
          <span className="font-medium">{KIND_LABEL[inc.kind]}</span>
          <span className="text-xs text-muted-foreground">· {plate}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {formatRelative(inc.reportedAt)} by {inc.reportedBy}
        </div>
      </div>
      {inc.notes ? <p className="text-sm">{inc.notes}</p> : null}
      {inc.lastKnownLat !== null && inc.lastKnownLng !== null ? (
        <a
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          href={`https://www.google.com/maps?q=${inc.lastKnownLat},${inc.lastKnownLng}`}
          target="_blank"
          rel="noreferrer"
        >
          <MapPin className="h-3 w-3" />
          Last-known location
        </a>
      ) : null}
      <Textarea
        value={adminNotes}
        onChange={(e) => setAdminNotes(e.target.value)}
        placeholder="Admin notes (visible only to fleet admins)"
        className="text-sm"
      />
      <div className="flex flex-wrap gap-2">
        {inc.status !== "investigating" && inc.status !== "resolved" ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              update.mutate({ incidentId: inc.id, body: { status: "investigating", adminNotes } })
            }
          >
            Mark investigating
          </Button>
        ) : null}
        {inc.status !== "resolved" ? (
          <Button
            size="sm"
            onClick={() =>
              update.mutate({ incidentId: inc.id, body: { status: "resolved", adminNotes } })
            }
          >
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Resolve
          </Button>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => update.mutate({ incidentId: inc.id, body: { adminNotes } })}
          >
            Save notes
          </Button>
        )}
      </div>
    </div>
  );
}
