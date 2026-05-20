import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  useCreateBooking,
  useListServiceCenters,
  useListVehicles,
} from "@workspace/api-client-react";

import { Badge, Button, Card, EmptyState, Input, LoadingScreen, Section } from "@/components/ui";
import { useColors } from "@/hooks/useColors";

const SERVICE_TYPES = [
  "Maintenance",
  "Oil change",
  "Brake service",
  "Tire service",
  "Inspection",
  "Repair",
];

export default function NewBookingScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const vehicles = useListVehicles();
  const centers = useListServiceCenters();
  const create = useCreateBooking();

  const [vehicleId, setVehicleId] = useState<string | null>(null);
  const [centerId, setCenterId] = useState<string | null>(null);
  const [type, setType] = useState(SERVICE_TYPES[0]!);
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");

  if (vehicles.isLoading || centers.isLoading) return <LoadingScreen />;
  const vList = (vehicles.data as Array<{ id: string; year?: number; make?: string; model?: string; plate?: string; brand?: string }>) ?? [];
  const cList = (centers.data as Array<{ id: string; name: string; city?: string }>) ?? [];

  if (vList.length === 0) {
    return (
      <View style={{ flex: 1, padding: 18, backgroundColor: c.background }}>
        <EmptyState title="No vehicles yet" body="Add a vehicle from the web app first." />
      </View>
    );
  }

  async function submit() {
    if (!vehicleId || !centerId) {
      Alert.alert("Pick details", "Choose a vehicle and a service center.");
      return;
    }
    try {
      const body = {
        vehicleId,
        serviceCenterId: centerId,
        serviceType: type,
        description: description.trim() || type,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
      } as unknown as Parameters<typeof create.mutateAsync>[0]["data"];
      const created = await create.mutateAsync({ data: body });
      const id = (created as { id?: string })?.id;
      Alert.alert("Booking requested", "We'll notify you when the center accepts.", [
        { text: "View", onPress: () => (id ? router.replace(`/bookings/${id}`) : router.back()) },
      ]);
    } catch (e) {
      Alert.alert("Couldn't book", e instanceof Error ? e.message : "Try again.");
    }
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 18 }}
    >
      <Section title="Vehicle">
        <Card padding={0}>
          {vList.map((v, i) => {
            const active = v.id === vehicleId;
            const title = `${v.year ?? ""} ${v.brand ?? v.make ?? ""} ${v.model ?? ""}`.trim() || "Vehicle";
            return (
              <Pressable
                key={v.id}
                onPress={() => setVehicleId(v.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: active ? c.accent : "transparent",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{title}</Text>
                  {v.plate ? (
                    <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{v.plate}</Text>
                  ) : null}
                </View>
                {active ? <Badge label="Selected" tone="primary" /> : null}
              </Pressable>
            );
          })}
        </Card>
      </Section>

      <Section title="Service center">
        <Card padding={0}>
          {cList.slice(0, 20).map((s, i) => {
            const active = s.id === centerId;
            return (
              <Pressable
                key={s.id}
                onPress={() => setCenterId(s.id)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: active ? c.accent : "transparent",
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>{s.name}</Text>
                  {s.city ? <Text style={{ color: c.mutedForeground, fontSize: 12 }}>{s.city}</Text> : null}
                </View>
                {active ? <Badge label="Selected" tone="primary" /> : null}
              </Pressable>
            );
          })}
        </Card>
      </Section>

      <Section title="Service type">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {SERVICE_TYPES.map((s) => (
            <Pressable
              key={s}
              onPress={() => setType(s)}
              style={({ pressed }) => ({
                paddingHorizontal: 14,
                paddingVertical: 8,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: s === type ? c.primary : c.border,
                backgroundColor: s === type ? c.primary : "transparent",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Text style={{ color: s === type ? "#fff" : c.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                {s}
              </Text>
            </Pressable>
          ))}
        </View>
      </Section>

      <Input
        label="Notes"
        value={description}
        onChangeText={setDescription}
        placeholder="What needs attention?"
        multiline
        numberOfLines={3}
        style={{ minHeight: 80, textAlignVertical: "top" }}
      />
      <Input
        label="Preferred date"
        value={scheduledAt}
        onChangeText={setScheduledAt}
        placeholder="YYYY-MM-DD (optional)"
        autoCapitalize="none"
      />

      <Button label="Request booking" onPress={submit} loading={create.isPending} />
    </ScrollView>
  );
}
