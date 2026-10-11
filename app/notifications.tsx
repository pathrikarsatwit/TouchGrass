import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, Bell, Check, ChevronRight } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Card, Eyebrow, Heading, Page } from "@/components/ui";
import { getNotifications, markNotificationRead, type AppNotification } from "@/lib/api";
import { colors } from "@/lib/theme";

const copy: Record<string, { title: string; description: string; icon: string }> = {
  friend_request: { title: "New friend request", description: "Someone wants to connect with you.", icon: "🫶" },
  friend_request_accepted: { title: "Friend request accepted", description: "You can now plan adventures together.", icon: "🌿" },
  group_invitation: { title: "Group invitation", description: "A friend invited you to join a group.", icon: "👋" },
  hangout_invitation: { title: "New hangout", description: "Your group has an adventure to RSVP to.", icon: "🌤️" },
  rsvp_update: { title: "RSVP update", description: "A group member responded to a hangout.", icon: "✅" },
};

export default function NotificationsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const result = await getNotifications();
      setItems(result.notifications);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load notifications.");
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function openItem(item: AppNotification) {
    try {
      if (!item.read_at) await markNotificationRead(item.id);
      await refresh();
      if (item.type === "hangout_invitation" && item.hangout_id) router.push(`/hangout/${item.hangout_id}`);
      else router.push("/friends");
    } catch (cause) {
      Alert.alert("Couldn’t open notification", cause instanceof Error ? cause.message : "Try again.");
    }
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.back} onPress={() => router.back()}><ArrowLeft size={19} color={colors.ink} /><Text style={styles.backText}>Profile</Text></Pressable>
        <Eyebrow>YOUR PEOPLE ARE CHECKING IN</Eyebrow><Heading>Notifications.</Heading>
        {error ? <Card><Body>{error}</Body></Card> : null}
        {!items.length && !error && <Card style={styles.empty}><View style={styles.emptyIcon}><Bell size={23} color={colors.forest} /></View><Text style={styles.title}>All caught up.</Text><Body>Your next adventure will show up here.</Body></Card>}
        {items.map((item) => {
          const details = copy[item.type] ?? { title: "TouchGrass update", description: "There’s something new.", icon: "🌱" };
          return <Pressable key={item.id} onPress={() => openItem(item)}><Card style={[styles.item, !item.read_at && styles.unread]}>
            <View style={styles.emoji}><Text style={{ fontSize: 21 }}>{details.icon}</Text></View>
            <View style={{ flex: 1, gap: 4 }}><Text style={styles.title}>{details.title}</Text><Body style={{ fontSize: 12 }}>{details.description}</Body><Text style={styles.time}>{new Date(item.sent_at).toLocaleString()}</Text></View>
            {item.read_at ? <ChevronRight size={17} color={colors.muted} /> : <Check size={17} color={colors.forest} />}
          </Card></Pressable>;
        })}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 25 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, height: 34 },
  backText: { color: colors.ink, fontWeight: "700" },
  empty: { alignItems: "center", gap: 10, paddingVertical: 30 },
  emptyIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  item: { flexDirection: "row", gap: 12, alignItems: "center", padding: 13 },
  unread: { backgroundColor: "#F0F3EB", borderColor: colors.sageDeep },
  emoji: { width: 43, height: 43, borderRadius: 15, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  title: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  time: { color: colors.muted, fontSize: 10, marginTop: 2 },
});
