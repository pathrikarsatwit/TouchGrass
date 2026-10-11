import { useState } from "react";
import { useRouter } from "expo-router";
import { LockKeyhole } from "lucide-react-native";
import { Alert, ScrollView, StyleSheet, Text } from "react-native";
import { Body, Button, Card, Field, Heading, Page } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { colors } from "@/lib/theme";

export default function RecoverScreen() {
  const { client } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);

  async function updatePassword() {
    if (!client) return Alert.alert("Recovery unavailable", "Configure Supabase Auth to reset your password.");
    if (password.length < 8 || password !== confirm) return Alert.alert("Check your new password", "Use at least 8 characters and make sure both fields match.");
    setSaving(true);
    const { error } = await client.auth.updateUser({ password });
    setSaving(false);
    if (error) return Alert.alert("Couldn’t update password", error.message);
    Alert.alert("Password updated", "Your account is ready. Welcome back.", [{ text: "Continue", onPress: () => router.replace("/(tabs)") }]);
  }

  return (
    <Page>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.icon}>🔐</Text>
        <Heading>Make it a{`\n`}fresh start.</Heading>
        <Body>Choose a new password for your TouchGrass account.</Body>
        <Card style={styles.form}>
          <Field label="New password" value={password} onChangeText={setPassword} placeholder="At least 8 characters" />
          <Field label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Enter it once more" />
          <Button title="Update password" onPress={updatePassword} loading={saving} icon={<LockKeyhole size={17} color={colors.white} />} />
        </Card>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, justifyContent: "center", gap: 13 },
  icon: { fontSize: 35 },
  form: { gap: 15, marginTop: 8 },
});
