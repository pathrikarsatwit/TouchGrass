import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import quote
from uuid import uuid4

import httpx

from .config import DATABASE_PATH, SUPABASE_DATABASE_ENABLED, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL


def supabase_request(method: str, table: str, *, params: dict | None = None, body: Any = None, headers: dict | None = None):
    if not SUPABASE_DATABASE_ENABLED:
        raise RuntimeError("Supabase PostgreSQL is not configured.")
    request_headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    if headers:
        request_headers.update(headers)
    try:
        response = httpx.request(
            method,
            f"{SUPABASE_URL}/rest/v1/{table}",
            params=params,
            json=body,
            headers=request_headers,
            timeout=12,
        )
    except httpx.HTTPError as exc:
        raise RuntimeError("Supabase PostgreSQL is currently unavailable.") from exc
    if response.is_error:
        raise RuntimeError(f"Supabase rejected a database operation ({response.status_code}).")
    return response.json() if response.content else []


class ClosingConnection(sqlite3.Connection):
    def __exit__(self, exc_type, exc_value, traceback):
        try:
            return super().__exit__(exc_type, exc_value, traceback)
        finally:
            self.close()


def connect() -> sqlite3.Connection:
    path = Path(DATABASE_PATH)
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path, timeout=10, factory=ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize() -> None:
    if SUPABASE_DATABASE_ENABLED:
        return
    with connect() as db:
        db.executescript(
            """
            CREATE TABLE IF NOT EXISTS groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 60),
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS group_members (
                group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('organizer', 'member')),
                joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(group_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS profiles (
                id TEXT PRIMARY KEY,
                username TEXT UNIQUE COLLATE NOCASE,
                display_name TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS friendships (
                id TEXT PRIMARY KEY,
                requester_id TEXT NOT NULL,
                recipient_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('pending', 'accepted', 'declined', 'blocked')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(requester_id, recipient_id),
                CHECK(requester_id <> recipient_id)
            );
            CREATE TABLE IF NOT EXISTS group_invitations (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                invited_user_id TEXT NOT NULL,
                invited_by TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(group_id, invited_user_id)
            );
            CREATE TABLE IF NOT EXISTS hangouts (
                id TEXT PRIMARY KEY,
                group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
                created_by TEXT NOT NULL,
                proposal_json TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE TABLE IF NOT EXISTS hangout_rsvps (
                hangout_id TEXT NOT NULL REFERENCES hangouts(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('going', 'maybe', 'declined')),
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(hangout_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS quest_completions (
                hangout_id TEXT NOT NULL REFERENCES hangouts(id) ON DELETE CASCADE,
                quest TEXT NOT NULL,
                user_id TEXT NOT NULL,
                private_photo_path TEXT,
                completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(hangout_id, quest, user_id)
            );
            CREATE TABLE IF NOT EXISTS calendar_connections (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                connection_status TEXT NOT NULL DEFAULT 'connected',
                encrypted_refresh_token TEXT,
                last_sync_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, provider)
            );
            CREATE TABLE IF NOT EXISTS oauth_state_nonces (
                nonce TEXT PRIMARY KEY,
                expires_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS push_tokens (
                user_id TEXT NOT NULL,
                expo_push_token TEXT NOT NULL UNIQUE,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY(user_id, expo_push_token)
            );
            CREATE TABLE IF NOT EXISTS notifications (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL,
                hangout_id TEXT REFERENCES hangouts(id) ON DELETE CASCADE,
                type TEXT NOT NULL,
                sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                read_at TEXT
            );
            """
        )
        quest_columns = {row["name"] for row in db.execute("PRAGMA table_info(quest_completions)").fetchall()}
        if "private_photo_path" not in quest_columns:
            db.execute("ALTER TABLE quest_completions ADD COLUMN private_photo_path TEXT")
        demo = db.execute("SELECT id FROM groups WHERE id = 'demo-friends'").fetchone()
        if not demo:
            db.execute("INSERT INTO groups(id, name, created_by) VALUES (?, ?, ?)", ("demo-friends", "The Trail Mix", "demo"))
            db.execute("INSERT INTO group_members(group_id, user_id, role) VALUES (?, ?, ?)", ("demo-friends", "demo", "organizer"))
        db.execute("INSERT OR IGNORE INTO profiles(id, username, display_name) VALUES ('demo', 'demo', 'Demo user')")


def create_group(name: str, user_id: str) -> dict[str, Any]:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("POST", "groups", body={"name": name, "created_by": user_id, "preferences": {}})
        if not rows:
            raise RuntimeError("Supabase did not return the created group.")
        return {"id": rows[0]["id"], "name": rows[0]["name"], "member_count": 1}
    group_id = str(uuid4())
    with connect() as db:
        db.execute("INSERT INTO groups(id, name, created_by) VALUES (?, ?, ?)", (group_id, name, user_id))
        db.execute("INSERT INTO group_members(group_id, user_id, role) VALUES (?, ?, 'organizer')", (group_id, user_id))
    return {"id": group_id, "name": name, "member_count": 1}


def list_groups(user_id: str) -> list[dict[str, Any]]:
    if SUPABASE_DATABASE_ENABLED:
        memberships = supabase_request("GET", "group_members", params={"user_id": f"eq.{user_id}", "select": "group_id"})
        if not memberships:
            return []
        ids = ",".join(row["group_id"] for row in memberships)
        groups = supabase_request("GET", "groups", params={"id": f"in.({ids})", "select": "id,name"})
        members = supabase_request("GET", "group_members", params={"group_id": f"in.({ids})", "select": "group_id"})
        counts: dict[str, int] = {}
        for member in members:
            counts[member["group_id"]] = counts.get(member["group_id"], 0) + 1
        return [{"id": group["id"], "name": group["name"], "member_count": counts.get(group["id"], 0)} for group in groups]
    with connect() as db:
        rows = db.execute(
            """SELECT g.id, g.name, COUNT(m.user_id) AS member_count
            FROM groups g JOIN group_members own ON own.group_id = g.id AND own.user_id = ?
            JOIN group_members m ON m.group_id = g.id
            GROUP BY g.id ORDER BY g.created_at""",
            (user_id,),
        ).fetchall()
    return [{"id": row["id"], "name": row["name"], "member_count": row["member_count"]} for row in rows]


def is_group_member(group_id: str, user_id: str) -> bool:
    if SUPABASE_DATABASE_ENABLED:
        return bool(supabase_request(
            "GET", "group_members",
            params={"group_id": f"eq.{group_id}", "user_id": f"eq.{user_id}", "select": "group_id", "limit": "1"},
        ))
    with connect() as db:
        return db.execute(
            "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?",
            (group_id, user_id),
        ).fetchone() is not None


def is_group_organizer(group_id: str, user_id: str) -> bool:
    if SUPABASE_DATABASE_ENABLED:
        return bool(supabase_request(
            "GET", "group_members",
            params={"group_id": f"eq.{group_id}", "user_id": f"eq.{user_id}", "role": "eq.organizer", "select": "group_id", "limit": "1"},
        ))
    with connect() as db:
        return db.execute(
            "SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ? AND role = 'organizer'",
            (group_id, user_id),
        ).fetchone() is not None


def upsert_profile(user_id: str, username: str, display_name: str) -> dict[str, Any]:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("PATCH", "profiles", params={"id": f"eq.{user_id}", "select": "id,username,display_name"}, body={
            "username": username, "display_name": display_name,
        })
        if not rows:
            rows = supabase_request("POST", "profiles", body={"id": user_id, "username": username, "display_name": display_name})
        return rows[0]
    with connect() as db:
        db.execute(
            """INSERT INTO profiles(id, username, display_name) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name""",
            (user_id, username, display_name),
        )
        row = db.execute("SELECT id, username, display_name FROM profiles WHERE id = ?", (user_id,)).fetchone()
    return dict(row)


def get_profile(user_id: str) -> dict[str, Any] | None:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "profiles", params={
            "id": f"eq.{user_id}", "select": "id,username,display_name",
        })
        return rows[0] if rows else None
    with connect() as db:
        row = db.execute("SELECT id, username, display_name FROM profiles WHERE id = ?", (user_id,)).fetchone()
    return dict(row) if row else None


def search_profiles(username: str, requesting_user: str) -> list[dict[str, Any]]:
    if SUPABASE_DATABASE_ENABLED:
        return supabase_request("POST", "rpc/search_profiles_by_username", body={"search_username": username})
    with connect() as db:
        rows = db.execute(
            """SELECT p.id, p.username, p.display_name FROM profiles p
            WHERE p.username LIKE ? AND p.id <> ? AND NOT EXISTS (
              SELECT 1 FROM friendships f WHERE f.status = 'blocked'
              AND ((f.requester_id = ? AND f.recipient_id = p.id)
                OR (f.recipient_id = ? AND f.requester_id = p.id))
            ) LIMIT 10""",
            (f"{username}%", requesting_user, requesting_user, requesting_user),
        ).fetchall()
    return [dict(row) for row in rows]


def is_friend(user_id: str, other_user: str) -> bool:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "friendships", params={
            "status": "eq.accepted", "select": "id", "limit": "1",
            "or": f"(and(requester_id.eq.{user_id},recipient_id.eq.{other_user}),and(requester_id.eq.{other_user},recipient_id.eq.{user_id}))",
        })
        return bool(rows)
    with connect() as db:
        return db.execute(
            """SELECT 1 FROM friendships WHERE status = 'accepted' AND
            ((requester_id = ? AND recipient_id = ?) OR (requester_id = ? AND recipient_id = ?))""",
            (user_id, other_user, other_user, user_id),
        ).fetchone() is not None


def send_friend_request(user_id: str, other_user: str) -> dict[str, Any]:
    if user_id == other_user:
        raise ValueError("You cannot send a friend request to yourself.")
    if is_friend(user_id, other_user):
        raise ValueError("You are already friends.")
    if SUPABASE_DATABASE_ENABLED:
        existing = supabase_request("GET", "friendships", params={
            "requester_id": f"eq.{other_user}", "recipient_id": f"eq.{user_id}", "status": "eq.pending", "select": "id",
        })
        if existing:
            raise ValueError("This person has already sent you a request.")
        rows = supabase_request("POST", "friendships", body={
            "requester_id": user_id, "recipient_id": other_user, "status": "pending",
        })
        return rows[0]
    with connect() as db:
        reverse = db.execute(
            "SELECT 1 FROM friendships WHERE requester_id = ? AND recipient_id = ? AND status = 'pending'",
            (other_user, user_id),
        ).fetchone()
        if reverse:
            raise ValueError("This person has already sent you a request.")
        request_id = str(uuid4())
        db.execute(
            "INSERT INTO friendships(id, requester_id, recipient_id, status) VALUES (?, ?, ?, 'pending')",
            (request_id, user_id, other_user),
        )
    return {"id": request_id, "requester_id": user_id, "recipient_id": other_user, "status": "pending"}


def list_friendships(user_id: str) -> dict[str, list[dict[str, Any]]]:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "friendships", params={
            "select": "id,requester_id,recipient_id,status,created_at",
            "or": f"(requester_id.eq.{user_id},recipient_id.eq.{user_id})",
        })
        friend_ids = {item["requester_id"] if item["recipient_id"] == user_id else item["recipient_id"]
                      for item in rows}
        profiles = supabase_request("GET", "profiles", params={
            "id": f"in.({','.join(friend_ids)})" if friend_ids else "eq.00000000-0000-0000-0000-000000000000",
            "select": "id,username,display_name",
        })
    else:
        with connect() as db:
            rows = [dict(row) for row in db.execute(
                """SELECT id, requester_id, recipient_id, status, created_at FROM friendships
                WHERE requester_id = ? OR recipient_id = ?""", (user_id, user_id),
            ).fetchall()]
            friend_ids = {row["requester_id"] if row["recipient_id"] == user_id else row["recipient_id"]
                          for row in rows}
            profiles = [dict(row) for row in db.execute(
                f"SELECT id, username, display_name FROM profiles WHERE id IN ({','.join('?' for _ in friend_ids)})",
                tuple(friend_ids),
            ).fetchall()] if friend_ids else []
    profile_by_id = {item["id"]: item for item in profiles}
    incoming = []
    for item in rows:
        if item["recipient_id"] == user_id and item["status"] == "pending":
            incoming.append({**item, "requester": profile_by_id.get(item["requester_id"])})
    return {
        "friends": [profile_by_id.get(item["requester_id"] if item["recipient_id"] == user_id else item["recipient_id"], {})
                    for item in rows if item["status"] == "accepted"],
        "incoming": incoming,
        "outgoing": [item for item in rows if item["requester_id"] == user_id and item["status"] == "pending"],
    }


def respond_friend_request(request_id: str, user_id: str, accept: bool) -> str:
    if SUPABASE_DATABASE_ENABLED:
        response = supabase_request("PATCH", "friendships", params={
            "id": f"eq.{request_id}", "recipient_id": f"eq.{user_id}", "status": "eq.pending",
        }, body={"status": "accepted" if accept else "declined"})
        if not response:
            raise ValueError("Friend request not found.")
        return response[0]["requester_id"]
    with connect() as db:
        request = db.execute(
            "SELECT requester_id FROM friendships WHERE id = ? AND recipient_id = ? AND status = 'pending'",
            (request_id, user_id),
        ).fetchone()
        if not request:
            raise ValueError("Friend request not found.")
        cursor = db.execute(
            "UPDATE friendships SET status = ? WHERE id = ? AND recipient_id = ? AND status = 'pending'",
            ("accepted" if accept else "declined", request_id, user_id),
        )
        if cursor.rowcount != 1:
            raise ValueError("Friend request not found.")
        return request["requester_id"]


def group_member_ids(group_id: str) -> list[str]:
    if SUPABASE_DATABASE_ENABLED:
        return [row["user_id"] for row in supabase_request(
            "GET", "group_members", params={"group_id": f"eq.{group_id}", "select": "user_id"},
        )]
    with connect() as db:
        return [row["user_id"] for row in db.execute("SELECT user_id FROM group_members WHERE group_id = ?", (group_id,)).fetchall()]


def save_google_credentials(user_id: str, encrypted_credentials: str) -> None:
    connection_id = str(uuid4())
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("POST", "calendar_connections", params={"on_conflict": "user_id,provider"}, body={
            "user_id": user_id, "provider": "google", "connection_status": "connected",
            "last_sync_at": datetime.now(timezone.utc).isoformat(),
        }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        if rows:
            connection_id = rows[0]["id"]
        else:
            rows = supabase_request("GET", "calendar_connections", params={
                "user_id": f"eq.{user_id}", "provider": "eq.google", "select": "id",
            })
            connection_id = rows[0]["id"]
        hex_ciphertext = "\\x" + encrypted_credentials.encode("ascii").hex()
        supabase_request("POST", "calendar_provider_tokens", params={"on_conflict": "connection_id"}, body={
            "connection_id": connection_id, "encrypted_token": hex_ciphertext, "key_version": "fernet-v1",
        }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        return
    with connect() as db:
        db.execute(
            """INSERT INTO calendar_connections(id, user_id, provider, connection_status, encrypted_refresh_token, last_sync_at)
            VALUES (?, ?, 'google', 'connected', ?, ?)
            ON CONFLICT(user_id, provider) DO UPDATE SET connection_status = 'connected',
              encrypted_refresh_token = excluded.encrypted_refresh_token, last_sync_at = excluded.last_sync_at""",
            (connection_id, user_id, encrypted_credentials, datetime.now(timezone.utc).isoformat()),
        )


def get_google_credentials(user_id: str) -> tuple[str, str] | None:
    if SUPABASE_DATABASE_ENABLED:
        connections = supabase_request("GET", "calendar_connections", params={
            "user_id": f"eq.{user_id}", "provider": "eq.google", "connection_status": "eq.connected", "select": "id",
        })
        if not connections:
            return None
        tokens = supabase_request("GET", "calendar_provider_tokens", params={
            "connection_id": f"eq.{connections[0]['id']}", "select": "encrypted_token,key_version",
        })
        if not tokens:
            return None
        value = tokens[0]["encrypted_token"]
        hex_value = value[2:] if value.startswith("\\x") else value
        try:
            encrypted = bytes.fromhex(hex_value).decode("ascii")
        except (ValueError, UnicodeDecodeError) as exc:
            raise RuntimeError("Stored calendar credentials are not valid encrypted data.") from exc
        return connections[0]["id"], encrypted
    with connect() as db:
        row = db.execute(
            """SELECT id, encrypted_refresh_token FROM calendar_connections
            WHERE user_id = ? AND provider = 'google' AND connection_status = 'connected'""",
            (user_id,),
        ).fetchone()
    return (row["id"], row["encrypted_refresh_token"]) if row and row["encrypted_refresh_token"] else None


def calendar_statuses(user_id: str) -> list[dict[str, Any]]:
    if SUPABASE_DATABASE_ENABLED:
        return supabase_request("GET", "calendar_connections", params={
            "user_id": f"eq.{user_id}", "select": "id,provider,connection_status,last_sync_at,created_at",
        })
    with connect() as db:
        return [dict(row) for row in db.execute(
            """SELECT id, provider, connection_status, last_sync_at, created_at
            FROM calendar_connections WHERE user_id = ? ORDER BY created_at""", (user_id,),
        ).fetchall()]


def disconnect_google_calendar(user_id: str) -> None:
    if SUPABASE_DATABASE_ENABLED:
        supabase_request("DELETE", "calendar_connections", params={
            "user_id": f"eq.{user_id}", "provider": "eq.google",
        })
        return
    with connect() as db:
        db.execute("DELETE FROM calendar_connections WHERE user_id = ? AND provider = 'google'", (user_id,))


def consume_oauth_nonce(nonce: str, expires_at: datetime) -> bool:
    if SUPABASE_DATABASE_ENABLED:
        try:
            supabase_request("POST", "oauth_state_nonces", body={"nonce": nonce, "expires_at": expires_at.isoformat()})
            return True
        except RuntimeError as exc:
            if "409" in str(exc):
                return False
            raise
    with connect() as db:
        db.execute("DELETE FROM oauth_state_nonces WHERE expires_at < ?", (datetime.now(timezone.utc).isoformat(),))
        try:
            db.execute("INSERT INTO oauth_state_nonces(nonce, expires_at) VALUES (?, ?)", (nonce, expires_at.isoformat()))
            return True
        except sqlite3.IntegrityError:
            return False


def save_native_calendar_status(user_id: str, connected: bool) -> None:
    if SUPABASE_DATABASE_ENABLED:
        if connected:
            supabase_request("POST", "calendar_connections", params={"on_conflict": "user_id,provider"}, body={
                "user_id": user_id, "provider": "apple", "connection_status": "connected",
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        else:
            supabase_request("DELETE", "calendar_connections", params={
                "user_id": f"eq.{user_id}", "provider": "eq.apple",
            })
        return
    with connect() as db:
        if connected:
            db.execute(
                """INSERT INTO calendar_connections(id, user_id, provider, connection_status, last_sync_at)
                VALUES (?, ?, 'apple', 'connected', ?)
                ON CONFLICT(user_id, provider) DO UPDATE SET connection_status = 'connected', last_sync_at = excluded.last_sync_at""",
                (str(uuid4()), user_id, datetime.now(timezone.utc).isoformat()),
            )
        else:
            db.execute("DELETE FROM calendar_connections WHERE user_id = ? AND provider = 'apple'", (user_id,))


def set_native_calendar_provider(user_id: str, provider: str, connected: bool) -> None:
    if SUPABASE_DATABASE_ENABLED:
        if connected:
            supabase_request("POST", "calendar_connections", params={"on_conflict": "user_id,provider"}, body={
                "user_id": user_id, "provider": provider, "connection_status": "connected",
                "last_sync_at": datetime.now(timezone.utc).isoformat(),
            }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        else:
            supabase_request("DELETE", "calendar_connections", params={
                "user_id": f"eq.{user_id}", "provider": f"eq.{provider}",
            })
        return
    with connect() as db:
        if connected:
            db.execute(
                """INSERT INTO calendar_connections(id, user_id, provider, connection_status, last_sync_at)
                VALUES (?, ?, ?, 'connected', ?)
                ON CONFLICT(user_id, provider) DO UPDATE SET connection_status = 'connected', last_sync_at = excluded.last_sync_at""",
                (str(uuid4()), user_id, provider, datetime.now(timezone.utc).isoformat()),
            )
        else:
            db.execute("DELETE FROM calendar_connections WHERE user_id = ? AND provider = ?", (user_id, provider))


def group_calendar_connections(group_id: str) -> dict[str, list[dict[str, Any]]]:
    members = group_member_ids(group_id)
    if not members:
        return {}
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "calendar_connections", params={
            "user_id": f"in.({','.join(members)})", "connection_status": "eq.connected",
            "select": "id,user_id,provider,connection_status,last_sync_at",
        })
    else:
        with connect() as db:
            rows = [dict(row) for row in db.execute(
                f"""SELECT id, user_id, provider, connection_status, last_sync_at
                FROM calendar_connections WHERE user_id IN ({','.join('?' for _ in members)})
                AND connection_status = 'connected'""", tuple(members),
            ).fetchall()]
    result: dict[str, list[dict[str, Any]]] = {member: [] for member in members}
    for row in rows:
        result[row["user_id"]].append(row)
    return result


def get_google_credentials_by_connection_id(connection_id: str) -> str | None:
    if SUPABASE_DATABASE_ENABLED:
        tokens = supabase_request("GET", "calendar_provider_tokens", params={
            "connection_id": f"eq.{connection_id}", "select": "encrypted_token",
        })
        if not tokens:
            return None
        value = tokens[0]["encrypted_token"]
        hex_value = value[2:] if value.startswith("\\x") else value
        return bytes.fromhex(hex_value).decode("ascii")
    with connect() as db:
        row = db.execute(
            "SELECT encrypted_refresh_token FROM calendar_connections WHERE id = ? AND provider = 'google'",
            (connection_id,),
        ).fetchone()
    return row["encrypted_refresh_token"] if row else None


def update_calendar_sync(connection_id: str, status: str = "connected") -> None:
    if SUPABASE_DATABASE_ENABLED:
        supabase_request("PATCH", "calendar_connections", params={"id": f"eq.{connection_id}"}, body={
            "connection_status": status, "last_sync_at": datetime.now(timezone.utc).isoformat(),
        })
        return
    with connect() as db:
        db.execute(
            "UPDATE calendar_connections SET connection_status = ?, last_sync_at = ? WHERE id = ?",
            (status, datetime.now(timezone.utc).isoformat(), connection_id),
        )


def group_membership(group_id: str, user_id: str) -> str | None:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "group_members", params={
            "group_id": f"eq.{group_id}", "user_id": f"eq.{user_id}", "select": "role",
        })
        return rows[0]["role"] if rows else None
    with connect() as db:
        row = db.execute("SELECT role FROM group_members WHERE group_id = ? AND user_id = ?", (group_id, user_id)).fetchone()
    return row["role"] if row else None


def save_push_token(user_id: str, token: str) -> None:
    if SUPABASE_DATABASE_ENABLED:
        supabase_request("POST", "push_tokens", params={"on_conflict": "user_id,expo_push_token"}, body={
            "user_id": user_id, "expo_push_token": token,
        }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        return
    with connect() as db:
        db.execute("INSERT OR IGNORE INTO push_tokens(user_id, expo_push_token) VALUES (?, ?)", (user_id, token))


def group_push_tokens(group_id: str, except_user: str | None = None) -> list[tuple[str, str]]:
    members = group_member_ids(group_id)
    members = [member for member in members if member != except_user]
    if not members:
        return []
    if SUPABASE_DATABASE_ENABLED:
        tokens = supabase_request("GET", "push_tokens", params={
            "user_id": f"in.({','.join(members)})", "select": "user_id,expo_push_token",
        })
        return [(row["user_id"], row["expo_push_token"]) for row in tokens]
    with connect() as db:
        rows = db.execute(
            f"SELECT user_id, expo_push_token FROM push_tokens WHERE user_id IN ({','.join('?' for _ in members)})",
            tuple(members),
        ).fetchall()
    return [(row["user_id"], row["expo_push_token"]) for row in rows]


def group_push_tokens_for_users(user_ids: list[str]) -> list[tuple[str, str]]:
    if not user_ids:
        return []
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "push_tokens", params={
            "user_id": f"in.({','.join(user_ids)})", "select": "user_id,expo_push_token",
        })
    else:
        with connect() as db:
            rows = db.execute(
                f"SELECT user_id, expo_push_token FROM push_tokens WHERE user_id IN ({','.join('?' for _ in user_ids)})",
                tuple(user_ids),
            ).fetchall()
    return [(row["user_id"], row["expo_push_token"]) for row in rows]


def create_notification(user_id: str, hangout_id: str | None, kind: str) -> None:
    if SUPABASE_DATABASE_ENABLED:
        supabase_request("POST", "notifications", body={"user_id": user_id, "hangout_id": hangout_id, "type": kind})
        return
    with connect() as db:
        db.execute(
            "INSERT INTO notifications(id, user_id, hangout_id, type) VALUES (?, ?, ?, ?)",
            (str(uuid4()), user_id, hangout_id, kind),
        )


def list_notifications(user_id: str) -> list[dict[str, Any]]:
    if SUPABASE_DATABASE_ENABLED:
        return supabase_request("GET", "notifications", params={
            "user_id": f"eq.{user_id}", "select": "id,hangout_id,type,sent_at,read_at", "order": "sent_at.desc", "limit": "50",
        })
    with connect() as db:
        return [dict(row) for row in db.execute(
            "SELECT id, hangout_id, type, sent_at, read_at FROM notifications WHERE user_id = ? ORDER BY sent_at DESC LIMIT 50",
            (user_id,),
        ).fetchall()]


def set_notification_read(notification_id: str, user_id: str) -> bool:
    if SUPABASE_DATABASE_ENABLED:
        return bool(supabase_request("PATCH", "notifications", params={
            "id": f"eq.{notification_id}", "user_id": f"eq.{user_id}", "select": "id",
        }, body={"read_at": datetime.now(timezone.utc).isoformat()}))
    with connect() as db:
        cursor = db.execute(
            "UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ?",
            (datetime.now(timezone.utc).isoformat(), notification_id, user_id),
        )
    return cursor.rowcount == 1


def send_group_invitation(group_id: str, user_id: str, invited_user: str) -> dict[str, Any]:
    if not is_group_organizer(group_id, user_id):
        raise PermissionError("Only a group organizer can invite people.")
    if not is_friend(user_id, invited_user):
        raise PermissionError("You can invite accepted friends only.")
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("POST", "group_invitations", body={
            "group_id": group_id, "invited_user_id": invited_user, "invited_by": user_id, "status": "pending",
        })
        return rows[0]
    invite_id = str(uuid4())
    with connect() as db:
        db.execute(
            "INSERT INTO group_invitations(id, group_id, invited_user_id, invited_by) VALUES (?, ?, ?, ?)",
            (invite_id, group_id, invited_user, user_id),
        )
    return {"id": invite_id, "group_id": group_id, "invited_user_id": invited_user, "status": "pending"}


def list_group_invitations(user_id: str) -> list[dict[str, Any]]:
    if SUPABASE_DATABASE_ENABLED:
        return supabase_request("GET", "group_invitations", params={
            "invited_user_id": f"eq.{user_id}", "status": "eq.pending", "select": "id,group_id,invited_by,created_at,groups(name)",
        })
    with connect() as db:
        return [dict(row) for row in db.execute(
            """SELECT i.id, i.group_id, i.invited_by, i.created_at, g.name AS group_name
            FROM group_invitations i JOIN groups g ON g.id = i.group_id
            WHERE i.invited_user_id = ? AND i.status = 'pending'""", (user_id,),
        ).fetchall()]


def respond_group_invitation(invitation_id: str, user_id: str, accept: bool) -> str | None:
    if SUPABASE_DATABASE_ENABLED:
        invitations = supabase_request("GET", "group_invitations", params={
            "id": f"eq.{invitation_id}", "invited_user_id": f"eq.{user_id}", "status": "eq.pending",
            "select": "group_id",
        })
        if not invitations:
            raise ValueError("Invitation not found.")
        group_id = invitations[0]["group_id"]
        supabase_request("PATCH", "group_invitations", params={
            "id": f"eq.{invitation_id}", "invited_user_id": f"eq.{user_id}", "status": "eq.pending",
        }, body={"status": "accepted" if accept else "declined"})
        if accept:
            supabase_request("POST", "group_members", params={"on_conflict": "group_id,user_id"}, body={
                "group_id": group_id, "user_id": user_id, "role": "member",
            }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        return group_id
    with connect() as db:
        row = db.execute(
            "SELECT group_id FROM group_invitations WHERE id = ? AND invited_user_id = ? AND status = 'pending'",
            (invitation_id, user_id),
        ).fetchone()
        if not row:
            raise ValueError("Invitation not found.")
        db.execute("UPDATE group_invitations SET status = ? WHERE id = ?", ("accepted" if accept else "declined", invitation_id))
        if accept:
            db.execute("INSERT OR IGNORE INTO group_members(group_id, user_id, role) VALUES (?, ?, 'member')", (row["group_id"], user_id))
            return row["group_id"]
    return None


def add_hangout(proposal: dict[str, Any], user_id: str) -> None:
    if SUPABASE_DATABASE_ENABLED:
        place_data = proposal["place"]
        place_rows = supabase_request("POST", "places", body={
            "provider": place_data["source"], "provider_place_id": place_data["id"], "name": place_data["name"],
            "address": place_data["address"], "latitude": place_data.get("latitude"),
            "longitude": place_data.get("longitude"), "source_metadata": {},
        }, params={"on_conflict": "provider,provider_place_id"},
            headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        if not place_rows:
            place_rows = supabase_request("GET", "places", params={
                "provider": f"eq.{place_data['source']}", "provider_place_id": f"eq.{place_data['id']}", "select": "id",
            })
        destination_id = place_rows[0]["id"] if place_rows else None
        rows = supabase_request("POST", "hangouts", body={
            "id": proposal["id"], "group_id": proposal["group_id"], "created_by": user_id,
            "title": proposal["title"], "description": proposal["description"], "city": proposal["city"],
            "destination_id": destination_id,
            "start_at": proposal["starts_at"], "end_at": proposal["ends_at"], "timezone": proposal["timezone"],
            "status": "draft", "budget_estimate": proposal["budget_estimate"], "itinerary": proposal["itinerary"],
            "plan_metadata": {
                key: proposal[key] for key in (
                    "items_to_bring", "safety_notes", "weather", "ai_generated", "generation_note",
                    "availability_complete", "availability_note",
                ) if key in proposal
            },
        })
        for quest in proposal["quests"]:
            supabase_request("POST", "quests", body={"hangout_id": proposal["id"], "description": quest, "is_optional": True})
        return
    with connect() as db:
        db.execute(
            "INSERT INTO hangouts(id, group_id, created_by, proposal_json) VALUES (?, ?, ?, ?)",
            (proposal["id"], proposal["group_id"], user_id, json.dumps(proposal)),
        )


def get_hangout(hangout_id: str) -> dict[str, Any] | None:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "hangouts", params={
            "id": f"eq.{hangout_id}", "select": "*",
        })
        if not rows:
            return None
        row = rows[0]
        quests = supabase_request("GET", "quests", params={"hangout_id": f"eq.{hangout_id}", "select": "description"})
        place_rows = supabase_request("GET", "places", params={
            "id": f"eq.{row['destination_id']}", "select": "provider,provider_place_id,name,address,latitude,longitude",
        }) if row.get("destination_id") else []
        place = place_rows[0] if place_rows else {}
        metadata = row.get("plan_metadata") or {}
        return {
            "id": row["id"], "group_id": row["group_id"], "created_by": row["created_by"],
            "title": row["title"], "description": row["description"], "city": row.get("city", ""),
            "place": {"id": place.get("provider_place_id", ""), "name": place.get("name", ""),
                      "address": place.get("address", ""), "latitude": place.get("latitude"),
                      "longitude": place.get("longitude"), "source": place.get("provider", "OpenStreetMap"),
                      "attribution": "© OpenStreetMap contributors"},
            "starts_at": row["start_at"], "ends_at": row["end_at"], "timezone": row["timezone"],
            "itinerary": row.get("itinerary") or [], "quests": [quest["description"] for quest in quests],
            "items_to_bring": [], "safety_notes": [], "budget_estimate": row.get("budget_estimate") or "Not provided",
            "weather": {"status": "unavailable", "detail": "Forecast not stored for this plan."},
            "ai_generated": False, "status": row["status"],
            **metadata,
        }
    with connect() as db:
        row = db.execute("SELECT proposal_json FROM hangouts WHERE id = ?", (hangout_id,)).fetchone()
    return json.loads(row["proposal_json"]) if row else None


def list_hangouts(user_id: str) -> list[dict[str, Any]]:
    if SUPABASE_DATABASE_ENABLED:
        memberships = supabase_request("GET", "group_members", params={"user_id": f"eq.{user_id}", "select": "group_id"})
        if not memberships:
            return []
        group_ids = ",".join(item["group_id"] for item in memberships)
        rows = supabase_request("GET", "hangouts", params={
            "group_id": f"in.({group_ids})", "or": f"(created_by.eq.{user_id},status.eq.published)",
            "select": "id",
        })
        proposals = [get_hangout(row["id"]) for row in rows]
        result = []
        for proposal in proposals:
            if proposal:
                proposal["rsvp_status"] = get_rsvp(proposal["id"], user_id)
                proposal["completed_quests"] = completed_quests(proposal["id"], user_id)
                result.append(proposal)
        return result
    with connect() as db:
        rows = db.execute(
            """SELECT h.proposal_json FROM hangouts h
            JOIN group_members gm ON gm.group_id = h.group_id AND gm.user_id = ?
            WHERE h.created_by = ? OR json_extract(h.proposal_json, '$.status') = 'published'
            ORDER BY json_extract(h.proposal_json, '$.starts_at')""",
            (user_id, user_id),
        ).fetchall()
    result = []
    for row in rows:
        proposal = json.loads(row["proposal_json"])
        proposal["rsvp_status"] = get_rsvp(proposal["id"], user_id)
        proposal["completed_quests"] = completed_quests(proposal["id"], user_id)
        result.append(proposal)
    return result


def update_hangout(proposal: dict[str, Any]) -> None:
    if SUPABASE_DATABASE_ENABLED:
        supabase_request("PATCH", "hangouts", params={"id": f"eq.{proposal['id']}"}, body={
            "title": proposal["title"], "description": proposal["description"], "city": proposal.get("city", ""),
            "start_at": proposal["starts_at"],
            "end_at": proposal["ends_at"], "timezone": proposal["timezone"], "itinerary": proposal["itinerary"],
            "status": proposal["status"],
            "plan_metadata": {
                key: proposal[key] for key in (
                    "items_to_bring", "safety_notes", "weather", "ai_generated", "generation_note",
                    "availability_complete", "availability_note",
                ) if key in proposal
            },
        })
        return
    with connect() as db:
        db.execute(
            "UPDATE hangouts SET proposal_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (json.dumps(proposal), proposal["id"]),
        )


def publish_hangout(hangout_id: str) -> None:
    if SUPABASE_DATABASE_ENABLED:
        proposal = get_hangout(hangout_id)
        if not proposal:
            raise RuntimeError("Hangout not found.")
        supabase_request("PATCH", "hangouts", params={"id": f"eq.{hangout_id}"}, body={
            "status": "published", "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        members = group_member_ids(proposal["group_id"])
        supabase_request("POST", "hangout_members", params={"on_conflict": "hangout_id,user_id"}, body=[
            {"hangout_id": hangout_id, "user_id": member, "rsvp_status": "pending"} for member in members
        ], headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        return
    with connect() as db:
        db.execute("UPDATE hangouts SET updated_at = CURRENT_TIMESTAMP WHERE id = ?", (hangout_id,))


def set_rsvp(hangout_id: str, user_id: str, status: str) -> None:
    if SUPABASE_DATABASE_ENABLED:
        supabase_request("PATCH", "hangout_members", params={
            "hangout_id": f"eq.{hangout_id}", "user_id": f"eq.{user_id}",
        }, body={"rsvp_status": status, "responded_at": datetime.now(timezone.utc).isoformat()})
        return
    with connect() as db:
        db.execute(
            """INSERT INTO hangout_rsvps(hangout_id, user_id, status) VALUES (?, ?, ?)
            ON CONFLICT(hangout_id, user_id) DO UPDATE SET status = excluded.status, updated_at = CURRENT_TIMESTAMP""",
            (hangout_id, user_id, status),
        )


def get_rsvp(hangout_id: str, user_id: str) -> str | None:
    if SUPABASE_DATABASE_ENABLED:
        rows = supabase_request("GET", "hangout_members", params={
            "hangout_id": f"eq.{hangout_id}", "user_id": f"eq.{user_id}", "select": "rsvp_status",
        })
        return rows[0]["rsvp_status"] if rows else None
    with connect() as db:
        row = db.execute(
            "SELECT status FROM hangout_rsvps WHERE hangout_id = ? AND user_id = ?",
            (hangout_id, user_id),
        ).fetchone()
    return row["status"] if row else None


def save_calendar_photo(hangout_id: str, quest: str, user_id: str, photo_path: str | None, completed: bool) -> None:
    complete_quest(hangout_id, quest, user_id, completed, photo_path)


def get_quest_photo_path(hangout_id: str, quest: str, user_id: str) -> str | None:
    if SUPABASE_DATABASE_ENABLED:
        quest_rows = supabase_request("GET", "quests", params={
            "hangout_id": f"eq.{hangout_id}", "description": f"eq.{quest}", "select": "id", "limit": "1",
        })
        if not quest_rows:
            return None
        rows = supabase_request("GET", "quest_completions", params={
            "quest_id": f"eq.{quest_rows[0]['id']}", "user_id": f"eq.{user_id}", "select": "private_photo_path",
        })
        return rows[0].get("private_photo_path") if rows else None
    with connect() as db:
        row = db.execute(
            """SELECT private_photo_path FROM quest_completions
            WHERE hangout_id = ? AND quest = ? AND user_id = ?""", (hangout_id, quest, user_id),
        ).fetchone()
    return row["private_photo_path"] if row else None


def list_quest_photos(hangout_id: str, quest: str) -> list[dict[str, str]]:
    if SUPABASE_DATABASE_ENABLED:
        quest_rows = supabase_request("GET", "quests", params={
            "hangout_id": f"eq.{hangout_id}", "description": f"eq.{quest}", "select": "id", "limit": "1",
        })
        if not quest_rows:
            return []
        return supabase_request("GET", "quest_completions", params={
            "quest_id": f"eq.{quest_rows[0]['id']}", "private_photo_path": "not.is.null",
            "select": "user_id,private_photo_path",
        })
    with connect() as db:
        rows = db.execute(
            """SELECT user_id, private_photo_path FROM quest_completions
            WHERE hangout_id = ? AND quest = ? AND private_photo_path IS NOT NULL""",
            (hangout_id, quest),
        ).fetchall()
    return [dict(row) for row in rows]


def sign_private_photo(photo_path: str, expires_in: int = 3600) -> str:
    if not SUPABASE_DATABASE_ENABLED:
        raise RuntimeError("Private photo access requires Supabase Storage.")
    try:
        response = httpx.post(
            f"{SUPABASE_URL}/storage/v1/object/sign/hangout-media/{quote(photo_path, safe='/')}",
            json={"expiresIn": expires_in},
            headers={
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
                "Content-Type": "application/json",
            },
            timeout=10,
        )
    except httpx.HTTPError as exc:
        raise RuntimeError("Private photo storage is unavailable.") from exc
    if response.is_error:
        raise RuntimeError("Private photo is unavailable.")
    signed_path = response.json().get("signedURL")
    if not signed_path:
        raise RuntimeError("Storage did not return a private photo link.")
    if signed_path.startswith("http://") or signed_path.startswith("https://"):
        return signed_path
    return f"{SUPABASE_URL}/storage/v1{signed_path if signed_path.startswith('/') else f'/{signed_path}'}"


def complete_quest(hangout_id: str, quest: str, user_id: str, completed: bool, photo_path: str | None = None) -> None:
    if SUPABASE_DATABASE_ENABLED:
        quests = supabase_request("GET", "quests", params={"hangout_id": f"eq.{hangout_id}", "description": f"eq.{quest}", "select": "id", "limit": "1"})
        if not quests:
            raise RuntimeError("Quest not found.")
        quest_id = quests[0]["id"]
        if completed:
            supabase_request("POST", "quest_completions", params={"on_conflict": "quest_id,user_id"}, body={
                "quest_id": quest_id, "user_id": user_id, "private_photo_path": photo_path,
            }, headers={"Prefer": "resolution=merge-duplicates,return=representation"})
        else:
            supabase_request("DELETE", "quest_completions", params={"quest_id": f"eq.{quest_id}", "user_id": f"eq.{user_id}"})
        return
    with connect() as db:
        if completed:
            db.execute(
                """INSERT INTO quest_completions(hangout_id, quest, user_id, private_photo_path)
                VALUES (?, ?, ?, ?) ON CONFLICT(hangout_id, quest, user_id)
                DO UPDATE SET private_photo_path = excluded.private_photo_path, completed_at = CURRENT_TIMESTAMP""",
                (hangout_id, quest, user_id, photo_path),
            )
        else:
            db.execute(
                "DELETE FROM quest_completions WHERE hangout_id = ? AND quest = ? AND user_id = ?",
                (hangout_id, quest, user_id),
            )


def completed_quests(hangout_id: str, user_id: str) -> list[str]:
    if SUPABASE_DATABASE_ENABLED:
        quests = supabase_request("GET", "quests", params={"hangout_id": f"eq.{hangout_id}", "select": "id,description"})
        if not quests:
            return []
        completions = supabase_request("GET", "quest_completions", params={
            "quest_id": f"in.({','.join(quest['id'] for quest in quests)})", "user_id": f"eq.{user_id}", "select": "quest_id",
        })
        completed_ids = {completion["quest_id"] for completion in completions}
        return [quest["description"] for quest in quests if quest["id"] in completed_ids]
    with connect() as db:
        rows = db.execute(
            "SELECT quest FROM quest_completions WHERE hangout_id = ? AND user_id = ?",
            (hangout_id, user_id),
        ).fetchall()
    return [row["quest"] for row in rows]
