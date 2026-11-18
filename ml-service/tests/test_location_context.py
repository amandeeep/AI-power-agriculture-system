"""Phase 6.5: rotation + area components and the district soil endpoints."""
import json
from pathlib import Path

import pytest

from app.services.crop import (WEIGHTS, area_scores, canonical_crop, effective_weights, rotation_score)

FAMILIES = json.loads((Path(__file__).parent.parent / "knowledge" / "crop_families.json").read_text(encoding="utf-8"))
RICE_LIKE = {"N": 90, "P": 42, "K": 43, "temperature": 21, "humidity": 82, "ph": 6.5, "rainfall": 203, "month": 7}


@pytest.mark.parametrize("crop,previous,score,reason", [
    ("rice", ["rice"], 0.0, "same_as_last_season"),
    ("rice", ["maize", "rice"], 0.4, "repeated_recently"),
    ("chickpea", ["rice"], 1.0, "legume_after_non_legume"),
    ("chickpea", ["wheat"], 1.0, "legume_after_non_legume"),  # history crop outside the 22 model crops
    ("lentil", ["chickpea"], 0.5, "same_family"),
    ("cotton", ["rice"], 0.8, "different_family"),
    ("mango", ["rice"], 0.5, "perennial"),
])
def test_rotation_rules(crop, previous, score, reason):
    assert rotation_score(crop, previous, FAMILIES) == (score, reason)


def test_rotation_without_history_is_not_used():
    assert rotation_score("rice", [], FAMILIES) == (None, None)


def test_canonical_crop_maps_local_names():
    assert canonical_crop("Paddy") == "rice"
    assert canonical_crop("chana") == "chickpea"
    assert canonical_crop("Wheat") == "wheat"


def test_area_needs_minimum_records():
    assert area_scores({"rice": 2, "maize": 2}) == ({}, 4)
    scores, total = area_scores({"rice": 4, "paddy": 2, "maize": 3})
    assert total == 9 and scores == {"rice": 1.0, "maize": 0.5}


def test_weights_reduce_to_original_without_context():
    assert effective_weights(False, False) == WEIGHTS
    w = effective_weights(True, True)
    assert w == {"probability": 0.48, "season": 0.16, "weather": 0.16, "rotation": 0.1, "area": 0.1}
    assert sum(w.values()) == pytest.approx(1.0)
    assert sum(effective_weights(True, False).values()) == pytest.approx(1.0)


def _crop_loaded(client):
    return client.get("/health").json()["models"]["crop"]["loaded"]


def test_crop_endpoint_with_context(client, auth_headers):
    if not _crop_loaded(client):
        pytest.skip("crop model not trained yet")
    plain = client.post("/predict/crop", json=RICE_LIKE, headers=auth_headers).json()
    assert plain["top"][0]["crop"] == "rice" and plain["top"][0]["rotation_score"] is None

    ctx = {"previous_crops": ["rice", "rice"], "area_counts": {"maize": 6}, "soil_source": "field_tests"}
    body = client.post("/predict/crop", json={**RICE_LIKE, "context": ctx}, headers=auth_headers).json()
    rice = next(r for r in body["top"] if r["crop"] == "rice")
    assert rice["rotation_reason"] == "same_as_last_season" and rice["area_score"] == 0.0
    assert rice["final_score"] < plain["top"][0]["final_score"]
    assert body["weights"]["rotation"] == 0.1 and body["soil_source"] == "field_tests" and body["area_records"] == 6


# --- district soil -------------------------------------------------------------------------------

DS = {"version": "shc-test", "scale_note": "test", "districts": [
    {"state": "Telangana", "district": "Nalgonda", "N": 60, "P": 40, "K": 35, "ph": 7.4, "samples": 900, "confidence": 0.6},
    {"state": "Bihar", "district": "Aurangabad", "N": 70, "P": 45, "K": 30, "ph": 7.0, "samples": 500, "confidence": 0.5},
    {"state": "Maharashtra", "district": "Aurangabad", "N": 50, "P": 30, "K": 50, "ph": 7.9, "samples": 700, "confidence": 0.5},
]}


@pytest.fixture
def district_soil(client):
    kb = client.app.state.registry.knowledge
    saved = kb.get("district_soil")
    kb["district_soil"] = DS
    yield
    if saved is None:
        kb.pop("district_soil", None)
    else:
        kb["district_soil"] = saved


def test_district_soil_unavailable_without_data(client, auth_headers):
    if "district_soil" in client.app.state.registry.knowledge:
        pytest.skip("real district data is installed")
    assert client.get("/soil/district?district=Nalgonda", headers=auth_headers).status_code == 503


def test_district_soil_lookup(client, auth_headers, district_soil):
    assert client.get("/soil/district?district=Nalgonda").status_code == 401
    res = client.get("/soil/district?district=nalgonda", headers=auth_headers)
    assert res.status_code == 200 and res.json()["N"] == 60 and res.json()["soil_source"] == "district_estimate"
    assert client.get("/soil/district?district=Atlantis", headers=auth_headers).status_code == 404
    amb = client.get("/soil/district?district=Aurangabad", headers=auth_headers)
    assert amb.status_code == 409
    ok = client.get("/soil/district?district=Aurangabad&state=Bihar", headers=auth_headers)
    assert ok.json()["N"] == 70
    assert len(client.get("/soil/districts", headers=auth_headers).json()["districts"]) == 3
