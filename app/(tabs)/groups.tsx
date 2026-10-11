import { useState } from "react";
import { Plus, Users, UserPlus } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Body, Button, Card, Eyebrow, Field, Heading, Page } from "@/components/ui";
import { createGroup } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { colors } from "@/lib/theme";

export default function GroupsScreen() {
  const router = useRouter();
  const { groups, addGroup } = useAppStore();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function makeGroup() {
    const cleanName = name.trim();
    if (!cleanName) return Alert.alert("Give the group a name", "You can change it later.");
    setLoading(true);
    try {
      const group = await createGroup(cleanName);
      addGroup(group.name, group.id);
      setName("");
      Alert.alert("Group created", `${cleanName} is ready for your crew.`);
    } catch (error) {
      Alert.alert("Couldn’t create the group", error instanceof Error ? error.message : "Try again when connected.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}><Eyebrow>GOOD THINGS ARE BETTER TOGETHER</Eyebrow><Heading>Your people.</Heading><Body>Bring your favorite humans along for the ride.</Body></View>
        <Pressable onPress={() => router.push("/friends")}><Card style={styles.friends}><View style={styles.createIcon}><UserPlus size={19} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>Find friends & manage invitations</Text><Body style={{ fontSize: 12 }}>Search usernames, invite friends, RSVP to group invites</Body></View></Card></Pressable>
        <Card style={styles.create}><View style={styles.createIcon}><Plus size={20} color={colors.forest} /></View><Text style={styles.cardTitle}>Start a new group</Text><Body style={{ fontSize: 13 }}>Make a little space for your next shared adventure.</Body><Field label="Group name" value={name} onChangeText={setName} placeholder="e.g. Weekend Wanderers" /><Button title="Create group" onPress={makeGroup} loading={loading} /></Card>
        <Heading style={styles.subhead}>Your groups</Heading>
        {groups.map((group) => <Card key={group.id} style={styles.group}><View style={styles.emoji}><Text style={{ fontSize: 23 }}>{group.avatar}</Text></View><View style={{ flex: 1 }}><Text style={styles.cardTitle}>{group.name}</Text><View style={styles.meta}><Users size={13} color={colors.muted} /><Body style={{ fontSize: 12 }}>{group.memberCount} {group.memberCount === 1 ? "member" : "members"}</Body></View></View></Card>)}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 16, paddingBottom: 25 },
  header: { gap: 9, paddingTop: 10, paddingBottom: 7 },
  create: { gap: 12, backgroundColor: "#F0F3EB" },
  friends: { flexDirection: "row", alignItems: "center", gap: 11 },
  createIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.sage, justifyContent: "center", alignItems: "center" },
  cardTitle: { color: colors.ink, fontSize: 15, fontWeight: "800" },
  subhead: { fontSize: 19, marginTop: 5 },
  group: { flexDirection: "row", alignItems: "center", gap: 12 },
  emoji: { width: 47, height: 47, backgroundColor: colors.sage, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  meta: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 4 },
});
