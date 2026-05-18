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

export type CartLine = {
  partId: string;
  vendorId: string;
  vendorName: string;
  name: string;
  sku: string;
  unitPrice: number;
  imageUrl: string | null;
  quantity: number;
  stock: number;
};

function read(scope: CartScope): CartLine[] {
  try {
    const raw = localStorage.getItem(bucketKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
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

export function addToCart(part: Part, quantity = 1) {
  const scope = getCartScope();
  const lines = read(scope);
  const existing = lines.find((l) => l.partId === part.id);
  if (existing) {
    existing.quantity = Math.min(existing.stock, existing.quantity + quantity);
  } else {
    lines.push({
      partId: part.id,
      vendorId: part.vendorId,
      vendorName: part.vendor?.name ?? "Vendor",
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
  const vendorIds = [...new Set(lines.map((l) => l.vendorId))];
  return { lines, itemCount, subtotal, vendorIds, scope };
}
