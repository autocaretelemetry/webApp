import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, AlertTriangle, CheckCircle2, RefreshCw, Loader2, Skull } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";

type ReminderRun = {
  id: string;
  trigger: "scheduler" | "manual" | "external" | string;
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "success" | "error" | "crashed" | string;
  createdCount: number;
  prunedCount: number | null;
  errorMessage: string | null;
};

type ReminderRunsResponse = {
  runs: ReminderRun[];
  retentionDays: number;
};

const REMINDER_RUNS_KEY = ["reminder-runs"] as const;

function durationMs(start: string, end: string | null): number | null {
  if (!end) return null;
  return new Date(end).getTime() - new Date(start).getTime();
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function triggerLabel(t: string): string {
  if (t === "scheduler") return "In-process scheduler";
  if (t === "manual") return "Manual (admin)";
  if (t === "external") return "Scheduled deployment";
  return t;
}

export default function AdminReminderRuns() {
  const qc = useQueryClient();
  const [isTriggering, setIsTriggering] = useState(false);

  const { data, isLoading, refetch } = useQuery<ReminderRunsResponse>({
    queryKey: REMINDER_RUNS_KEY,
    queryFn: async () => {
      const res = await fetch("/api/notifications/reminder-runs", {
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Failed to load reminder runs (${res.status})`);
      return res.json();
    },
    refetchInterval: 30_000,
  });

  // Auto-refresh once on mount so the page never opens with stale cache.
  useEffect(() => {
    void refetch();
  }, [refetch]);

  async function triggerNow() {
    setIsTriggering(true);
    try {
      const res = await fetch("/api/notifications/generate-reminders", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Reminder run failed");
      } else {
        toast.success(
          body?.created > 0
            ? `Created ${body.created} reminder notification(s)`
            : "Run completed — no new reminders to send",
        );
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Reminder run failed");
    } finally {
      setIsTriggering(false);
      void qc.invalidateQueries({ queryKey: REMINDER_RUNS_KEY });
    }
  }

  const runs = data?.runs ?? [];
  const retentionDays = data?.retentionDays ?? null;
  const last = runs[0] ?? null;
  const lastSuccess = runs.find((r) => r.status === "success") ?? null;
  const recentFailures = runs.filter((r) => r.status === "error").length;
  const totalPruned = runs.reduce(
    (sum, r) => sum + (r.prunedCount ?? 0),
    0,
  );

  return (
    <div className="space-y-6 pb-12">
      <PageHeader
        title="Reminder runs"
        description={
          retentionDays !== null
            ? `Audit of the service-reminder generator. Runs on a recurring schedule, can be triggered manually, and is also invoked by the optional Replit Scheduled Deployment. Run history is retained for ${retentionDays} day${retentionDays === 1 ? "" : "s"} (configurable via REMINDER_RETENTION_DAYS); older rows are pruned at the end of every successful run.`
            : "Audit of the service-reminder generator. Runs on a recurring schedule, can be triggered manually, and is also invoked by the optional Replit Scheduled Deployment."
        }
        actions={
          <Button onClick={triggerNow} disabled={isTriggering}>
            {isTriggering ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Running…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4 mr-2" />
                Run now
              </>
            )}
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Last run
            </p>
            <p className="text-lg font-semibold mt-1">
              {last ? formatDateTime(last.startedAt) : "Never"}
            </p>
            {last ? (
              <p className="text-xs text-muted-foreground mt-1">
                {triggerLabel(last.trigger)} ·{" "}
                {last.status === "success"
                  ? `${last.createdCount} created`
                  : last.status}
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Last successful
            </p>
            <p className="text-lg font-semibold mt-1">
              {lastSuccess ? formatDateTime(lastSuccess.startedAt) : "Never"}
            </p>
            {lastSuccess ? (
              <p className="text-xs text-muted-foreground mt-1">
                {lastSuccess.createdCount} notification(s) created
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Pruned in last {runs.length || 0} runs
            </p>
            <p className="text-lg font-semibold mt-1">{totalPruned}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {retentionDays !== null
                ? `Older than ${retentionDays} day${retentionDays === 1 ? "" : "s"}`
                : "Retention window unknown"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Failures in last {runs.length || 0} runs
            </p>
            <p
              className={
                "text-lg font-semibold mt-1 " +
                (recentFailures > 0 ? "text-destructive" : "")
              }
            >
              {recentFailures}
            </p>
            {recentFailures > 0 ? (
              <p className="text-xs text-destructive mt-1">
                Check the rows below for the failure reason.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left">
                <tr>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Trigger</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                  <th className="px-4 py-3 font-medium">Pruned</th>
                  <th className="px-4 py-3 font-medium">Duration</th>
                  <th className="px-4 py-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      Loading reminder runs…
                    </td>
                  </tr>
                ) : runs.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      No runs yet. The scheduler logs its first run shortly after the
                      server starts.
                    </td>
                  </tr>
                ) : (
                  runs.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {formatDateTime(r.startedAt)}
                      </td>
                      <td className="px-4 py-3">{triggerLabel(r.trigger)}</td>
                      <td className="px-4 py-3">
                        {r.status === "success" ? (
                          <Badge variant="outline" className="text-emerald-700 border-emerald-300">
                            <CheckCircle2 className="h-3 w-3 mr-1" />
                            Success
                          </Badge>
                        ) : r.status === "error" ? (
                          <Badge variant="outline" className="text-destructive border-destructive/40">
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Error
                          </Badge>
                        ) : r.status === "crashed" ? (
                          <Badge
                            variant="outline"
                            className="text-amber-700 border-amber-400 bg-amber-50"
                            title="The server process exited before this run finished. The audit row was reconciled by the stale-run sweep."
                          >
                            <Skull className="h-3 w-3 mr-1" />
                            Crashed
                          </Badge>
                        ) : (
                          <Badge variant="outline">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Running
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">{r.createdCount}</td>
                      <td className="px-4 py-3">
                        {r.prunedCount === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          r.prunedCount
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {fmtDuration(durationMs(r.startedAt, r.finishedAt))}
                      </td>
                      <td className="px-4 py-3 max-w-md">
                        {r.errorMessage ? (
                          <span className="text-destructive font-mono text-xs break-words">
                            {r.errorMessage}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
