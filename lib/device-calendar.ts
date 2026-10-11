import * as Calendar from "expo-calendar";
import { Platform } from "react-native";
import { syncNativeCalendar } from "@/lib/api";

export type NativeProvider = "apple" | "android";

export function currentNativeProvider(): NativeProvider | null {
  if (Platform.OS === "ios") return "apple";
  if (Platform.OS === "android") return "android";
  return null;
}

export async function readAndSyncBusyTimes(startAt: Date, endAt: Date, provider: NativeProvider) {
  const permission = await Calendar.getCalendarPermissions(false);
  if (!permission.granted) return false;
  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  const events = calendars.length ? await Calendar.listEvents(calendars, startAt, endAt) : [];
  const startMs = startAt.getTime();
  const endMs = endAt.getTime();
  const busy = events
    .filter((event) => event.availability !== Calendar.Availability.FREE)
    .map((event) => {
      const eventStart = Math.max(new Date(event.startDate).getTime(), startMs);
      const eventEnd = Math.min(new Date(event.endDate).getTime(), endMs);
      return { start: new Date(eventStart).toISOString(), end: new Date(eventEnd).toISOString() };
    })
    .filter((event) => new Date(event.end).getTime() > new Date(event.start).getTime());
  await syncNativeCalendar({
    provider,
    start_at: startAt.toISOString(),
    end_at: endAt.toISOString(),
    busy,
  });
  return true;
}
