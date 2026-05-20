import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Input } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

type RoleChoice = "owner" | "renter" | "center" | "vendor" | "delivery" | "fleet";

const ROLE_OPTIONS: Array<{ value: RoleChoice; label: string; hint: string }> = [
  { value: "owner", label: "Vehicle owner", hint: "Service your own cars" },
  { value: "renter", label: "Renter", hint: "Rent a car" },
  { value: "center", label: "Service center", hint: "Run a workshop" },
  { value: "vendor", label: "Parts vendor", hint: "Sell parts" },
  { value: "delivery", label: "Delivery agent", hint: "Deliver parts" },
  { value: "fleet", label: "Fleet operator", hint: "Manage a fleet" },
];

export default function SignupScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup } = useAuth();
  const [chosenRole, setChosenRole] = useState<RoleChoice>("owner");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);

  const needsBusinessField =
    chosenRole === "center" || chosenRole === "vendor" || chosenRole === "fleet";

  async function submit() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (needsBusinessField && !businessName.trim()) {
      setError("Business name is required for this role.");
      return;
    }
    setBusy(true);
    try {
      const isOwner = chosenRole === "owner";
      const applicantData: Record<string, unknown> = {};
      if (needsBusinessField) applicantData.businessName = businessName.trim();
      const res = await signup({
        name,
        email,
        phone,
        password,
        notificationChannels: ["email"],
        ...(isOwner
          ? {}
          : {
              requestedRole: chosenRole,
              applicantData,
            }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (isOwner) {
        router.replace("/");
      } else {
        // Non-owner signups go into approval queue — no session is issued.
        setPending(true);
      }
    } finally {
      setBusy(false);
    }
  }

  if (pending) {
    return (
      <View style={{ flex: 1, backgroundColor: c.background, padding: 22, paddingTop: insets.top + 60, gap: 18 }}>
        <Card>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            Application received
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 8 }}>
            A super admin will review your application shortly. You'll get an email once a
            decision is made. After approval, sign in and finish identity verification to
            unlock the app.
          </Text>
        </Card>
        <Button label="Back to sign in" onPress={() => router.replace("/login")} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        contentContainerStyle={{
          padding: 22,
          paddingTop: insets.top + 36,
          paddingBottom: insets.bottom + 36,
          gap: 22,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 26 }}>
            Create an account
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
            Vehicle-owner accounts are activated instantly. Every other role goes through a
            super-admin review.
          </Text>
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
            I'm signing up as a
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {ROLE_OPTIONS.map((opt) => {
              const active = opt.value === chosenRole;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => setChosenRole(opt.value)}
                  style={({ pressed }) => ({
                    flexGrow: 1,
                    flexBasis: "47%",
                    borderRadius: c.radius * 1.5,
                    borderWidth: 1,
                    borderColor: active ? c.primary : c.border,
                    backgroundColor: active ? `${c.primary}15` : c.card,
                    padding: 12,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    {opt.label}
                  </Text>
                  <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                    {opt.hint}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <Card style={{ gap: 14 }}>
          <Input label="Full name" value={name} onChangeText={setName} placeholder="Akosua Mensah" />
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Input
            label="Phone"
            value={phone}
            onChangeText={setPhone}
            placeholder="+233 24 000 0000"
            keyboardType="phone-pad"
            autoComplete="tel"
          />
          {needsBusinessField ? (
            <Input
              label="Business name"
              value={businessName}
              onChangeText={setBusinessName}
              placeholder="Acme Auto Ltd."
            />
          ) : null}
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            secureTextEntry
          />
          {error ? (
            <View
              style={{
                borderRadius: c.radius,
                borderWidth: 1,
                borderColor: c.destructive,
                padding: 10,
                backgroundColor: `${c.destructive}15`,
              }}
            >
              <Text style={{ color: c.destructive, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                {error}
              </Text>
            </View>
          ) : null}
          <Button
            label={busy ? "Creating account…" : chosenRole === "owner" ? "Create account" : "Submit application"}
            onPress={() => void submit()}
            loading={busy}
            disabled={!name || !email || !phone || !password}
          />
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 4 }}>
            <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              Already have an account?
            </Text>
            <Link href="/login">
              <Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                Sign in
              </Text>
            </Link>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
