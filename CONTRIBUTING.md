# Contributing

Thanks for helping people spend more time outside.

## Before opening a pull request

- Keep private calendar data out of clients, logs, analytics, database rows and language-model prompts. Unknown availability must never be interpreted as free.
- Use provider-backed facts for places and weather; label missing data instead of inventing it.
- Preserve organizer confirmation before publishing and enforce authorization in the backend/database, not just in the UI.
- Add focused tests for changed business logic. Do not add real credentials, user data, or generated database files.
- Run `npm run typecheck` and, in `server/`, `python -m pytest`.

## Development setup

See the root [README](README.md) for Expo, FastAPI, optional Ollama and Supabase setup. The local SQLite service is a demo implementation only; do not use it for real accounts or private information.

## Pull requests

Describe the user-facing behavior and security/privacy implications. List any manual iOS, Android, provider, migration or RLS tests that could not be automated.
