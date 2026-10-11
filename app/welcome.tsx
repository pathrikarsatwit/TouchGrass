import { useState } from "react";
import { useRouter } from "expo-router";
import { Leaf, LockKeyhole, Mail } from "lucide-react-native";
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Body, Button, Card, Field, Heading, Page } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

export default function WelcomeScreen() {
  const router = useRouter();
  const { client, configured } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function authenticate() {
    if (!client) return Alert.alert("Sign-in unavailable", "Configure Supabase Auth or use the local demo.");
    if (!email.includes("@") || password.length < 8) return Alert.alert("Check your details", "Enter a valid email and a password of at least 8 characters.");
    setLoading(true);
    const result = mode === "signup"
      ? await client.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: "touchgrass://welcome" },
        })
      : await client.auth.signInWithPassword({ email: email.trim(), password });
    setLoading(false);
    if (result.error) return Alert.alert("Couldn’t sign in", result.error.message);
    if (mode === "signup" && !result.data.session) {
      Alert.alert("Check your inbox", "Confirm your email to finish creating your account.");
      setMode("signin");
    } else {
      router.replace("/(tabs)");
    }
  }

  return (
    <Page>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.mark}><Leaf size={30} color="#F4EEDC" /></View>
          <Text style={styles.brand}>touchgrass</Text><Text style={styles.tagline}>LESS SCROLLING. MORE LIVING.</Text>
          <Heading style={styles.title}>Real life is{`\n`}calling.</Heading>
          <Body>Make plans with your people and find a little more outside.</Body>
          {configured ? <Card style={styles.form}>
            <View style={styles.switch}><Pressable onPress={() => setMode("signup")} style={[styles.switchItem, mode === "signup" && styles.active]}><Text style={[styles.switchText, mode === "signup" && styles.selected]}>Sign up</Text></Pressable><Pressable onPress={() => setMode("signin")} style={[styles.switchItem, mode === "signin" && styles.active]}><Text style={[styles.switchText, mode === "signin" && styles.selected]}>Sign in</Text></Pressable></View>
            <Field label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" />
            <Field label="Password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
            <Button title={mode === "signup" ? "Create my account" : "Welcome back"} onPress={authenticate} loading={loading} icon={mode === "signup" ? <Mail color={colors.white} size={17} /> : <LockKeyhole color={colors.white} size={17} />} />
            {mode === "signin" && <Text style={styles.forgot} onPress={async () => {
              if (!client || !email.includes("@")) return Alert.alert("Enter your email", "Add your account email above, then request a reset link.");
              const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: "touchgrass://recover" });
              if (error) Alert.alert("Couldn’t send reset link", error.message);
              else Alert.alert("Check your email", "If an account exists, a password reset link is on its way.");
            }}>Forgot your password?</Text>}
          </Card> : <Card style={styles.demo}>
            <Text style={styles.demoTitle}>Try the local demo</Text><Body style={{ fontSize: 13 }}>Demo mode uses local sample identity. No account or calendar is connected.</Body>
            <Button title="Explore the demo" onPress={() => router.replace("/(tabs)")} />
          </Card>}
          {!configured && <Text style={styles.configure}>Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to enable account sign-up.</Text>}
          <Text style={styles.privacy}>Your plans belong to you. We never show friends your calendar or private schedule.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", gap: 11, paddingVertical: 28 },
  mark: { width: 56, height: 56, backgroundColor: colors.forest, borderRadius: 20, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  brand: { color: colors.forest, fontSize: 21, fontWeight: "900", letterSpacing: -0.8 },
  tagline: { color: colors.muted, fontSize: 9, fontWeight: "800", letterSpacing: 1.1 },
  title: { fontSize: 38, lineHeight: 42, marginTop: 21 },
  form: { gap: 15, marginTop: 17, padding: 16 },
  switch: { flexDirection: "row", backgroundColor: colors.paper, borderRadius: 13, padding: 4 },
  switchItem: { flex: 1, padding: 9, alignItems: "center", borderRadius: 10 },
  active: { backgroundColor: colors.white },
  switchText: { fontWeight: "700", color: colors.muted, fontSize: 13 },
  selected: { color: colors.forest },
  demo: { gap: 13, marginTop: 17 },
  demoTitle: { color: colors.ink, fontWeight: "800", fontSize: 16 },
  configure: { color: colors.muted, fontSize: 11, textAlign: "center", marginTop: 3 },
  forgot: { color: colors.forest, fontSize: 13, fontWeight: "700", textAlign: "center" },
  privacy: { color: colors.muted, fontSize: 12, textAlign: "center", lineHeight: 17, marginTop: 13 },
});
