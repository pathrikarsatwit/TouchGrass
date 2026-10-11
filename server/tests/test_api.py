from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from fastapi.testclient import TestClient

from app import db, main


@pytest.fixture
def test_client(tmp_path, monkeypatch):
    database = tmp_path / "touchgrass.sqlite3"
    monkeypatch.setattr(db, "DATABASE_PATH", str(database))
    with TestClient(main.app) as client:
        yield client


def test_availability_returns_neutral_unknown_suggestions(test_client):
    day = date.today() + timedelta(days=3)
    response = test_client.post("/availability/search", json={
        "group_id": "demo-friends", "date": day.isoformat(),
        "duration_minutes": 120, "timezone": "America/New_York",
    })
    assert response.status_code == 200
    body = response.json()
    assert body["availability_complete"] is False
    assert all(candidate["availability_complete"] is False for candidate in body["candidates"])
    serialized = str(body).lower()
    assert "busy_intervals" not in serialized
    assert "participant_id" not in serialized
    assert "event_title" not in serialized


def test_nonmember_cannot_query_another_group(test_client):
    group = db.create_group("Private crew", "someone-else")
    response = test_client.post("/availability/search", json={
        "group_id": group["id"], "date": (date.today() + timedelta(days=3)).isoformat(),
        "duration_minutes": 60, "timezone": "UTC",
    })
    assert response.status_code == 404


def test_availability_queries_are_rate_limited(test_client):
    main.query_attempts.clear()
    body = {
        "group_id": "demo-friends", "date": (date.today() + timedelta(days=2)).isoformat(),
        "duration_minutes": 60, "timezone": "UTC",
    }
    for _ in range(3):
        assert test_client.post("/availability/search", json=body).status_code == 200
    assert test_client.post("/availability/search", json=body).status_code == 429


def test_plan_publish_and_rsvp_require_real_verified_place_and_group_member(test_client, monkeypatch):
    async def fake_details(place_id):
        return {
            "id": place_id, "name": "Verified park", "address": "1 Public Way",
            "latitude": 42.35, "longitude": -71.06, "category": "park",
            "source": "OpenStreetMap", "attribution": "© OpenStreetMap contributors",
        }

    async def fake_generate(*_args):
        return ({
            "title": "The Easygoing Nature Walk", "description": "A relaxed loop.",
            "itinerary": ["Meet at the entrance.", "Walk a public path.", "Share a snack."],
            "quests": ["Spot three leaf shapes.", "Take a group photo if everyone agrees."],
            "items_to_bring": ["Water"], "safety_notes": ["Stay on public paths."],
        }, False)

    async def fake_weather(*_args):
        return {"status": "unavailable", "detail": "No reliable forecast is available yet."}

    monkeypatch.setattr(main.places, "details", fake_details)
    monkeypatch.setattr(main.ai, "generate", fake_generate)
    monkeypatch.setattr(main.weather, "forecast", fake_weather)
    start = (datetime.now(ZoneInfo("America/New_York")) + timedelta(days=3)).replace(hour=11, minute=0, second=0, microsecond=0)
    response = test_client.post("/hangouts/plan", json={
        "group_id": "demo-friends", "city": "Boston, MA", "date": start.date().isoformat(),
        "duration_minutes": 120, "mood": "Nature walk", "budget": "Under $20",
        "place_id": "W1234", "starts_at": start.isoformat(), "timezone": "America/New_York",
    })
    assert response.status_code == 201, response.text
    proposal = response.json()
    assert proposal["place"]["name"] == "Verified park"
    assert proposal["status"] == "draft"
    assert proposal["ai_generated"] is False
    assert proposal["generation_note"]
    assert proposal["availability_complete"] is False
    assert proposal["availability_note"] is None
    draft_rsvp = test_client.post(f"/hangouts/{proposal['id']}/rsvp", json={"status": "going"})
    assert draft_rsvp.status_code == 409
    monkeypatch.setattr(main.calendar_service, "verify_group_interval", lambda *_args: _async_value((True, True)))
    cleared_users = []
    monkeypatch.setattr(main.calendar_service, "clear_native_busy", cleared_users.append)
    conflict = test_client.post(f"/hangouts/{proposal['id']}/publish", json={})
    assert conflict.status_code == 409
    assert "no longer fits the connected calendars" in conflict.json()["detail"]
    assert cleared_users == []
    published = test_client.post(f"/hangouts/{proposal['id']}/publish", json={"confirm_conflict": True})
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    assert published.json()["availability_note"] == "The organizer confirmed this time despite a connected-calendar conflict."
    assert cleared_users == ["demo"]
    rsvp = test_client.post(f"/hangouts/{proposal['id']}/rsvp", json={"status": "going"})
    assert rsvp.status_code == 200
    assert rsvp.json()["status"] == "going"


async def _async_value(value):
    return value
