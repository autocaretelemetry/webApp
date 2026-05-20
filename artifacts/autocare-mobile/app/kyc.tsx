import { Feather } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useMemo, useState } from "react";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Badge, Button, Card, EmptyState, Section } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";
import { apiFetch, getMobileApiBase } from "@/lib/api-mobile";

type DocSpec = { key: string; label: string; required: boolean };

const DEFAULT_DOCS: DocSpec[] = [
  { key: "gov_id", label: "Government-issued ID", required: true },
  { key: "selfie", label: "Selfie holding the ID", required: true },
];

function docsForRole(role: string): DocSpec[] {
  switch (role) {
    case "renter":
    case "delivery":
      return [...DEFAULT_DOCS, { key: "drivers_license", label: "Driver's licence", required: true }];
    case "center":
    case "vendor":
      return [...DEFAULT_DOCS, { key: "business_reg", label: "Business registration", required: true }];
    case "fleet":
      return [
        ...DEFAULT_DOCS,
        { key: "org_reg", label: "Organisation registration", required: true },
        { key: "sample_vehicle_reg", label: "Sample vehicle registration", required: false },
      ];
    default:
      return DEFAULT_DOCS;
  }
}

type Upload = { url: string; uploading: boolean; error?: string | null };

export default function KycScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const specs = useMemo(() => docsForRole(user?.requestedRole ?? user?.role ?? "owner"), [user]);
  const [docs, setDocs] = useState<Record<string, Upload>>(() =>
    Object.fromEntries(specs.map((s) => [s.key, { url: "", uploading: false }])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pickAndUpload(spec: DocSpec) {
    setError(null);
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError("Permission to access photos is required.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.85,
      base64: false,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const name = asset.fileName ?? `${spec.key}.jpg`;
    const contentType = asset.mimeType ?? "image/jpeg";
    setDocs((d) => ({ ...d, [spec.key]: { ...d[spec.key]!, uploading: true, error: null } }));
    try {
      const blob = await (await fetch(asset.uri)).blob();
      const meta = await apiFetch<{ uploadURL: string; objectPath: string }>(
        "/api/storage/uploads/request-url",
        {
          method: "POST",
          body: JSON.stringify({ name, size: blob.size, contentType }),
        },
      );
      if (!meta.ok || !meta.data) {
        throw new Error(meta.error ?? "Could not start upload");
      }
      const put = await fetch(meta.data.uploadURL, {
        method: "PUT",
        body: blob,
        headers: { "content-type": contentType },
      });
      if (!put.ok) throw new Error("Upload failed");
      const url = `${getMobileApiBase()}/api/storage${meta.data.objectPath}`;
      setDocs((d) => ({ ...d, [spec.key]: { url, uploading: false } }));
    } catch (e) {
      setDocs((d) => ({
        ...d,
        [spec.key]: { url: "", uploading: false, error: e instanceof Error ? e.message : "Upload failed" },
      }));
    }
  }

  async function submit() {
    setError(null);
    const missing = specs.filter((s) => s.required && !docs[s.key]?.url);
    if (missing.length) {
      setError(`Please upload: ${missing.map((m) => m.label).join(", ")}`);
      return;
    }
    setSubmitting(true);
    const body = {
      documents: specs
        .filter((s) => docs[s.key]?.url)
        .map((s) => {
          const stored = docs[s.key]!.url;
          const base = getMobileApiBase();
          const url = base && stored.startsWith(base) ? stored.slice(base.length) : stored;
          return { key: s.key, label: s.label, url };
        }),
    };
    const r = await apiFetch("/api/me/kyc", { method: "POST", body: JSON.stringify(body) });
    setSubmitting(false);
    if (!r.ok) {
      setError(r.error ?? "Submission failed");
      return;
    }
    await refresh();
    Alert.alert("KYC submitted", "We'll notify you once review is complete.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  }

  if (!user) return null;
  if (user.approvalStatus !== "approved") {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 18 }}>
        <EmptyState
          title="Application under review"
          body="Once a super admin approves your account you'll be able to submit KYC."
        />
      </View>
    );
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 18, paddingBottom: insets.bottom + 32, gap: 18 }}
    >
      <Card>
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
          Verify your identity
        </Text>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 6 }}>
          Upload clear photos (JPG, PNG or WebP, max 10 MB each). We scan every file for malware before review.
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
          <Badge label={`Status: ${user.kycStatus ?? "not submitted"}`} tone={user.kycStatus === "verified" ? "success" : "warning"} />
        </View>
      </Card>

      <Section title="Documents">
        <Card padding={0}>
          {specs.map((s, i) => {
            const u = docs[s.key]!;
            return (
              <Pressable
                key={s.key}
                disabled={u.uploading}
                onPress={() => void pickAndUpload(s)}
                style={{
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: c.border,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: u.url ? c.success : c.muted,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={u.url ? "check" : "upload"}
                    size={18}
                    color={u.url ? "#fff" : c.foreground}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    {s.label}
                    {s.required ? " *" : ""}
                  </Text>
                  <Text
                    style={{
                      color: u.error ? c.destructive : c.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                      marginTop: 2,
                    }}
                  >
                    {u.uploading
                      ? "Uploading…"
                      : u.error
                        ? u.error
                        : u.url
                          ? "Uploaded — tap to replace"
                          : "Tap to upload from your device"}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </Card>
      </Section>

      {error ? (
        <Card>
          <Text style={{ color: c.destructive, fontFamily: "Inter_500Medium" }}>{error}</Text>
        </Card>
      ) : null}

      <Button label="Submit for review" onPress={submit} loading={submitting} />
    </ScrollView>
  );
}
