import { TimelineEntry } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { CheckCircle2, Clock, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface TimelineProps {
  entries: TimelineEntry[];
  className?: string;
}

export function Timeline({ entries, className }: TimelineProps) {
  if (!entries || entries.length === 0) return null;

  return (
    <div className={cn("relative space-y-4 before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:ml-[1.25rem] md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-border before:to-transparent", className)}>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const isFirst = index === 0;
        
        return (
          <div key={index} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
            <div className="flex items-center justify-center w-10 h-10 rounded-full border-2 border-background bg-muted shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10 shadow-sm relative">
              {isFirst ? (
                <CheckCircle className="h-5 w-5 text-primary" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              )}
            </div>
            
            <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-4 rounded border bg-card shadow-sm group-hover:border-primary/50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <span className="font-medium text-foreground">{entry.label}</span>
                <time className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(entry.at)}
                </time>
              </div>
              {entry.actor && (
                <p className="text-sm text-muted-foreground mt-1">by {entry.actor}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
