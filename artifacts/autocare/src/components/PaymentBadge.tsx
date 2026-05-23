import { cn } from "@/lib/utils";
import type { OrderPaymentStatus } from "@workspace/api-client-react";

const CONFIG: Record<
  OrderPaymentStatus,
  { label: string; colorClass: string }
> = {
  unpaid: {
    label: "Unpaid",
    colorClass: "border-amber-400/40 bg-amber-400/10 text-amber-700",
  },
  paid_by_owner: {
    label: "Paid by owner",
    colorClass: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700",
  },
  paid_by_center: {
    label: "Paid by center",
    colorClass: "border-sky-500/40 bg-sky-500/10 text-sky-700",
  },
};

export function PaymentBadge({
  status,
  authorized,
  className,
}: {
  status: OrderPaymentStatus;
  authorized?: boolean;
  className?: string;
}) {
  const config = CONFIG[status];
  if (!config) return null;
  const label =
    status === "unpaid" && authorized ? "Awaiting center payment" : config.label;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
        config.colorClass,
        className,
      )}
    >
      {label}
    </span>
  );
}
