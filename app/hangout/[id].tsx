import { useCallback, useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, Camera, Clock3, MapPin, Users } from "lucide-react-native";
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Heading, Page, Tag } from "@/components/ui";
import { completeQuest, getHangout, getQuestPhotos, updateRsvp } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { pickAndUploadQuestPhoto } from "@/lib/media";
import { useAppStore } from "@/lib/store";
import { colors } from "@/lib/theme";
import type { Proposal } from "@/lib/types";

export default function HangoutScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { session, configured } = useAuth();
  const { proposals, replaceProposal } = useAppStore();
  const [hangout, setHangout] = useState<Proposal | null>(proposals.find((item) => item.id === id) ?? null);
  const [photos, setPhotos] = useState<Record<number, string[]>>({});
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    const result = await getHangout(id);
    setHangout(result);
    replaceProposal(result);
    if (configured) {
      const results = await Promise.all(result.quests.map((_, index) => getQuestPhotos(id, index)));
      const signedPhotos: Record<number, string[]> = {};
      results.forEach((item, index) => {
        signedPhotos[index] = item.photos.map((photo) => photo.url);
      });
      setPhotos(signedPhotos);
    }
  }, [configured, id, replaceProposal]);

  useEffect(() => {
    refresh().catch((error: unknown) => console.warn("Could not load hangout:", error instanceof Error ? error.message : "Unknown API error"));
  }, [refresh]);

  async function setRsvp(status: "going" | "maybe" | "declined") {
    setLoading(true);
    try {
      await updateRsvp(id, status);
      await refresh();
    } catch (error) {
      Alert.alert("Couldn’t update RSVP", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function markComplete(index: number) {
    setLoading(true);
    try {
      await completeQuest(id, index, { completed: !(hangout?.completed_quests ?? []).includes(hangout?.quests[index] ?? "") });
      await refresh();
    } catch (error) {
      Alert.alert("Couldn’t save quest", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function addPhoto(index: number) {
    if (!session?.user.id) return Alert.alert("Sign in to share", "Private quest photos require a signed-in account.");
    setLoading(true);
    let uploadedPath: string | null = null;
    try {
      const upload = await pickAndUploadQuestPhoto(id, session.user.id);
      if (!upload) return;
      uploadedPath = upload.path;
      await completeQuest(id, index, { completed: true, photo_path: upload.path });
      await refresh();
      Alert.alert("Private photo added", "This photo is only available to people in this hangout.");
    } catch (error) {
      if (uploadedPath) {
        try {
          const { getSupabaseClient } = await import("@/lib/auth");
          await getSupabaseClient()?.storage.from("hangout-media").remove([uploadedPath]);
        } catch (cleanupError) {
          console.warn("Could not remove an unlinked private photo:", cleanupError instanceof Error ? cleanupError.message : "Unknown storage error");
        }
      }
      Alert.alert("Couldn’t add photo", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  if (!hangout) {
    return <Page><Button title="Back home" onPress={() => router.replace("/(tabs)")} /><Body style={{ marginTop: 18 }}>Loading this hangout or it isn’t available to your account.</Body></Page>;
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable style={styles.back} onPress={() => router.back()}><ArrowLeft size={19} color={colors.ink} /><Text style={styles.backText}>Home</Text></Pressable>
        <View style={styles.cover}><Text style={{ fontSize: 85 }}>🌳</Text><Tag active>{hangout.status === "published" ? "IT’S HAPPENING" : "DRAFT"}</Tag></View>
        <Eyebrow>YOUR GROUP ADVENTURE</Eyebrow><Heading>{hangout.title}</Heading><Body>{hangout.description}</Body>
        <Card style={styles.info}><View style={styles.icon}><MapPin size={18} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={styles.title}>{hangout.place.name}</Text><Body style={{ fontSize: 13 }}>{hangout.place.address}</Body><Body style={{ fontSize: 12 }}>{hangout.city}</Body></View></Card>
        <View style={styles.infoRow}>
          <Card style={styles.infoMini}><Clock3 size={18} color={colors.forest} /><Text style={styles.title}>{new Date(hangout.starts_at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</Text><Body style={{ fontSize: 12 }}>{new Date(hangout.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</Body></Card>
          <Card style={styles.infoMini}><Users size={18} color={colors.forest} /><Text style={styles.title}>Group plan</Text><Body style={{ fontSize: 12 }}>Your crew is invited</Body></Card>
        </View>
        {hangout.status === "published" && <Card style={styles.rsvp}><Text style={styles.title}>Are you in?</Text><View style={styles.actions}>
          {(["going", "maybe", "declined"] as const).map((status) => <Pressable key={status} onPress={() => setRsvp(status)} disabled={loading}><Tag active={hangout.rsvp_status === status}>{status === "going" ? "I’m in" : status === "maybe" ? "Maybe" : "Can’t make it"}</Tag></Pressable>)}
        </View></Card>}
        <Card style={styles.card}><Text style={styles.title}>The plan</Text>{hangout.itinerary.map((item, index) => <View key={`${index}-${item}`} style={styles.line}><View style={styles.number}><Text style={styles.numberText}>{index + 1}</Text></View><Body style={{ flex: 1, color: colors.ink }}>{item}</Body></View>)}</Card>
        <Card style={styles.card}><Text style={styles.title}>Optional side quests</Text>{hangout.quests.map((quest, index) => {
          const complete = (hangout.completed_quests ?? []).includes(quest);
          return <View key={quest} style={styles.quest}>
            <Pressable style={[styles.check, complete && styles.checked]} onPress={() => markComplete(index)} disabled={loading}><Check size={15} color={complete ? colors.white : colors.forest} /></Pressable>
            <Body style={{ flex: 1, color: colors.ink }}>{quest}</Body>
            <Pressable accessibilityRole="button" accessibilityLabel="Add optional private photo" onPress={() => addPhoto(index)} disabled={loading} style={styles.camera}><Camera size={17} color={colors.forest} /></Pressable>
            {photos[index]?.map((url) => <Image key={url} source={{ uri: url }} style={styles.photo} accessibilityLabel="Private group quest photo" />)}
          </View>;
        })}</Card>
        <Card style={styles.weather}><Text style={styles.title}>Weather</Text><Body style={{ fontSize: 13 }}>{hangout.weather.detail}</Body><Body style={{ fontSize: 11 }}>Forecasts can change; check local conditions before heading out.</Body></Card>
        <Card style={styles.privacy}><Text style={styles.title}>Calendar privacy</Text><Body style={{ fontSize: 13 }}>{hangout.availability_note ?? "Group members see only the confirmed plan and their RSVP. Nobody sees private calendar details."}</Body></Card>
        <Body style={styles.source}>{hangout.place.attribution}</Body>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 14, paddingBottom: 28 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, height: 34 },
  backText: { color: colors.ink, fontWeight: "700" },
  cover: { height: 150, borderRadius: 23, backgroundColor: "#DCE8D8", justifyContent: "space-between", alignItems: "flex-start", flexDirection: "row", padding: 16 },
  info: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 42, height: 42, borderRadius: 14, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 14, color: colors.ink, fontWeight: "800" },
  infoRow: { flexDirection: "row", gap: 10 },
  infoMini: { flex: 1, gap: 6 },
  rsvp: { gap: 10, backgroundColor: "#F0F3EB" },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { gap: 13 },
  line: { flexDirection: "row", alignItems: "center", gap: 10 },
  number: { width: 25, height: 25, borderRadius: 9, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  numberText: { color: colors.forest, fontWeight: "800", fontSize: 12 },
  quest: { flexDirection: "row", gap: 9, alignItems: "center", flexWrap: "wrap" },
  check: { width: 25, height: 25, borderRadius: 9, backgroundColor: "#EEF2E9", alignItems: "center", justifyContent: "center" },
  checked: { backgroundColor: colors.forest },
  camera: { width: 32, height: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.sage, borderRadius: 11 },
  photo: { width: 90, height: 75, borderRadius: 11, backgroundColor: colors.sage },
  weather: { gap: 7, backgroundColor: "#FFF8E9" },
  privacy: { gap: 7, backgroundColor: "#EDF1E8" },
  source: { textAlign: "center", fontSize: 10 },
});
