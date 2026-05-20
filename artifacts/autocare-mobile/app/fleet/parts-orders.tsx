import React, { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, EmptyState, Input, LoadingScreen, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Order = {
  id: string;
  status: string;
  requestedByName: string;
  totalAmount: string | number;
  createdAt: string;
  items: Array<{ name: string; quantity: number; unitPrice: number }>;
  shippingAddress?: string;
  notes?: string | null;
};

export default function FleetPartsOrdersScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();

  const { currentOrgId } = useAuth();
  const orgs = useQuery({
    queryKey: ["mobile-my-organizations"],
    queryFn: async () => {
      const r = await apiFetch<Array<{ id: string; name: string }>>(`/api/organizations/mine`);
      return r.ok && r.data ? r.data : [];
    },
  });
  const orgId = currentOrgId ?? orgs.data?.[0]?.id;

  const queue = useQuery({
    queryKey: ["mobile-parts-orders", orgId],
    enabled: !!orgId,
    queryFn: async () => {
      const r = await apiFetch<{ orders?: Order[] } | Order[]>(
        `/api/organizations/${orgId}/parts-orders`,
      );
      if (!r.ok || !r.data) return [] as Order[];
      const list = Array.isArray(r.data) ? r.data : (r.data.orders ?? []);
      return list;
    },
  });

  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  async function approve(o: Order) {
    const r = await apiFetch(`/api/organizations/${orgId}/parts-orders/${o.id}/pay`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    if (!r.ok) {
      Alert.alert("Couldn't approve", r.error ?? "Try again.");
      return;
    }
    await qc.invalidateQueries({ queryKey: ["mobile-parts-orders", orgId] });
  }

  async function confirmReject(o: Order) {
    if (!reason.trim()) {
      Alert.alert("Add a reason", "Provide a reason so the requester knows what to fix.");
      return;
    }
    const r = await apiFetch(`/api/organizations/${orgId}/parts-orders/${o.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ reason: reason.trim() }),
    });
    if (!r.ok) {
      Alert.alert("Couldn't reject", r.error ?? "Try again.");
      return;
    }
    setRejectingId(null);
    setReason("");
    await qc.invalidateQueries({ queryKey: ["mobile-parts-orders", orgId] });
  }

  if (orgs.isLoading || queue.isLoading) return <LoadingScreen />;
  if (!orgId) {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="No fleet found" body="Register a fleet from the web app to manage parts orders." />
      </View>
    );
  }
  const list = queue.data ?? [];
  if (list.length === 0) {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="No parts orders" body="When drivers or managers submit orders, they'll appear here." />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 14 }}
    >
      {list.map((o) => {
        const total = typeof o.totalAmount === "string" ? Number(o.totalAmount) : o.totalAmount;
        const pending = o.status === "pending_finance";
        return (
          <Card key={o.id}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
                  GHS {Number.isFinite(total) ? total.toFixed(2) : "—"}
                </Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 2 }}>
                  by {o.requestedByName} · {new Date(o.createdAt).toLocaleDateString()}
                </Text>
              </View>
              <Badge
                label={o.status.replaceAll("_", " ")}
                tone={
                  o.status === "paid"
                    ? "success"
                    : o.status === "rejected"
                      ? "destructive"
                      : "warning"
                }
              />
            </View>
            <Section title="Items">
              <View style={{ gap: 6 }}>
                {(o.items ?? []).slice(0, 6).map((it, i) => (
                  <Text
                    key={i}
                    style={{ color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 13 }}
                  >
                    {it.quantity} × {it.name} · GHS {(it.unitPrice * it.quantity).toFixed(2)}
                  </Text>
                ))}
              </View>
            </Section>
            {o.shippingAddress ? (
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 8 }}>
                Ship to: {o.shippingAddress}
              </Text>
            ) : null}
            {pending ? (
              <View style={{ marginTop: 14, gap: 8 }}>
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button label="Approve & pay" onPress={() => approve(o)} style={{ flex: 1 }} />
                  <Button
                    label="Reject"
                    tone="destructive"
                    onPress={() => {
                      setRejectingId(o.id);
                      setReason("");
                    }}
                    style={{ flex: 1 }}
                  />
                </View>
                {rejectingId === o.id ? (
                  <View style={{ gap: 8 }}>
                    <Input
                      label="Reason"
                      value={reason}
                      onChangeText={setReason}
                      placeholder="Why are you rejecting?"
                      multiline
                      numberOfLines={2}
                      style={{ minHeight: 60, textAlignVertical: "top" }}
                    />
                    <Button label="Confirm reject" tone="destructive" onPress={() => confirmReject(o)} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}
