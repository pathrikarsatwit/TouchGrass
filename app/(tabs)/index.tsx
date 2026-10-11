import { useRouter } from "expo-router";
import { ArrowUpRight, Bell, CalendarDays, Plus, Sparkles, Sun, Users } from "lucide-react-native";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Heading, Page, Tag } from "@/components/ui";
import { useAppStore } from "@/lib/store";
import { colors, spacing } from "@/lib/theme";
import { getNotifications } from "@/lib/api";
import { useEffect, useState } from "react";

export default function HomeScreen() {
  const router = useRouter();
  const { groups, proposals } = useAppStore();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    getNotifications().then((result) => setUnread(result.notifications.filter((item) => !item.read_at).length))
      .catch(() => setUnread(0));
  }, [proposals]);
  const published = proposals.filter((item) => item.status === "published");

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.topline}>
          <View style={styles.brandMark}><Text style={styles.brandGlyph}>✳</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.brand}>touchgrass</Text><Text style={styles.tagline}>LESS SCROLLING. MORE LIVING.</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel={`${unread} unread notifications`} onPress={() => router.push("/notifications")} style={styles.bell}><Bell color={colors.forest} size={19} />{unread > 0 && <View style={styles.bellDot} />}</Pressable>
          <View style={styles.avatar}><Text style={styles.avatarText}>S</Text></View>
        </View>

        <View style={styles.greeting}>
          <View><Eyebrow>{new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }).toUpperCase()}</Eyebrow><Heading style={{ marginTop: 9 }}>A little fresh air{`\n`}looks good on you.</Heading></View>
          <View style={styles.sunIcon}><Sun color={colors.orange} size={25} /></View>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroDecorOne} /><View style={styles.heroDecorTwo} />
          <View style={styles.heroTop}><Tag active>YOUR NEXT ADVENTURE</Tag><Sparkles color="#F4C27A" size={20} /></View>
          <Text style={styles.heroTitle}>Make “sometime”{`\n`}happen this week.</Text>
          <Text style={styles.heroCopy}>Good plans, good people, and a reason to put your phone away.</Text>
          <Button title="Plan a hangout" onPress={() => router.push("/plan")} icon={<ArrowUpRight color={colors.white} size={18} />} />
        </View>

        <View style={styles.sectionHeader}><Heading style={styles.sectionTitle}>Your people</Heading><Text style={styles.smallLink} onPress={() => router.push("/(tabs)/groups")}>See groups</Text></View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 11 }}>
          {groups.slice(0, 4).map((group) => (
            <Card key={group.id} style={styles.groupCard}>
              <Text style={styles.groupEmoji}>{group.avatar}</Text><Text style={styles.groupName}>{group.name}</Text>
              <Text style={styles.groupCount}><Users size={12} color={colors.muted} />  {group.memberCount} {group.memberCount === 1 ? "member" : "members"}</Text>
            </Card>
          ))}
          <Pressable onPress={() => router.push("/(tabs)/groups")}><Card style={[styles.groupCard, styles.addGroup]}><Plus color={colors.forest} size={22} /><Text style={styles.groupName}>New group</Text></Card></Pressable>
        </ScrollView>

        {proposals.filter((item) => item.status === "draft").slice(0, 1).map((draft) => (
          <Pressable key={draft.id} onPress={() => router.push("/proposal")}>
            <Card style={styles.draftCard}><View style={styles.draftIcon}><Text style={{ fontSize: 19 }}>📝</Text></View><View style={{ flex: 1 }}><Text style={styles.eventName}>Pick up your draft</Text><Body style={{ fontSize: 13 }}>{draft.title} · {draft.place.name}</Body></View><ArrowUpRight size={18} color={colors.forest} /></Card>
          </Pressable>
        ))}

        <View style={styles.sectionHeader}><Heading style={styles.sectionTitle}>Coming up</Heading><CalendarDays size={18} color={colors.forest} /></View>
        {published.length ? published.slice(0, 2).map((event) => (
          <Pressable key={event.id} onPress={() => router.push(`/hangout/${event.id}`)}>
          <Card style={styles.eventCard}>
            <View style={styles.eventEmoji}><Text style={{ fontSize: 22 }}>🥾</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.eventName}>{event.title}</Text><Body style={{ fontSize: 13 }}>{new Date(event.starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {event.place.name}</Body></View>
            <ArrowUpRight size={18} color={colors.muted} />
          </Card>
          </Pressable>
        )) : (
          <Card style={styles.emptyCard}><View style={styles.emptyDot}><Text style={{ fontSize: 20 }}>🌤️</Text></View><View style={{ flex: 1 }}><Text style={styles.eventName}>Nothing on the calendar. Yet.</Text><Body style={{ fontSize: 13 }}>Your next story starts with a plan.</Body></View></Card>
        )}
        <View style={{ height: 20 }} />
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { paddingBottom: 20, gap: 21 },
  topline: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 4 },
  brandMark: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.forest, alignItems: "center", justifyContent: "center" },
  brandGlyph: { color: "#EFF3DF", fontSize: 24, fontWeight: "700" },
  brand: { color: colors.forest, fontSize: 19, fontWeight: "900", letterSpacing: -0.7 },
  tagline: { color: colors.muted, fontSize: 8, fontWeight: "800", letterSpacing: 1.1, marginTop: 2 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: "#E8D7B9", alignItems: "center", justifyContent: "center" },
  avatarText: { color: colors.forest, fontSize: 15, fontWeight: "800" },
  greeting: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", paddingVertical: 3 },
  sunIcon: { width: 48, height: 48, borderRadius: 17, backgroundColor: colors.paleOrange, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  hero: { backgroundColor: colors.forest, borderRadius: 25, padding: 20, overflow: "hidden", gap: 14 },
  heroDecorOne: { position: "absolute", width: 165, height: 165, right: -74, top: -55, borderRadius: 100, backgroundColor: "#FFFFFF0D" },
  heroDecorTwo: { position: "absolute", width: 105, height: 105, right: 44, bottom: -80, borderRadius: 100, backgroundColor: "#FFFFFF0D" },
  heroTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  heroTitle: { color: colors.white, fontSize: 25, lineHeight: 30, fontWeight: "800", letterSpacing: -0.6 },
  heroCopy: { color: "#D6E0D8", fontSize: 14, lineHeight: 20, maxWidth: 290 },
  sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 2 },
  sectionTitle: { fontSize: 19, lineHeight: 24 },
  smallLink: { color: colors.forest, fontWeight: "700", fontSize: 13 },
  groupCard: { width: 142, minHeight: 117, justifyContent: "center", gap: 7, padding: 14, borderRadius: 19 },
  groupEmoji: { fontSize: 24 },
  groupName: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  groupCount: { display: "flex", color: colors.muted, fontSize: 11 },
  addGroup: { alignItems: "center", borderStyle: "dashed", backgroundColor: "#F2F1EA" },
  eventCard: { flexDirection: "row", alignItems: "center", gap: 13, padding: 13 },
  eventEmoji: { width: 45, height: 45, backgroundColor: colors.sage, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  eventName: { color: colors.ink, fontWeight: "800", fontSize: 14, marginBottom: 3 },
  emptyCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13 },
  emptyDot: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.paleOrange },
  draftCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13, backgroundColor: "#F3F2E9" },
  draftIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.white },
  bell: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.sage, justifyContent: "center", alignItems: "center" },
  bellDot: { position: "absolute", width: 8, height: 8, right: 6, top: 6, borderRadius: 5, backgroundColor: colors.orange },
});
