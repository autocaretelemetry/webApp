import { useEffect, useState } from "react";
import { Clock, Loader2 } from "lucide-react";

type PublicAction =
  | "applied"
  | "approved"
  | "rejected"
  | "kyc_submitted"
  | "kyc_verified"
  | "kyc_rejected";

type ApprovalEvent = {
  id: string;
  action: PublicAction | "note";
  note: string | null;
  actorName: string | null;
  internal: boolean;
  createdAt: string;
};

const ACTION_LABEL: Record<PublicAction, string> = {
  applied: "Application received",
  approved: "Application approved",
  rejected: "Application rejected",
  kyc_submitted: "KYC submitted",
  kyc_verified: "KYC verified",
  kyc_rejected: "KYC needs changes",
};

const ACTION_TONE: Record<PublicAction, string> = {
  applied: "bg-muted text-muted-foreground",
  approved: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  rejected: "bg-destructive/15 text-destructive",
  kyc_submitted: "bg-muted text-muted-foreground",
  kyc_verified: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  kyc_rejected: "bg-destructive/15 text-destructive",
};

export function MyApprovalTimeline({ title = "Your decision history" }: { title?: string }) {
  const [events, setEvents] = useState<ApprovalEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me/approval-events", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load history");
        const data = (await res.json()) as ApprovalEvent[];
        if (!cancelled) setEvents(data.filter((e) => !e.internal && e.action !== "note"));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load history");
          setEvents([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (events && events.length === 0 && !error) return null;

  return (
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="text-sm font-semibold">{title}</div>
      {events === null && (
        <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
          <Loader2 className="h-3 w-3 animate-spin" /> Loading…
        </div>
      )}
      {error && (
        <div className="text-xs text-destructive">{error}</div>
      )}
      <ol className="space-y-3">
        {events?.map((ev) => {
          const action = ev.action as PublicAction;
          return (
            <li key={ev.id} className="flex gap-3 text-sm border-l-2 border-muted pl-3">
              <div className="space-y-1 flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${ACTION_TONE[action]}`}
                  >
                    {ACTION_LABEL[action] ?? action}
                  </span>
                  <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {new Date(ev.createdAt).toLocaleString()}
                  </span>
                </div>
                {ev.note && (
                  <div className="text-sm whitespace-pre-wrap break-words">
                    {ev.note}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
