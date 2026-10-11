from datetime import datetime, timedelta, timezone

from app.availability import common_free_windows, group_time_suggestions


def test_disconnected_calendar_is_unknown_not_free():
    slots = group_time_suggestions(
        datetime.now().date() + timedelta(days=2), 120, "America/New_York"
    )
    assert len(slots) == 3
    assert all(slot["availability_complete"] is False for slot in slots)
    assert all("suggested" in slot["explanation"] for slot in slots)
    assert all("participant" not in slot for slot in slots)
    assert all("calendar" not in slot for slot in slots)


def test_intersection_keeps_only_time_free_for_every_calendar():
    start = datetime(2026, 10, 11, 9, tzinfo=timezone.utc)
    end = datetime(2026, 10, 11, 17, tzinfo=timezone.utc)
    first = [(datetime(2026, 10, 11, 11, tzinfo=timezone.utc), datetime(2026, 10, 11, 12, tzinfo=timezone.utc))]
    second = [(datetime(2026, 10, 11, 14, tzinfo=timezone.utc), datetime(2026, 10, 11, 15, tzinfo=timezone.utc))]
    assert common_free_windows([first, second], start, end) == [
        (start, datetime(2026, 10, 11, 11, tzinfo=timezone.utc)),
        (datetime(2026, 10, 11, 12, tzinfo=timezone.utc), datetime(2026, 10, 11, 14, tzinfo=timezone.utc)),
        (datetime(2026, 10, 11, 15, tzinfo=timezone.utc), end),
    ]


def test_no_attendees_or_busy_intervals_are_returned_from_intersection():
    start = datetime(2026, 10, 11, 9, tzinfo=timezone.utc)
    end = datetime(2026, 10, 11, 17, tzinfo=timezone.utc)
    assert common_free_windows([[]], start, end) == [(start, end)]
