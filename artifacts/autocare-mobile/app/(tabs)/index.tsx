import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge, ScreenHeader } from "@/components/ui";
import { QuickActions, RoleDashboard } from "@/components/dashboards";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ROLE_LABEL } from "@/lib/roles";

export default function HomeScreen() {
  const c = useColors();
  const { user, role } = useAuth();
  const insets = useSafeAreaInsets();
  if (!user) return null;

  const greeting = user.name?.split(" ")[0] ?? "there";

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <ScreenHeader
        eyebrow="Welcome back"
        title={greeting}
        right={
          <View>
            <Badge label={ROLE_LABEL[role]} tone="primary" />
          </View>
        }
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 4,
          paddingBottom: insets.bottom + 110,
          gap: 22,
        }}
        showsVerticalScrollIndicator={false}
      >
        <QuickActions role={role} />
        <RoleDashboard role={role} phone={user.phone as string | null | undefined} />
      </ScrollView>
    </View>
  );
}
