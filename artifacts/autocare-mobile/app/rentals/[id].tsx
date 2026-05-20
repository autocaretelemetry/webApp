import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";

import { Badge, Button, Card, EmptyState, Input, LoadingScreen, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch } from "@/lib/api-mobile";

type Car = {
  id: string;
  year?: number;
  make?: string;
  model?: string;
  city?: string;
  dailyRate?: number;
  withDriverDailyRate?: number | null;
  rentalModes?: string[];
  description?: string;
  features?: string[];
};

type RenterProfile = { id: string; phone: string; kycStatus?: string };

function todayPlus(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function RentalCarScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, role } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();

  const car = useQuery({
    queryKey: ["mobile-rental-car", id],
    queryFn: async () => {
      const r = await apiFetch<Car>(`/api/rental-cars/${id}`);
      if (!r.ok || !r.data) throw new Error(r.error ?? "Car not found");
      return r.data;
    },
  });

  const profile = useQuery({
    queryKey: ["mobile-renter-profile", user?.phone],
    enabled: !!user?.phone && role === "renter",
    queryFn: async () => {
      const r = await apiFetch<RenterProfile>(
        `/api/renter-profiles/by-phone/${encodeURIComponent(user!.phone!)}`,
      );
      return r.ok ? r.data : null;
    },
  });

  const [mode, setMode] = useState<"self_drive" | "with_driver">("self_drive");
  const [start, setStart] = useState(todayPlus(1));
  const [end, setEnd] = useState(todayPlus(3));
  const [pickup, setPickup] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const modes = car.data?.rentalModes ?? ["self_drive"];
    if (!modes.includes(mode)) setMode((modes[0] as "self_drive" | "with_driver") ?? "self_drive");
  }, [car.data, mode]);

  const days = useMemo(() => {
    const s = new Date(start);
    const e = new Date(end);
    const diff = Math.ceil((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(diff, 0);
  }, [start, end]);
  const rate = mode === "with_driver" && car.data?.withDriverDailyRate != null
    ? car.data.withDriverDailyRate
    : car.data?.dailyRate ?? 0;
  const total = rate * days;

  if (car.isLoading) return <LoadingScreen />;
  if (car.error || !car.data) {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="Couldn't load car" body="It may no longer be available." />
      </View>
    );
  }

  const offered = car.data.rentalModes ?? ["self_drive"];
  const isRenter = role === "renter";
  const kycOk = profile.data?.kycStatus === "verified";

  async function submit() {
    if (!profile.data?.id) {
      Alert.alert("Profile required", "Finish your renter profile and KYC before booking.");
      return;
    }
    setSubmitting(true);
    const notes = pickup.trim() ? `Pickup: ${pickup.trim()}` : undefined;
    const body = {
      carId: id,
      renterId: profile.data.id,
      startDate: new Date(start).toISOString(),
      endDate: new Date(end).toISOString(),
      rentalMode: mode,
      purpose: "general",
      ...(notes ? { notes } : {}),
    };
    const r = await apiFetch<{ id: string }>(`/api/rental-bookings`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    setSubmitting(false);
    if (!r.ok) {
      Alert.alert("Booking failed", r.error ?? "Please try again.");
      return;
    }
    Alert.alert("Booking requested", "The owner will review your request.", [
      { text: "View trip", onPress: () => router.replace(`/trips/${r.data!.id}`) },
    ]);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 18 }}
    >
      <Card>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
          {`${car.data.year ?? ""} ${car.data.make ?? ""} ${car.data.model ?? ""}`.trim() || "Car"}
        </Text>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 4 }}>
          {car.data.city ?? "Location not set"}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
          <Badge label={`GHS ${(car.data.dailyRate ?? 0).toFixed(0)} / day`} tone="primary" />
          {car.data.withDriverDailyRate != null ? (
            <Badge label={`With driver: GHS ${car.data.withDriverDailyRate.toFixed(0)}`} tone="secondary" />
          ) : null}
        </View>
        {car.data.description ? (
          <Text style={{ color: c.foreground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 14 }}>
            {car.data.description}
          </Text>
        ) : null}
      </Card>

      {!isRenter ? (
        <EmptyState title="Switch to renter to book" body="Only the renter role can create rental bookings." />
      ) : !kycOk ? (
        <Card>
          <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
            Finish KYC to book
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 6 }}>
            Renters need a verified ID and driver's licence on file before booking.
          </Text>
          <View style={{ marginTop: 12 }}>
            <Button label="Go to KYC" onPress={() => router.push("/kyc")} tone="secondary" />
          </View>
        </Card>
      ) : (
        <Section title="Trip details">
          <Card>
            {offered.length > 1 ? (
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                {offered.map((m) => {
                  const active = m === mode;
                  return (
                    <Button
                      key={m}
                      label={m === "self_drive" ? "Self drive" : "With driver"}
                      tone={active ? "primary" : "ghost"}
                      onPress={() => setMode(m as "self_drive" | "with_driver")}
                      style={{ flex: 1 }}
                    />
                  );
                })}
              </View>
            ) : null}
            <View style={{ gap: 12 }}>
              <Input label="Pickup date" value={start} onChangeText={setStart} placeholder="YYYY-MM-DD" autoCapitalize="none" />
              <Input label="Return date" value={end} onChangeText={setEnd} placeholder="YYYY-MM-DD" autoCapitalize="none" />
              <Input label="Pickup location" value={pickup} onChangeText={setPickup} placeholder="e.g. Accra Mall" />
            </View>
            <View style={{ marginTop: 16, gap: 6 }}>
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                {days} day{days === 1 ? "" : "s"} × GHS {rate.toFixed(0)}
              </Text>
              <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
                GHS {total.toFixed(0)}
              </Text>
            </View>
            <View style={{ marginTop: 14 }}>
              <Button
                label="Request booking"
                onPress={submit}
                loading={submitting}
                disabled={days <= 0}
              />
            </View>
          </Card>
        </Section>
      )}
    </ScrollView>
  );
}
