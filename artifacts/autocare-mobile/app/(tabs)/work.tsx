import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, ScreenHeader } from "@/components/ui";
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

const SUBTITLES: Record<string, string> = {
  owner: "Your service requests and history",
  center: "Jobs flowing through your workshop",
  vendor: "Orders coming in from buyers",
  renter: "Active and past rentals",
  delivery: "Pickups assigned to you",
  fleet: "Vehicles across your fleet",
  admin: "Every booking on the platform",
  super_admin: "Every booking on the platform",
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
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader title={TITLES[role] ?? "Activity"} subtitle={SUBTITLES[role]} />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 110,
          gap: 14,
        }}
        showsVerticalScrollIndicator={false}
      >
        {canCreateBooking ? (
          <Button label="Book a service" icon="plus" onPress={() => router.push("/bookings/new")} />
        ) : null}
        {showFleetParts ? (
          <Button
            label="Parts orders"
            icon="package"
            tone="secondary"
            onPress={() => router.push("/fleet/parts-orders")}
          />
        ) : null}
        <WorkList role={role} />
      </ScrollView>
    </View>
  );
}
