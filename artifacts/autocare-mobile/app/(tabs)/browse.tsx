import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import {
  useListServiceCenters,
  useListVendors,
  useListParts,
} from "@workspace/api-client-react";

import { Card, EmptyState, LoadingScreen, Row, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type Tab = "centers" | "cars" | "parts" | "vendors";

const ROLE_TABS: Record<string, Tab[]> = {
  owner: ["centers", "parts", "vendors"],
  fleet: ["centers", "parts", "vendors"],
  renter: ["cars"],
  center: ["parts", "vendors"],
  vendor: ["centers"],
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

export default function BrowseScreen() {
  const c = useColors();
  const { role, token } = useAuth();
  const insets = useSafeAreaInsets();
  const tabs = ROLE_TABS[role] ?? ["centers"];
  const [tab, setTab] = useState<Tab>(tabs[0]!);

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          flexDirection: "row",
          padding: 14,
          gap: 8,
          borderBottomWidth: 1,
          borderBottomColor: c.border,
          backgroundColor: c.background,
        }}
      >
        {tabs.map((t) => {
          const active = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: active ? c.primary : c.border,
                backgroundColor: active ? c.primary : "transparent",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text
                style={{
                  color: active ? "#fff" : c.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                }}
              >
                {TAB_LABEL[t]}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 96, gap: 14 }}
      >
        {tab === "centers" ? <CentersList /> : null}
        {tab === "cars" ? <CarsList token={token} /> : null}
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
  if (list.length === 0) return <EmptyState title="No service centers" />;
  return (
    <Card padding={0}>
      {list.map((s, i) => (
        <View key={s.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={s.name}
            subtitle={[s.city, s.rating ? `${s.rating.toFixed(1)} ★` : null].filter(Boolean).join("  ·  ")}
          />
        </View>
      ))}
    </Card>
  );
}

function VendorsList() {
  const { data, isLoading } = useListVendors();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{ id: string; name: string; city?: string }>) ?? [];
  if (list.length === 0) return <EmptyState title="No vendors" />;
  return (
    <Card padding={0}>
      {list.map((v, i) => (
        <View key={v.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row title={v.name} subtitle={v.city} />
        </View>
      ))}
    </Card>
  );
}

function PartsList() {
  const { data, isLoading } = useListParts();
  if (isLoading) return <LoadingScreen />;
  const list = (data as Array<{ id: string; name: string; vendorName?: string; priceCents?: number }>) ?? [];
  if (list.length === 0) return <EmptyState title="No parts listed" />;
  return (
    <Card padding={0}>
      {list.slice(0, 40).map((p, i) => (
        <View key={p.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={p.name}
            subtitle={[p.vendorName, p.priceCents != null ? `GHS ${(p.priceCents / 100).toFixed(2)}` : null]
              .filter(Boolean)
              .join("  ·  ")}
          />
        </View>
      ))}
    </Card>
  );
}

function CarsList({ token }: { token: string | null }) {
  const safeToken = token ?? "";
  const q = useQuery({
    queryKey: ["browse-cars"],
    queryFn: async () => {
      const r = await fetch(`/api/rental-cars`, {
        headers: { authorization: `Bearer ${safeToken}`, accept: "application/json" },
      });
      if (!r.ok) return [];
      return (await r.json()) as Array<{
        id: string;
        year?: number;
        make?: string;
        model?: string;
        city?: string;
        dailyRate?: number;
      }>;
    },
  });
  if (q.isLoading) return <LoadingScreen />;
  const list = q.data ?? [];
  if (list.length === 0) return <EmptyState title="No cars available right now" />;
  return (
    <Card padding={0}>
      {list.map((car, i) => (
        <View key={car.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: "#0001" }}>
          <Row
            title={`${car.year ?? ""} ${car.make ?? ""} ${car.model ?? ""}`.trim() || "Car"}
            subtitle={[car.city, car.dailyRate != null ? `GHS ${car.dailyRate.toFixed(0)} / day` : null]
              .filter(Boolean)
              .join("  ·  ")}
          />
        </View>
      ))}
    </Card>
  );
}
