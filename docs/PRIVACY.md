# Privacy, security, and safety notes

## Implemented in this MVP

- Supabase access tokens are kept in Expo SecureStore on mobile; the API verifies a bearer token against Supabase Auth when demo mode is disabled.
- Local-only demo mode is opt-in (`DEV_MODE=true`) and is not an authentication system. Its SQLite database and seeded account are for a developer-owned machine only.
- API group reads and writes check authenticated membership/organizer access in both repositories. Supabase persistence uses a server-only service-role key, which bypasses RLS; the backend authorization code, not RLS, protects API operations. Direct mobile access remains governed by the migration's RLS policies.
- Place records are looked up again by provider ID before proposal creation. The model cannot choose a place, route, price, weather, or opening hours.
- Availability responses contain generic time suggestions and a group-level completeness flag; the endpoint never accepts or returns user busy intervals. Three availability requests per user per hour are allowed.
- Google access requests free/busy only. Encrypted refresh tokens are stored by the backend; Google intervals are processed for scheduling but not returned to clients. Native event names, notes, locations, and attendees are not sent; busy intervals are cached in backend process memory for up to 15 minutes.
- Quest photos use a private Supabase Storage bucket with member-only signed reads. Photo sharing is optional, requires explicit selection, and is not sent to Ollama.

## Supabase database controls

The migration enables RLS on user-facing tables, denies client access to encrypted provider tokens and OAuth replay nonces, creates a private media bucket, and restricts groups, hangouts and quest data to members. Group creation automatically adds its creator. Group invites require an accepted friendship and organizer authorization; the API additionally checks authorization before privileged operations. The service-role key bypasses RLS and must stay in a trusted backend environment.

Apply and test the migration in a disposable Supabase project. Test both positive and negative access as multiple users, including API authorization; do not grant `service_role` to the mobile app or assume service-role requests are covered by RLS.

Calendar connections use owner authorization, minimum Google free/busy scope, encrypted server-only credentials, disconnect/revoke support, and the Availability Service. Native intervals are stored in process memory for at most 15 minutes; this is not a multi-instance cache. Unknown provider state must remain unknown. Before horizontally scaling, replace the native cache with a shared short-lived store that preserves this privacy boundary.

## Data deletion and export

This demo stores groups, proposals, RSVPs and quest completion in the local SQLite file. Deleting the ignored demo database removes that local data; there is no in-app export or deletion action yet. Never use this demo database for real user information.

For a Supabase deployment, implement an authenticated export and deletion workflow before launch. Deletion must revoke calendar grants and OAuth tokens, remove private media and storage objects, delete or anonymize authored records according to retention policy, and finally delete the Auth user. Groups and authored hangouts have foreign-key dependencies; transfer ownership or delete/cancel dependent records before deleting the account. Test cascading deletes in a non-production project first.

## External data and location

City/place search is sent to the OpenStreetMap Nominatim service from the backend, and coordinate forecasts are requested from Open-Meteo. Neither service is treated as authoritative for safety, access, opening hours, or accessibility. Review their privacy terms and provider policies before deployment. Current location, contacts, calendar, and photos are not requested.

## Reporting a vulnerability

Do not post credentials, private calendar data, or exploitable details in a public issue. Contact the repository maintainers privately and include the affected version and a minimal reproducible report.
