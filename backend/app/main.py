from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote_plus
import xml.etree.ElementTree as ET

import httpx
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sklearn.ensemble import RandomForestRegressor

app = FastAPI(title="AirSense API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search"
AIR_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

HOURLY_FIELDS = [
    "us_aqi", "european_aqi", "pm2_5", "pm10", "nitrogen_dioxide",
    "sulphur_dioxide", "ozone", "carbon_monoxide"
]
CURRENT_FIELDS = [
    "us_aqi", "european_aqi", "pm2_5", "pm10", "nitrogen_dioxide",
    "sulphur_dioxide", "ozone", "carbon_monoxide"
]


async def get_json(url: str, params: dict[str, Any]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=25) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"Air-quality provider request failed: {exc}") from exc


async def geocode(city: str) -> dict[str, Any]:
    data = await get_json(
        GEOCODING_URL,
        {"name": city, "count": 1, "language": "en", "format": "json"},
    )
    results = data.get("results") or []
    if not results:
        raise HTTPException(status_code=404, detail=f"No location found for '{city}'. Try another city.")
    return results[0]


def number_or_none(value):
    if value is None:
        return None
    try:
        val = float(value)
        return val if np.isfinite(val) else None
    except (TypeError, ValueError):
        return None


def category_for_aqi(aqi):
    if aqi is None:
        return {"label": "Unavailable", "tone": "neutral"}
    # US AQI categories
    if aqi <= 50:
        return {"label": "Good", "tone": "good"}
    if aqi <= 100:
        return {"label": "Moderate", "tone": "moderate"}
    if aqi <= 150:
        return {"label": "Unhealthy for sensitive groups", "tone": "sensitive"}
    if aqi <= 200:
        return {"label": "Unhealthy", "tone": "unhealthy"}
    if aqi <= 300:
        return {"label": "Very unhealthy", "tone": "very-unhealthy"}
    return {"label": "Hazardous", "tone": "hazardous"}


def recommendations(aqi):
    if aqi is None:
        return ["Air-quality data is unavailable. Try again later or select another city."]
    if aqi <= 50:
        return ["Air quality is generally satisfactory.", "Enjoy outdoor activities as usual."]
    if aqi <= 100:
        return ["Air quality is acceptable for most people.", "Unusually sensitive people may choose to reduce prolonged, heavy outdoor exertion."]
    if aqi <= 150:
        return ["Sensitive groups should reduce prolonged or heavy outdoor exertion.", "Consider moving strenuous activities indoors if symptoms occur."]
    if aqi <= 200:
        return ["Consider reducing prolonged outdoor exertion.", "Sensitive groups should avoid strenuous outdoor activity."]
    return ["Avoid strenuous outdoor activity.", "Follow local public-health guidance and check for official advisories."]


def build_ml_estimate(hourly: dict[str, list], current_time: str | None = None) -> dict[str, Any]:
    """
    Prototype: learns next-hour US AQI from recent hourly provider values.
    Uses a chronological split for a small internal evaluation. With little/missing
    data, returns no estimate rather than inventing a number.
    """
    times = hourly.get("time", [])
    aqi = hourly.get("us_aqi", [])
    pm25 = hourly.get("pm2_5", [])
    pm10 = hourly.get("pm10", [])
    no2 = hourly.get("nitrogen_dioxide", [])
    ozone = hourly.get("ozone", [])

    frame = pd.DataFrame({
        "time": times, "aqi": aqi, "pm25": pm25, "pm10": pm10,
        "no2": no2, "ozone": ozone
    })
    if frame.empty:
        return {"value": None, "method": "Random Forest prototype", "note": "No hourly data available."}

    frame["time"] = pd.to_datetime(frame["time"], errors="coerce")
    for col in ["aqi", "pm25", "pm10", "no2", "ozone"]:
        frame[col] = pd.to_numeric(frame[col], errors="coerce")
    frame = frame.dropna(subset=["time", "aqi"]).sort_values("time").reset_index(drop=True)

    # Train only on records at or before the current time. The API also returns
    # future forecast rows, which must not leak into training or shift the target.
    if current_time:
        cutoff = pd.to_datetime(current_time, errors="coerce")
        if pd.notna(cutoff):
            frame = frame[frame["time"] <= cutoff].copy().reset_index(drop=True)

    # Lagged features ensure the model uses past values to estimate the next hour.
    frame["aqi_lag1"] = frame["aqi"]
    frame["aqi_lag2"] = frame["aqi"].shift(1)
    frame["aqi_lag3"] = frame["aqi"].shift(2)
    frame["pm25_lag1"] = frame["pm25"]
    frame["pm10_lag1"] = frame["pm10"]
    frame["no2_lag1"] = frame["no2"]
    frame["ozone_lag1"] = frame["ozone"]
    frame["hour"] = frame["time"].dt.hour
    frame["dayofweek"] = frame["time"].dt.dayofweek
    frame["target"] = frame["aqi"].shift(-1)

    feature_cols = [
        "aqi_lag1", "aqi_lag2", "aqi_lag3", "pm25_lag1",
        "pm10_lag1", "no2_lag1", "ozone_lag1", "hour", "dayofweek"
    ]
    training = frame.dropna(subset=feature_cols + ["target"]).copy()
    if len(training) < 24:
        return {
            "value": None,
            "method": "Random Forest prototype",
            "note": "Not enough complete hourly history yet (at least 24 usable rows needed)."
        }

    X = training[feature_cols]
    y = training["target"]
    split = max(1, int(len(training) * 0.8))
    if len(training) - split < 1:
        split = len(training) - 1
    model = RandomForestRegressor(n_estimators=120, random_state=42, min_samples_leaf=2)
    model.fit(X.iloc[:split], y.iloc[:split])

    latest = frame.dropna(subset=feature_cols).tail(1)
    if latest.empty:
        return {"value": None, "method": "Random Forest prototype", "note": "Not enough recent data to create features."}
    prediction = float(model.predict(latest[feature_cols])[0])
    prediction = max(0, prediction)
    return {
        "value": round(prediction, 1),
        "method": "Random Forest regression",
        "note": "Experimental next-hour estimate trained on recent provider hourly series; not an official forecast.",
        "training_rows": int(split)
    }


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "AirSense API"}



NEWS_RSS_URL = "https://news.google.com/rss/search?q={query}&hl=en-IN&gl=IN&ceid=IN:en"


@app.get("/api/environmental-reports")
async def environmental_reports(
    region: str = Query("Chennai", min_length=2, max_length=100),
):
    """Return public news reports about air pollution/environmental issues for a region."""
    search_query = f'"{region}" (air pollution OR emissions OR environmental compliance)'
    url = NEWS_RSS_URL.format(query=quote_plus(search_query))

    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            response = await client.get(url, headers={"User-Agent": "AirSense student project"})
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Environmental news provider request failed: {exc}",
        ) from exc

    try:
        root = ET.fromstring(response.content)
    except ET.ParseError as exc:
        raise HTTPException(status_code=502, detail="Could not read the environmental news feed.") from exc

    items = []
    for item in root.findall("./channel/item")[:10]:
        title = item.findtext("title")
        link = item.findtext("link")
        published = item.findtext("pubDate")
        source_node = item.find("source")
        source_name = source_node.text if source_node is not None else "Google News"
        if title and link:
            items.append({
                "title": title,
                "url": link,
                "published_at": published,
                "source": source_name or "Google News",
                "type": "Public news report — not an official finding",
            })

    return {
        "region": region,
        "query": search_query,
        "reports": items,
        "source": "Google News RSS",
        "notice": (
            "News coverage is not proof of a legal violation. Verify compliance claims "
            "against official CPCB, state pollution control board, or court records."
        ),
    }


@app.get("/api/dashboard")
async def dashboard(
    city: str = Query("Chennai", min_length=2, max_length=80),
    latitude: float | None = Query(None, ge=-90, le=90),
    longitude: float | None = Query(None, ge=-180, le=180),
):
    if latitude is not None and longitude is not None:
        place = {
            "name": f"Selected location ({latitude:.3f}, {longitude:.3f})",
            "admin1": None,
            "country": None,
            "latitude": latitude,
            "longitude": longitude,
        }
    else:
        place = await geocode(city)
    latitude = place.get("latitude")
    longitude = place.get("longitude")
    if latitude is None or longitude is None:
        raise HTTPException(status_code=404, detail="The selected location has no coordinates.")

    air = await get_json(AIR_URL, {
        "latitude": latitude,
        "longitude": longitude,
        "current": ",".join(CURRENT_FIELDS),
        "hourly": ",".join(HOURLY_FIELDS),
        "past_days": 7,
        "forecast_days": 3,
        "timezone": "auto",
    })

    current = air.get("current") or {}
    hourly = air.get("hourly") or {}
    current_aqi = number_or_none(current.get("us_aqi"))
    ml = build_ml_estimate(hourly, current.get("time"))

    history = []
    hourly_times = hourly.get("time", [])
    for i, stamp in enumerate(hourly_times):
        row = {"time": stamp}
        for key in HOURLY_FIELDS:
            values = hourly.get(key, [])
            row[key] = number_or_none(values[i]) if i < len(values) else None
        history.append(row)

    pollutants = [
        {"key": "pm2_5", "label": "PM2.5", "unit": "µg/m³", "value": number_or_none(current.get("pm2_5"))},
        {"key": "pm10", "label": "PM10", "unit": "µg/m³", "value": number_or_none(current.get("pm10"))},
        {"key": "nitrogen_dioxide", "label": "NO₂", "unit": "µg/m³", "value": number_or_none(current.get("nitrogen_dioxide"))},
        {"key": "ozone", "label": "O₃", "unit": "µg/m³", "value": number_or_none(current.get("ozone"))},
        {"key": "sulphur_dioxide", "label": "SO₂", "unit": "µg/m³", "value": number_or_none(current.get("sulphur_dioxide"))},
        {"key": "carbon_monoxide", "label": "CO", "unit": "µg/m³", "value": number_or_none(current.get("carbon_monoxide"))},
    ]

    return {
        "location": {
            "name": place.get("name", city),
            "admin1": place.get("admin1"),
            "country": place.get("country"),
            "latitude": latitude,
            "longitude": longitude,
            "timezone": air.get("timezone"),
        },
        "current": {
            "time": current.get("time"),
            "us_aqi": current_aqi,
            "european_aqi": number_or_none(current.get("european_aqi")),
            "category": category_for_aqi(current_aqi),
        },
        "pollutants": pollutants,
        "history": history,
        "prediction": ml,
        "recommendations": recommendations(current_aqi),
        "source": "Open-Meteo Air Quality API (model-based data; coverage varies by location)",
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }
