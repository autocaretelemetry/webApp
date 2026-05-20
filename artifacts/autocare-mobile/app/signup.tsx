import { Link, useRouter } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Input } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function SignupScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const res = await signup({ name, email, phone, password, notificationChannels: ["email"] });
      if (!res.ok) setError(res.error);
      else router.replace("/");
    } finally {
      setBusy(false);
    }
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
            This sets you up as a vehicle owner. Other roles (rental, service center, vendor, fleet)
            can be applied for from the web app for now.
          </Text>
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
            label={busy ? "Creating account…" : "Create account"}
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
