import { useEffect, useState } from "react";

/**
 * Renter "draft" store. Used only for UX scratch state (e.g. a preferred
 * pickup address the renter typed into the search bar) that we want to
 * persist across page loads. Identity (name / phone / email / KYC) is
 * always sourced from `useAuth()` and the server's renter-profile-by-phone
 * endpoint — never from this store. Historically this hook held a hardcoded
 * "Marcus Hale" persona; that behaviour caused signed-in renters to file
 * bookings and incident reports under the wrong identity, so it was
 * removed.
 */

const KEY = "autocare_renter_draft";

export type RenterDraft = {
  preferredPickupAddress: string;
};

const EMPTY: RenterDraft = { preferredPickupAddress: "" };

export function getRenterDraft(): RenterDraft {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<RenterDraft>;
    return {
      preferredPickupAddress: parsed.preferredPickupAddress?.trim() ?? "",
    };
  } catch {
    return EMPTY;
  }
}

export function setRenterDraft(d: RenterDraft) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    window.dispatchEvent(new Event("renterdraftchange"));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export function useRenterDraft() {
  const [draft, setDraft] = useState<RenterDraft>(getRenterDraft());
  useEffect(() => {
    const onChange = () => setDraft(getRenterDraft());
    window.addEventListener("renterdraftchange", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("renterdraftchange", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return { draft, setDraft: setRenterDraft };
}
