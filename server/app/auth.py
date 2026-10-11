import httpx
from fastapi import Header, HTTPException

from .config import DEV_MODE, SUPABASE_ANON_KEY, SUPABASE_URL


async def current_user(authorization: str | None = Header(default=None)) -> str:
    if authorization and authorization.startswith("Bearer "):
        token = authorization.removeprefix("Bearer ").strip()
        if DEV_MODE and token == "demo":
            return "demo"
        if not SUPABASE_URL or not SUPABASE_ANON_KEY:
            raise HTTPException(status_code=503, detail="Supabase Auth is not configured on this server.")
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get(
                f"{SUPABASE_URL}/auth/v1/user",
                headers={"apikey": SUPABASE_ANON_KEY, "Authorization": f"Bearer {token}"},
            )
        if response.status_code != 200:
            raise HTTPException(status_code=401, detail="Your session is invalid or expired.")
        user_id = response.json().get("id")
        if not user_id:
            raise HTTPException(status_code=401, detail="The authentication provider returned no user.")
        return user_id
    if DEV_MODE and authorization is None:
        return "demo"
    raise HTTPException(status_code=401, detail="Sign in to continue.")
