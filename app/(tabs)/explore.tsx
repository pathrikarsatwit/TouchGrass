import { useState } from "react";
import { Search, TreePine } from "lucide-react-native";
import { Alert, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Field, Heading, Page } from "@/components/ui";
import { searchPlaces } from "@/lib/api";
import type { Place } from "@/lib/types";
import { colors } from "@/lib/theme";

export default function ExploreScreen() {
  const [city, setCity] = useState("Boston, MA");
  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);

  async function search() {
    setLoading(true);
    try {
      const result = await searchPlaces(city, "park");
      setPlaces(result.places);
    } catch (error) {
      Alert.alert("Couldn’t explore just now", error instanceof Error ? error.message : "Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}><Eyebrow>FIND YOUR OUTSIDE</Eyebrow><Heading>Good places,{`\n`}close to home.</Heading><Body>Real parks and public places for your next little adventure.</Body></View>
        <Field label="Explore a city" value={city} onChangeText={setCity} placeholder="Your city" />
        <Button title="Find places" onPress={search} loading={loading} icon={<Search size={18} color={colors.white} />} />
        {places.map((place) => <Card key={place.id} style={styles.place}>
          <View style={styles.icon}><TreePine size={22} color={colors.forest} /></View>
          <View style={{ flex: 1, gap: 4 }}><Text style={styles.name}>{place.name}</Text><Body style={{ fontSize: 12 }}>{place.address}</Body><Text style={styles.source}>{place.attribution}</Text></View>
        </Card>)}
        {!places.length && <Card style={styles.empty}><Text style={{ fontSize: 27 }}>🧭</Text><Text style={styles.name}>A little exploring goes a long way</Text><Body>Search a city to find real parks from OpenStreetMap.</Body></Card>}
        <Text style={styles.note}>Map and place data © OpenStreetMap contributors. Verify local conditions before visiting.</Text>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 15, paddingBottom: 24 },
  header: { gap: 9, paddingTop: 10, paddingBottom: 5 },
  place: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  icon: { width: 44, height: 44, borderRadius: 14, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  name: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  source: { color: colors.muted, fontSize: 10, marginTop: 3 },
  empty: { alignItems: "center", gap: 10, paddingVertical: 28, marginTop: 8 },
  note: { color: colors.muted, fontSize: 10, lineHeight: 15 },
});
