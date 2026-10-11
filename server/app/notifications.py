import logging

import httpx

from . import db
from .config import EXPO_PUSH_ACCESS_TOKEN, SUPABASE_DATABASE_ENABLED

logger = logging.getLogger(__name__)
EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


async def send_group_invitation(group_id: str, invitee_id: str, invite_id: str) -> None:
    db.create_notification(invitee_id, None, "group_invitation")
    await _send(
        [token for _, token in db.group_push_tokens_for_users([invitee_id])],
        "A friend invited you",
        "You have a new TouchGrass group invitation.",
        {"type": "group_invitation", "invitation_id": invite_id},
    )


async def send_hangout_invitations(group_id: str, hangout_id: str, sender_id: str) -> None:
    recipients = [user_id for user_id, _ in db.group_push_tokens(group_id, sender_id)]
    if not SUPABASE_DATABASE_ENABLED:
        for recipient in recipients:
            db.create_notification(recipient, hangout_id, "hangout_invitation")
    tokens = [token for _, token in db.group_push_tokens(group_id, sender_id)]
    await _send(
        tokens,
        "A new hangout is planned",
        "Your group has a new adventure to RSVP to.",
        {"type": "hangout_invitation", "hangout_id": hangout_id},
    )


async def send_friend_request(recipient_id: str, request_id: str) -> None:
    db.create_notification(recipient_id, None, "friend_request")
    await _send(
        [token for _, token in db.group_push_tokens_for_users([recipient_id])],
        "New friend request",
        "Someone would like to plan an adventure with you.",
        {"type": "friend_request", "request_id": request_id},
    )


async def send_friend_acceptance(recipient_id: str) -> None:
    db.create_notification(recipient_id, None, "friend_request_accepted")
    await _send(
        [token for _, token in db.group_push_tokens_for_users([recipient_id])],
        "Friend request accepted",
        "You can now plan adventures together.",
        {"type": "friend_request_accepted"},
    )


async def send_rsvp_update(group_id: str, hangout_id: str, sender_id: str, status: str) -> None:
    hangout = db.get_hangout(hangout_id)
    organizer = hangout.get("created_by") if hangout else None
    recipients = [token for _, token in db.group_push_tokens_for_users([organizer]) if organizer] if organizer and organizer != sender_id else []
    if organizer and organizer != sender_id:
        db.create_notification(organizer, hangout_id, "rsvp_update")
    await _send(
        recipients,
        "RSVP updated",
        f"A group member responded: {status}.",
        {"type": "rsvp_update", "hangout_id": hangout_id},
    )


async def _send(tokens: list[str], title: str, body: str, data: dict) -> None:
    if not tokens:
        return
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if EXPO_PUSH_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {EXPO_PUSH_ACCESS_TOKEN}"
    messages = [
        {"to": token, "title": title, "body": body, "data": data, "sound": "default", "priority": "high"}
        for token in tokens
    ]
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(EXPO_PUSH_URL, headers=headers, json=messages)
        if response.is_error:
            logger.warning("Expo push service returned HTTP %s.", response.status_code)
            return
        for ticket in response.json().get("data", []):
            if ticket.get("status") == "error":
                logger.warning("Expo push rejected a device message (%s).", ticket.get("details", {}).get("error", "unknown"))
    except (httpx.HTTPError, ValueError) as exc:
        logger.warning("Expo push delivery failed (%s).", type(exc).__name__)
