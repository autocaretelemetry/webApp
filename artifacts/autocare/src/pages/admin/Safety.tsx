import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTrackedTrips,
  useListRentalIncidents,
  useListTripLocations,
  useUpdateRentalIncident,
  type TrackedTrip,
  type RentalIncident,
} from "@workspace/api-client-react";
import {
  getListTrackedTripsQueryKey,
  getListRentalIncidentsQueryKey,
  getListTripLocationsQueryKey,
} from "@/lib/queryKeys";
import { describeMutationError } from "@/lib/adminErrors";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatDate, formatDateTime } from "@/lib/format";
import {
  Activity,
  AlertTriangle,
  Car,
  Phone,
  Navigation,
  MapPin,
  ShieldAlert,
  CheckCircle2,
  Clock,
  ExternalLink,
  Radio,
} from "lucide-react";
import { toast } from "sonner";

const INCIDENT_KIND_LABEL: Record<string, string> = {
  theft: "Theft",
  accident: "Accident",
  breakdown: "Breakdown",
  sos: "SOS",
};

const INCIDENT_STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-destructive/15 text-destructive" },
  investigating: { label: "Investigating", cls: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  resolved: { label: "Resolved", cls: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
};

function googleMapsUrl(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null;
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

function freshness(ts: string | null | undefined): { label: string; cls: string } {
  if (!ts) return { label: "No pings yet", cls: "text-muted-foreground" };
  const minutes = (Date.now() - new Date(ts).getTime()) / 60000;
  if (minutes < 5) return { label: "Live", cls: "text-emerald-600 font-medium" };
  if (minutes < 60) return { label: `${Math.round(minutes)}m ago`, cls: "text-amber-600" };
  if (minutes < 60 * 24) return { label: `${Math.round(minutes / 60)}h ago`, cls: "text-amber-700" };
  return { label: `${Math.round(minutes / (60 * 24))}d ago`, cls: "text-destructive" };
}

export default function AdminSafety() {
  const { data: trips } = useListTrackedTrips({
    query: { queryKey: getListTrackedTripsQueryKey(), refetchInterval: 15000 },
  });
  const { data: incidents } = useListRentalIncidents(
    {},
    { query: { queryKey: getListRentalIncidentsQueryKey(), refetchInterval: 15000 } },
  );

  const openIncidents = (incidents ?? []).filter((i) => i.status !== "resolved");

  return (
    <div className="space-y-6 animate-in fade-in-50 duration-500">
      <PageHeader
        title="Safety & Tracking"
        description="Watch active rentals, respond to theft/SOS alerts, and assist car owners in tracing their vehicles."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Active trips" value={(trips ?? []).length} icon={Activity} accent="text-emerald-600" />
        <Stat
          label="Streaming"
          value={(trips ?? []).filter((t) => t.lastSeenAt && (Date.now() - new Date(t.lastSeenAt).getTime()) < 5 * 60_000).length}
          icon={Radio}
          accent="text-primary"
        />
        <Stat label="Flagged trips" value={(trips ?? []).filter((t) => t.hasIncident).length} icon={AlertTriangle} accent="text-amber-600" />
        <Stat label="Open incidents" value={openIncidents.length} icon={ShieldAlert} accent="text-destructive" />
      </div>

      <Tabs defaultValue="trips">
        <TabsList>
          <TabsTrigger value="trips">Live trips ({(trips ?? []).length})</TabsTrigger>
          <TabsTrigger value="incidents">Incidents ({openIncidents.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="trips" className="mt-4 space-y-3">
          {(trips ?? []).length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No active rentals right now.</CardContent></Card>
          )}
          {(trips ?? []).map((t) => <TripRow key={t.bookingId} trip={t} />)}
        </TabsContent>

        <TabsContent value="incidents" className="mt-4 space-y-3">
          {openIncidents.length === 0 && (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No open incidents. Nice and quiet.</CardContent></Card>
          )}
          {openIncidents.map((i) => <IncidentRow key={i.id} incident={i} />)}
          {(incidents ?? []).some((i) => i.status === "resolved") && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground py-2">Recently resolved</summary>
              <div className="space-y-2 pt-2">
                {(incidents ?? []).filter((i) => i.status === "resolved").map((i) => <IncidentRow key={i.id} incident={i} />)}
              </div>
            </details>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  label,
  value,
  icon: Icon,
  accent,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-9 w-9 rounded-md bg-muted flex items-center justify-center ${accent}`}>
          <Icon className="h-4 w-4" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function TripRow({ trip: t }: { trip: TrackedTrip }) {
  const [open, setOpen] = useState(false);
  const fresh = freshness(t.lastSeenAt);
  const mapsUrl = googleMapsUrl(t.lastLat, t.lastLng);
  return (
    <Card className={t.hasIncident ? "border-destructive/60" : ""}>
      <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap">
        <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Car className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold">{t.carLabel}</p>
            {t.carPlate && <span className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{t.carPlate}</span>}
            <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${t.status === "active" ? "bg-emerald-500/15 text-emerald-700" : "bg-blue-500/15 text-blue-700"}`}>
              {t.status}
            </span>
            {t.hasIncident && (
              <span className="text-[11px] uppercase tracking-wide px-2 py-0.5 rounded bg-destructive/15 text-destructive inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3" /> Incident
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Renter: {t.renterName} · {t.renterPhone} · Owner: {t.ownerName}{t.ownerPhone ? ` · ${t.ownerPhone}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDate(t.startDate)} → {formatDate(t.endDate)}
          </p>
        </div>
        <div className="text-right min-w-[140px]">
          <p className={`text-xs ${fresh.cls}`}>{fresh.label}</p>
          {t.lastLat != null && t.lastLng != null ? (
            <p className="text-[11px] text-muted-foreground font-mono">{t.lastLat.toFixed(4)}, {t.lastLng.toFixed(4)}</p>
          ) : (
            <p className="text-[11px] text-muted-foreground">No GPS data</p>
          )}
          <p className="text-[10px] text-muted-foreground">{t.pingCount} ping{t.pingCount === 1 ? "" : "s"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mapsUrl && (
            <Button size="sm" variant="outline" asChild className="gap-1.5">
              <a href={mapsUrl} target="_blank" rel="noreferrer">
                <Navigation className="h-3.5 w-3.5" /> Maps <ExternalLink className="h-3 w-3" />
              </a>
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} className="gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> Trail
          </Button>
        </div>
      </CardContent>
      {open && <TripTrailDialog bookingId={t.bookingId} carLabel={t.carLabel} onClose={() => setOpen(false)} />}
    </Card>
  );
}

function TripTrailDialog({ bookingId, carLabel, onClose }: { bookingId: string; carLabel: string; onClose: () => void }) {
  const { data: pings, isLoading } = useListTripLocations(bookingId, {
    query: { enabled: true, queryKey: getListTripLocationsQueryKey(bookingId) },
  });

  const bounds = useMemo(() => {
    if (!pings || pings.length === 0) return null;
    const lats = pings.map((p) => p.lat);
    const lngs = pings.map((p) => p.lng);
    return {
      minLat: Math.min(...lats),
      maxLat: Math.max(...lats),
      minLng: Math.min(...lngs),
      maxLng: Math.max(...lngs),
    };
  }, [pings]);

  // Lightweight inline "map": SVG polyline of the trail with start/end markers.
  // For a real product we'd embed leaflet; this MVP keeps the bundle slim and
  // gives the operator something visual plus an "Open in Maps" deep link.
  const svg = useMemo(() => {
    if (!pings || pings.length < 2 || !bounds) return null;
    const padding = 12;
    const w = 600;
    const h = 280;
    const dx = bounds.maxLng - bounds.minLng || 1e-6;
    const dy = bounds.maxLat - bounds.minLat || 1e-6;
    const project = (lat: number, lng: number) => {
      const x = padding + ((lng - bounds.minLng) / dx) * (w - 2 * padding);
      // Flip Y so north is up.
      const y = padding + ((bounds.maxLat - lat) / dy) * (h - 2 * padding);
      return [x, y] as const;
    };
    const points = pings.map((p) => project(p.lat, p.lng).join(",")).join(" ");
    const first = project(pings[0].lat, pings[0].lng);
    const last = project(pings[pings.length - 1].lat, pings[pings.length - 1].lng);
    return { w, h, points, first, last };
  }, [pings, bounds]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{carLabel} — Trip trail</DialogTitle>
          <DialogDescription>
            Recorded GPS pings, oldest to newest. Click any ping to open it in Google Maps.
          </DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-sm text-muted-foreground">Loading trail…</p>}

        {!isLoading && (!pings || pings.length === 0) && (
          <p className="text-sm text-muted-foreground py-8 text-center">No GPS data recorded for this trip yet.</p>
        )}

        {svg && (
          <div className="bg-muted/30 rounded border overflow-hidden">
            <svg viewBox={`0 0 ${svg.w} ${svg.h}`} className="w-full h-auto">
              <polyline points={svg.points} fill="none" stroke="hsl(var(--primary))" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={svg.first[0]} cy={svg.first[1]} r="6" fill="hsl(var(--muted-foreground))" />
              <circle cx={svg.last[0]} cy={svg.last[1]} r="7" fill="hsl(var(--destructive))" />
              <text x={svg.first[0] + 9} y={svg.first[1] + 4} fontSize="11" fill="currentColor">start</text>
              <text x={svg.last[0] + 9} y={svg.last[1] + 4} fontSize="11" fill="currentColor">last seen</text>
            </svg>
          </div>
        )}

        {pings && pings.length > 0 && (
          <div className="max-h-64 overflow-y-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                <tr>
                  <th className="text-left p-2 font-medium">Time</th>
                  <th className="text-left p-2 font-medium">Coordinates</th>
                  <th className="text-left p-2 font-medium">Source</th>
                  <th className="text-right p-2 font-medium">Open</th>
                </tr>
              </thead>
              <tbody>
                {[...pings].reverse().map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2">{formatDateTime(p.recordedAt)}</td>
                    <td className="p-2 font-mono">{p.lat.toFixed(5)}, {p.lng.toFixed(5)}</td>
                    <td className="p-2 capitalize">{p.source}</td>
                    <td className="p-2 text-right">
                      <a
                        href={googleMapsUrl(p.lat, p.lng)!}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary inline-flex items-center gap-1 hover:underline"
                      >
                        Maps <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IncidentRow({ incident: i }: { incident: RentalIncident }) {
  const queryClient = useQueryClient();
  const update = useUpdateRentalIncident();
  const [notes, setNotes] = useState(i.adminNotes ?? "");
  const meta = INCIDENT_STATUS_META[i.status] ?? INCIDENT_STATUS_META.open;
  const mapsUrl = googleMapsUrl(i.lastKnownLat, i.lastKnownLng);

  const setStatus = async (status: "investigating" | "resolved") => {
    try {
      await update.mutateAsync({ incidentId: i.id, data: { status, adminNotes: notes || undefined } });
      await queryClient.invalidateQueries({ queryKey: getListRentalIncidentsQueryKey() });
      toast.success(status === "resolved" ? "Incident marked resolved." : "Marked as investigating.");
    } catch (err) {
      toast.error(describeMutationError(err, "Failed to update incident."));
    }
  };

  return (
    <Card className={i.status === "open" ? "border-destructive/60" : ""}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className={`h-10 w-10 rounded-md flex items-center justify-center shrink-0 ${i.kind === "theft" ? "bg-destructive/15 text-destructive" : "bg-amber-500/15 text-amber-700"}`}>
            {i.kind === "theft" ? <ShieldAlert className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold">{INCIDENT_KIND_LABEL[i.kind] ?? i.kind} · {i.carLabel ?? "Rental"}</p>
              {i.carPlate && <span className="text-[11px] font-mono bg-muted px-1.5 py-0.5 rounded">{i.carPlate}</span>}
              <span className={`text-[11px] uppercase tracking-wide px-2 py-0.5 rounded ${meta.cls}`}>{meta.label}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Reported by {i.reportedBy} {i.reporterName ? `· ${i.reporterName}` : ""} {i.reporterPhone ? `· ${i.reporterPhone}` : ""} ·{" "}
              <Clock className="inline h-3 w-3" /> {formatDateTime(i.reportedAt)}
            </p>
            {i.notes && <p className="text-sm bg-muted/40 rounded p-2 mt-2 whitespace-pre-wrap">{i.notes}</p>}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Owner</p>
            <p className="font-medium">{i.ownerName ?? "—"}</p>
            {i.ownerPhone && (
              <a href={`tel:${i.ownerPhone}`} className="text-primary inline-flex items-center gap-1 hover:underline">
                <Phone className="h-3 w-3" /> {i.ownerPhone}
              </a>
            )}
          </div>
          <div className="space-y-1">
            <p className="text-muted-foreground uppercase tracking-wide text-[10px]">Renter</p>
            <p className="font-medium">{i.renterName ?? "—"}</p>
            {i.renterPhone && (
              <a href={`tel:${i.renterPhone}`} className="text-primary inline-flex items-center gap-1 hover:underline">
                <Phone className="h-3 w-3" /> {i.renterPhone}
              </a>
            )}
          </div>
        </div>

        {(i.lastKnownLat != null && i.lastKnownLng != null) ? (
          <div className="text-xs flex items-center gap-2 flex-wrap bg-muted/40 rounded p-2">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            <span>Last known location:</span>
            <span className="font-mono">{i.lastKnownLat.toFixed(5)}, {i.lastKnownLng.toFixed(5)}</span>
            {i.lastKnownAt && <span className="text-muted-foreground">({formatDateTime(i.lastKnownAt)})</span>}
            {mapsUrl && (
              <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline ml-auto">
                Open in Maps <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">No GPS pings on file for this trip.</p>
        )}

        {i.status !== "resolved" && (
          <div className="space-y-2 border-t pt-3">
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Notes for the case file (who you've called, agencies notified, etc.)"
              rows={2}
            />
            <div className="flex flex-wrap gap-2">
              {i.status === "open" && (
                <Button size="sm" variant="outline" onClick={() => setStatus("investigating")} disabled={update.isPending}>
                  Mark investigating
                </Button>
              )}
              <Button size="sm" onClick={() => setStatus("resolved")} disabled={update.isPending} className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" /> Mark resolved
              </Button>
            </div>
          </div>
        )}

        {i.status === "resolved" && i.resolvedAt && (
          <p className="text-xs text-muted-foreground border-t pt-2">Resolved {formatDateTime(i.resolvedAt)}{i.adminNotes ? ` — ${i.adminNotes}` : ""}</p>
        )}
      </CardContent>
    </Card>
  );
}
