import pytest

from app.services.crop import season_score, variable_fit

RICE_LIKE = {"N": 90, "P": 42, "K": 43, "temperature": 21, "humidity": 82, "ph": 6.5, "rainfall": 203}

SEASONS_KB = {
    "seasons": {"Kharif": {"months": [6, 7, 8, 9, 10]}, "Rabi": {"months": [11, 12, 1, 2]}, "Zaid": {"months": [3, 4, 5]}},
    "season_order": ["Kharif", "Rabi", "Zaid"],
    "scoring": {"current": 1.0, "adjacent": 0.5, "other": 0.0},
    "crops": {"rice": {"seasons": ["Kharif"]}, "chickpea": {"seasons": ["Rabi"]}, "watermelon": {"seasons": ["Zaid"]}},
}


# --- unit: scoring rules --------------------------------------------------------------------------

@pytest.mark.parametrize("crop,month,expected", [
    ("rice", 7, 1.0),        # Kharif crop in Kharif
    ("chickpea", 9, 0.5),    # Rabi is the upcoming season after Kharif
    ("watermelon", 7, 0.0),  # Zaid crop in Kharif
    ("watermelon", 1, 0.5),  # Zaid follows Rabi
])
def test_season_score(crop, month, expected):
    assert season_score(crop, month, SEASONS_KB) == expected


def test_variable_fit_is_1_inside_one_std_and_0_beyond_three():
    assert variable_fit(20, 20, 2) == 1.0
    assert variable_fit(22, 20, 2) == 1.0
    assert variable_fit(24, 20, 2) == pytest.approx(0.5)
    assert variable_fit(30, 20, 2) == 0.0


# --- endpoint -------------------------------------------------------------------------------------

def _crop_loaded(client):
    return client.get("/health").json()["models"]["crop"]["loaded"]


def test_crop_requires_internal_key(client):
    assert client.post("/predict/crop", json=RICE_LIKE).status_code == 401
    assert client.post("/predict/crop", json=RICE_LIKE, headers={"X-Internal-Key": "wrong"}).status_code == 401


def test_crop_rejects_out_of_range_input(client, auth_headers):
    res = client.post("/predict/crop", json={**RICE_LIKE, "ph": 15}, headers=auth_headers)
    assert res.status_code == 422
    res = client.post("/predict/crop", json={k: v for k, v in RICE_LIKE.items() if k != "N"}, headers=auth_headers)
    assert res.status_code == 422


def test_crop_recommendation_shape_and_scores(client, auth_headers):
    if not _crop_loaded(client):
        pytest.skip("crop model not trained yet")
    res = client.post("/predict/crop", json={**RICE_LIKE, "month": 7}, headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["model_version"].startswith("crop-stack")
    assert body["current_season"] == "Kharif"
    assert len(body["top"]) == 5
    top = body["top"][0]
    assert top["crop"] == "rice"
    for r in body["top"]:
        expected = 0.6 * r["probability"] + 0.2 * r["season_score"] + 0.2 * r["weather_score"]
        assert r["final_score"] == pytest.approx(expected, abs=1e-3)
    finals = [r["final_score"] for r in body["top"]]
    assert finals == sorted(finals, reverse=True)


def test_live_weather_changes_weather_score(client, auth_headers):
    if not _crop_loaded(client):
        pytest.skip("crop model not trained yet")
    base = client.post("/predict/crop", json={**RICE_LIKE, "month": 7}, headers=auth_headers).json()
    hot = client.post("/predict/crop", json={**RICE_LIKE, "month": 7, "weather": {"temperature": 45, "humidity": 15}},
                      headers=auth_headers).json()
    rice = lambda b: next(r for r in b["top"] if r["crop"] == "rice")  # noqa: E731
    assert rice(hot)["weather_score"] < rice(base)["weather_score"]
