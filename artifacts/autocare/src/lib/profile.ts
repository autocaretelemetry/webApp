import { useEffect, useState } from "react";

const KEY = "autocare_renter_profile";

export type RenterProfile = {
  name: string;
  phone: string;
  email: string;
};

const DEFAULT: RenterProfile = {
  name: "Marcus Hale",
  phone: "+234 802 201 1932",
  email: "marcus.hale@example.com",
};

export function getRenterProfile(): RenterProfile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<RenterProfile>;
    return {
      name: parsed.name?.trim() || DEFAULT.name,
      phone: parsed.phone?.trim() || DEFAULT.phone,
      email: parsed.email?.trim() || DEFAULT.email,
    };
  } catch {
    return DEFAULT;
  }
}

export function setRenterProfile(p: RenterProfile) {
  localStorage.setItem(KEY, JSON.stringify(p));
  window.dispatchEvent(new Event("renterprofilechange"));
}

export function useRenterProfile() {
  const [profile, setProfile] = useState<RenterProfile>(getRenterProfile());
  useEffect(() => {
    const onChange = () => setProfile(getRenterProfile());
    window.addEventListener("renterprofilechange", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("renterprofilechange", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return { profile, setProfile: setRenterProfile };
}
