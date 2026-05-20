const KEY = "renter:recentCars";
const MAX = 6;

export type RecentCar = {
  id: string;
  label: string;
  imageUrl: string | null;
  city: string | null;
  dailyRate: number | null;
  viewedAt: number;
};

export function getRecentlyViewedCars(): RecentCar[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentCar[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordRecentlyViewedCar(entry: Omit<RecentCar, "viewedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const prev = getRecentlyViewedCars().filter((c) => c.id !== entry.id);
    const next: RecentCar[] = [{ ...entry, viewedAt: Date.now() }, ...prev].slice(0, MAX);
    window.localStorage.setItem(KEY, JSON.stringify(next));
    window.dispatchEvent(new Event("renter:recentCars-changed"));
  } catch {
    /* noop */
  }
}
