import asyncio
import time

import httpx
from fastapi import HTTPException

from .config import PLACE_PROVIDER_USER_AGENT

NOMINATIM_URL = "https://nominatim.openstreetmap.org"
_request_lock = asyncio.Lock()
_last_request_at = 0.0


async def _get(url: str, *, params: dict, headers: dict) -> httpx.Response:
    global _last_request_at
    async with _request_lock:
        wait_seconds = 1.0 - (time.monotonic() - _last_request_at)
        if wait_seconds > 0:
            await asyncio.sleep(wait_seconds)
        async with httpx.AsyncClient(timeout=12, headers=headers) as client:
            response = await client.get(url, params=params)
        _last_request_at = time.monotonic()
        return response


def _place(item: dict) -> dict:
    address = item.get("address", {})
    street = " ".join(part for part in [
        address.get("house_number"), address.get("road"), address.get("neighbourhood")
    ] if part)
    locality = address.get("city") or address.get("town") or address.get("village") or address.get("county")
    postcode = address.get("postcode")
    address_line = ", ".join(part for part in [street, locality, address.get("state"), postcode] if part)
    category = item.get("type") or item.get("class") or "place"
    return {
        "id": f"{item.get('osm_type', 'N')[0].upper()}{item.get('osm_id')}",
        "name": item.get("name") or item.get("display_name", "Unnamed place").split(",")[0],
        "address": address_line or item.get("display_name", ""),
        "latitude": float(item["lat"]) if item.get("lat") else None,
        "longitude": float(item["lon"]) if item.get("lon") else None,
        "category": category,
        "source": "OpenStreetMap",
        "attribution": "© OpenStreetMap contributors",
    }


async def search(city: str, query: str) -> list[dict]:
    headers = {"User-Agent": PLACE_PROVIDER_USER_AGENT}
    params = {"q": f"{query}, {city}", "format": "jsonv2", "addressdetails": 1, "limit": 8, "extratags": 1}
    response = await _get(f"{NOMINATIM_URL}/search", params=params, headers=headers)
    if response.status_code == 429:
        raise HTTPException(status_code=503, detail="Place search is temporarily rate limited. Try again in a moment.")
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="The place provider is unavailable right now.")
    return [_place(item) for item in response.json() if item.get("osm_id")]


async def details(place_id: str) -> dict:
    if len(place_id) < 2 or place_id[0] not in "NWR" or not place_id[1:].isdigit():
        raise HTTPException(status_code=422, detail="Select a place returned by the place search.")
    params = {"osm_ids": place_id, "format": "jsonv2", "addressdetails": 1}
    headers = {"User-Agent": PLACE_PROVIDER_USER_AGENT}
    response = await _get(f"{NOMINATIM_URL}/lookup", params=params, headers=headers)
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="The place provider is unavailable right now.")
    result = response.json()
    if not result:
        raise HTTPException(status_code=422, detail="The selected place could not be verified.")
    place = _place(result[0])
    place["source_metadata"] = {"osm_type": result[0].get("osm_type"), "osm_id": result[0].get("osm_id")}
    return place
