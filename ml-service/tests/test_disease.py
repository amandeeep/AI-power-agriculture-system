"""
Disease endpoint tests. They run without TensorFlow: a stand-in model with fixed probabilities is
injected into the registry, so the HTTP contract, thresholding and treatment lookup are all exercised.
"""
from io import BytesIO

import numpy as np
import pytest
from PIL import Image

from app.services.registry import ModelStatus

CLASSES = ["Tomato___Early_blight", "Tomato___Late_blight", "Tomato___healthy", "Potato___Late_blight"]


class FakeModel:
    def __init__(self, probs):
        self.probs = np.asarray([probs], dtype=np.float32)
        self.last_input_shape = None

    def predict(self, x, verbose=0):
        self.last_input_shape = x.shape
        return self.probs


def png_bytes(size=(300, 200), fmt="PNG"):
    buf = BytesIO()
    Image.new("RGB", size, (40, 160, 60)).save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture
def fake_disease_model(client):
    """Temporarily installs a fake model; restores the real registry state afterwards."""
    reg = client.app.state.registry
    saved = (reg.disease_model, reg.disease_classes, reg.status.get("disease"))

    def install(probs, classes=CLASSES):
        reg.disease_model = FakeModel(probs)
        reg.disease_classes = classes
        reg.status["disease"] = ModelStatus(loaded=True, version="disease-test")
        return reg.disease_model

    yield install
    reg.disease_model, reg.disease_classes, reg.status["disease"] = saved


def post_image(client, headers, data=None, ctype="image/png"):
    return client.post("/predict/disease", headers=headers,
                       files={"file": ("leaf.png", data if data is not None else png_bytes(), ctype)})


def test_disease_returns_503_when_model_missing(client, auth_headers):
    reg = client.app.state.registry
    if reg.status["disease"].loaded:
        pytest.skip("a real disease model is installed")
    res = post_image(client, auth_headers)
    assert res.status_code == 503
    assert "notebooks/03" in res.json()["detail"]["message"]
    # Graceful degradation: the other services still work.
    assert client.get("/health").json()["models"]["crop"]["loaded"] in (True, False)


def test_disease_requires_internal_key(client):
    assert post_image(client, {}).status_code == 401


def test_confident_prediction_includes_treatment(client, auth_headers, fake_disease_model):
    model = fake_disease_model([0.05, 0.85, 0.07, 0.03])
    res = post_image(client, auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert model.last_input_shape == (1, 224, 224, 3)  # resized from 300x200
    assert body["label"] == "Tomato___Late_blight"
    assert body["crop"] == "Tomato" and body["disease"] == "Late blight"
    assert body["confidence"] == pytest.approx(0.85, abs=1e-4)
    assert body["uncertain"] is False and body["healthy"] is False
    assert [t["label"] for t in body["top3"]] == ["Tomato___Late_blight", "Tomato___healthy", "Tomato___Early_blight"]
    assert body["treatment"]["chemical"] and body["treatment"]["organic"]
    assert body["model_version"] == "disease-test"
    assert "label" in body["disclaimer"]


def test_low_confidence_is_uncertain(client, auth_headers, fake_disease_model):
    fake_disease_model([0.40, 0.35, 0.15, 0.10])
    body = post_image(client, auth_headers).json()
    assert body["label"] == "uncertain"
    assert body["uncertain"] is True and body["treatment"] is None
    assert "clear" in body["message"]
    assert len(body["top3"]) == 3


def test_photo_without_leaf_is_uncertain_and_hidden_from_top3(client, auth_headers, fake_disease_model):
    fake_disease_model([0.02, 0.03, 0.01, 0.04, 0.90], CLASSES + ["Background_without_leaves"])
    body = post_image(client, auth_headers).json()
    assert body["uncertain"] is True and body["no_leaf"] is True
    assert body["label"] == "uncertain" and body["treatment"] is None
    assert "No plant leaf" in body["message"]
    assert "Background_without_leaves" not in [t["label"] for t in body["top3"]]
    assert len(body["top3"]) == 3


def test_leaf_wins_over_background_class(client, auth_headers, fake_disease_model):
    fake_disease_model([0.05, 0.80, 0.05, 0.05, 0.05], CLASSES + ["Background_without_leaves"])
    body = post_image(client, auth_headers).json()
    assert body["no_leaf"] is False and body["label"] == "Tomato___Late_blight"


def test_healthy_leaf(client, auth_headers, fake_disease_model):
    fake_disease_model([0.01, 0.01, 0.97, 0.01])
    body = post_image(client, auth_headers).json()
    assert body["healthy"] is True and body["disease"] == "Healthy"


def test_rejects_wrong_type_and_corrupt_image(client, auth_headers, fake_disease_model):
    fake_disease_model([0.9, 0.05, 0.03, 0.02])
    assert post_image(client, auth_headers, b"hello", "text/plain").status_code == 415
    assert post_image(client, auth_headers, b"not really a png").status_code == 400


def test_rejects_oversized_image(client, auth_headers, fake_disease_model):
    fake_disease_model([0.9, 0.05, 0.03, 0.02])
    assert post_image(client, auth_headers, b"\0" * (5 * 1024 * 1024 + 10)).status_code == 413


def test_treatments_cover_all_38_plantvillage_classes(client):
    classes = client.app.state.registry.knowledge["disease_treatments"]["classes"]
    assert len(classes) == 38
    for label, info in classes.items():
        for key in ("crop", "disease", "symptoms", "organic", "chemical", "prevention", "healthy"):
            assert key in info, f"{label} missing {key}"
        if not info["healthy"]:
            assert info["chemical"], f"{label} has no chemical/vector advice"
