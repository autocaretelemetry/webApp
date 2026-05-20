import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { setBaseUrl, setAuthTokenGetter } from "@workspace/api-client-react";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, configureAuthApiBase, useAuth } from "@/contexts/AuthContext";
import { getStoredToken } from "@/lib/token-store";
import { setMobileApiBase } from "@/lib/api-mobile";
import { LoadingScreen } from "@/components/ui";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

// Resolve the API origin once at module load. On native we MUST use the
// fully-qualified Replit dev domain (injected as EXPO_PUBLIC_DOMAIN via the
// dev script). On the web preview, an empty base means "use the current
// origin" — the shared proxy routes /api/* to the API server.
function resolveApiBase(): string {
  const env = (process.env as Record<string, string | undefined>)["EXPO_PUBLIC_DOMAIN"];
  if (env && env.length > 0) return `https://${env.replace(/^https?:\/\//, "")}`;
  return "";
}

const API_BASE = resolveApiBase();
setBaseUrl(API_BASE);
configureAuthApiBase(API_BASE);
setMobileApiBase(API_BASE);
setAuthTokenGetter(async () => getStoredToken());

function AuthGate() {
  const { user, loading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    const inAuth = segments[0] === "login" || segments[0] === "signup";
    if (!user && !inAuth) {
      router.replace("/login");
    } else if (user && inAuth) {
      router.replace("/");
    }
  }, [user, loading, segments, router]);

  if (loading) return <LoadingScreen label="Loading AutoCare…" />;
  return (
    <Stack screenOptions={{ headerBackTitle: "Back" }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="login" options={{ headerShown: false }} />
      <Stack.Screen name="signup" options={{ headerShown: false }} />
      <Stack.Screen name="kyc" options={{ title: "Identity verification" }} />
      <Stack.Screen name="rentals/[id]" options={{ title: "Car details" }} />
      <Stack.Screen name="trips/[id]" options={{ title: "Trip" }} />
      <Stack.Screen name="bookings/new" options={{ title: "Book a service" }} />
      <Stack.Screen name="bookings/[id]" options={{ title: "Service booking" }} />
      <Stack.Screen name="fleet/parts-orders" options={{ title: "Parts orders" }} />
      <Stack.Screen name="admin/approvals" options={{ title: "Approvals" }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <KeyboardProvider>
              <AuthProvider>
                <AuthGate />
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
