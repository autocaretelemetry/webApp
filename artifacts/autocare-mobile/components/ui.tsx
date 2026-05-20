import { Feather } from "@expo/vector-icons";
import React, { type ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
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
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";

type Tone = "primary" | "secondary" | "muted" | "destructive" | "success" | "warning";

const cardShadow = Platform.select<ViewStyle>({
  ios: {
    shadowColor: "#101010",
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
  },
  android: { elevation: 2 },
  default: {},
}) as ViewStyle;

export function Card({
  children,
  style,
  padding = 16,
  flat = false,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  flat?: boolean;
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
        flat ? null : cardShadow,
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
    <View style={[{ gap: 12 }, style]}>
      {title ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 17,
              letterSpacing: -0.2,
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

/* -------------------- ScreenHeader: large title block with safe-area -------------------- */

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  right,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={{
        paddingTop: insets.top + 12,
        paddingHorizontal: 20,
        paddingBottom: 16,
        backgroundColor: c.background,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 12 }}>
        <View style={{ flex: 1 }}>
          {eyebrow ? (
            <Text
              style={{
                color: c.primary,
                fontFamily: "Inter_600SemiBold",
                fontSize: 12,
                letterSpacing: 1.2,
                textTransform: "uppercase",
                marginBottom: 6,
              }}
            >
              {eyebrow}
            </Text>
          ) : null}
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 30,
              letterSpacing: -0.6,
              lineHeight: 36,
            }}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                marginTop: 4,
              }}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </View>
  );
}

/* -------------------- IconCircle: colored avatar for list rows -------------------- */

export function IconCircle({
  icon,
  tone = "primary",
  size = 40,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  tone?: Tone;
  size?: number;
}) {
  const c = useColors();
  const tint: Record<Tone, string> = {
    primary: c.primary,
    secondary: c.secondary,
    muted: c.mutedForeground,
    destructive: c.destructive,
    success: c.success,
    warning: c.warning,
  };
  const color = tint[tone];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `${color}1f`,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Feather name={icon} size={size * 0.45} color={color} />
    </View>
  );
}

/* -------------------- Chip (filter pill) -------------------- */

export function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: 9,
        paddingHorizontal: 16,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? c.primary : c.border,
        backgroundColor: active ? c.primary : c.card,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Text
        style={{
          color: active ? "#fff" : c.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function Button({
  label,
  onPress,
  tone = "primary",
  disabled,
  loading,
  icon,
  style,
}: {
  label: string;
  onPress?: () => void;
  tone?: "primary" | "secondary" | "ghost" | "destructive";
  disabled?: boolean;
  loading?: boolean;
  icon?: React.ComponentProps<typeof Feather>["name"];
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
  const border = tone === "ghost" ? c.border : "transparent";

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
          paddingHorizontal: 20,
          borderRadius: c.radius * 1.4,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Feather name={icon} size={17} color={fg} /> : null}
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
            borderRadius: c.radius * 1.2,
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
    primary: { bg: `${c.primary}1a`, fg: c.primary },
    secondary: { bg: `${c.secondary}1a`, fg: c.secondary },
    muted: { bg: c.muted, fg: c.mutedForeground },
    destructive: { bg: `${c.destructive}1a`, fg: c.destructive },
    success: { bg: `${c.success}1f`, fg: c.success },
    warning: { bg: `${c.warning}1f`, fg: c.warning },
  };
  const { bg, fg } = map[tone];
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 9,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          color: fg,
          fontSize: 10.5,
          fontFamily: "Inter_700Bold",
          letterSpacing: 0.5,
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
  tone = "primary",
  icon,
  style,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: Tone;
  icon?: React.ComponentProps<typeof Feather>["name"];
  style?: StyleProp<ViewStyle>;
}) {
  const c = useColors();
  const tint: Record<Tone, string> = {
    primary: c.primary,
    secondary: c.secondary,
    muted: c.mutedForeground,
    destructive: c.destructive,
    success: c.success,
    warning: c.warning,
  };
  const accent = tint[tone];
  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 140,
          backgroundColor: c.card,
          borderRadius: c.radius * 1.5,
          borderWidth: 1,
          borderColor: c.border,
          paddingVertical: 14,
          paddingHorizontal: 14,
          overflow: "hidden",
        },
        cardShadow,
        style,
      ]}
    >
      <View
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          backgroundColor: accent,
        }}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        {icon ? <Feather name={icon} size={13} color={accent} /> : null}
        <Text
          style={{
            color: c.mutedForeground,
            fontSize: 11,
            fontFamily: "Inter_600SemiBold",
            textTransform: "uppercase",
            letterSpacing: 0.6,
          }}
        >
          {label}
        </Text>
      </View>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_700Bold",
          fontSize: 26,
          marginTop: 6,
          letterSpacing: -0.4,
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
    </View>
  );
}

export function EmptyState({
  title,
  body,
  icon = "inbox",
  action,
}: {
  title: string;
  body?: string;
  icon?: React.ComponentProps<typeof Feather>["name"];
  action?: ReactNode;
}) {
  const c = useColors();
  return (
    <Card style={{ alignItems: "center", paddingVertical: 32 }}>
      <View
        style={{
          width: 56,
          height: 56,
          borderRadius: 28,
          backgroundColor: c.muted,
          alignItems: "center",
          justifyContent: "center",
          marginBottom: 14,
        }}
      >
        <Feather name={icon} size={24} color={c.mutedForeground} />
      </View>
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
            marginTop: 6,
            paddingHorizontal: 12,
            lineHeight: 20,
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
  leadingIcon,
  leadingTone,
  showChevron,
}: {
  left?: ReactNode;
  right?: ReactNode;
  title: string;
  subtitle?: string;
  onPress?: () => void;
  badge?: { label: string; tone?: Tone };
  leadingIcon?: React.ComponentProps<typeof Feather>["name"];
  leadingTone?: Tone;
  showChevron?: boolean;
}) {
  const c = useColors();
  const leading =
    left ?? (leadingIcon ? <IconCircle icon={leadingIcon} tone={leadingTone ?? "primary"} /> : null);
  const trailing =
    right ?? (onPress || showChevron ? <Feather name="chevron-right" size={18} color={c.mutedForeground} /> : null);
  const content = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 14,
        paddingVertical: 14,
      }}
    >
      {leading}
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
              lineHeight: 18,
            }}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => ({
          backgroundColor: pressed ? c.accent : "transparent",
        })}
      >
        {content}
      </Pressable>
    );
  }
  return content;
}

/* -------------------- ListCard: wraps rows in a single card with dividers -------------------- */

export function ListCard({ children }: { children: ReactNode }) {
  const c = useColors();
  const items = React.Children.toArray(children).filter(Boolean);
  return (
    <Card padding={0}>
      {items.map((child, i) => (
        <View
          key={i}
          style={{
            paddingHorizontal: 14,
            borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth,
            borderTopColor: c.border,
          }}
        >
          {child}
        </View>
      ))}
    </Card>
  );
}

export const styles = StyleSheet.create({});
