import type { PropsWithChildren, ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, spacing } from "@/lib/theme";

export function Page({ children }: PropsWithChildren) {
  return <View style={styles.page}>{children}</View>;
}

export function Eyebrow({ children }: PropsWithChildren) {
  return <Text style={styles.eyebrow}>{children}</Text>;
}

export function Heading({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <Text style={[styles.heading, style]}>{children}</Text>;
}

export function Body({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <Text style={[styles.body, style]}>{children}</Text>;
}

export function Card({ children, style }: PropsWithChildren<{ style?: object }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Button({ title, onPress, secondary = false, disabled = false, loading = false, icon }: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled || loading}
      style={({ pressed }) => [styles.button, secondary && styles.secondary, (disabled || loading) && styles.disabled, pressed && styles.pressed]}>
      {loading ? <ActivityIndicator color={secondary ? colors.forest : colors.white} /> : <>{icon}<Text style={[styles.buttonText, secondary && styles.secondaryText]}>{title}</Text></>}
    </Pressable>
  );
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, multiline = false }: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  multiline?: boolean;
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.muted}
        keyboardType={keyboardType} multiline={multiline} style={[styles.input, multiline && { minHeight: 84, textAlignVertical: "top" }]} />
    </View>
  );
}

export function Tag({ children, active = false }: PropsWithChildren<{ active?: boolean }>) {
  return <View style={[styles.tag, active && styles.activeTag]}><Text style={[styles.tagText, active && { color: colors.forest }]}>{children}</Text></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  eyebrow: { color: colors.forest, fontSize: 12, fontWeight: "800", letterSpacing: 1.4, textTransform: "uppercase" },
  heading: { color: colors.ink, fontSize: 27, lineHeight: 33, fontWeight: "800", letterSpacing: -0.7 },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: colors.white, borderRadius: 22, padding: spacing.md, borderWidth: 1, borderColor: colors.line },
  button: { minHeight: 54, backgroundColor: colors.forest, borderRadius: 16, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 9 },
  secondary: { backgroundColor: colors.sage },
  disabled: { opacity: 0.55 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.99 }] },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: "700" },
  secondaryText: { color: colors.forest },
  fieldWrap: { gap: 8 },
  label: { fontSize: 13, fontWeight: "700", color: colors.ink },
  input: { minHeight: 50, backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, color: colors.ink, fontSize: 15 },
  tag: { borderRadius: 20, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line },
  activeTag: { backgroundColor: colors.sage, borderColor: colors.sage },
  tagText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
});
