import json

import pytest

from app.config import get_settings
from app.services import fertilizer as fert

PROFILES = json.loads((get_settings().knowledge_path / "crop_profiles.json").read_text(encoding="utf-8"))
RICE = {n: PROFILES["crops"]["rice"][n]["mean"] for n in ("N", "P", "K")}  # ~80 / 48 / 40 kg/ha


# --- unit: rules ----------------------------------------------------------------------------------

def test_optimal_soil_needs_no_fertilizer():
    out = fert.recommend("rice", dict(RICE), PROFILES)
    assert out["balanced"] is True
    assert out["fertilizers"] == []
    assert out["warnings"] == []


def test_deficits_map_to_dap_urea_mop_with_dap_nitrogen_credit():
    soil = {"N": RICE["N"] - 40, "P": RICE["P"] - 23, "K": RICE["K"] - 30}
    out = fert.recommend("rice", soil, PROFILES)
    by_name = {f["name"]: f for f in out["fertilizers"]}
    assert set(by_name) == {"DAP", "Urea", "MOP"}

    dap_ha = 23 / 0.46                      # 50 kg/ha DAP
    urea_ha = (40 - 0.18 * dap_ha) / 0.46   # N still needed after the 9 kg N from DAP
    mop_ha = 30 / 0.60
    assert by_name["DAP"]["kg_per_ha"] == pytest.approx(dap_ha, abs=0.1)
    assert by_name["Urea"]["kg_per_ha"] == pytest.approx(urea_ha, abs=0.1)
    assert by_name["MOP"]["kg_per_ha"] == pytest.approx(mop_ha, abs=0.1)
    assert by_name["DAP"]["kg_per_acre"] == pytest.approx(dap_ha / 2.471, abs=0.1)
    assert set(out["organic_alternatives"]) == {"N", "P", "K"}


def test_excess_nutrient_produces_warning_and_no_product():
    out = fert.recommend("rice", {**RICE, "K": RICE["K"] + 60}, PROFILES)
    assert out["nutrients"]["K"]["status"] == "excess"
    assert not any(f["name"] == "MOP" for f in out["fertilizers"])
    assert any("Potassium is already high" in w for w in out["warnings"])


@pytest.mark.parametrize("name,expected", [("Rice", "rice"), ("paddy", "rice"), ("Kidney Beans", "kidneybeans"),
                                           ("chana", "chickpea"), ("arhar", "pigeonpeas"), ("banana", "banana"),
                                           ("wheat", None)])
def test_crop_name_normalization(name, expected):
    assert fert.normalize_crop(name, set(PROFILES["crops"])) == expected


# --- endpoint -------------------------------------------------------------------------------------

def test_fertilizer_endpoint(client, auth_headers):
    res = client.post("/predict/fertilizer", json={"crop": "Paddy", "N": 40, "P": 30, "K": 45}, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["crop"] == "rice"
    assert body["model_version"] == "fertilizer-rules-v1"
    assert "Krishi Vigyan Kendra" in body["disclaimer"]
    assert body["nutrients"]["N"]["status"] == "deficient"


def test_fertilizer_unknown_crop_and_validation(client, auth_headers):
    res = client.post("/predict/fertilizer", json={"crop": "wheat", "N": 40, "P": 30, "K": 45}, headers=auth_headers)
    assert res.status_code == 422
    assert "rice" in res.json()["detail"]["supported_crops"]
    assert client.post("/predict/fertilizer", json={"crop": "rice", "N": -1, "P": 30, "K": 45},
                       headers=auth_headers).status_code == 422
    assert client.post("/predict/fertilizer", json={"crop": "rice", "N": 1, "P": 1, "K": 1}).status_code == 401
