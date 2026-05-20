import { useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useApproveInvoice,
  usePayInvoice,
  useUpdateBookingStatus,
} from "@workspace/api-client-react";

import { Badge, Button, Card, EmptyState, LoadingScreen, Row, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Booking = {
  id: string;
  status?: string;
  vehicleLabel?: string;
  serviceCenterName?: string;
  scheduledAt?: string;
  description?: string;
  invoiceId?: string | null;
  events?: Array<{ id: string; label: string; createdAt: string; actor?: string }>;
};

type Invoice = {
  id: string;
  status?: string;
  totalCents?: number;
  lineItems?: Array<{ label: string; amountCents: number }>;
};

const NEXT_STATUS: Record<string, string | null> = {
  requested: "accepted",
  accepted: "in_progress",
  in_progress: "awaiting_approval",
  approved: "completed",
};

const NEXT_LABEL: Record<string, string> = {
  requested: "Accept booking",
  accepted: "Start work",
  in_progress: "Send for approval",
  approved: "Mark completed",
};

export default function BookingDetailScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { role } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const booking = useQuery({
    queryKey: ["mobile-booking", id],
    queryFn: async () => {
      const r = await apiFetch<Booking>(`/api/bookings/${id}`);
      if (!r.ok || !r.data) throw new Error(r.error ?? "Booking not found");
      return r.data;
    },
  });

  const invoice = useQuery({
    queryKey: ["mobile-invoice", booking.data?.invoiceId],
    enabled: !!booking.data?.invoiceId,
    queryFn: async () => {
      const r = await apiFetch<Invoice>(`/api/invoices/${booking.data!.invoiceId}`);
      if (!r.ok || !r.data) return null;
      return r.data;
    },
  });

  const setStatus = useUpdateBookingStatus();
  const approveInvoice = useApproveInvoice();
  const payInvoice = usePayInvoice();

  if (booking.isLoading) return <LoadingScreen />;
  if (booking.error || !booking.data) {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="Couldn't load booking" />
      </View>
    );
  }

  const b = booking.data;
  const isCenter = role === "center" || role === "admin" || role === "super_admin";
  const isOwner = role === "owner" || role === "admin" || role === "super_admin" || role === "fleet";
  const nextStatus = b.status ? NEXT_STATUS[b.status] : null;
  const nextLabel = b.status ? NEXT_LABEL[b.status] : null;

  async function advance() {
    if (!nextStatus) return;
    try {
      await setStatus.mutateAsync({ bookingId: id!, data: { status: nextStatus } as never });
      await qc.invalidateQueries({ queryKey: ["mobile-booking", id] });
    } catch (e) {
      Alert.alert("Couldn't update", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function approve() {
    if (!b.invoiceId) return;
    try {
      await approveInvoice.mutateAsync({ invoiceId: b.invoiceId });
      await qc.invalidateQueries({ queryKey: ["mobile-invoice", b.invoiceId] });
      await qc.invalidateQueries({ queryKey: ["mobile-booking", id] });
      Alert.alert("Approved", "The invoice has been approved.");
    } catch (e) {
      Alert.alert("Couldn't approve", e instanceof Error ? e.message : "Try again.");
    }
  }

  async function pay() {
    if (!b.invoiceId) return;
    try {
      await payInvoice.mutateAsync({ invoiceId: b.invoiceId });
      await qc.invalidateQueries({ queryKey: ["mobile-invoice", b.invoiceId] });
      await qc.invalidateQueries({ queryKey: ["mobile-booking", id] });
      Alert.alert("Paid", "Payment recorded.");
    } catch (e) {
      Alert.alert("Couldn't pay", e instanceof Error ? e.message : "Try again.");
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 18 }}
    >
      <Card>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
          {b.vehicleLabel ?? "Booking"}
        </Text>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 }}>
          {b.serviceCenterName ?? ""}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Badge label={(b.status ?? "").replaceAll("_", " ") || "—"} tone="primary" />
          {b.scheduledAt ? (
            <Badge label={new Date(b.scheduledAt).toLocaleDateString()} tone="muted" />
          ) : null}
        </View>
        {b.description ? (
          <Text style={{ color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 14 }}>
            {b.description}
          </Text>
        ) : null}
      </Card>

      {isCenter && nextStatus && nextLabel ? (
        <Button label={nextLabel} onPress={advance} loading={setStatus.isPending} />
      ) : null}

      {invoice.data ? (
        <Section title="Invoice">
          <Card>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
              GHS {(((invoice.data.totalCents ?? 0) as number) / 100).toFixed(2)}
            </Text>
            <View style={{ flexDirection: "row", gap: 8, marginTop: 8 }}>
              <Badge label={(invoice.data.status ?? "").replaceAll("_", " ")} tone="primary" />
            </View>
            {(invoice.data.lineItems ?? []).map((li, i) => (
              <View
                key={i}
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  paddingVertical: 6,
                  borderTopWidth: i === 0 ? 1 : 0,
                  borderTopColor: c.border,
                  marginTop: i === 0 ? 12 : 0,
                }}
              >
                <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>{li.label}</Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                  GHS {((li.amountCents ?? 0) / 100).toFixed(2)}
                </Text>
              </View>
            ))}
            {isOwner && invoice.data.status === "sent" ? (
              <View style={{ marginTop: 14, gap: 8 }}>
                <Button label="Approve invoice" onPress={approve} loading={approveInvoice.isPending} />
              </View>
            ) : null}
            {isOwner && invoice.data.status === "approved" ? (
              <View style={{ marginTop: 14 }}>
                <Button label="Pay invoice" tone="secondary" onPress={pay} loading={payInvoice.isPending} />
              </View>
            ) : null}
          </Card>
        </Section>
      ) : null}

      {(b.events ?? []).length > 0 ? (
        <Section title="Timeline">
          <Card padding={0}>
            {(b.events ?? []).map((e, i) => (
              <View key={e.id} style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}>
                <Row
                  title={e.label}
                  subtitle={`${e.actor ?? "system"} · ${new Date(e.createdAt).toLocaleString()}`}
                />
              </View>
            ))}
          </Card>
        </Section>
      ) : null}

      <Button label="Back" tone="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}
