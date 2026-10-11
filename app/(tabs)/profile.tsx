import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { CalendarDays, Heart, LogOut, Settings2, ShieldCheck, ChevronRight } from "lucide-react-native";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Eyebrow, Field, Heading, Page } from "@/components/ui";
import { getMyProfile, updateProfile } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";
import { enablePushNotifications } from "@/lib/push";

export default function ProfileScreen() {
  const { client, session, signOut } = useAuth();
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMyProfile().then((profile) => {
      setUsername(profile.username);
      setDisplayName(profile.display_name);
    }).catch((error: unknown) => {
      console.warn("Could not load profile:", error instanceof Error ? error.message : "Unknown API error");
    });
  }, [session?.user.id]);

  async function saveProfile() {
    setSaving(true);
    try {
      const profile = await updateProfile(username.trim().toLowerCase(), displayName.trim());
      setUsername(profile.username);
      setDisplayName(profile.display_name);
      Alert.alert("Profile saved", "Friends can find you by your username.");
    } catch (error) {
      Alert.alert("Couldn’t save profile", error instanceof Error ? error.message : "Check your username and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSignOut() {
    try {
      await signOut();
      router.replace("/welcome");
    } catch (error) {
      Alert.alert("Couldn’t sign out", error instanceof Error ? error.message : "Try again.");
    }
  }

  async function requestNotifications() {
    try {
      await enablePushNotifications();
      Alert.alert("Notifications enabled", "You’ll receive friend requests and hangout invitations.");
    } catch (error) {
      Alert.alert("Couldn’t enable notifications", error instanceof Error ? error.message : "Try again.");
    }
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}><Eyebrow>A LITTLE ABOUT YOU</Eyebrow><Heading>Your profile.</Heading></View>
        <Card style={styles.profile}>
          <View style={styles.avatar}><Text style={styles.initial}>{session?.user.email?.[0]?.toUpperCase() ?? "S"}</Text></View>
          <View><Text style={styles.name}>{displayName || session?.user.email || "Demo profile"}</Text><Body style={{ fontSize: 13 }}>{username ? `@${username}` : "Choose a username to find friends"}</Body></View>
        </Card>
        <Card style={styles.editProfile}>
          <Field label="Display name" value={displayName} onChangeText={setDisplayName} placeholder="What friends call you" />
          <Field label="Username" value={username} onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="3–24 lowercase letters, numbers or _" />
          <Button title="Save profile" onPress={saveProfile} loading={saving} />
        </Card>
        <View style={styles.callout}>
          <ShieldCheck size={20} color={colors.forest} />
          <View style={{ flex: 1 }}><Text style={styles.calloutTitle}>Private by nature</Text><Body style={{ fontSize: 13 }}>Friends never see your calendar or why a time doesn’t work. Availability stays unknown until you choose to connect.</Body></View>
        </View>
        <Text style={styles.heading}>SETTINGS</Text>
        <SettingsRow icon={CalendarDays} title="Calendar connections" detail="Connect or disconnect availability" onPress={() => router.push("/calendar")} />
        <SettingsRow icon={Heart} title="Friends & invitations" detail="Find friends and answer group invites" onPress={() => router.push("/friends")} />
        <SettingsRow icon={Settings2} title="Notification inbox" detail="Friend requests and hangout updates" onPress={() => router.push("/notifications")} />
        <Card style={styles.item}><View style={styles.icon}><ShieldCheck size={19} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={styles.title}>Privacy & safety</Text><Body style={{ fontSize: 12 }}>Your calendar stays yours</Body></View></Card>
        <Card style={styles.item}><View style={styles.icon}><Settings2 size={19} color={colors.forest} /></View><View style={{ flex: 1 }}><Text style={styles.title}>About TouchGrass</Text><Body style={{ fontSize: 12 }}>Open-source · model & data info in README</Body></View></Card>
        <Button title="Enable push notifications" onPress={requestNotifications} secondary />
        {client && <Button title="Sign out" onPress={handleSignOut} secondary icon={<LogOut size={17} color={colors.forest} />} />}
        <Body style={styles.note}>{client ? "Contacts are never uploaded. Calendar, notifications and photos are requested only when you use those features." : "Local demo data stays on this development server. Configure Supabase Auth to use features with other accounts."}</Body>
      </ScrollView>
    </Page>
  );
}

function SettingsRow({ icon: Icon, title, detail, onPress }: {
  icon: typeof CalendarDays;
  title: string;
  detail: string;
  onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" onPress={onPress}><Card style={styles.item}>
    <View style={styles.icon}><Icon size={19} color={colors.forest} /></View>
    <View style={{ flex: 1 }}><Text style={styles.title}>{title}</Text><Body style={{ fontSize: 12 }}>{detail}</Body></View>
    <ChevronRight size={18} color={colors.muted} />
  </Card></Pressable>;
}

const styles = StyleSheet.create({
  content: { gap: 15, paddingBottom: 25 },
  header: { gap: 9, paddingTop: 10, paddingBottom: 5 },
  profile: { flexDirection: "row", alignItems: "center", gap: 14 },
  editProfile: { gap: 13 },
  avatar: { width: 58, height: 58, borderRadius: 21, backgroundColor: "#EAD9BE", alignItems: "center", justifyContent: "center" },
  initial: { fontSize: 22, fontWeight: "800", color: colors.forest },
  name: { color: colors.ink, fontSize: 17, fontWeight: "800", marginBottom: 4 },
  callout: { flexDirection: "row", gap: 11, alignItems: "flex-start", backgroundColor: "#EAF0E6", borderRadius: 18, padding: 15 },
  calloutTitle: { color: colors.forest, fontSize: 14, fontWeight: "800", marginBottom: 4 },
  heading: { color: colors.muted, fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginTop: 5 },
  item: { flexDirection: "row", alignItems: "center", gap: 11, padding: 13 },
  icon: { width: 39, height: 39, borderRadius: 13, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  title: { color: colors.ink, fontSize: 14, fontWeight: "800", marginBottom: 3 },
  note: { fontSize: 11, textAlign: "center", lineHeight: 16, marginTop: 5 },
});
