import { useEffect, useState } from "react";
import type { Part } from "@workspace/api-client-react";

// Each "cart scope" gets its own localStorage bucket so an owner's personal
// shopping cart and a mechanic's per-job parts list never blend.
// Job-mode (per-booking) scope is only meaningful for the "center" role.
// If the active role is anything else, getCartScope() returns null so an owner
// who switches roles on the same device never inherits a mechanic's job cart.
const SCOPE_KEY = "autocare_cart_scope";
const ROLE_KEY = "autocare_role";

export type CartScope = {
  bookingId: string;
  mechanicId: string;
  bookingLabel: string;
} | null;

function activeRole(): string {
  try {
    return localStorage.getItem(ROLE_KEY) ?? "owner";
  } catch {
    return "owner";
  }
}

function scopeFromRaw(raw: string | null): CartScope {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && parsed.bookingId && parsed.mechanicId) {
      return {
        bookingId: parsed.bookingId,
        mechanicId: parsed.mechanicId,
        bookingLabel: parsed.bookingLabel ?? "",
      };
    }
  } catch {
    // fall through
  }
  return null;
}

export function getCartScope(): CartScope {
  if (activeRole() !== "center") return null;
  return scopeFromRaw(localStorage.getItem(SCOPE_KEY));
}

export function setCartScope(scope: CartScope) {
  if (scope) localStorage.setItem(SCOPE_KEY, JSON.stringify(scope));
  else localStorage.removeItem(SCOPE_KEY);
  window.dispatchEvent(new Event("cartchange"));
}

function bucketKey(scope: CartScope): string {
  return scope ? `autocare_cart_v1_job_${scope.bookingId}` : "autocare_cart_v1";
}

export type SellerKind = "vendor" | "center";

// A cart line belongs to exactly one seller — either a third-party parts
// vendor (delivery) or a service center's on-hand shop (no delivery).
// Orders cannot mix the two: checkout groups by sellerKey and submits one
// order per group; the server rejects multi-seller orders defensively.
export type CartLine = {
  partId: string;
  sellerKind: SellerKind;
  sellerId: string;
  sellerName: string;
  // Back-compat for older payloads written by previous versions where every
  // line was vendor-sourced. Newly written lines always set sellerKind.
  vendorId?: string;
  vendorName?: string;
  name: string;
  sku: string;
  unitPrice: number;
  imageUrl: string | null;
  quantity: number;
  stock: number;
};

export function sellerKey(line: Pick<CartLine, "sellerKind" | "sellerId">): string {
  return `${line.sellerKind}:${line.sellerId}`;
}

function normalize(raw: unknown): CartLine | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.partId !== "string") return null;
  // Legacy entry: vendorId-only, infer sellerKind=vendor.
  const sellerKind = (r.sellerKind === "center" ? "center" : "vendor") as SellerKind;
  const sellerId =
    typeof r.sellerId === "string"
      ? r.sellerId
      : typeof r.vendorId === "string"
        ? r.vendorId
        : "";
  if (!sellerId) return null;
  const sellerName =
    typeof r.sellerName === "string"
      ? r.sellerName
      : typeof r.vendorName === "string"
        ? r.vendorName
        : "Seller";
  return {
    partId: r.partId,
    sellerKind,
    sellerId,
    sellerName,
    vendorId: typeof r.vendorId === "string" ? r.vendorId : undefined,
    vendorName: typeof r.vendorName === "string" ? r.vendorName : undefined,
    name: String(r.name ?? ""),
    sku: String(r.sku ?? ""),
    unitPrice: Number(r.unitPrice ?? 0),
    imageUrl: typeof r.imageUrl === "string" ? r.imageUrl : null,
    quantity: Number(r.quantity ?? 1),
    stock: Number(r.stock ?? 0),
  };
}

function read(scope: CartScope): CartLine[] {
  try {
    const raw = localStorage.getItem(bucketKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalize).filter((l): l is CartLine => !!l);
  } catch {
    return [];
  }
}

function write(scope: CartScope, lines: CartLine[]) {
  localStorage.setItem(bucketKey(scope), JSON.stringify(lines));
  window.dispatchEvent(new Event("cartchange"));
}

export function getCart(scope: CartScope = getCartScope()): CartLine[] {
  return read(scope);
}

/**
 * Resolve a Part's seller. Center-sourced parts (centerId set) sell from
 * the service center's own shop; otherwise it's a third-party vendor.
 */
function sellerFromPart(part: Part): {
  sellerKind: SellerKind;
  sellerId: string;
  sellerName: string;
} | null {
  if (part.centerId) {
    return {
      sellerKind: "center",
      sellerId: part.centerId,
      sellerName: part.sellerCenter?.name ?? "Service center",
    };
  }
  if (part.vendorId) {
    return {
      sellerKind: "vendor",
      sellerId: part.vendorId,
      sellerName: part.vendor?.name ?? "Vendor",
    };
  }
  return null;
}

export function addToCart(part: Part, quantity = 1) {
  const seller = sellerFromPart(part);
  if (!seller) return;
  const scope = getCartScope();
  const lines = read(scope);
  const existing = lines.find((l) => l.partId === part.id);
  if (existing) {
    existing.quantity = Math.min(existing.stock, existing.quantity + quantity);
  } else {
    lines.push({
      partId: part.id,
      sellerKind: seller.sellerKind,
      sellerId: seller.sellerId,
      sellerName: seller.sellerName,
      vendorId: part.vendorId ?? undefined,
      vendorName: part.vendor?.name ?? undefined,
      name: part.name,
      sku: part.sku,
      unitPrice: part.price,
      imageUrl: part.imageUrl ?? null,
      quantity: Math.min(part.stock, quantity),
      stock: part.stock,
    });
  }
  write(scope, lines);
}

export function updateQuantity(partId: string, quantity: number) {
  const scope = getCartScope();
  const lines = read(scope);
  const line = lines.find((l) => l.partId === partId);
  if (!line) return;
  line.quantity = Math.max(1, Math.min(line.stock, Math.floor(quantity)));
  write(scope, lines);
}

export function removeFromCart(partId: string) {
  const scope = getCartScope();
  const lines = read(scope).filter((l) => l.partId !== partId);
  write(scope, lines);
}

export function clearCart() {
  const scope = getCartScope();
  write(scope, []);
}

export type CartSellerGroup = {
  sellerKey: string;
  sellerKind: SellerKind;
  sellerId: string;
  sellerName: string;
  lines: CartLine[];
};

export function groupBySeller(lines: CartLine[]): CartSellerGroup[] {
  const groups = new Map<string, CartSellerGroup>();
  for (const line of lines) {
    const key = sellerKey(line);
    let g = groups.get(key);
    if (!g) {
      g = {
        sellerKey: key,
        sellerKind: line.sellerKind,
        sellerId: line.sellerId,
        sellerName: line.sellerName,
        lines: [],
      };
      groups.set(key, g);
    }
    g.lines.push(line);
  }
  return [...groups.values()];
}

export function useCart() {
  const [scope, setScope] = useState<CartScope>(getCartScope());
  const [lines, setLines] = useState<CartLine[]>(read(scope));
  useEffect(() => {
    const onChange = () => {
      const s = getCartScope();
      setScope(s);
      setLines(read(s));
    };
    window.addEventListener("cartchange", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("cartchange", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0);
  const sellerGroups = groupBySeller(lines);
  return { lines, itemCount, subtotal, sellerGroups, scope };
}
