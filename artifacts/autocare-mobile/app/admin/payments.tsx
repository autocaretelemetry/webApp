import React, { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, EmptyState, LoadingScreen, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Payment = {
  id: string;
  provider: string;
  transactionId: string;
  purpose: string;
  purposeRef: string | null;
  amount: number;
  email: string;
  phone: string | null;
  description: string;
  status: "pending" | "successful" | "failed";
  providerCode: string | null;
  providerReason: string | null;
  createdAt: string;
  completedAt: string | null;
};

type FilterKey = "" | "pending" | "successful" | "failed" | "amount_mismatch";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "successful", label: "Successful" },
  { key: "failed", label: "Failed" },
  { key: "amount_mismatch", label: "Mismatch" },
];

const STATUS_TONE: Record<Payment["status"], "warning" | "success" | "destructive"> = {
  pending: "warning",
  successful: "success",
  failed: "destructive",
};

function ageOf(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function fmtCedis(pesewas: number): string {
  return `GHS ${(pesewas / 100).toFixed(2)}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export default function PaymentsScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { role } = useAuth();
  const [filter, setFilter] = useState<FilterKey>("pending");
  const [busy, setBusy] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["mobile-admin-payments", filter],
    queryFn: async () => {
      const r = await apiFetch<{ payswitchConfigured: boolean; payments: Payment[] }>(
        `/api/admin/payments${filter ? `?status=${filter}` : ""}`,
      );
      return r.ok && r.data ? r.data : { payswitchConfigured: false, payments: [] };
    },
    refetchInterval: 15_000,
  });

  if (role !== "super_admin") {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState
          title="Super admin only"
          body="Switch to the super admin role to review payment transactions."
        />
      </View>
    );
  }

  const data = list.data;
  const rows = data?.payments ?? [];
  const configured = data?.payswitchConfigured ?? false;

  async function recheck(id: string) {
    setBusy(id);
    const r = await apiFetch<{ error?: string; outcome?: { kind: string; reason?: string } }>(
      `/api/admin/payments/${id}/recheck`,
      { method: "POST" },
    );
    setBusy(null);
    if (!r.ok) {
      Alert.alert("Re-check failed", r.error ?? "Try again.");
      return;
    }
    const kind = r.data?.outcome?.kind ?? "unknown";
    const reason = r.data?.outcome?.reason ? ` — ${r.data.outcome.reason}` : "";
    Alert.alert("Re-checked", `${kind}${reason}`);
    await qc.invalidateQueries({ queryKey: ["mobile-admin-payments"] });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 14 }}
    >
      <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
        {configured
          ? "The reconciler re-verifies pending charges every few minutes. Re-check now forces an immediate verification."
          : "PaySwitch credentials not configured — Re-check is unavailable until credentials are set."}
      </Text>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <Pressable
              key={f.key || "all"}
              onPress={() => setFilter(f.key)}
              style={({ pressed }) => ({
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: isActive ? c.primary : c.border,
                backgroundColor: isActive ? c.primary : "transparent",
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
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {list.isLoading ? (
        <LoadingScreen />
      ) : rows.length === 0 ? (
        <EmptyState title="No payment transactions" body="Nothing matches this filter." />
      ) : (
        <Section title={`Transactions (${rows.length})`}>
          <View style={{ gap: 10 }}>
            {rows.map((p) => {
              const isAmountMismatch =
                p.status === "failed" && (p.providerReason ?? "").startsWith("amount_mismatch:");
              return (
                <Card key={p.id}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: 8,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}
                      >
                        {p.purpose}
                      </Text>
                      <Text
                        style={{
                          color: c.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        txn {p.transactionId}
                      </Text>
                      <Text
                        style={{
                          color: c.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                          marginTop: 2,
                        }}
                      >
                        {fmtDateTime(p.createdAt)} · {ageOf(p.createdAt)}
                      </Text>
                    </View>
                    <View style={{ alignItems: "flex-end", gap: 6 }}>
                      <Badge label={p.status} tone={STATUS_TONE[p.status]} />
                      {isAmountMismatch ? <Badge label="mismatch" tone="destructive" /> : null}
                    </View>
                  </View>

                  <View
                    style={{
                      marginTop: 12,
                      paddingTop: 12,
                      borderTopWidth: 1,
                      borderTopColor: c.border,
                      gap: 4,
                    }}
                  >
                    <Text
                      style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}
                    >
                      {fmtCedis(p.amount)}
                    </Text>
                    <Text
                      style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}
                    >
                      {p.email}
                      {p.phone ? ` · ${p.phone}` : ""}
                    </Text>
                    {p.description ? (
                      <Text
                        style={{
                          color: c.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                        }}
                      >
                        {p.description}
                      </Text>
                    ) : null}
                    {p.providerCode || p.providerReason ? (
                      <Text
                        style={{
                          color: c.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                        }}
                      >
                        Provider: {p.providerCode ?? "—"} · {p.providerReason ?? "—"}
                      </Text>
                    ) : null}
                    {p.completedAt ? (
                      <Text
                        style={{
                          color: c.mutedForeground,
                          fontFamily: "Inter_400Regular",
                          fontSize: 12,
                        }}
                      >
                        Completed {fmtDateTime(p.completedAt)}
                      </Text>
                    ) : null}
                  </View>

                  <View style={{ marginTop: 12 }}>
                    <Button
                      label={busy === p.id ? "Re-checking…" : "Re-check now"}
                      tone="ghost"
                      icon="refresh-cw"
                      loading={busy === p.id}
                      disabled={busy === p.id || !configured || p.status === "successful"}
                      onPress={() => void recheck(p.id)}
                    />
                  </View>
                </Card>
              );
            })}
          </View>
        </Section>
      )}

      <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        Re-check runs the same verification + settlement path the background reconciler uses, so the
        outcome here is the canonical one.
      </Text>
    </ScrollView>
  );
}
