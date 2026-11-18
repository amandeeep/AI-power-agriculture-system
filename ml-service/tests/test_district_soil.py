"""District soil build (SHC class shares -> model scale) and the coordinates -> district lookup."""
import pytest

from app.services.soil import locate_lgd, point_in_polygon
from training.build_district_soil import (MAX_CONFIDENCE, build_district, class_shares, confidence, pick_year,
                                          to_model_scale)

ANCHORS = {k: {"l": 10.0, "m": 50.0, "h": 90.0} for k in ("N", "P", "K")}


def _row(**overrides):
    """A district row with full 2025-26 data (100 samples each) unless overridden."""
    r = {"state_name": "Telangana", "district_name": "Testpur", "lgd_district_code": 999}
    for n in ("n", "p", "k"):
        r.update({f"per_{n}_l_25_26": 50, f"per_{n}_m_25_26": 50, f"per_{n}_h_25_26": 0,
                  f"val_{n}_l_25_26": 50, f"val_{n}_m_25_26": 50, f"val_{n}_h_25_26": 0})
    r.update({"per_ph_aci_25_26": 0, "per_ph_neu_25_26": 50, "per_ph_alk_25_26": 50,
              "val_ph_aci_25_26": 0, "val_ph_neu_25_26": 50, "val_ph_alk_25_26": 50})
    r.update(overrides)
    return r


def test_class_shares_normalise_and_detect_missing_years():
    assert class_shares(_row(), "n", ["l", "m", "h"], "25_26") == {"l": 0.5, "m": 0.5, "h": 0.0}
    assert class_shares(_row(), "n", ["l", "m", "h"], "24_25") is None


def test_model_scale_is_the_share_weighted_anchor():
    assert to_model_scale({"l": 1.0, "m": 0.0, "h": 0.0}, ANCHORS["N"]) == 10.0
    assert to_model_scale({"l": 0.5, "m": 0.5, "h": 0.0}, ANCHORS["N"]) == 30.0


def test_pick_year_prefers_newest_well_sampled_year():
    row = _row(**{"per_n_l_24_25": 0, "per_n_m_24_25": 0, "per_n_h_24_25": 100,
                  "val_n_l_24_25": 0, "val_n_m_24_25": 0, "val_n_h_24_25": 500,
                  "val_n_l_25_26": 1, "val_n_m_25_26": 1, "val_n_h_25_26": 0})  # 2025-26 has 2 samples only
    year, shares, n = pick_year(row, "n", ["l", "m", "h"])
    assert (year, n, shares["h"]) == ("24_25", 500, 1.0)


def test_confidence_grows_with_samples_and_is_capped():
    assert confidence(0, 1.0) == 0.0
    assert confidence(10, 0.5) < confidence(1000, 0.5) < confidence(1000, 1.0) == MAX_CONFIDENCE


def test_build_district():
    d = build_district(_row(), ANCHORS)
    assert (d["N"], d["P"], d["K"], d["ph"]) == (30.0, 30.0, 30.0, 7.5)  # pH: half neutral (7) + half alkaline (8)
    assert d["lgd"] == 999 and d["year"] == "2025-26" and d["samples"] == 100
    assert d["status"]["N"] == {"low": 50.0, "medium": 50.0, "high": 0.0}
    assert list(d["history"]) == ["2025-26"]
    assert build_district(_row(per_ph_aci_25_26=None), ANCHORS) is None   # no pH in any year
    few = {f"val_{n}_{c}_25_26": 1 for n in ("n", "p", "k") for c in "lmh"}
    assert build_district(_row(**few), ANCHORS) is None                    # 3 samples -> left out


SQUARE_WITH_HOLE = [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]]


def test_point_in_polygon_with_hole():
    assert point_in_polygon(1, 1, SQUARE_WITH_HOLE)
    assert not point_in_polygon(5, 5, SQUARE_WITH_HOLE)  # inside the hole
    assert not point_in_polygon(11, 5, SQUARE_WITH_HOLE)
    bounds = {"districts": [{"lgd": 7, "bbox": [0, 0, 10, 10], "polygons": [SQUARE_WITH_HOLE]}]}
    assert locate_lgd(1, 1, bounds) == 7 and locate_lgd(5, 5, bounds) is None


# --- endpoint with the real SHC data (skipped until training.build_district_soil has been run) --------

def _real(client):
    kb = client.app.state.registry.knowledge
    ds = kb.get("district_soil")
    if not ds or "district_boundaries" not in kb or not ds.get("version", "").startswith("shc-districts"):
        pytest.skip("real district soil data not built")
    return ds


@pytest.mark.parametrize("lat,lon,district", [
    (17.0504, 79.2669, "Nalgonda"),       # Nalgonda town
    (13.0827, 80.2707, "Chennai"),
    (30.9010, 75.8573, None),             # Ludhiana: too few samples -> 404 with the LGD code
])
def test_real_lookup_by_coordinates(client, auth_headers, lat, lon, district):
    _real(client)
    res = client.get(f"/soil/district?lat={lat}&lon={lon}", headers=auth_headers)
    if district is None:
        assert res.status_code == 404 and res.json()["detail"]["lgd"]
        return
    body = res.json()
    assert res.status_code == 200, body
    assert body["district"] == district and body["matched_by"] == "coordinates"
    assert 0 < body["confidence"] <= 0.7 and {"N", "P", "K", "ph", "status", "history"} <= set(body)


def test_real_lookup_by_name_and_outside_india(client, auth_headers):
    _real(client)
    assert client.get("/soil/district?district=ranga%20reddy", headers=auth_headers).json()["state"] == "Telangana"
    assert client.get("/soil/district?lat=51.5&lon=-0.12", headers=auth_headers).status_code == 404
    assert client.get("/soil/district?lat=17", headers=auth_headers).status_code == 422
