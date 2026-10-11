from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class ProfileUpdate(BaseModel):
    username: str = Field(pattern=r"^[a-z0-9_]{3,24}$")
    display_name: str = Field(min_length=1, max_length=80)


class FriendRequestCreate(BaseModel):
    username: str = Field(pattern=r"^[a-z0-9_]{3,24}$")


class FriendshipResponse(BaseModel):
    accept: bool


class GroupInvitationCreate(BaseModel):
    user_id: str = Field(min_length=1, max_length=80)


class CalendarBusyInterval(BaseModel):
    start: datetime
    end: datetime

    @field_validator("start", "end")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Calendar intervals must include a time zone.")
        return value


class NativeCalendarSync(BaseModel):
    provider: Literal["apple", "android"]
    start_at: datetime
    end_at: datetime
    busy: list[CalendarBusyInterval] = Field(max_length=1000)

    @field_validator("start_at", "end_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("Calendar windows must include a time zone.")
        return value


class PushTokenRequest(BaseModel):
    token: str = Field(min_length=20, max_length=256, pattern=r"^(Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$")


class PhotoCompletionRequest(BaseModel):
    completed: bool = True
    photo_path: str | None = Field(default=None, min_length=1, max_length=512)


class PublishRequest(BaseModel):
    confirm_conflict: bool = False


class NotificationReadRequest(BaseModel):
    read: bool = True


class AvailabilityRequest(BaseModel):
    group_id: str = Field(min_length=1, max_length=80)
    date: date
    duration_minutes: int = Field(ge=30, le=480)
    timezone: str = Field(min_length=1, max_length=80)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("A valid IANA time zone is required.") from exc
        return value


class PlanRequest(BaseModel):
    group_id: str = Field(min_length=1, max_length=80)
    city: str = Field(min_length=2, max_length=120)
    date: date
    duration_minutes: int = Field(ge=30, le=480)
    mood: str = Field(min_length=2, max_length=60)
    budget: str = Field(min_length=1, max_length=40)
    place_id: str = Field(pattern=r"^[NWR]\d+$")
    starts_at: datetime
    timezone: str = Field(min_length=1, max_length=80)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as exc:
            raise ValueError("A valid IANA time zone is required.") from exc
        return value

    @field_validator("starts_at")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            raise ValueError("The selected start time must include a time zone.")
        return value


class RSVPRequest(BaseModel):
    status: Literal["going", "maybe", "declined"]


class QuestCompleteRequest(BaseModel):
    completed: bool = True


class Place(BaseModel):
    id: str
    name: str
    address: str
    latitude: float | None = None
    longitude: float | None = None
    category: str = "place"
    source: str = "OpenStreetMap"
    attribution: str = "© OpenStreetMap contributors"


class TimeSlot(BaseModel):
    starts_at: datetime
    ends_at: datetime
    timezone: str
    availability_complete: bool
    explanation: str


class Weather(BaseModel):
    status: Literal["available", "unavailable"]
    detail: str
    checked_at: datetime | None = None


class Proposal(BaseModel):
    id: str
    group_id: str
    title: str
    description: str
    city: str
    place: Place
    starts_at: datetime
    ends_at: datetime
    timezone: str
    itinerary: list[str]
    quests: list[str]
    items_to_bring: list[str]
    safety_notes: list[str]
    budget_estimate: str
    weather: Weather
    ai_generated: bool
    generation_note: str | None = None
    availability_complete: bool = False
    availability_note: str | None = None
    status: Literal["draft", "published"]
    rsvp_status: str | None = None
    completed_quests: list[str] = Field(default_factory=list)
