import asyncio
import json

import pytest

from app import ai


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        return None

    def json(self):
        return {"response": json.dumps(self.body)}


class FakeClient:
    def __init__(self, body):
        self.response = FakeResponse(body)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return self.response


@pytest.mark.parametrize("outline", [
    {"title": "Public path walk", "description": "An easy outing.",
     "itinerary": ["Meet at the public entrance.", "Walk a marked path."],
     "quests": ["Spot a leaf shape.", "Share a snack."], "items_to_bring": ["Water"],
     "safety_notes": ["Stay on public paths."]},
    {"title": "Unsafe suggestion", "description": "A dangerous outing.",
     "itinerary": ["Enter restricted area.", "Take a photo."],
     "quests": ["Spot a bird.", "Share a snack."], "items_to_bring": ["Water"],
     "safety_notes": ["Be careful."]},
])
def test_model_result_is_structured_and_unsafe_result_falls_back(monkeypatch, outline):
    monkeypatch.setattr(ai.httpx, "AsyncClient", lambda **_kwargs: FakeClient(outline))
    result, generated = asyncio.run(
        ai.generate(
            {"name": "Verified park", "address": "1 Public Way", "category": "park"},
            "Nature walk", "Under $20", 120,
        )
    )
    if "Unsafe" in outline["title"]:
        assert generated is False
        assert "safe, built-in" not in result["description"].lower()
        assert all("restricted area" not in item.lower() for item in result["itinerary"])
    else:
        assert generated is True
        assert result["title"] == "Public path walk"
