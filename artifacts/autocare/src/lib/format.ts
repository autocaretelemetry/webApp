import { format, formatDistanceToNow, isToday, isYesterday } from "date-fns";

/**
 * Resolve an image reference to a renderable URL. Accepts:
 *  - absolute URLs (`http://…`, `https://…`, `data:…`, `blob:…`) — returned as-is
 *  - already-prefixed app paths (`/api/…`) — returned as-is
 *  - storage object paths (e.g. `uploads/<id>` or `/objects/<id>`) — wrapped
 *    into `/api/storage/objects/<id>` so the API serves the bytes.
 *  - empty/nullish — returns an empty string so callers can fallback.
 */
export function resolveImageUrl(value: string | null | undefined): string {
  if (!value) return "";
  const v = value.trim();
  if (!v) return "";
  if (/^(https?:|data:|blob:)/i.test(v)) return v;
  if (v.startsWith("/api/")) return v;
  const cleaned = v.replace(/^\/+/, "").replace(/^objects\//, "");
  return `/api/storage/objects/${cleaned}`;
}

export function formatCurrency(amount: number): string {
  // Ghana Cedi (GHS). Using en-GH locale so the symbol renders as "GH₵".
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string | Date | undefined | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MMM d, yyyy");
}

export function formatDateTime(date: string | Date | undefined | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  return format(d, "MMM d, yyyy h:mm a");
}

export function formatRelative(date: string | Date | undefined | null): string {
  if (!date) return "N/A";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return formatDistanceToNow(d, { addSuffix: true });
}
