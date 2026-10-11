import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { ArrowLeft, CalendarDays, Check, CircleAlert, ShieldCheck, Unplug } from "lucide-react-native";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Heading, Page } from "@/components/ui";
import { disconnectCalendar, getCalendarConnections, getGoogleCalendarUrl, type CalendarConnection } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { currentNativeProvider, readAndSyncBusyTimes } from "@/lib/device-calendar";
import { colors } from "@/lib/theme";

WebBrowser.maybeCompleteAuthSession();
const PROVIDER_LABEL: Record<string, string> = { google: "Google Calendar", apple: "Apple Calendar", android: "Android Calendar" };

export default function CalendarScreen() {
  const router = useRouter();
  const { configured } = useAuth();
  const [connections, setConnections] = useState<CalendarConnection[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await getCalendarConnections();
      setConnections(result.connections);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your calendar connections.");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const listener = Linking.addEventListener("url", ({ url }) => {
      if (url.startsWith("touchgrass://calendar/complete")) {
        const status = new URL(url).searchParams.get("status");
        if (status === "connected") Alert.alert("Calendar connected", "Google Calendar free/busy access is ready.");
        else Alert.alert("Couldn’t connect", "Google Calendar did not finish authorization. Try again.");
        refresh();
      }
    });
    return () => listener.remove();
  }, [refresh]);

  async function connectGoogle() {
    setLoading(true);
    try {
      const { authorization_url: authUrl } = await getGoogleCalendarUrl();
      const result = await WebBrowser.openAuthSessionAsync(authUrl, "touchgrass://calendar/complete");
      if (result.type === "success" && result.url.includes("status=connected")) {
        Alert.alert("Calendar connected", "Google Calendar free/busy access is ready.");
      } else if (result.type === "success" && result.url.includes("status=error")) {
        Alert.alert("Couldn’t connect", "Google Calendar did not finish authorization. Try again.");
      }
      await refresh();
    } catch (cause) {
      Alert.alert("Google Calendar unavailable", cause instanceof Error ? cause.message : "Check backend OAuth configuration.");
    } finally {
      setLoading(false);
    }
  }

  async function connectDeviceCalendar() {
    if (Platform.OS !== "ios" && Platform.OS !== "android") {
      return Alert.alert("Mobile device required", "Device calendars are available in the iOS and Android app builds.");
    }
    setLoading(true);
    try {
      const permission = await (await import("expo-calendar")).requestCalendarPermissions(false);
      if (!permission.granted) {
        setError("Calendar permission was not granted. You can allow it later in system settings.");
        return;
      }
      await syncDeviceCalendar();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Device calendar access is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  async function syncDeviceCalendar() {
    setRefreshing(true);
    try {
      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      const provider = currentNativeProvider();
      if (!provider) return;
      await readAndSyncBusyTimes(now, end, provider);
      await refresh();
      Alert.alert(
        "Busy times shared securely",
        "Only start/end busy intervals were sent to TouchGrass. Event names, notes, locations and attendees stay on this device. The temporary availability expires after 15 minutes or after scheduling.",
      );
    } catch (cause) {
      Alert.alert("Couldn’t sync calendar availability", cause instanceof Error ? cause.message : "Check your connection and calendar permission.");
    } finally {
      setRefreshing(false);
    }
  }

  async function disconnect(provider: CalendarConnection["provider"]) {
    setLoading(true);
    try {
      await disconnectCalendar(provider);
      await refresh();
    } catch (cause) {
      Alert.alert("Couldn’t disconnect", cause instanceof Error ? cause.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.back} onPress={() => router.back()}><ArrowLeft size={19} color={colors.ink} /><Text style={styles.backText}>Profile</Text></Pressable>
        <Eyebrow>YOU’RE ALWAYS IN CONTROL</Eyebrow>
        <Heading>Calendar{`\n`}connections.</Heading>
        <Body>We look for a good time without sharing the details of your schedule.</Body>
        <Card style={styles.privacy}><View style={styles.shield}><ShieldCheck color={colors.forest} size={20} /></View><View style={{ flex: 1, gap: 5 }}><Text style={styles.cardTitle}>Private by design</Text><Body style={{ fontSize: 13 }}>We read only busy/free periods. Events, titles and locations never go to your friends or the AI. Busy intervals are processed briefly and not saved as calendar events.</Body></View></Card>
        {error ? <Card style={styles.error}><CircleAlert size={18} color={colors.red} /><Body style={{ flex: 1, color: colors.red }}>{error}</Body></Card> : null}
        <Heading style={styles.section}>YOUR CONNECTIONS</Heading>
        {(["google", "apple", "android"] as const).map((provider) => {
          const connection = connections.find((item) => item.provider === provider && item.connection_status === "connected");
          const isDevice = provider !== "google";
          if (provider === "apple" && Platform.OS === "android") return null;
          if (provider === "android" && Platform.OS === "ios") return null;
          return <Card key={provider} style={styles.connection}>
            <View style={styles.providerIcon}><CalendarDays size={19} color={colors.forest} /></View>
            <View style={{ flex: 1, gap: 3 }}><Text style={styles.cardTitle}>{PROVIDER_LABEL[provider]}</Text><Body style={{ fontSize: 12 }}>{connection ? `Connected · ${connection.last_sync_at ? new Date(connection.last_sync_at).toLocaleString() : "availability refreshes when planning"}` : "Not connected · availability unknown"}</Body></View>
            {connection ? <Check size={19} color={colors.forest} /> : null}
            {connection ? <Pressable accessibilityRole="button" accessibilityLabel={`Disconnect ${PROVIDER_LABEL[provider]}`} onPress={() => disconnect(provider)}><Unplug size={17} color={colors.red} /></Pressable> : null}
          </Card>;
        })}
        {!connections.some((item) => item.provider === "google" && item.connection_status === "connected")
          ? <Button title="Connect Google Calendar" onPress={connectGoogle} loading={loading} disabled={!configured} /> : null}
        {Platform.OS !== "web" && !connections.some((item) => item.provider === (Platform.OS === "ios" ? "apple" : "android") && item.connection_status === "connected")
          ? <Button title="Connect this device’s calendar" onPress={connectDeviceCalendar} loading={loading} secondary disabled={!configured} /> : null}
        {Platform.OS !== "web" && connections.some((item) => item.provider === (Platform.OS === "ios" ? "apple" : "android") && item.connection_status === "connected")
          ? <Button title="Refresh device availability" onPress={syncDeviceCalendar} loading={refreshing} secondary /> : null}
        {!configured && <Body style={styles.configure}>Sign in with Supabase to securely connect and manage calendars.</Body>}
        <Card style={styles.note}><Text style={styles.cardTitle}>What group members see</Text><Body style={{ fontSize: 13 }}>Only suggested start/end times and whether the group check is complete. No one sees who is busy, why, or a raw calendar interval.</Body></Card>
        <Body style={styles.footnote}>Google uses the primary calendar’s free/busy endpoint. iOS/Android device calendars require a development build and share only busy intervals for the next 30 days; temporary device intervals expire in 15 minutes.</Body>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 26 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, height: 34, marginBottom: 2 },
  backText: { fontWeight: "700", color: colors.ink, fontSize: 14 },
  privacy: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "#EDF1E8" },
  shield: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  section: { fontSize: 12, lineHeight: 15, color: colors.muted, letterSpacing: 1, marginTop: 7 },
  connection: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13 },
  providerIcon: { width: 40, height: 40, borderRadius: 14, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  error: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#FFF0ED" },
  note: { backgroundColor: "#F0F3EB" },
  configure: { textAlign: "center", fontSize: 12 },
  footnote: { fontSize: 11, lineHeight: 16 },
});
