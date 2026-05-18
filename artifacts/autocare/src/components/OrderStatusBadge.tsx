import { cn } from "@/lib/utils";
import { ORDER_STATUS_CONFIG } from "@/lib/status";
import type { OrderStatus } from "@workspace/api-client-react";

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const config = ORDER_STATUS_CONFIG[status];
  if (!config) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
        config.colorClass,
        className,
      )}
    >
      {config.label}
    </span>
  );
}
