import { Feather } from "@expo/vector-icons";
import { Link } from "expo-router";
import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Input } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

export default function LoginScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(em: string, pw: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await login(em, pw);
      if (!res.ok) {
        if (res.reason === "pending") {
          setError("Your application is still under review.");
        } else if (res.reason === "rejected") {
          setError(res.note ?? "Your application was not approved.");
        } else {
          setError(res.error);
        }
      }
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
        <View style={{ gap: 8 }}>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 6,
            }}
          >
            <Feather name="tool" size={28} color="#fff" />
          </View>
          <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 28, letterSpacing: -0.2 }}>
            AutoCare
          </Text>
          <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 15 }}>
            Sign in to keep every wheel moving.
          </Text>
        </View>

        <Card style={{ gap: 14 }}>
          <Input
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
          />
          <Input
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            secureTextEntry
            autoComplete="password"
            textContentType="password"
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
            label={busy ? "Signing in…" : "Sign in"}
            onPress={() => void submit(email, password)}
            loading={busy}
            disabled={!email || !password}
          />
          <View style={{ flexDirection: "row", justifyContent: "center", gap: 4 }}>
            <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              New to AutoCare?
            </Text>
            <Link href="/signup">
              <Text style={{ color: c.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                Create an account
              </Text>
            </Link>
          </View>
        </Card>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
