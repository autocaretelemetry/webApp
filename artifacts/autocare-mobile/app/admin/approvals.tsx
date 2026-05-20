import React, { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, EmptyState, Input, LoadingScreen, Row, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Applicant = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  requestedRole?: string;
  approvalStatus?: string;
  kycStatus?: string;
  createdAt?: string;
};

type Tab = "pending" | "kyc_pending" | "rejected";

const TAB_LABEL: Record<Tab, string> = {
  pending: "Applications",
  kyc_pending: "KYC",
  rejected: "Rejected",
};

export default function ApprovalsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [tab, setTab] = useState<Tab>("pending");
  const [active, setActive] = useState<Applicant | null>(null);
  const [note, setNote] = useState("");
  const [acting, setActing] = useState<"approve" | "reject" | null>(null);

  const list = useQuery({
    queryKey: ["mobile-approvals", tab],
    queryFn: async () => {
      const r = await apiFetch<{ items?: Applicant[] }>(`/api/admin/approvals?state=${tab}`);
      return r.ok && r.data ? (r.data.items ?? []) : [];
    },
  });

  if (role !== "super_admin") {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="Super admin only" body="Switch to the super admin role to review approvals." />
      </View>
    );
  }

  async function decideApproval(decision: "approve" | "reject") {
    if (!active) return;
    setActing(decision);
    const r = await apiFetch(`/api/admin/approvals/${active.id}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, note: note.trim() || null }),
    });
    setActing(null);
    if (!r.ok) {
      Alert.alert("Action failed", r.error ?? "Try again.");
      return;
    }
    setActive(null);
    setNote("");
    await qc.invalidateQueries({ queryKey: ["mobile-approvals"] });
  }

  async function decideKyc(decision: "approve" | "reject") {
    if (!active) return;
    setActing(decision);
    const r = await apiFetch(`/api/admin/kyc/${active.id}`, {
      method: "PATCH",
      body: JSON.stringify({ decision, note: note.trim() || null }),
    });
    setActing(null);
    if (!r.ok) {
      Alert.alert("Action failed", r.error ?? "Try again.");
      return;
    }
    setActive(null);
    setNote("");
    await qc.invalidateQueries({ queryKey: ["mobile-approvals"] });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 14 }}
    >
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(Object.keys(TAB_LABEL) as Tab[]).map((t) => {
          const isActive = tab === t;
          return (
            <Pressable
              key={t}
              onPress={() => {
                setTab(t);
                setActive(null);
              }}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: isActive ? c.primary : c.border,
                backgroundColor: isActive ? c.primary : "transparent",
                alignItems: "center",
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Text
                style={{
                  color: isActive ? "#fff" : c.foreground,
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

      {list.isLoading ? (
        <LoadingScreen />
      ) : (list.data ?? []).length === 0 ? (
        <EmptyState title="Nothing to review" body="You're all caught up." />
      ) : (
        <Section title={`${TAB_LABEL[tab]} (${list.data!.length})`}>
          <Card padding={0}>
            {list.data!.map((u, i) => (
              <View
                key={u.id}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}
              >
                <Row
                  title={u.name}
                  subtitle={[u.email, u.phone].filter(Boolean).join(" · ")}
                  badge={{ label: u.requestedRole ?? u.kycStatus ?? "", tone: "muted" }}
                  onPress={() => {
                    setActive(u);
                    setNote("");
                  }}
                />
              </View>
            ))}
          </Card>
        </Section>
      )}

      {active ? (
        <Card>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 17 }}>{active.name}</Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 }}>
            {active.email}
            {active.phone ? ` · ${active.phone}` : ""}
          </Text>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            {active.requestedRole ? <Badge label={active.requestedRole} tone="primary" /> : null}
            {active.approvalStatus ? <Badge label={`status: ${active.approvalStatus}`} tone="muted" /> : null}
            {active.kycStatus ? <Badge label={`kyc: ${active.kycStatus}`} tone="muted" /> : null}
          </View>
          <View style={{ marginTop: 14 }}>
            <Input
              label="Note (sent in decision email)"
              value={note}
              onChangeText={setNote}
              placeholder="Optional context"
              multiline
              numberOfLines={3}
              style={{ minHeight: 70, textAlignVertical: "top" }}
            />
          </View>
          <View style={{ flexDirection: "row", gap: 8, marginTop: 14 }}>
            <Button
              label="Reject"
              tone="destructive"
              loading={acting === "reject"}
              onPress={() => (tab === "kyc_pending" ? decideKyc("reject") : decideApproval("reject"))}
              style={{ flex: 1 }}
            />
            <Button
              label="Approve"
              loading={acting === "approve"}
              onPress={() => (tab === "kyc_pending" ? decideKyc("approve") : decideApproval("approve"))}
              style={{ flex: 1 }}
            />
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}
