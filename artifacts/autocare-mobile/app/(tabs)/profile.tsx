import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useMyOrganizations } from "@/components/dashboards";
import { Badge, Button, Card, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { ALL_ROLES, ROLE_LABEL, type Role } from "@/lib/roles";

export default function ProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const { user, role, logout, setRoleOverride, currentOrgId, setCurrentOrgId } = useAuth();
  const orgs = useMyOrganizations();
  const insets = useSafeAreaInsets();
  if (!user) return null;
  const canImpersonate = user.role === "super_admin";
  const needsKyc = user.approvalStatus === "approved" && user.kycStatus !== "verified";
  const showFleetQueue = role === "fleet";
  const showApprovals = role === "super_admin";
  const orgList = orgs.data ?? [];
  const showOrgPicker = role === "fleet" && orgList.length > 1;
  const webDomain = (process.env as Record<string, string | undefined>)["EXPO_PUBLIC_DOMAIN"] ?? "";

  const kycLabel =
    user.kycStatus === "verified"
      ? "KYC verified"
      : user.kycStatus === "submitted"
        ? "KYC under review"
        : "KYC pending";
  const kycTone =
    user.kycStatus === "verified" ? "success" : user.kycStatus === "submitted" ? "warning" : "muted";

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 96, gap: 20 }}
    >
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 28,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontFamily: "Inter_700Bold",
                fontSize: 22,
              }}
            >
              {(user.name ?? "?").trim().charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              {user.name}
            </Text>
            <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              {user.email}
            </Text>
            {user.phone ? (
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {user.phone}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <Badge label={ROLE_LABEL[role]} tone="primary" />
          <Badge label={kycLabel} tone={kycTone} />
          {user.approvalStatus && user.approvalStatus !== "approved" ? (
            <Badge label={String(user.approvalStatus)} tone="warning" />
          ) : null}
        </View>
      </Card>

      {canImpersonate ? (
        <Section title="View as">
          <Card padding={8}>
            {ALL_ROLES.map((r) => {
              const active = r === role;
              return (
                <Pressable
                  key={r}
                  onPress={() => setRoleOverride(r)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderRadius: c.radius,
                    backgroundColor: active ? c.accent : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: c.foreground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 14,
                      flex: 1,
                    }}
                  >
                    {ROLE_LABEL[r as Role]}
                  </Text>
                  {active ? <Feather name="check" size={18} color={c.primary} /> : null}
                </Pressable>
              );
            })}
          </Card>
        </Section>
      ) : null}

      {showOrgPicker ? (
        <Section title="Active fleet">
          <Card padding={8}>
            {orgList.map((o) => {
              const active = (currentOrgId ?? orgList[0]?.id) === o.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => setCurrentOrgId(o.id)}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                    borderRadius: c.radius,
                    backgroundColor: active ? c.accent : "transparent",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 14, flex: 1 }}>
                    {o.name}
                  </Text>
                  {active ? <Feather name="check" size={18} color={c.primary} /> : null}
                </Pressable>
              );
            })}
          </Card>
        </Section>
      ) : null}

      <Section title="Quick actions">
        <Card padding={0}>
          <ActionRow
            icon="shield"
            label={needsKyc ? "Finish identity verification" : "Identity verification"}
            hint={needsKyc ? "Required to unlock the app" : "Re-submit documents"}
            onPress={() => router.push("/kyc")}
          />
          {showFleetQueue ? (
            <ActionRow
              icon="package"
              label="Fleet parts orders"
              hint="Approve or reject pending orders"
              onPress={() => router.push("/fleet/parts-orders")}
            />
          ) : null}
          {showApprovals ? (
            <ActionRow
              icon="clipboard"
              label="Approvals queue"
              hint="Applications & KYC review"
              onPress={() => router.push("/admin/approvals")}
            />
          ) : null}
        </Card>
      </Section>

      <Section title="Account">
        <Card padding={0}>
          {webDomain ? (
            <ActionRow
              icon="external-link"
              label="Open full web app"
              hint={webDomain}
              onPress={() => void Linking.openURL(webDomain)}
            />
          ) : null}
          <ActionRow
            icon="mail"
            label="Help & support"
            hint="support@autocare.test"
            onPress={() => void Linking.openURL("mailto:support@autocare.test")}
          />
        </Card>
      </Section>

      <Button label="Sign out" tone="destructive" onPress={() => void logout()} />
    </ScrollView>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onPress,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  hint?: string;
  onPress?: () => void;
}) {
  const c = useColors();
  const baseStyle = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: c.border,
  };
  const content = (
    <>
      <Feather name={icon} size={18} color={c.mutedForeground} />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>{label}</Text>
        {hint ? (
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {hint}
          </Text>
        ) : null}
      </View>
      {onPress ? <Feather name="chevron-right" size={18} color={c.mutedForeground} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({ ...baseStyle, backgroundColor: pressed ? c.accent : "transparent" })}
      >
        {content}
      </Pressable>
    );
  }
  return <View style={baseStyle}>{content}</View>;
}
