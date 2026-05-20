import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Section } from "@/components/ui";
import { WorkList } from "@/components/dashboards";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const TITLES: Record<string, string> = {
  owner: "Service bookings",
  center: "Workshop queue",
  vendor: "Parts orders",
  renter: "My trips",
  delivery: "Deliveries",
  fleet: "Fleet vehicles",
  admin: "All bookings",
  super_admin: "All bookings",
};

export default function WorkScreen() {
  const c = useColors();
  const router = useRouter();
  const { role } = useAuth();
  const insets = useSafeAreaInsets();
  const canCreateBooking =
    role === "owner" || role === "fleet" || role === "admin" || role === "super_admin";
  const showFleetParts = role === "fleet";
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 96, gap: 16 }}
    >
      {canCreateBooking ? (
        <Button label="Book a service" onPress={() => router.push("/bookings/new")} />
      ) : null}
      {showFleetParts ? (
        <Button label="Parts orders" tone="secondary" onPress={() => router.push("/fleet/parts-orders")} />
      ) : null}
      <Section title={TITLES[role] ?? "Activity"}>
        <WorkList role={role} />
      </Section>
    </ScrollView>
  );
}
