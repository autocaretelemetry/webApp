import { useEffect, useState } from "react";
import type { Part } from "@workspace/api-client-react";

const CART_KEY = "autocare_cart_v1";

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

function read(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function write(lines: CartLine[]) {
  localStorage.setItem(CART_KEY, JSON.stringify(lines));
  window.dispatchEvent(new Event("cartchange"));
}

export function getCart(): CartLine[] {
  return read();
}

export function addToCart(part: Part, quantity = 1) {
  const lines = read();
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
  write(lines);
}

export function updateQuantity(partId: string, quantity: number) {
  const lines = read();
  const line = lines.find((l) => l.partId === partId);
  if (!line) return;
  line.quantity = Math.max(1, Math.min(line.stock, Math.floor(quantity)));
  write(lines);
}

export function removeFromCart(partId: string) {
  const lines = read().filter((l) => l.partId !== partId);
  write(lines);
}

export function clearCart() {
  write([]);
}

export function useCart() {
  const [lines, setLines] = useState<CartLine[]>(read());
  useEffect(() => {
    const onChange = () => setLines(read());
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
  return { lines, itemCount, subtotal, vendorIds };
}
