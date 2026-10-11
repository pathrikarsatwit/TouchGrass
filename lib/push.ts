import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "@/lib/api";

export async function enablePushNotifications() {
  if (Platform.OS === "web") throw new Error("Push notifications are supported in the iOS and Android apps.");
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId) throw new Error("Set EXPO_PUBLIC_EAS_PROJECT_ID after creating an EAS project to enable push notifications.");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("hangouts", {
      name: "Hangout invitations",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200, 100, 200],
      lightColor: "#214D3A",
    });
  }
  const existing = await Notifications.getPermissionsAsync();
  const permission = existing.granted ? existing : await Notifications.requestPermissionsAsync();
  if (!permission.granted) throw new Error("Notification permission was not granted. You can allow it later in system settings.");
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPushToken(token.data);
}
