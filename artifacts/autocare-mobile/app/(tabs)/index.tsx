import React from "react";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge } from "@/components/ui";
import { RoleDashboard } from "@/components/dashboards";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ROLE_LABEL } from "@/lib/roles";

export default function HomeScreen() {
  const c = useColors();
  const { user, token, role } = useAuth();
  const insets = useSafeAreaInsets();
  if (!user) return null;

  const greeting = user.name?.split(" ")[0] ?? "there";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{
        padding: 18,
        paddingBottom: insets.bottom + 96,
        gap: 20,
      }}
    >
      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_500Medium",
            fontSize: 13,
          }}
        >
          Welcome back
        </Text>
        <Text
          style={{
            color: c.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 26,
            letterSpacing: -0.2,
          }}
        >
          {greeting}
        </Text>
        <View style={{ flexDirection: "row" }}>
          <Badge label={ROLE_LABEL[role]} tone="primary" />
        </View>
      </View>

      <RoleDashboard role={role} token={token} phone={user.phone as string | null | undefined} />
    </ScrollView>
  );
}
