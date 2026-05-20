import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Section } from "@/components/ui";
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
  const { role, token } = useAuth();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 96, gap: 16 }}
    >
      <Section title={TITLES[role] ?? "Activity"}>
        <WorkList role={role} token={token} />
      </Section>
    </ScrollView>
  );
}
