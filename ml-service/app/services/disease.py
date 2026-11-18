"""
Plant disease detection with the MobileNetV2 model trained in notebooks/03.

The exported model has its preprocessing built in (MobileNetV2's [-1, 1] rescaling sits inside the graph),
so here we only decode, fix orientation, convert to RGB and resize to 224x224, then feed raw 0-255 pixels.
"""
from __future__ import annotations

from io import BytesIO

import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError

IMAGE_SIZE = (224, 224)
BACKGROUND_CLASS = "Background_without_leaves"
NO_LEAF_MESSAGE = (
    "No plant leaf was found in this photo. Please take a close, well-lit photo of a single affected leaf, "
    "filling most of the frame, and try again."
)
UNCERTAIN_MESSAGE = (
    "The photo is not clear enough for a confident diagnosis. Please take a close, well-lit photo of a "
    "single affected leaf against a plain background, and try again."
)


class InvalidImageError(ValueError):
    pass


def preprocess(raw: bytes) -> np.ndarray:
    try:
        img = Image.open(BytesIO(raw))
        img.load()
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImageError("File is not a readable image") from exc
    img = ImageOps.exif_transpose(img).convert("RGB")  # phone photos often carry EXIF rotation
    img = img.resize(IMAGE_SIZE, Image.Resampling.BILINEAR)  # same resize method as Keras' image_dataset_from_directory
    return np.asarray(img, dtype=np.float32)[None, ...]


def _split_label(label: str) -> tuple[str, str]:
    """Fallback names from a PlantVillage folder name like 'Tomato___Early_blight'."""
    crop, _, disease = label.partition("___")
    return crop.replace("_", " ").strip(), disease.replace("_", " ").strip()


def _describe(label: str, treatments: dict) -> dict:
    info = treatments.get("classes", {}).get(label)
    crop, disease = (info["crop"], info["disease"]) if info else _split_label(label)
    return {"label": label, "crop": crop, "disease": disease}


def predict(raw: bytes, registry, threshold: float) -> dict:
    x = preprocess(raw)
    probs = np.asarray(registry.disease_model.predict(x, verbose=0))[0]
    classes = registry.disease_classes
    treatments = registry.knowledge.get("disease_treatments", {})

    # The model has a "no leaf in the photo" class (PlantVillage Background_without_leaves). It is never shown
    # as a diagnosis: if it wins, the answer is "uncertain" (retake the photo), and it is left out of top3.
    order = [i for i in np.argsort(probs)[::-1] if classes[i] != BACKGROUND_CLASS]
    no_leaf = classes[int(np.argmax(probs))] == BACKGROUND_CLASS
    top3 = [{**_describe(classes[i], treatments), "confidence": round(float(probs[i]), 4)} for i in order[:3]]
    best = top3[0]
    common = {
        "top3": top3,
        "threshold": threshold,
        "no_leaf": no_leaf,
        "model_version": registry.status["disease"].version,
        "disclaimer": treatments.get("chemical_disclaimer"),
    }

    if no_leaf or best["confidence"] < threshold:
        return {
            "label": "uncertain", "crop": None, "disease": None, "confidence": best["confidence"],
            "uncertain": True, "healthy": None, "treatment": None,
            "message": NO_LEAF_MESSAGE if no_leaf else UNCERTAIN_MESSAGE, **common,
        }

    info = treatments.get("classes", {}).get(best["label"])
    treatment = None
    if info:
        treatment = {k: info[k] for k in ("pathogen", "symptoms", "organic", "chemical", "prevention")}
    return {
        **best, "uncertain": False, "healthy": bool(info and info["healthy"]),
        "treatment": treatment, "message": None, **common,
    }
