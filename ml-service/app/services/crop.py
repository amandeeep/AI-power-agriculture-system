"""
Crop recommendation = stacked-model probability blended with agronomic context:

    final = 0.6 * model_probability + 0.2 * season_score + 0.2 * weather_score

With location/history context (Phase 6.5), two optional components are added:
    rotation_score  fit with the field's past crops (knowledge/crop_families.json)
    area_score      popularity among nearby farms (needs >= MIN_AREA_RECORDS records)
Each active extra takes its weight from the base components proportionally, so with no context the
score is exactly the original formula. Example with both active: 0.48 / 0.16 / 0.16 / 0.10 / 0.10.

Every component is returned, so the UI and Gemini can explain why a crop ranks where it does.
"""
from __future__ import annotations

import re
from datetime import date

import numpy as np

from app.schemas import CropRequest
from app.services.fertilizer import ALIASES

WEIGHTS = {"probability": 0.6, "season": 0.2, "weather": 0.2}
EXTRA_WEIGHTS = {"rotation": 0.1, "area": 0.1}
MIN_AREA_RECORDS = 5
FEATURES = ["N", "P", "K", "temperature", "humidity", "ph", "rainfall"]
WEATHER_VARS = ["temperature", "humidity", "rainfall"]
TOP_K = 5


# --- season ---------------------------------------------------------------------------------------

def season_for_month(month: int, seasons_kb: dict) -> str:
    for name, s in seasons_kb["seasons"].items():
        if month in s["months"]:
            return name
    raise ValueError(f"month {month} is not mapped to a season")


def season_score(crop: str, month: int, seasons_kb: dict) -> float:
    """1.0 if sown in the current season, 0.5 if sown in the upcoming (adjacent) season, else 0."""
    scoring = seasons_kb["scoring"]
    crop_seasons = seasons_kb["crops"].get(crop, {}).get("seasons", [])
    current = season_for_month(month, seasons_kb)
    order = seasons_kb["season_order"]
    upcoming = order[(order.index(current) + 1) % len(order)]
    if current in crop_seasons:
        return scoring["current"]
    if upcoming in crop_seasons:
        return scoring["adjacent"]
    return scoring["other"]


# --- weather --------------------------------------------------------------------------------------

def variable_fit(value: float, mean: float, std: float) -> float:
    """1.0 within ±1 std of the crop's mean, decaying linearly to 0 at ±3 std."""
    z = abs(value - mean) / max(std, 1e-6)
    return float(np.clip(1.0 - (z - 1.0) / 2.0, 0.0, 1.0))


def weather_score(crop: str, conditions: dict[str, float], profiles: dict) -> tuple[float, dict[str, float]]:
    profile = profiles["crops"][crop]
    detail = {
        v: round(variable_fit(conditions[v], profile[v]["mean"], profile[v]["std"]), 3)
        for v in WEATHER_VARS
        if conditions.get(v) is not None
    }
    return (round(float(np.mean(list(detail.values()))), 4) if detail else 0.0), detail


# --- rotation + area (Phase 6.5) ------------------------------------------------------------------

def _crop_key(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower())


def canonical_crop(name: str) -> str:
    """Model crop name when known (paddy -> rice, chana -> chickpea), else the cleaned name (wheat)."""
    key = _crop_key(name)
    return ALIASES.get(key, key)


def rotation_score(crop: str, previous: list[str], families_kb: dict) -> tuple[float | None, str | None]:
    """(score, reason code). previous = canonical crop names, most recent season first."""
    if not previous:
        return None, None
    sc, fam = families_kb["scoring"], families_kb["families"]
    recent = previous[: families_kb.get("recent_seasons", 3)]
    family, last_family = fam.get(crop), fam.get(previous[0])
    if family == "perennial":
        return sc["perennial"], "perennial"
    if crop == previous[0]:
        return sc["same_as_last_season"], "same_as_last_season"
    if crop in recent:
        return sc["repeated_recently"], "repeated_recently"
    if family == "legume" and last_family not in (None, "legume"):
        return sc["legume_after_non_legume"], "legume_after_non_legume"
    if family is None or last_family is None:
        return sc["no_history"], "unknown_family"
    if family == last_family:
        return sc["same_family"], "same_family"
    return sc["different_family"], "different_family"


def area_scores(area_counts: dict[str, int]) -> tuple[dict[str, float], int]:
    """Crop -> count / max count, plus the total number of records. Empty when there is too little data."""
    counts: dict[str, int] = {}
    for name, n in area_counts.items():
        if n > 0:
            key = canonical_crop(name)
            counts[key] = counts.get(key, 0) + int(n)
    total = sum(counts.values())
    if total < MIN_AREA_RECORDS:
        return {}, total
    top = max(counts.values())
    return {c: round(n / top, 4) for c, n in counts.items()}, total


def effective_weights(use_rotation: bool, use_area: bool) -> dict[str, float]:
    extras = {k: w for k, w in EXTRA_WEIGHTS.items() if (k == "rotation" and use_rotation) or (k == "area" and use_area)}
    scale = 1.0 - sum(extras.values())
    return {**{k: round(w * scale, 4) for k, w in WEIGHTS.items()}, **extras}


# --- recommendation -------------------------------------------------------------------------------

def recommend(req: CropRequest, registry) -> dict:
    month = req.month or date.today().month
    seasons_kb = registry.knowledge["crop_seasons"]
    profiles = registry.knowledge["crop_profiles"]

    x = np.array([[getattr(req, f) for f in FEATURES]], dtype=float)
    proba = registry.crop_model.predict_proba(registry.crop_scaler.transform(x))[0]
    classes = registry.crop_encoder.inverse_transform(registry.crop_model.classes_)

    # Live weather overrides the climate inputs field by field; missing fields fall back to the inputs.
    live = req.weather.model_dump() if req.weather else {}
    conditions = {v: live.get(v) if live.get(v) is not None else getattr(req, v) for v in WEATHER_VARS}

    ctx = req.context
    families_kb = registry.knowledge.get("crop_families")
    previous = [canonical_crop(c) for c in (ctx.previous_crops if ctx else []) if c.strip()]
    use_rotation = bool(previous) and families_kb is not None
    area, area_total = area_scores(ctx.area_counts) if ctx else ({}, 0)
    use_area = bool(area)
    weights = effective_weights(use_rotation, use_area)

    scored = []
    for crop, p in zip(classes, proba):
        s = season_score(crop, month, seasons_kb)
        w, detail = weather_score(crop, conditions, profiles)
        rot, reason = rotation_score(str(crop), previous, families_kb) if use_rotation else (None, None)
        ar = area.get(str(crop), 0.0) if use_area else None
        final = weights["probability"] * p + weights["season"] * s + weights["weather"] * w
        if rot is not None:
            final += weights["rotation"] * rot
        if ar is not None:
            final += weights["area"] * ar
        scored.append({
            "crop": str(crop),
            "probability": round(float(p), 4),
            "season_score": s,
            "weather_score": w,
            "final_score": round(float(final), 4),
            "seasons": seasons_kb["crops"].get(crop, {}).get("seasons", []),
            "weather_detail": detail,
            "rotation_score": rot,
            "rotation_reason": reason,
            "area_score": ar,
        })
    scored.sort(key=lambda r: r["final_score"], reverse=True)

    return {
        "top": scored[:TOP_K],
        "confidence": round(float(proba.max()), 4),
        "current_season": season_for_month(month, seasons_kb),
        "month": month,
        "weights": weights,
        "model_version": registry.status["crop"].version,
        "soil_source": ctx.soil_source if ctx else None,
        "area_records": area_total if ctx else None,
    }
