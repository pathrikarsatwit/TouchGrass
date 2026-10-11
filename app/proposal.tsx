import { useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, Check, Clock3, Leaf, MapPin, Share2, Sparkles, Sun, Users } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Field, Heading, Page, Tag } from "@/components/ui";
import { publishPlan } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { colors } from "@/lib/theme";

export default function ProposalScreen() {
  const router = useRouter();
  const { proposals, replaceProposal } = useAppStore();
  const proposal = proposals[0];
  const [title, setTitle] = useState(proposal?.title ?? "");
  const [publishing, setPublishing] = useState(false);
  if (!proposal) {
    return <Page><Button title="Back home" onPress={() => router.replace("/(tabs)")} /><Body style={{ marginTop: 20 }}>No draft to review. Start by planning a hangout.</Body></Page>;
  }

  async function publish(confirmConflict = false) {
    setPublishing(true);
    try {
      const result = await publishPlan(proposal.id, confirmConflict);
      const updated = { ...result, title: title.trim() || result.title };
      replaceProposal(updated);
      Alert.alert("It’s happening!", "Your plan is published. Invite your crew and get ready to go.", [{ text: "Lovely", onPress: () => router.replace("/(tabs)") }]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Try again.";
      if (message.includes("no longer fits the connected calendars")) {
        Alert.alert(
          "Calendar conflict",
          "A connected calendar changed since you selected this time. Create a new draft to choose another time, or explicitly publish anyway if your group has agreed to it.",
          [
            { text: "Create a new draft", onPress: () => router.replace("/plan") },
            { text: "Keep draft", style: "cancel" },
            { text: "Publish anyway", style: "destructive", onPress: () => publish(true) },
          ],
        );
      } else {
        Alert.alert("Couldn’t publish", message);
      }
    } finally {
      setPublishing(false);
    }
  }

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Pressable style={styles.back} onPress={() => router.back()}><ArrowLeft size={19} color={colors.ink} /><Text style={styles.backText}>Back to places</Text></Pressable>
        <View style={styles.cover}>
          <View style={styles.coverSun} /><Text style={styles.coverEmoji}>🌲</Text><View style={styles.coverLabel}><Sparkles size={13} color="#F7D08A" /><Text style={styles.coverTag}>A LITTLE ADVENTURE</Text></View>
        </View>
        <Eyebrow>YOUR HANGOUT DRAFT</Eyebrow>
        <Heading>Looks like a good{`\n`}day to go outside.</Heading>
        <Body>{proposal.ai_generated ? "AI-assisted draft · verify details before you go." : proposal.generation_note ?? "A simple plan you can edit and make your own."}</Body>
        <Card style={styles.privacy}><Text style={styles.cardTitle}>Time availability</Text><Body style={{ fontSize: 13 }}>{proposal.availability_note ?? "This time is unconfirmed until calendars are checked. Before publishing, the server refreshes any connected calendars; unknown remains unknown."}</Body></Card>
        <Field label="Give it a name" value={title} onChangeText={setTitle} />
        <Card style={styles.placeCard}><View style={styles.placeIcon}><MapPin color={colors.forest} size={19} /></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{proposal.place.name}</Text><Body style={{ fontSize: 13 }}>{proposal.place.address}</Body><Tag active>{proposal.city}</Tag></View></Card>
        <View style={styles.infoRow}>
          <Card style={styles.infoCard}><Clock3 size={18} color={colors.forest} /><Text style={styles.infoTitle}>{new Date(proposal.starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</Text><Body style={{ fontSize: 12 }}>{new Date(proposal.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Body></Card>
          <Card style={styles.infoCard}><Users size={18} color={colors.forest} /><Text style={styles.infoTitle}>The Trail Mix</Text><Body style={{ fontSize: 12 }}>Friends invited</Body></Card>
        </View>
        <Card style={styles.card}><View style={styles.cardHead}><Leaf size={18} color={colors.forest} /><Text style={styles.cardTitle}>The little itinerary</Text></View>{proposal.itinerary.map((item, index) => <View key={`${index}-${item}`} style={styles.lineItem}><View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View><Body style={{ flex: 1, color: colors.ink }}>{item}</Body></View>)}</Card>
        <Card style={styles.card}><View style={styles.cardHead}><Sparkles size={18} color={colors.forest} /><Text style={styles.cardTitle}>Optional side quests</Text></View>{proposal.quests.map((item) => <View key={item} style={styles.quest}><View style={styles.questCheck}><Check size={14} color={colors.forest} /></View><Body style={{ color: colors.ink, flex: 1 }}>{item}</Body></View>)}</Card>
        <Card style={styles.weather}><Sun color={colors.orange} size={20} /><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Weather check</Text><Body style={{ fontSize: 13 }}>{proposal.weather.detail}</Body></View></Card>
        <Card style={styles.card}><Text style={styles.cardTitle}>Bring along</Text><View style={styles.tagRow}>{proposal.items_to_bring.map((item) => <Tag key={item}>{item}</Tag>)}</View><Body style={{ fontSize: 12, marginTop: 8 }}>{proposal.safety_notes.join(" ")}</Body></Card>
        <Body style={styles.privacy}>Time availability is unknown unless members connect their own calendars. Publishing sends invitations only after you confirm.</Body>
        <Button title="Confirm & publish" onPress={publish} loading={publishing} icon={<Check size={18} color={colors.white} />} />
        <Button title="Save for later" onPress={() => { Alert.alert("Draft saved", "You can come back to this plan anytime."); router.replace("/(tabs)"); }} secondary icon={<Share2 size={17} color={colors.forest} />} />
        <Body style={styles.attribution}>{proposal.place.attribution}</Body>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 15, paddingBottom: 28 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, height: 34 },
  backText: { fontWeight: "700", color: colors.ink, fontSize: 14 },
  cover: { height: 176, borderRadius: 24, backgroundColor: "#55755D", justifyContent: "flex-end", padding: 18, overflow: "hidden" },
  coverSun: { position: "absolute", right: 33, top: 20, height: 83, width: 83, borderRadius: 50, backgroundColor: "#E6C981" },
  coverEmoji: { position: "absolute", right: 39, bottom: -8, fontSize: 111 },
  coverLabel: { flexDirection: "row", gap: 7, alignItems: "center" },
  coverTag: { color: colors.white, fontSize: 10, fontWeight: "800", letterSpacing: 1.4 },
  placeCard: { flexDirection: "row", gap: 13, alignItems: "flex-start" },
  placeIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: "800", marginBottom: 4 },
  infoRow: { flexDirection: "row", gap: 11 },
  infoCard: { flex: 1, gap: 6 },
  infoTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  card: { gap: 12 },
  cardHead: { flexDirection: "row", gap: 9, alignItems: "center" },
  lineItem: { flexDirection: "row", alignItems: "center", gap: 10 },
  number: { width: 25, height: 25, borderRadius: 9, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  numberText: { color: colors.forest, fontWeight: "800", fontSize: 12 },
  quest: { flexDirection: "row", gap: 10, alignItems: "center" },
  questCheck: { width: 24, height: 24, borderRadius: 9, backgroundColor: "#EEF2E9", alignItems: "center", justifyContent: "center" },
  weather: { flexDirection: "row", gap: 11, alignItems: "center", backgroundColor: "#FFF8E9" },
  tagRow: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  privacy: { fontSize: 12, lineHeight: 18, color: colors.muted },
  attribution: { fontSize: 10, textAlign: "center" },
});
