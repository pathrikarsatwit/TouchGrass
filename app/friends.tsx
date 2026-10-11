import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { ArrowLeft, Check, Search, UserPlus, Users } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Field, Heading, Page, Tag } from "@/components/ui";
import {
  getFriends, getInvitations, inviteFriendToGroup, respondFriendRequest,
  respondGroupInvitation, searchFriends, sendFriendRequest,
  type Friendship, type SocialUser,
} from "@/lib/api";
import { useAppStore } from "@/lib/store";
import { colors } from "@/lib/theme";

type GroupInvitation = { id: string; group_id: string; group_name?: string; groups?: { name: string } };

export default function FriendsScreen() {
  const router = useRouter();
  const { groups, reload } = useAppStore();
  const [username, setUsername] = useState("");
  const [results, setResults] = useState<SocialUser[]>([]);
  const [friends, setFriends] = useState<SocialUser[]>([]);
  const [incoming, setIncoming] = useState<Friendship[]>([]);
  const [invitations, setInvitations] = useState<GroupInvitation[]>([]);
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);

  const refresh = useCallback(async () => {
    const [social, groupInvites] = await Promise.all([getFriends(), getInvitations()]);
    setFriends(social.friends);
    setIncoming(social.incoming);
    setInvitations(groupInvites.groups);
  }, []);

  useEffect(() => { refresh().catch((error: unknown) => Alert.alert("Couldn’t load friends", error instanceof Error ? error.message : "Try again.")); }, [refresh]);
  useEffect(() => { if (!groupId && groups[0]) setGroupId(groups[0].id); }, [groupId, groups]);

  async function search() {
    setSearching(true);
    try {
      const response = await searchFriends(username.trim().toLowerCase());
      setResults(response.users);
    } catch (error) {
      Alert.alert("Couldn’t find people", error instanceof Error ? error.message : "Try another username.");
    } finally {
      setSearching(false);
    }
  }

  async function addFriend(name: string) {
    setLoading(true);
    try {
      await sendFriendRequest(name);
      Alert.alert("Request sent", `Your request to @${name} is on its way.`);
      await refresh();
      setResults((current) => current.filter((person) => person.username !== name));
    } catch (error) {
      Alert.alert("Couldn’t send request", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function acceptFriend(request: Friendship, accept: boolean) {
    setLoading(true);
    try {
      await respondFriendRequest(request.id, accept);
      await refresh();
    } catch (error) {
      Alert.alert("Couldn’t update request", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function inviteToGroup(friend: SocialUser) {
    if (!groupId) return Alert.alert("Create a group first", "Start a group before sending an invitation.");
    setLoading(true);
    try {
      await inviteFriendToGroup(groupId, friend.id);
      Alert.alert("Invitation sent", `@${friend.username} can now join your group.`);
    } catch (error) {
      Alert.alert("Couldn’t invite friend", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function replyToGroupInvite(invite: GroupInvitation, accept: boolean) {
    setLoading(true);
    try {
      await respondGroupInvitation(invite.id, accept);
      await Promise.all([refresh(), reload()]);
    } catch (error) {
      Alert.alert("Couldn’t update invitation", error instanceof Error ? error.message : "Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable style={styles.back} onPress={() => router.back()}><ArrowLeft size={19} color={colors.ink} /><Text style={styles.backText}>Groups</Text></Pressable>
        <Eyebrow>BRING YOUR PEOPLE ALONG</Eyebrow>
        <Heading>Friends &{`\n`}invitations.</Heading>
        <Body>Find friends by their TouchGrass username. Your contacts stay on your device.</Body>
        {!!incoming.length && <View style={styles.section}>
          <Text style={styles.sectionTitle}>FRIEND REQUESTS</Text>
          {incoming.map((request) => <Card key={request.id} style={styles.request}>
            <View style={styles.personIcon}><UserPlus size={17} color={colors.forest} /></View>
            <View style={{ flex: 1 }}><Text style={styles.name}>New friend request</Text><Body style={{ fontSize: 12 }}>A TouchGrass user wants to connect.</Body></View>
            <Pressable onPress={() => acceptFriend(request, true)} disabled={loading} style={styles.accept}><Check size={17} color={colors.white} /></Pressable>
            <Pressable onPress={() => acceptFriend(request, false)} disabled={loading}><Text style={styles.decline}>Decline</Text></Pressable>
          </Card>)}
        </View>}

        {!!invitations.length && <View style={styles.section}>
          <Text style={styles.sectionTitle}>GROUP INVITATIONS</Text>
          {invitations.map((invite) => <Card key={invite.id} style={styles.request}>
            <View style={styles.personIcon}><Users size={17} color={colors.forest} /></View>
            <View style={{ flex: 1 }}><Text style={styles.name}>{invite.group_name ?? invite.groups?.name ?? "A private group"}</Text><Body style={{ fontSize: 12 }}>You’ve been invited to join.</Body></View>
            <Pressable onPress={() => replyToGroupInvite(invite, true)} disabled={loading} style={styles.accept}><Check size={17} color={colors.white} /></Pressable>
            <Pressable onPress={() => replyToGroupInvite(invite, false)} disabled={loading}><Text style={styles.decline}>Decline</Text></Pressable>
          </Card>)}
        </View>}

        <Card style={styles.searchCard}>
          <Text style={styles.name}>Find someone</Text>
          <Field label="TouchGrass username" value={username} onChangeText={setUsername} placeholder="e.g. trailfriend" />
          <Button title="Search by username" onPress={search} loading={searching} icon={<Search size={17} color={colors.white} />} />
        </Card>
        {results.map((person) => <Card key={person.id} style={styles.result}>
          <View style={styles.personIcon}><Text style={styles.initial}>{person.display_name?.[0]?.toUpperCase() ?? "🌱"}</Text></View>
          <View style={{ flex: 1 }}><Text style={styles.name}>{person.display_name}</Text><Body style={{ fontSize: 12 }}>@{person.username}</Body></View>
          <Pressable onPress={() => addFriend(person.username)} disabled={loading}><Tag active>＋ Add</Tag></Pressable>
        </Card>)}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>YOUR FRIENDS</Text>
          {friends.length ? friends.map((friend) => <Card key={friend.id} style={styles.result}>
            <View style={styles.personIcon}><Text style={styles.initial}>{friend.display_name?.[0]?.toUpperCase() ?? "🌿"}</Text></View>
            <View style={{ flex: 1 }}><Text style={styles.name}>{friend.display_name}</Text><Body style={{ fontSize: 12 }}>@{friend.username}</Body></View>
            <Pressable onPress={() => inviteToGroup(friend)} disabled={loading}><Tag>Invite</Tag></Pressable>
          </Card>) : <Card style={styles.empty}><Text style={{ fontSize: 22 }}>🫶</Text><Body>No friends here yet. Search a username to send a request.</Body></Card>}
        </View>

        {!!friends.length && groups.length > 0 && <View style={styles.section}>
          <Text style={styles.sectionTitle}>INVITE INTO A GROUP</Text>
          <View style={styles.groups}>{groups.map((group) => <Pressable key={group.id} onPress={() => setGroupId(group.id)}><Tag active={group.id === groupId}>{group.name}</Tag></Pressable>)}</View>
          <Body style={{ fontSize: 12 }}>Choose a group above, then tap Invite next to a friend.</Body>
        </View>}
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { gap: 15, paddingBottom: 28 },
  back: { flexDirection: "row", alignItems: "center", gap: 8, height: 34 },
  backText: { color: colors.ink, fontWeight: "700" },
  section: { gap: 9 },
  sectionTitle: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.1 },
  request: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  result: { flexDirection: "row", alignItems: "center", gap: 11, padding: 12 },
  searchCard: { gap: 12, marginTop: 4 },
  personIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.sage },
  initial: { color: colors.forest, fontSize: 16, fontWeight: "800" },
  name: { color: colors.ink, fontSize: 14, fontWeight: "800" },
  accept: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.forest },
  decline: { color: colors.red, fontWeight: "700", fontSize: 12, paddingHorizontal: 3 },
  empty: { gap: 8, alignItems: "center", padding: 18 },
  groups: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
});
