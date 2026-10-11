from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo


def group_time_suggestions(
    day, duration_minutes: int, timezone: str, *, has_calendar_providers: bool = False
) -> list[dict]:
    """Return non-personal suggestions; never equate disconnected calendars with free time."""
    local_zone = ZoneInfo(timezone)
    candidates = []
    for hour in (10, 14, 17):
        start = datetime.combine(day, time(hour, 0), tzinfo=local_zone)
        end = start + timedelta(minutes=duration_minutes)
        candidates.append(
            {
                "starts_at": start.isoformat(),
                "ends_at": end.isoformat(),
                "timezone": timezone,
                "availability_complete": False,
                "explanation": (
                    "A suggested time to ask the group; no private calendar details are shared."
                    if not has_calendar_providers
                    else "Calendar availability could not be confirmed for everyone; please check with the group."
                ),
            }
        )
    return candidates


def common_free_windows(calendars: list[list[tuple[datetime, datetime]]], window_start: datetime, window_end: datetime):
    """Intersect owner-authorized busy intervals inside the private availability service."""
    free_windows = [(window_start, window_end)]
    for busy_intervals in calendars:
        for busy_start, busy_end in sorted(busy_intervals):
            next_windows = []
            for start, end in free_windows:
                if busy_end <= start or busy_start >= end:
                    next_windows.append((start, end))
                    continue
                if start < busy_start:
                    next_windows.append((start, busy_start))
                if busy_end < end:
                    next_windows.append((busy_end, end))
            free_windows = next_windows
    return free_windows
