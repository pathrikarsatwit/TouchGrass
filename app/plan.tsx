import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, Check, ChevronRight, MapPin, Sparkles } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Field, Heading, Page, Tag } from "@/components/ui";
import { createPlan, fallbackPlace, getAvailability, getCalendarConnections, searchPlaces } from "@/lib/api";
import { currentNativeProvider, readAndSyncBusyTimes } from "@/lib/device-calendar";
import { useAppStore } from "@/lib/store";
import { colors, spacing } from "@/lib/theme";
import type { Place, TimeSlot } from "@/lib/types";

const moods = ["Picnic", "Nature walk", "Photo hunt", "Outdoor games", "Coffee walk", "Surprise me"];
const soonDate = () => {
  const date = new Date();
  date.setDate(date.getDate() + ((6 - date.getDay() + 7) % 7 || 7));
  return date.toISOString().slice(0, 10);
};

export default function PlanScreen() {
  const router = useRouter();
  const { groups, addProposal } = useAppStore();
  const [city, setCity] = useState("Boston, MA");
  const [date, setDate] = useState(soonDate());
  const [mood, setMood] = useState("Nature walk");
  const [budget, setBudget] = useState("Under $20");
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "demo-friends");
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [slot, setSlot] = useState<TimeSlot | null>(null);
  const [candidates, setCandidates] = useState<TimeSlot[]>([]);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [manualTime, setManualTime] = useState("11:00");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"details" | "place">("details");
  useEffect(() => {
    if (!groupId && groups[0]) setGroupId(groups[0].id);
  }, [groupId, groups]);

  async function findPlaces() {
    if (!groups.length) {
      Alert.alert("Make a group first", "Create a group so you can plan an adventure together.", [
        { text: "Create a group", onPress: () => router.push("/(tabs)/groups") }, { text: "Not now" },
      ]);
      return;
    }
    if (!city.trim()) return Alert.alert("Add a place", "Enter a city to find nearby parks and public places.");
    setBusy(true);
    try {
      const result = await searchPlaces(city, mood.toLowerCase().includes("coffee") ? "cafe" : "park");
      setPlaces(result.places);
      setSelectedPlace(result.places[0] ?? null);
      setSlot(null);
      setCandidates([]);
      setAvailabilityChecked(false);
      setStep("place");
    } catch (error) {
      Alert.alert("Place search unavailable", error instanceof Error ? error.message : "Try again or enter a real meeting place yourself.");
      const manual = fallbackPlace(city);
      setPlaces([manual]);
      setSelectedPlace(manual);
      setSlot(null);
      setCandidates([]);
      setAvailabilityChecked(false);
      setStep("place");
    } finally {
      setBusy(false);
    }
  }

  async function checkAvailability() {
    if (!selectedPlace) return Alert.alert("Pick a place", "Choose where your group will meet first.");
    setBusy(true);
    setAvailabilityChecked(false);
    try {
      const provider = currentNativeProvider();
      if (provider) {
        const connections = await getCalendarConnections();
        const connected = connections.connections.some((item) => item.provider === provider && item.connection_status === "connected");
        const targetDate = new Date(`${date}T00:00:00`);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (connected && targetDate.getTime() <= today.getTime() + 30 * 24 * 60 * 60 * 1000) {
          const end = new Date(`${date}T23:59:59`);
          await readAndSyncBusyTimes(today, end, provider);
        }
      }
      const result = await getAvailability(groupId, date, 120);
      setCandidates(result.candidates);
      setSlot(result.candidates[0] ?? null);
      setAvailabilityChecked(true);
      if (!result.candidates.length) setManualTime("11:00");
    } catch (error) {
      Alert.alert("Couldn’t check group availability", error instanceof Error ? error.message : "You can still choose a time yourself.");
      setCandidates([]);
      setSlot(null);
      setAvailabilityChecked(true);
    } finally {
      setBusy(false);
    }
  }

  async function findTimeAndPlan() {
    if (!selectedPlace) return;
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const manuallyEntered = new Date(`${date}T${manualTime}:00`);
    if (!slot && (!availabilityChecked || Number.isNaN(manuallyEntered.getTime()))) {
      return Alert.alert("Choose a valid time", "Check group availability or enter a local time like 11:00.");
    }
    setBusy(true);
    try {
      const proposal = await createPlan({
        group_id: groupId,
        city,
        date,
        duration_minutes: 120,
        mood,
        budget,
        place_id: selectedPlace.id,
        starts_at: slot?.starts_at ?? manuallyEntered.toISOString(),
        timezone,
      });
      addProposal({
        ...proposal,
        availability_complete: slot?.availability_complete ?? false,
        availability_note: slot?.availability_complete
          ? "Group availability was complete when this time was suggested; it will be refreshed before publishing."
          : "This is an unconfirmed suggestion. Some group calendars are disconnected or could not be checked.",
      });
      router.replace("/proposal");
    } catch (error) {
      if (selectedPlace.source === "user-entered") {
        Alert.alert("Planner unavailable", "Manual plans need a verified meeting place. Try again when place search is online.");
      } else {
        Alert.alert("Couldn’t make a draft", error instanceof Error ? error.message : "Check your connection and retry.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <Pressable style={styles.back} onPress={() => step === "place" ? setStep("details") : router.back()}><ArrowLeft size={19} color={colors.ink} /><Text style={styles.backText}>{step === "place" ? "Details" : "Back"}</Text></Pressable>
        <View style={styles.title}><Eyebrow>LET’S GET OUT THERE</Eyebrow><Heading style={{ marginTop: 9 }}>{step === "details" ? "Make a plan that\nfeels like you." : "Pick your\nstarting point."}</Heading><Body>Just enough planning. Plenty of room for the good stuff.</Body></View>

        {step === "details" ? <>
          <Card style={styles.formCard}>
            <Text style={styles.label}>Who’s coming?</Text>
            <View style={styles.rowWrap}>{groups.map((group) => (
              <Pressable key={group.id} onPress={() => setGroupId(group.id)}><Tag active={groupId === group.id}>{group.avatar}  {group.name}</Tag></Pressable>
            ))}</View>
            <Field label="Where are you thinking?" value={city} onChangeText={setCity} placeholder="Boston, MA" />
            <Field label="What day?" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
            <Text style={styles.label}>Set the mood</Text>
            <View style={styles.rowWrap}>{moods.map((item) => <Pressable key={item} onPress={() => setMood(item)}><Tag active={mood === item}>{item}</Tag></Pressable>)}</View>
            <Text style={styles.label}>Budget per person</Text>
            <View style={styles.rowWrap}>{["Free", "Under $20", "$20–50"].map((item) => <Pressable key={item} onPress={() => setBudget(item)}><Tag active={budget === item}>{item}</Tag></Pressable>)}</View>
          </Card>
          <Card style={styles.privacyCard}><View style={styles.privacyIcon}><Sparkles size={18} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={styles.privacyTitle}>Your plans, your call</Text><Body style={{ fontSize: 13 }}>We’ll suggest a time, but friends’ calendars stay private. You can always choose your own time.</Body></View></Card>
          <Button title="Find a real place" onPress={findPlaces} loading={busy} icon={<MapPin color={colors.white} size={18} />} />
        </> : <>
          <View style={styles.placeIntro}><MapPin color={colors.forest} size={17} /><Body style={{ flex: 1 }}>Real places near {city}, via OpenStreetMap contributors.</Body></View>
          {places.map((place) => (
            <Pressable key={place.id} onPress={() => setSelectedPlace(place)}>
              <Card style={[styles.placeCard, selectedPlace?.id === place.id && styles.placeSelected]}>
                <View style={styles.placeEmoji}><Text style={{ fontSize: 22 }}>{place.category?.includes("cafe") ? "☕" : "🌳"}</Text></View>
                <View style={{ flex: 1, gap: 4 }}><Text style={styles.placeName}>{place.name}</Text><Body style={{ fontSize: 12 }}>{place.address}</Body></View>
                {selectedPlace?.id === place.id ? <Check color={colors.forest} size={20} /> : <ChevronRight color={colors.muted} size={18} />}
              </Card>
            </Pressable>
          ))}
          <Button title="Check group availability" onPress={checkAvailability} loading={busy} secondary />
          {availabilityChecked && candidates.map((candidate) => <Pressable key={candidate.starts_at} onPress={() => setSlot(candidate)}>
            <Card style={[styles.availability, slot?.starts_at === candidate.starts_at && styles.placeSelected]}>
              <Text style={styles.label}>{slot?.starts_at === candidate.starts_at ? "Selected time" : "Suggested time"}</Text>
              <Text style={styles.slotText}>{new Date(candidate.starts_at).toLocaleString(undefined, { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</Text>
              <Body style={{ fontSize: 13 }}>{candidate.explanation}</Body>
            </Card>
          </Pressable>)}
          {availabilityChecked && !candidates.length && <Card style={styles.availability}><Text style={styles.label}>No group time was confirmed</Text><Body style={{ fontSize: 13 }}>You can choose a time and ask the group. Any connected-calendar conflict will be checked again before publishing.</Body></Card>}
          {availabilityChecked && <Field label="Or choose a local start time" value={manualTime} onChangeText={(value) => { setManualTime(value); setSlot(null); }} placeholder="11:00" />}
          <Body style={styles.attribution}>Places from OpenStreetMap contributors. Place details may be incomplete; verify before you go.</Body>
          <Button title="Generate hangout draft" onPress={findTimeAndPlan} loading={busy} disabled={!availabilityChecked} icon={<Sparkles color={colors.white} size={18} />} />
          <Button title="Change the details" onPress={() => setStep("details")} secondary />
        </>}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 17, paddingBottom: 30 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, height: 35 },
  backText: { fontWeight: "700", color: colors.ink, fontSize: 14 },
  title: { gap: 8, paddingBottom: 2 },
  formCard: { gap: 17, borderRadius: 23, padding: 17 },
  label: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  rowWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  privacyCard: { flexDirection: "row", gap: 12, backgroundColor: "#EDF1E8", borderColor: "#E1E9DD", alignItems: "flex-start" },
  privacyIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.white, alignItems: "center", justifyContent: "center" },
  privacyTitle: { color: colors.forest, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  placeIntro: { flexDirection: "row", gap: 8, alignItems: "center" },
  placeCard: { flexDirection: "row", alignItems: "center", gap: 12, padding: 13 },
  placeSelected: { borderColor: colors.forest, borderWidth: 1.5, backgroundColor: "#FAFCF8" },
  placeEmoji: { width: 45, height: 45, borderRadius: 15, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  placeName: { color: colors.ink, fontWeight: "800", fontSize: 14 },
  availability: { gap: 8, backgroundColor: "#F3F2E9" },
  slotText: { color: colors.forest, fontSize: 17, fontWeight: "800" },
  attribution: { fontSize: 11, lineHeight: 16 },
});
