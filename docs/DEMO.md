# Feature status and demo walkthrough

## End-to-end local demo

1. Start the local API with `DEV_MODE=true`, then start Expo as described in the README.
2. Continue as the local demo user, open **Groups**, and create a group.
3. Tap **Plan a hangout**, keep the default Boston city or choose another city, select a date within the next 90 days, pick a mood/budget, and search.
4. Select an OpenStreetMap result, then check group availability. Disconnected or unavailable calendars remain unknown; suggestions are not represented as confirmed availability. You can choose a local time manually.
5. Review the verified destination, itinerary, optional quests, bring list and forecast status. Rename the outing if you like.
6. Tap **Confirm & publish**. The API refreshes connected calendars and blocks a detected conflict unless the organizer explicitly confirms the override. The published plan appears on Home.
7. Use **Explore** for more real parks. When Ollama is unavailable, the saved draft is marked as a built-in plan rather than an AI-generated itinerary.

Places and weather require network access. SQLite demo plans persist across API restarts but are local to that machine. Supabase mode is enabled by backend `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; it requires the supplied migration. Calendar, push, and photo flows also require their provider configuration, and native calendar access requires a development build. These provider integrations have not been tested against live credentials.

## Status

| Area | Implemented | Not yet implemented / limitation |
| --- | --- | --- |
| Mobile app | Expo Router iOS/Android screens, accessible shared components, Home/Explore/Groups/Profile tabs, group creation, plan and review flows | Dark-theme switching, complete accessibility settings, native map, full onboarding/preferences |
| Auth | Supabase sign-up, sign-in, password-reset request, SecureStore session persistence, sign-out | Verified end-to-end project and production configuration |
| Group and hangout API | SQLite demo or Supabase REST persistence; organizer/member checks; draft, explicit publish, RSVP, quest completion | Production hardening and multi-user deployment validation |
| Places/weather | Live Nominatim search and place revalidation, Open-Meteo forecast when available | Directions, map display, venue opening data and production-scale provider |
| AI | Provider-independent Ollama adapter, optional Qwen3, constrained JSON and deterministic fallback | Agent/tool orchestration, automated model serving, AI-assisted preference learning |
| Calendar privacy | Google free/busy OAuth, native device busy-time sync, unknown-by-default suggestions, conflict refresh before publish, encrypted tokens | Live OAuth/provider validation; multi-instance storage for native intervals |
| Quests/media | Quest completion UI, private Supabase Storage uploads, member-authorized signed links | Live storage policy validation, memories/badges |
| Delivery | Expo push registration and notification inbox; backend push delivery; Supabase schema and REST persistence | EAS/APNs/FCM credentials, live push validation, production secret management and hardening |

Do not represent a mocked/unavailable integration as live.
