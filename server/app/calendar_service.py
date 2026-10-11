import base64
import hashlib
import hmac
import json
import logging
import secrets
import time
from datetime import date, datetime, time as day_time, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException

from . import db
from .config import (
    APP_DEEP_LINK,
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
    GOOGLE_OAUTH_STATE_SECRET,
    GOOGLE_REDIRECT_URI,
    TOKEN_ENCRYPTION_KEY,
)

logger = logging.getLogger(__name__)
GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke"
GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy"
STATE_LIFETIME_SECONDS = 600
NATIVE_CACHE_LIFETIME = timedelta(minutes=15)
native_busy_windows: dict[str, tuple[datetime, datetime, list[tuple[datetime, datetime]], datetime]] = {}


def google_is_configured() -> bool:
    return all((GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_OAUTH_STATE_SECRET, TOKEN_ENCRYPTION_KEY))


def _fernet() -> Fernet:
    if not TOKEN_ENCRYPTION_KEY:
        raise HTTPException(status_code=503, detail="Calendar token encryption is not configured.")
    try:
        return Fernet(TOKEN_ENCRYPTION_KEY.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as exc:
        raise HTTPException(status_code=503, detail="Calendar token encryption key is invalid.") from exc


def _create_state(user_id: str) -> str:
    if not GOOGLE_OAUTH_STATE_SECRET:
        raise HTTPException(status_code=503, detail="Google Calendar OAuth is not configured.")
    payload = {
        "sub": user_id,
        "exp": int(time.time()) + STATE_LIFETIME_SECONDS,
        "nonce": secrets.token_urlsafe(24),
    }
    encoded = base64.urlsafe_b64encode(json.dumps(payload, separators=(",", ":")).encode()).decode().rstrip("=")
    signature = hmac.new(GOOGLE_OAUTH_STATE_SECRET.encode(), encoded.encode(), hashlib.sha256).digest()
    return f"{encoded}.{base64.urlsafe_b64encode(signature).decode().rstrip('=')}"


def _consume_state(state: str) -> str:
    if not GOOGLE_OAUTH_STATE_SECRET:
        raise HTTPException(status_code=503, detail="Google Calendar OAuth is not configured.")
    try:
        encoded, provided_signature = state.split(".", 1)
        expected = hmac.new(GOOGLE_OAUTH_STATE_SECRET.encode(), encoded.encode(), hashlib.sha256).digest()
        signature = base64.urlsafe_b64decode(provided_signature + "=" * (-len(provided_signature) % 4))
        if not hmac.compare_digest(expected, signature):
            raise ValueError("Invalid signature.")
        payload = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
        expires_at = datetime.fromtimestamp(int(payload["exp"]), timezone.utc)
        if int(payload["exp"]) < int(time.time()):
            raise ValueError("Expired OAuth state.")
        if not db.consume_oauth_nonce(payload["nonce"], expires_at):
            raise ValueError("OAuth state already used.")
        if not payload["sub"]:
            raise ValueError("Missing account.")
        return payload["sub"]
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="This calendar connection link is invalid or expired. Start again in the app.") from exc


def authorization_url(user_id: str) -> str:
    if not google_is_configured():
        raise HTTPException(status_code=503, detail="Google Calendar is not configured yet. Set the backend OAuth and encryption values.")
    params = {
        "client_id": GOOGLE_CLIENT_ID,
        "redirect_uri": GOOGLE_REDIRECT_URI,
        "response_type": "code",
        "scope": GOOGLE_FREEBUSY_SCOPE,
        "access_type": "offline",
        "prompt": "consent",
        "include_granted_scopes": "true",
        "state": _create_state(user_id),
    }
    return f"{GOOGLE_AUTH_URL}?{urlencode(params)}"


async def complete_google_oauth(code: str, state: str) -> str:
    user_id = _consume_state(state)
    if not google_is_configured():
        raise HTTPException(status_code=503, detail="Google Calendar is not configured.")
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(GOOGLE_TOKEN_URL, data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            })
        if response.is_error:
            logger.warning("Google token exchange failed with HTTP %s", response.status_code)
            raise HTTPException(status_code=400, detail="Google did not complete calendar authorization. Please try again.")
        token = response.json()
        refresh_token = token.get("refresh_token")
        if not refresh_token:
            existing = db.get_google_credentials(user_id)
            if not existing:
                raise HTTPException(status_code=400, detail="Google did not return a refresh token. Disconnect the app in Google Account settings and try connecting again.")
            connection_id, encrypted = existing
            _fernet().decrypt(encrypted.encode())
            db.update_calendar_sync(connection_id, "connected")
            return user_id
        encrypted = _fernet().encrypt(refresh_token.encode()).decode()
        db.save_google_credentials(user_id, encrypted)
        return user_id
    except httpx.HTTPError as exc:
        logger.warning("Google token endpoint unavailable (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Google Calendar is temporarily unavailable.") from exc


async def _refresh_access_token(refresh_token: str) -> str:
    async with httpx.AsyncClient(timeout=12) as client:
        response = await client.post(GOOGLE_TOKEN_URL, data={
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        })
    if response.status_code in (400, 401):
        raise HTTPException(status_code=401, detail="Google Calendar permission expired. Reconnect your calendar.")
    if response.is_error:
        raise HTTPException(status_code=502, detail="Google Calendar could not be refreshed right now.")
    token = response.json().get("access_token")
    if not token:
        raise HTTPException(status_code=502, detail="Google did not return an access token.")
    return token


async def google_busy_intervals(user_id: str, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    credentials = db.get_google_credentials(user_id)
    if not credentials:
        raise HTTPException(status_code=404, detail="No connected Google Calendar.")
    connection_id, encrypted_refresh_token = credentials
    try:
        refresh_token = _fernet().decrypt(encrypted_refresh_token.encode()).decode()
    except InvalidToken as exc:
        db.update_calendar_sync(connection_id, "error")
        raise HTTPException(status_code=503, detail="Stored Google Calendar credentials could not be decrypted. Disconnect and reconnect.") from exc
    try:
        access_token = await _refresh_access_token(refresh_token)
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.post(
                GOOGLE_FREEBUSY_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                json={"timeMin": start.isoformat(), "timeMax": end.isoformat(), "items": [{"id": "primary"}]},
            )
        if response.status_code in (401, 403):
            db.update_calendar_sync(connection_id, "error")
            raise HTTPException(status_code=403, detail="Google Calendar access was revoked or denied. Reconnect your calendar.")
        if response.is_error:
            db.update_calendar_sync(connection_id, "error")
            raise HTTPException(status_code=502, detail="Google Calendar availability could not be read right now.")
        data = response.json().get("calendars", {}).get("primary", {})
        if data.get("errors"):
            db.update_calendar_sync(connection_id, "error")
            raise HTTPException(status_code=403, detail="Google Calendar access needs attention. Reconnect your calendar.")
        result = []
        for item in data.get("busy", []):
            interval_start = datetime.fromisoformat(item["start"].replace("Z", "+00:00"))
            interval_end = datetime.fromisoformat(item["end"].replace("Z", "+00:00"))
            if interval_start.tzinfo and interval_end.tzinfo and interval_start < interval_end:
                result.append((interval_start.astimezone(timezone.utc), interval_end.astimezone(timezone.utc)))
        db.update_calendar_sync(connection_id)
        return result
    except httpx.HTTPError as exc:
        db.update_calendar_sync(connection_id, "error")
        logger.warning("Google Calendar free/busy request failed (%s)", type(exc).__name__)
        raise HTTPException(status_code=502, detail="Google Calendar availability is temporarily unavailable.") from exc
    except HTTPException as exc:
        if exc.status_code in (401, 403):
            db.update_calendar_sync(connection_id, "error")
        raise


async def disconnect_google(user_id: str) -> None:
    credentials = db.get_google_credentials(user_id)
    if credentials:
        try:
            refresh_token = _fernet().decrypt(credentials[1].encode()).decode()
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(GOOGLE_REVOKE_URL, data={"token": refresh_token})
        except (httpx.HTTPError, InvalidToken):
            logger.warning("Google revocation could not be confirmed; local calendar credentials will still be removed.")
    db.disconnect_google_calendar(user_id)
    native_busy_windows.pop(user_id, None)


def cache_native_busy(
    user_id: str,
    start: datetime,
    end: datetime,
    busy_intervals: list[tuple[datetime, datetime]],
) -> None:
    now = datetime.now(timezone.utc)
    lower = start.astimezone(timezone.utc)
    upper = end.astimezone(timezone.utc)
    if upper <= lower or upper - lower > timedelta(days=31):
        raise HTTPException(status_code=422, detail="Calendar sync must cover a future window of at most 31 days.")
    if lower < now - timedelta(minutes=5) or upper > now + timedelta(days=32):
        raise HTTPException(status_code=422, detail="Calendar sync window must be current or in the next 31 days.")
    if len(busy_intervals) > 1000:
        raise HTTPException(status_code=422, detail="Too many busy periods were returned by the device calendar.")
    normalized = []
    for busy_start, busy_end in busy_intervals:
        start_utc = busy_start.astimezone(timezone.utc)
        end_utc = busy_end.astimezone(timezone.utc)
        if end_utc <= start_utc or start_utc < lower or end_utc > upper:
            raise HTTPException(status_code=422, detail="A calendar interval was outside the requested date range.")
        normalized.append((start_utc, end_utc))
    native_busy_windows[user_id] = (lower, upper, normalized, now)


def clear_native_busy(user_id: str) -> None:
    native_busy_windows.pop(user_id, None)


def prune_expired_native_busy() -> None:
    cutoff = datetime.now(timezone.utc) - NATIVE_CACHE_LIFETIME
    expired = [user_id for user_id, entry in native_busy_windows.items() if entry[3] < cutoff]
    for user_id in expired:
        native_busy_windows.pop(user_id, None)


def _native_busy(user_id: str, start: datetime, end: datetime) -> list[tuple[datetime, datetime]] | None:
    cached = native_busy_windows.get(user_id)
    if not cached:
        return None
    cached_start, cached_end, intervals, synced_at = cached
    now = datetime.now(timezone.utc)
    if now - synced_at > NATIVE_CACHE_LIFETIME or cached_start > start or cached_end < end:
        native_busy_windows.pop(user_id, None)
        return None
    return [(max(busy_start, start), min(busy_end, end)) for busy_start, busy_end in intervals
            if busy_start < end and busy_end > start]


async def verify_group_interval(
    group_id: str,
    start: datetime,
    end: datetime,
    connections: dict[str, list[dict]] | None = None,
) -> tuple[bool, bool]:
    """Refresh connected providers for publish; return only aggregate complete/conflict flags."""
    members = db.group_member_ids(group_id)
    connections = connections or db.group_calendar_connections(group_id)
    complete = bool(members)
    conflict = False
    start_utc = start.astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    for member in members:
        providers = connections.get(member, [])
        google_connected = any(row["provider"] == "google" for row in providers)
        native_connected = any(row["provider"] in ("apple", "android") for row in providers)
        member_known = False
        if google_connected:
            try:
                busy = await google_busy_intervals(member, start_utc, end_utc)
                member_known = True
                conflict = conflict or any(busy_start < end_utc and busy_end > start_utc for busy_start, busy_end in busy)
            except HTTPException:
                pass
        if native_connected:
            native_busy = _native_busy(member, start_utc, end_utc)
            if native_busy is None:
                complete = False
            else:
                member_known = True
                conflict = conflict or any(busy_start < end_utc and busy_end > start_utc for busy_start, busy_end in native_busy)
        if not member_known:
            complete = False
    return complete, conflict


def suggested_slots(
    day: date,
    duration_minutes: int,
    timezone_name: str,
    members: list[str],
    connections: dict[str, list[dict]],
    google_busy: dict[str, list[tuple[datetime, datetime]]],
) -> tuple[list[dict], bool]:
    zone = ZoneInfo(timezone_name)
    day_start = datetime.combine(day, day_time(9), tzinfo=zone)
    day_end = datetime.combine(day, day_time(21), tzinfo=zone)
    candidate_start = day_start.astimezone(timezone.utc)
    candidate_end = day_end.astimezone(timezone.utc)
    per_member_busy: list[list[tuple[datetime, datetime]]] = []
    all_complete = bool(members)
    for member in members:
        providers = connections.get(member, [])
        has_google = any(provider["provider"] == "google" for provider in providers) and member in google_busy
        has_native_permission = any(provider["provider"] in ("apple", "android") for provider in providers)
        native = _native_busy(member, candidate_start, candidate_end) if has_native_permission else None
        if has_native_permission and native is None:
            all_complete = False
        if not has_google and native is None:
            all_complete = False
        intervals = []
        if has_google:
            intervals.extend(google_busy[member])
        if native is not None:
            intervals.extend(native)
        per_member_busy.append(intervals)

    if not all_complete:
        # Connected calendars can filter proposals, but unknown members are never treated as free.
        available_members = [
            intervals for member, intervals in zip(members, per_member_busy)
            if intervals or any(item["provider"] == "google" and member in google_busy
                                or item["provider"] in ("apple", "android") and _native_busy(member, candidate_start, candidate_end) is not None
                                for item in connections.get(member, []))
        ]
    else:
        available_members = per_member_busy
    if not available_members:
        # No calendar is connected: show clearly unconfirmed times, never confirmed availability.
        candidates = [
            datetime.combine(day, day_time(hour), tzinfo=zone)
            for hour in (10, 14, 17)
        ]
        return ([{
            "starts_at": start.isoformat(),
            "ends_at": (start + timedelta(minutes=duration_minutes)).isoformat(),
            "timezone": timezone_name,
            "availability_complete": False,
            "explanation": "A suggested time to ask the group; no private calendar details are shared.",
        } for start in candidates], False)

    from .availability import common_free_windows

    windows = common_free_windows(available_members, candidate_start, candidate_end)
    step = timedelta(minutes=30)
    duration = timedelta(minutes=duration_minutes)
    options = []
    for window_start, window_end in windows:
        start = window_start.replace(minute=(window_start.minute // 30) * 30, second=0, microsecond=0)
        while start + duration <= window_end:
            local = start.astimezone(zone)
            if 10 <= local.hour <= 18:
                options.append(start)
            start += step
            if len(options) >= 20:
                break
        if len(options) >= 20:
            break
    options = sorted(set(options), key=lambda value: (abs((value.astimezone(zone).hour - 14)), value))
    candidates = []
    for start in options[:3]:
        end = start + duration
        candidates.append({
            "starts_at": start.astimezone(zone).isoformat(),
            "ends_at": end.astimezone(zone).isoformat(),
            "timezone": timezone_name,
            "availability_complete": all_complete,
            "explanation": (
                "This time fits the calendars connected for everyone in the group."
                if all_complete
                else "This time fits the calendars that could be checked; availability is incomplete for some group members."
            ),
        })
    return candidates, all_complete
