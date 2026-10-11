import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { colors } from "@/lib/theme";
import { StoreProvider } from "@/lib/store";
import { AuthProvider, useAuth } from "@/lib/auth";
import { useEffect } from "react";
import { useRouter, useSegments } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import * as Notifications from "expo-notifications";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

export default function RootLayout() {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StoreProvider>
            <StatusBar style="dark" />
            <AuthGate />
          </StoreProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

function AuthGate() {
  const { loading, configured, session } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const isPublic = segments[0] === "welcome" || segments[0] === "recover";

  useEffect(() => {
    if (!configured || loading) return;
    if (!session && !isPublic) router.replace("/welcome");
    else if (session && segments[0] === "welcome") router.replace("/(tabs)");
  }, [configured, loading, session, isPublic, segments, router]);

  if (configured && loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.paper }}><ActivityIndicator color={colors.forest} /></View>;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.paper } }} />;
}
