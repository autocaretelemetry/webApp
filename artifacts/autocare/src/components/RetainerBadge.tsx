import { Link } from "wouter";
import { ShieldCheck } from "lucide-react";

/**
 * A compact "Retainer" pill linking to the service center the owner is
 * subscribed to. Used on the service-centers grid card and the booking
 * card so the owner can quickly see — and jump to — their retainer
 * relationship anywhere a center is referenced.
 */
export function RetainerBadge({
  serviceCenterId,
  asLink = true,
  className = "",
}: {
  serviceCenterId: string;
  asLink?: boolean;
  className?: string;
}) {
  const inner = (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300 ${className}`}
    >
      <ShieldCheck className="h-3 w-3" /> Retainer
    </span>
  );
  if (!asLink) return inner;
  return (
    <Link href={`/service-centers/${serviceCenterId}`} aria-label="View your retainer center">
      {inner}
    </Link>
  );
}
