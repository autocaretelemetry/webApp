import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
  type TextStyle,
  type TextInputProps,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Tone = "primary" | "secondary" | "muted" | "destructive" | "success" | "warning";

export function Card({
  children,
  style,
  padding = 16,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
}) {
  const c = useColors();
  return (
    <View
      style={[
        {
          backgroundColor: c.card,
          borderRadius: c.radius * 1.5,
          borderWidth: 1,
          borderColor: c.border,
          padding,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

export function Section({
  title,
  action,
  children,
  style,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <View style={[{ gap: 10 }, style]}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 16,
              letterSpacing: 0.2,
            }}
          >
            {title}
          </Text>
          {action ?? null}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
  loading,
  style,
}: {
  label: string;
  onPress?: () => void;
  tone?: "primary" | "secondary" | "ghost" | "destructive";
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const bg =
    tone === "primary"
      ? c.primary
      : tone === "secondary"
        ? c.secondary
        : tone === "destructive"
          ? c.destructive
          : "transparent";
  const fg =
    tone === "primary" || tone === "secondary" || tone === "destructive"
      ? "#ffffff"
      : c.primary;
  const border =
    tone === "ghost" ? c.border : "transparent";

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        {
          backgroundColor: bg,
          borderColor: border,
          borderWidth: tone === "ghost" ? 1 : 0,
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
          paddingVertical: 14,
          paddingHorizontal: 18,
          borderRadius: c.radius * 1.4,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : null}
      <Text
        style={{
          color: fg,
          fontFamily: "Inter_600SemiBold",
          fontSize: 15,
          letterSpacing: 0.2,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Input({
  label,
  hint,
  error,
  style,
  ...rest
}: TextInputProps & { label?: string; hint?: string; error?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      {label ? (
        <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.mutedForeground}
        style={[
          {
            backgroundColor: c.card,
            borderColor: error ? c.destructive : c.input,
            borderWidth: 1,
            borderRadius: c.radius * 1.4,
            paddingHorizontal: 14,
            paddingVertical: 12,
            fontSize: 15,
            color: c.foreground,
            fontFamily: "Inter_400Regular",
          },
          style as TextStyle,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={{ color: c.destructive, fontSize: 12, fontFamily: "Inter_500Medium" }}>
          {error}
        </Text>
      ) : hint ? (
        <Text style={{ color: c.mutedForeground, fontSize: 12, fontFamily: "Inter_400Regular" }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Badge({
  label,
  tone = "muted",
}: {
  label: string;
  tone?: Tone;
}) {
  const c = useColors();
  const map: Record<Tone, { bg: string; fg: string }> = {
    primary: { bg: c.primary, fg: "#ffffff" },
    secondary: { bg: c.secondary, fg: "#ffffff" },
    muted: { bg: c.muted, fg: c.foreground },
    destructive: { bg: c.destructive, fg: "#ffffff" },
    success: { bg: c.success, fg: "#ffffff" },
    warning: { bg: c.warning, fg: "#ffffff" },
  };
  const { bg, fg } = map[tone];
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          color: fg,
          fontSize: 11,
          fontFamily: "Inter_600SemiBold",
          letterSpacing: 0.4,
          textTransform: "uppercase",
        }}
      >
        {label}
      </Text>
    </View>
  );
}

export function StatTile({
  label,
  value,
  hint,
  style,
}: {
  label: string;
  value: string | number;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  return (
    <Card style={[{ flex: 1, minWidth: 140 }, style]} padding={14}>
      <Text
        style={{
          color: c.mutedForeground,
          fontSize: 11,
          fontFamily: "Inter_500Medium",
          textTransform: "uppercase",
          letterSpacing: 0.6,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_700Bold",
          fontSize: 26,
          marginTop: 6,
        }}
      >
        {value}
      </Text>
      {hint ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 12,
            marginTop: 4,
          }}
        >
          {hint}
        </Text>
      ) : null}
    </Card>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <Card style={{ alignItems: "center", paddingVertical: 32 }}>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 16,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      {body ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            textAlign: "center",
            marginTop: 8,
            paddingHorizontal: 12,
          }}
        >
          {body}
        </Text>
      ) : null}
      {action ? <View style={{ marginTop: 16, width: "100%" }}>{action}</View> : null}
    </Card>
  );
}

export function LoadingScreen({ label }: { label?: string }) {
  const c = useColors();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        backgroundColor: c.background,
      }}
    >
      <ActivityIndicator color={c.primary} size="large" />
      {label ? (
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium" }}>{label}</Text>
      ) : null}
    </View>
  );
}

export function Row({
  left,
  right,
  title,
  subtitle,
  onPress,
  badge,
}: {
  left?: ReactNode;
  right?: ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  badge?: { label: string; tone?: Tone };
}) {
  const c = useColors();
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 12,
      }}
    >
      {left}
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              color: c.foreground,
              fontFamily: "Inter_600SemiBold",
              fontSize: 15,
              flexShrink: 1,
            }}
          >
            {title}
          </Text>
          {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        </View>
        {subtitle ? (
          <Text
            numberOfLines={2}
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              marginTop: 2,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
  if (onPress) {
    return (
      <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
        {content}
      </Pressable>
    );
  }
  return content;
}

export const styles = StyleSheet.create({});
