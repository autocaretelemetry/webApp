import { useRouter } from "expo-router";
import React, { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useListVendors,
  useListParts,
} from "@workspace/api-client-react";

import { Chip, EmptyState, IconCircle, ListCard, LoadingScreen, Row, ScreenHeader } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Tab = "centers" | "cars" | "parts" | "vendors";

const ROLE_TABS: Record<string, Tab[]> = {
  owner: ["centers", "parts", "vendors"],
  fleet: ["centers", "parts", "vendors"],
  renter: ["cars"],
  center: ["parts", "vendors"],
  vendor: ["parts", "vendors"],
  delivery: ["centers"],
  admin: ["centers", "cars", "parts", "vendors"],
  super_admin: ["centers", "cars", "parts", "vendors"],
};

const TAB_LABEL: Record<Tab, string> = {
  centers: "Service centers",
  cars: "Cars for rent",
  parts: "Parts",
  vendors: "Vendors",
};

const SUBTITLES: Record<Tab, string> = {
  centers: "Workshops near you",
  cars: "Cars available to rent",
  parts: "Replacement parts catalog",
  vendors: "Parts suppliers",
};

export default function BrowseScreen() {
  const c = useColors();
  const { role } = useAuth();
  const insets = useSafeAreaInsets();
  const tabs = ROLE_TABS[role] ?? ["centers"];
  const [tab, setTab] = useState<Tab>(tabs[0]!);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title="Browse" subtitle={SUBTITLES[tab]} />
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: 14,
          backgroundColor: c.background,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: "row", gap: 8, paddingRight: 20 }}
        >
          {tabs.map((t) => (
            <Chip key={t} label={TAB_LABEL[t]} active={tab === t} onPress={() => setTab(t)} />
          ))}
        </ScrollView>
      </View>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 110,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {tab === "centers" ? <CentersList /> : null}
        {tab === "cars" ? <CarsList /> : null}
        {tab === "parts" ? <PartsList /> : null}
        {tab === "vendors" ? <VendorsList /> : null}
      </ScrollView>
    </View>
  );
}

function CentersList() {
  const { data, isLoading } = useListServiceCenters();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{ id: string; name: string; city?: string; rating?: number }>) ?? [];
  if (list.length === 0)
    return <EmptyState title="No service centers" body="Check back soon — we're adding partners across the region." icon="tool" />;
  return (
    <ListCard>
      {list.map((s) => (
        <Row
          key={s.id}
          leadingIcon="tool"
          leadingTone="primary"
          title={s.name}
          subtitle={[s.city, s.rating ? `${s.rating.toFixed(1)} ★` : null].filter(Boolean).join("  ·  ")}
        />
      ))}
    </ListCard>
  );
}

function VendorsList() {
  const { data, isLoading } = useListVendors();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{ id: string; name: string; city?: string }>) ?? [];
  if (list.length === 0)
    return <EmptyState title="No vendors" body="Parts suppliers will appear here once they're onboarded." icon="briefcase" />;
  return (
    <ListCard>
      {list.map((v) => (
        <Row
          key={v.id}
          leadingIcon="briefcase"
          leadingTone="secondary"
          title={v.name}
          subtitle={v.city}
        />
      ))}
    </ListCard>
  );
}

function PartsList() {
  const { data, isLoading } = useListParts();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{ id: string; name: string; vendorName?: string; priceCents?: number }>) ?? [];
  if (list.length === 0)
    return <EmptyState title="No parts listed" body="Vendors haven't listed anything yet." icon="package" />;
  return (
    <ListCard>
      {list.slice(0, 40).map((p) => (
        <Row
          key={p.id}
          leadingIcon="package"
          leadingTone="warning"
          title={p.name}
          subtitle={[p.vendorName, p.priceCents != null ? `GHS ${(p.priceCents / 100).toFixed(2)}` : null]
            .filter(Boolean)
            .join("  ·  ")}
        />
      ))}
    </ListCard>
  );
}

function CarsList() {
  const router = useRouter();
  const q = useQuery({
    queryKey: ["mobile-browse-cars"],
    queryFn: async () => {
      const r = await apiFetch<Array<{
        id: string;
        year?: number;
        make?: string;
        model?: string;
        city?: string;
        dailyRate?: number;
      }>>(`/api/rental-cars`);
      return r.ok && r.data ? r.data : [];
    },
  });
  if (q.isLoading) return <LoadingScreen />;
  const list = q.data ?? [];
  if (list.length === 0)
    return <EmptyState title="No cars available" body="Pull to refresh or check back later." icon="truck" />;
  return (
    <ListCard>
      {list.map((car) => (
        <Row
          key={car.id}
          leadingIcon="truck"
          leadingTone="primary"
          title={`${car.year ?? ""} ${car.make ?? ""} ${car.model ?? ""}`.trim() || "Car"}
          subtitle={[car.city, car.dailyRate != null ? `GHS ${car.dailyRate.toFixed(0)} / day` : null]
            .filter(Boolean)
            .join("  ·  ")}
          onPress={() => router.push(`/rentals/${car.id}`)}
        />
      ))}
    </ListCard>
  );
}
