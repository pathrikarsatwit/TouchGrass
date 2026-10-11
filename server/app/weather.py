from datetime import date, datetime, timezone
import logging

import httpx

logger = logging.getLogger(__name__)


async def forecast(latitude: float | None, longitude: float | None, day: date) -> dict:
    if latitude is None or longitude is None or (day - date.today()).days > 7 or (day - date.today()).days < 0:
        return {"status": "unavailable", "detail": "No reliable forecast is available for this place and date. Check again closer to your outing."}
    params = {
        "latitude": latitude, "longitude": longitude, "daily": "weather_code,temperature_2m_max,precipitation_probability_max",
        "timezone": "auto", "forecast_days": 7,
    }
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.get("https://api.open-meteo.com/v1/forecast", params=params)
        response.raise_for_status()
        daily = response.json().get("daily", {})
        dates = daily.get("time", [])
        if day.isoformat() not in dates:
            return {"status": "unavailable", "detail": "A forecast is not available yet. Check again closer to your outing."}
        index = dates.index(day.isoformat())
        temp = daily["temperature_2m_max"][index]
        rain = daily["precipitation_probability_max"][index]
        detail = f"Forecast: high near {round(temp)}°C, with up to {rain}% chance of precipitation. Forecasts can change."
        return {"status": "available", "detail": detail, "checked_at": datetime.now(timezone.utc).isoformat()}
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
        logger.warning("Weather provider unavailable (%s)", type(exc).__name__)
        return {"status": "unavailable", "detail": "Weather information is temporarily unavailable. Check a local forecast before heading out."}
