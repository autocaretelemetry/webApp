import * as Location from "expo-location";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge, Button, Card, EmptyState, Input, LoadingScreen, Row, Section } from "@/components/ui";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Booking = {
  id: string;
  status?: string;
  carLabel?: string;
  startDate?: string;
  endDate?: string;
  pickupLocation?: string;
  totalAmount?: number;
  lastKnownLat?: number | null;
  lastKnownLng?: number | null;
  lastKnownAt?: string | null;
};

type Ping = { id: string; recordedAt: string; latitude: number; longitude: number };

export default function TripScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();

  const booking = useQuery({
    queryKey: ["mobile-trip", id],
    queryFn: async () => {
      const r = await apiFetch<Booking>(`/api/rental-bookings/${id}`);
      if (!r.ok || !r.data) throw new Error(r.error ?? "Trip not found");
      return r.data;
    },
  });

  const pings = useQuery({
    queryKey: ["mobile-trip-pings", id],
    queryFn: async () => {
      const r = await apiFetch<Ping[] | { locations?: Ping[] }>(
        `/api/rental-bookings/${id}/locations`,
      );
      if (!r.ok || !r.data) return [];
      return Array.isArray(r.data) ? r.data : (r.data.locations ?? []);
    },
  });

  const [sending, setSending] = useState(false);
  const [incidentOpen, setIncidentOpen] = useState(false);
  const [kind, setKind] = useState("issue");
  const [summary, setSummary] = useState("");
  const [reporting, setReporting] = useState(false);

  async function pingLocation() {
    setSending(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        Alert.alert("Permission denied", "Enable location access to share your trip.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const r = await apiFetch(`/api/rental-bookings/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          accuracy: loc.coords.accuracy ?? undefined,
          recordedAt: new Date().toISOString(),
        }),
      });
      if (!r.ok) Alert.alert("Couldn't share location", r.error ?? "Try again.");
      else {
        await qc.invalidateQueries({ queryKey: ["mobile-trip-pings", id] });
        await qc.invalidateQueries({ queryKey: ["mobile-trip", id] });
      }
    } finally {
      setSending(false);
    }
  }

  async function submitIncident() {
    if (!summary.trim()) {
      Alert.alert("Add a summary", "Please describe what happened.");
      return;
    }
    setReporting(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
        }
      } catch {
        /* ignore */
      }
      const r = await apiFetch(`/api/rental-bookings/${id}/incidents`, {
        method: "POST",
        body: JSON.stringify({
          kind,
          summary: summary.trim(),
          latitude: lat,
          longitude: lng,
        }),
      });
      if (!r.ok) {
        Alert.alert("Couldn't file report", r.error ?? "Try again.");
        return;
      }
      Alert.alert("Report sent", "Our team will follow up shortly.");
      setIncidentOpen(false);
      setSummary("");
    } finally {
      setReporting(false);
    }
  }

  if (booking.isLoading) return <LoadingScreen />;
  if (booking.error || !booking.data) {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="Couldn't load trip" />
      </View>
    );
  }

  const b = booking.data;
  const pingList = pings.data ?? [];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 18 }}
    >
      <Card>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
          {b.carLabel ?? "Trip"}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Badge label={(b.status ?? "").replaceAll("_", " ") || "trip"} tone="primary" />
          {b.totalAmount != null ? <Badge label={`GHS ${b.totalAmount.toFixed(0)}`} tone="secondary" /> : null}
        </View>
        <View style={{ marginTop: 12, gap: 4 }}>
          {b.startDate ? (
            <Text style={{ color: c.mutedForeground, fontSize: 13 }}>
              Pickup: {new Date(b.startDate).toLocaleString()}
            </Text>
          ) : null}
          {b.endDate ? (
            <Text style={{ color: c.mutedForeground, fontSize: 13 }}>
              Return: {new Date(b.endDate).toLocaleString()}
            </Text>
          ) : null}
          {b.pickupLocation ? (
            <Text style={{ color: c.mutedForeground, fontSize: 13 }}>{b.pickupLocation}</Text>
          ) : null}
        </View>
      </Card>

      <Section title="Live location">
        <Card>
          {b.lastKnownAt ? (
            <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
              Last ping {new Date(b.lastKnownAt).toLocaleString()}
              {b.lastKnownLat != null && b.lastKnownLng != null
                ? ` · ${b.lastKnownLat.toFixed(4)}, ${b.lastKnownLng.toFixed(4)}`
                : ""}
            </Text>
          ) : (
            <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              No location shared yet. Tap below to share your current spot.
            </Text>
          )}
          <View style={{ marginTop: 12 }}>
            <Button label={sending ? "Sharing…" : "Share my location"} onPress={pingLocation} loading={sending} />
          </View>
        </Card>
        {pingList.length > 0 ? (
          <Card padding={0}>
            {pingList.slice(0, 8).map((p, i) => (
              <View
                key={p.id ?? i}
                style={{ paddingHorizontal: 14, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: c.border }}
              >
                <Row
                  title={`${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`}
                  subtitle={p.recordedAt ? new Date(p.recordedAt).toLocaleString() : undefined}
                />
              </View>
            ))}
          </Card>
        ) : null}
      </Section>

      <Section title="Safety">
        {!incidentOpen ? (
          <Button label="Report an incident" tone="destructive" onPress={() => setIncidentOpen(true)} />
        ) : (
          <Card>
            <View style={{ gap: 10 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                {(["issue", "accident", "breakdown", "theft"] as const).map((k) => (
                  <Button
                    key={k}
                    label={k}
                    tone={kind === k ? "primary" : "ghost"}
                    onPress={() => setKind(k)}
                  />
                ))}
              </View>
              <Input
                label="What happened?"
                value={summary}
                onChangeText={setSummary}
                multiline
                numberOfLines={4}
                style={{ minHeight: 90, textAlignVertical: "top" }}
              />
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button label="Cancel" tone="ghost" onPress={() => setIncidentOpen(false)} style={{ flex: 1 }} />
                <Button label="Send report" onPress={submitIncident} loading={reporting} style={{ flex: 1 }} />
              </View>
            </View>
          </Card>
        )}
      </Section>

      <Button label="Back to trips" tone="ghost" onPress={() => router.back()} />
    </ScrollView>
  );
}
