from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
import re
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from . import ai, calendar_service, db, notifications, places, weather
from .auth import current_user
from .config import APP_DEEP_LINK, DEV_MODE
from .models import (
    AvailabilityRequest, FriendRequestCreate, FriendshipResponse, GroupCreate,
    GroupInvitationCreate, NativeCalendarSync, PhotoCompletionRequest, PlanRequest,
    ProfileUpdate, Proposal, PushTokenRequest, PublishRequest, RSVPRequest,
)

query_attempts: dict[str, list[datetime]] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not db.SUPABASE_DATABASE_ENABLED:
        db.initialize()
    yield


app = FastAPI(title="TouchGrass API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if DEV_MODE else [],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


def limit_availability_queries(user_id: str) -> None:
    now = datetime.now(timezone.utc)
    recent = [timestamp for timestamp in query_attempts.get(user_id, []) if now - timestamp < timedelta(hours=1)]
    if len(recent) >= 3:
        raise HTTPException(status_code=429, detail="You’ve made several availability requests. Try again later.")
    recent.append(now)
    query_attempts[user_id] = recent


def assert_future_date(day: date) -> None:
    if day < date.today() or day > date.today() + timedelta(days=90):
        raise HTTPException(status_code=422, detail="Choose a date between today and the next 90 days.")


@app.get("/health")
def health():
    return {"status": "ok", "service": "TouchGrass API", "demo_mode": DEV_MODE}


@app.get("/groups")
def list_groups(user_id: str = Depends(current_user)):
    return {"groups": db.list_groups(user_id)}


@app.post("/groups", status_code=201)
def create_group(payload: GroupCreate, user_id: str = Depends(current_user)):
    return db.create_group(payload.name.strip(), user_id)


@app.put("/profiles/me")
def update_my_profile(payload: ProfileUpdate, user_id: str = Depends(current_user)):
    try:
        return db.upsert_profile(user_id, payload.username.lower(), payload.display_name.strip())
    except RuntimeError as exc:
        if "409" in str(exc) or "duplicate" in str(exc).lower():
            raise HTTPException(status_code=409, detail="That username is already taken.") from exc
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@app.get("/profiles/me")
def get_my_profile(user_id: str = Depends(current_user)):
    return db.get_profile(user_id) or {"id": user_id, "username": "", "display_name": ""}


@app.get("/friends/search")
def search_friends(username: str, user_id: str = Depends(current_user)):
    if len(username.strip()) < 3 or len(username) > 24:
        raise HTTPException(status_code=422, detail="Enter at least 3 characters of a username.")
    return {"users": db.search_profiles(username.strip().lower(), user_id)}


@app.get("/friends")
def list_friends(user_id: str = Depends(current_user)):
    return db.list_friendships(user_id)


@app.post("/friends/requests", status_code=201)
async def create_friend_request(payload: FriendRequestCreate, user_id: str = Depends(current_user)):
    matches = db.search_profiles(payload.username, user_id)
    target = next((person for person in matches if person.get("username", "").lower() == payload.username.lower()), None)
    if not target:
        raise HTTPException(status_code=404, detail="Person not found. Search for their username first.")
    try:
        result = db.send_friend_request(user_id, target["id"])
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await notifications.send_friend_request(target["id"], result["id"])
    return result


@app.post("/friends/requests/{request_id}/respond")
async def respond_to_friend_request(request_id: str, payload: FriendshipResponse, user_id: str = Depends(current_user)):
    try:
        requester_id = db.respond_friend_request(request_id, user_id, payload.accept)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if payload.accept:
        await notifications.send_friend_acceptance(requester_id)
    return {"status": "accepted" if payload.accept else "declined"}


@app.get("/invitations")
def list_invitations(user_id: str = Depends(current_user)):
    return {"groups": db.list_group_invitations(user_id)}


@app.post("/groups/{group_id}/invitations", status_code=201)
async def invite_friend(group_id: str, payload: GroupInvitationCreate, user_id: str = Depends(current_user)):
    if not db.is_group_member(group_id, user_id):
        raise HTTPException(status_code=404, detail="Group not found.")
    try:
        invitation = db.send_group_invitation(group_id, user_id, payload.user_id)
    except PermissionError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except RuntimeError as exc:
        if "409" in str(exc) or "duplicate" in str(exc).lower():
            raise HTTPException(status_code=409, detail="This person already has a pending invitation.") from exc
        raise HTTPException(status_code=503, detail="The invitation could not be saved.") from exc
    await notifications.send_group_invitation(group_id, payload.user_id, invitation["id"])
    return invitation


@app.post("/invitations/groups/{invitation_id}/respond")
def respond_to_group_invitation(invitation_id: str, payload: FriendshipResponse, user_id: str = Depends(current_user)):
    try:
        group_id = db.respond_group_invitation(invitation_id, user_id, payload.accept)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"status": "accepted" if payload.accept else "declined", "group_id": group_id}


@app.get("/calendar/connections")
def calendar_connections(user_id: str = Depends(current_user)):
    return {"connections": db.calendar_statuses(user_id)}


@app.get("/calendar/google/start")
def start_google_calendar_oauth(user_id: str = Depends(current_user)):
    return {"authorization_url": calendar_service.authorization_url(user_id)}


@app.get("/calendar/google/callback")
async def google_calendar_callback(code: str | None = None, state: str | None = None, error: str | None = None):
    if error or not code or not state:
        return RedirectResponse(f"{APP_DEEP_LINK}?status=error", status_code=302)
    try:
        await calendar_service.complete_google_oauth(code, state)
    except HTTPException:
        return RedirectResponse(f"{APP_DEEP_LINK}?status=error", status_code=302)
    return RedirectResponse(f"{APP_DEEP_LINK}?status=connected", status_code=302)


@app.post("/calendar/native/sync")
def sync_native_calendar(payload: NativeCalendarSync, user_id: str = Depends(current_user)):
    start = payload.start_at.astimezone(timezone.utc)
    end = payload.end_at.astimezone(timezone.utc)
    intervals = [(item.start, item.end) for item in payload.busy]
    calendar_service.cache_native_busy(user_id, start, end, intervals)
    db.set_native_calendar_provider(user_id, payload.provider, True)
    return {
        "status": "connected", "provider": payload.provider,
        "expires_in_seconds": int(calendar_service.NATIVE_CACHE_LIFETIME.total_seconds()),
    }


@app.delete("/calendar/connections/{provider}")
async def disconnect_calendar(provider: str, user_id: str = Depends(current_user)):
    if provider == "google":
        await calendar_service.disconnect_google(user_id)
    elif provider in {"apple", "android"}:
        db.set_native_calendar_provider(user_id, provider, False)
        calendar_service.clear_native_busy(user_id)
    else:
        raise HTTPException(status_code=404, detail="Calendar provider not found.")
    return {"status": "disconnected", "provider": provider}


@app.post("/notifications/register", status_code=204)
def register_push_token(payload: PushTokenRequest, user_id: str = Depends(current_user)):
    db.save_push_token(user_id, payload.token)
    return None


@app.get("/notifications")
def get_notifications(user_id: str = Depends(current_user)):
    return {"notifications": db.list_notifications(user_id)}


@app.post("/notifications/{notification_id}/read")
def mark_notification_read(notification_id: str, user_id: str = Depends(current_user)):
    if not db.set_notification_read(notification_id, user_id):
        raise HTTPException(status_code=404, detail="Notification not found.")
    return {"status": "read"}


@app.get("/places/search")
async def search_places(city: str, q: str = "park", _: str = Depends(current_user)):
    if len(city.strip()) < 2 or len(city) > 120 or len(q) > 60:
        raise HTTPException(status_code=422, detail="Enter a valid city and short place search.")
    results = await places.search(city.strip(), q.strip() or "park")
    return {"places": results, "attribution": "© OpenStreetMap contributors"}


@app.post("/availability/search")
async def search_availability(payload: AvailabilityRequest, user_id: str = Depends(current_user)):
    calendar_service.prune_expired_native_busy()
    limit_availability_queries(user_id)
    if not db.is_group_member(payload.group_id, user_id):
        raise HTTPException(status_code=404, detail="Group not found.")
    assert_future_date(payload.date)
    members = db.group_member_ids(payload.group_id)
    connections = db.group_calendar_connections(payload.group_id)
    google_busy = {}
    zone = ZoneInfo(payload.timezone)
    start = datetime.combine(payload.date, datetime.min.time(), tzinfo=zone)
    end = start + timedelta(days=1)
    for member in members:
        if any(connection["provider"] == "google" for connection in connections.get(member, [])):
            try:
                google_busy[member] = await calendar_service.google_busy_intervals(member, start, end)
            except HTTPException:
                continue
    suggestions, complete = calendar_service.suggested_slots(
        payload.date, payload.duration_minutes, payload.timezone, members, connections, google_busy
    )
    return {
        "candidates": suggestions,
        "availability_complete": complete,
        "note": "Availability is complete only when each group member has a current, connected calendar.",
    }


@app.post("/hangouts/plan", response_model=Proposal, status_code=201)
async def plan_hangout(payload: PlanRequest, user_id: str = Depends(current_user)):
    if not db.is_group_organizer(payload.group_id, user_id):
        raise HTTPException(status_code=403, detail="Only a group organizer can create a plan.")
    assert_future_date(payload.date)
    if payload.starts_at.astimezone(ZoneInfo(payload.timezone)).date() != payload.date:
        raise HTTPException(status_code=422, detail="The selected time must fall on the planning date.")
    place = await places.details(payload.place_id)
    if not place.get("latitude") or not place.get("longitude"):
        raise HTTPException(status_code=422, detail="The selected place has no verified map coordinates.")
    outline, ai_generated = await ai.generate(place, payload.mood, payload.budget, payload.duration_minutes)
    end_at = payload.starts_at + timedelta(minutes=payload.duration_minutes)
    proposal = Proposal(
        id=str(uuid4()),
        group_id=payload.group_id,
        title=outline["title"][:100],
        description=outline["description"][:500],
        city=payload.city,
        place=place,
        starts_at=payload.starts_at,
        ends_at=end_at,
        timezone=payload.timezone,
        itinerary=outline["itinerary"][:5],
        quests=outline["quests"][:5],
        items_to_bring=outline["items_to_bring"][:8],
        safety_notes=outline["safety_notes"][:5],
        budget_estimate=f"{payload.budget} per person (organizer estimate)",
        weather=await weather.forecast(place["latitude"], place["longitude"], payload.date),
        ai_generated=ai_generated,
        generation_note=None if ai_generated else "AI server unavailable; this is a safe, built-in itinerary, not an AI-generated plan.",
        status="draft",
    )
    stored_proposal = proposal.model_dump(mode="json")
    stored_proposal["created_by"] = user_id
    db.add_hangout(stored_proposal, user_id)
    return proposal


@app.get("/hangouts", response_model=list[Proposal])
def list_hangouts(user_id: str = Depends(current_user)):
    return [Proposal.model_validate(item) for item in db.list_hangouts(user_id)]


def load_authorized_hangout(hangout_id: str, user_id: str) -> dict:
    proposal = db.get_hangout(hangout_id)
    if not proposal or not db.is_group_member(proposal["group_id"], user_id):
        raise HTTPException(status_code=404, detail="Hangout not found.")
    return proposal


@app.post("/hangouts/{hangout_id}/publish", response_model=Proposal)
async def publish_hangout(hangout_id: str, payload: PublishRequest, user_id: str = Depends(current_user)):
    proposal = load_authorized_hangout(hangout_id, user_id)
    if proposal["created_by"] != user_id and not db.is_group_organizer(proposal["group_id"], user_id):
        raise HTTPException(status_code=403, detail="Only the organizer can publish this draft.")
    if proposal["status"] != "draft":
        raise HTTPException(status_code=409, detail="This hangout has already been published.")
    calendar_service.prune_expired_native_busy()
    starts_at = datetime.fromisoformat(proposal["starts_at"])
    ends_at = datetime.fromisoformat(proposal["ends_at"])
    complete, conflict = await calendar_service.verify_group_interval(proposal["group_id"], starts_at, ends_at)
    if conflict and not payload.confirm_conflict:
        raise HTTPException(status_code=409, detail="This time no longer fits the connected calendars. Choose another suggested time or edit the plan.")
    for member in db.group_member_ids(proposal["group_id"]):
        calendar_service.clear_native_busy(member)
    proposal["status"] = "published"
    proposal["availability_complete"] = complete
    proposal["availability_note"] = (
        "The organizer confirmed this time despite a connected-calendar conflict."
        if conflict else
        "Group availability was refreshed before publishing."
        if complete else
        "Published with organizer confirmation; some calendar availability could not be verified."
    )
    db.update_hangout(proposal)
    db.publish_hangout(hangout_id)
    await notifications.send_hangout_invitations(proposal["group_id"], hangout_id, user_id)
    return Proposal.model_validate(proposal)


@app.post("/hangouts/{hangout_id}/rsvp")
async def rsvp(hangout_id: str, payload: RSVPRequest, user_id: str = Depends(current_user)):
    proposal = load_authorized_hangout(hangout_id, user_id)
    if proposal["status"] != "published":
        raise HTTPException(status_code=409, detail="You can RSVP after the hangout is published.")
    db.set_rsvp(hangout_id, user_id, payload.status)
    await notifications.send_rsvp_update(proposal["group_id"], hangout_id, user_id, payload.status)
    return {"status": payload.status}


@app.post("/hangouts/{hangout_id}/quests/{quest_index}/complete")
def complete_quest(
    hangout_id: str, quest_index: int, payload: PhotoCompletionRequest, user_id: str = Depends(current_user)
):
    proposal = load_authorized_hangout(hangout_id, user_id)
    if proposal["status"] != "published":
        raise HTTPException(status_code=409, detail="Quest progress is available after the hangout is published.")
    if quest_index < 0 or quest_index >= len(proposal["quests"]):
        raise HTTPException(status_code=404, detail="Quest not found.")
    if payload.photo_path and not re.fullmatch(
        rf"{re.escape(hangout_id)}/{re.escape(user_id)}/[A-Za-z0-9_-]+\.(?:jpg|png|webp)",
        payload.photo_path,
    ):
        raise HTTPException(status_code=403, detail="Photo path must be a file in your private hangout folder.")
    db.complete_quest(hangout_id, proposal["quests"][quest_index], user_id, payload.completed, payload.photo_path)
    return {"completed": db.completed_quests(hangout_id, user_id)}


@app.get("/hangouts/{hangout_id}/quests/{quest_index}/photos")
def get_quest_photos(hangout_id: str, quest_index: int, user_id: str = Depends(current_user)):
    proposal = load_authorized_hangout(hangout_id, user_id)
    if quest_index < 0 or quest_index >= len(proposal["quests"]):
        raise HTTPException(status_code=404, detail="Quest not found.")
    try:
        photos = db.list_quest_photos(hangout_id, proposal["quests"][quest_index])
        return {"photos": [
            {"url": db.sign_private_photo(photo["private_photo_path"])}
            for photo in photos if photo.get("private_photo_path")
        ]}
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail="Private quest photos are unavailable.") from exc


@app.get("/hangouts/{hangout_id}", response_model=Proposal)
def get_hangout(hangout_id: str, user_id: str = Depends(current_user)):
    proposal = load_authorized_hangout(hangout_id, user_id)
    proposal["rsvp_status"] = db.get_rsvp(hangout_id, user_id)
    proposal["completed_quests"] = db.completed_quests(hangout_id, user_id)
    return Proposal.model_validate(proposal)
