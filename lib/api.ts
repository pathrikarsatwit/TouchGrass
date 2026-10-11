import type { Place, Proposal, TimeSlot } from "@/lib/types";

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:8000";
let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function getMyProfile(): Promise<{ id: string; username: string; display_name: string }> {
  return request("/profiles/me");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (init?.headers) Object.assign(headers, init.headers);
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ detail: "The service could not complete that request." }));
    throw new Error(body.detail ?? `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export function getQuestPhotos(hangoutId: string, questIndex: number): Promise<{ photos: Array<{ url: string }> }> {
  return request(`/hangouts/${encodeURIComponent(hangoutId)}/quests/${questIndex}/photos`);
}

export function searchPlaces(city: string, query = "park"): Promise<{ places: Place[]; attribution: string }> {
  return request(`/places/search?city=${encodeURIComponent(city)}&q=${encodeURIComponent(query)}`);
}

export function getAvailability(groupId: string, date: string, durationMinutes: number): Promise<{ candidates: TimeSlot[]; availability_complete: boolean }> {
  return request("/availability/search", {
    method: "POST",
    body: JSON.stringify({ group_id: groupId, date, duration_minutes: durationMinutes, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
}

export function createPlan(input: {
  group_id: string;
  city: string;
  date: string;
  duration_minutes: number;
  mood: string;
  budget: string;
  place_id: string;
  starts_at: string;
  timezone: string;
}): Promise<Proposal> {
  return request("/hangouts/plan", { method: "POST", body: JSON.stringify(input) });
}

export function publishPlan(id: string, confirmConflict = false): Promise<Proposal> {
  return request(`/hangouts/${encodeURIComponent(id)}/publish`, {
    method: "POST", body: JSON.stringify({ confirm_conflict: confirmConflict }),
  });
}

export function updateRsvp(id: string, status: "going" | "maybe" | "declined"): Promise<{ status: string }> {
  return request(`/hangouts/${encodeURIComponent(id)}/rsvp`, { method: "POST", body: JSON.stringify({ status }) });
}

export function createGroup(name: string): Promise<{ id: string; name: string }> {
  return request("/groups", { method: "POST", body: JSON.stringify({ name }) });
}

export function getGroups(): Promise<{ groups: Array<{ id: string; name: string; member_count: number }> }> {
  return request("/groups");
}

export function getHangouts(): Promise<Proposal[]> {
  return request("/hangouts");
}

export function updateProfile(username: string, displayName: string) {
  return request<{ id: string; username: string; display_name: string }>("/profiles/me", {
    method: "PUT", body: JSON.stringify({ username, display_name: displayName }),
  });
}

export type SocialUser = { id: string; username: string; display_name: string };
export type Friendship = { id: string; requester_id: string; recipient_id: string; status: string; created_at?: string };

export function searchFriends(username: string): Promise<{ users: SocialUser[] }> {
  return request(`/friends/search?username=${encodeURIComponent(username)}`);
}

export function sendFriendRequest(username: string): Promise<Friendship> {
  return request("/friends/requests", { method: "POST", body: JSON.stringify({ username }) });
}

export function getFriends(): Promise<{ friends: SocialUser[]; incoming: Friendship[]; outgoing: Friendship[] }> {
  return request("/friends");
}

export function respondFriendRequest(id: string, accept: boolean) {
  return request(`/friends/requests/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
}

export function inviteFriendToGroup(groupId: string, userId: string) {
  return request(`/groups/${encodeURIComponent(groupId)}/invitations`, { method: "POST", body: JSON.stringify({ user_id: userId }) });
}

export function getInvitations(): Promise<{ groups: Array<{ id: string; group_id: string; group_name?: string; groups?: { name: string } }> }> {
  return request("/invitations");
}

export function respondGroupInvitation(id: string, accept: boolean) {
  return request(`/invitations/groups/${encodeURIComponent(id)}/respond`, { method: "POST", body: JSON.stringify({ accept }) });
}

export type CalendarConnection = { id: string; provider: "google" | "apple" | "android"; connection_status: string; last_sync_at?: string | null };

export function getCalendarConnections(): Promise<{ connections: CalendarConnection[] }> {
  return request("/calendar/connections");
}

export function getGoogleCalendarUrl(): Promise<{ authorization_url: string }> {
  return request("/calendar/google/start");
}

export function syncNativeCalendar(input: {
  provider: "apple" | "android";
  start_at: string;
  end_at: string;
  busy: Array<{ start: string; end: string }>;
}) {
  return request<{ status: string; expires_in_seconds: number }>("/calendar/native/sync", {
    method: "POST", body: JSON.stringify(input),
  });
}

export function disconnectCalendar(provider: CalendarConnection["provider"]) {
  return request(`/calendar/connections/${provider}`, { method: "DELETE" });
}

export function registerPushToken(token: string) {
  return request<void>("/notifications/register", { method: "POST", body: JSON.stringify({ token }) });
}

export type AppNotification = { id: string; hangout_id: string | null; type: string; sent_at: string; read_at: string | null };

export function getNotifications(): Promise<{ notifications: AppNotification[] }> {
  return request("/notifications");
}

export function markNotificationRead(id: string) {
  return request(`/notifications/${encodeURIComponent(id)}/read`, { method: "POST" });
}

export function completeQuest(hangoutId: string, questIndex: number, input: { completed: boolean; photo_path?: string | null }) {
  return request<{ completed: string[] }>(
    `/hangouts/${encodeURIComponent(hangoutId)}/quests/${questIndex}/complete`,
    { method: "POST", body: JSON.stringify(input) },
  );
}

export function getHangout(id: string): Promise<Proposal> {
  return request(`/hangouts/${encodeURIComponent(id)}`);
}

export function fallbackPlace(city: string): Place {
  return {
    id: "manual-place",
    name: `${city} meetup spot`,
    address: city,
    source: "user-entered",
    attribution: "Place entered by organizer",
  };
}
