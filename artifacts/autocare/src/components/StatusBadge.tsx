import { cn } from "@/lib/utils";
import { BOOKING_STATUS_CONFIG, INVOICE_STATUS_CONFIG } from "@/lib/status";
import { BookingStatus, InvoiceStatus } from "@workspace/api-client-react";

interface StatusBadgeProps {
  status: BookingStatus | InvoiceStatus;
  type?: "booking" | "invoice";
  className?: string;
}

export function StatusBadge({ status, type = "booking", className }: StatusBadgeProps) {
  const config = type === "booking" 
    ? BOOKING_STATUS_CONFIG[status as BookingStatus] 
    : INVOICE_STATUS_CONFIG[status as InvoiceStatus];

  if (!config) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium border",
        config.colorClass,
        className
      )}
    >
      {config.label}
    </span>
  );
}
