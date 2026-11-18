"""
Model registry: loads every model artifact once at startup and records what is available.

Each loader is independent, so a missing or broken artifact (e.g. the disease model before it
has been trained on Colab) only disables that one feature. The rest of the service keeps running.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import joblib

from app.config import Settings

log = logging.getLogger("ml.registry")

# Artifact file names (see ml-service/models/).
CROP_MODEL_FILE = "crop_stack.joblib"
CROP_SCALER_FILE = "scaler.joblib"
CROP_ENCODER_FILE = "label_encoder.joblib"
CROP_META_FILE = "crop_model_meta.json"
DISEASE_MODEL_FILE = "disease_mnv2.keras"
DISEASE_CLASSES_FILE = "class_names.json"


@dataclass
class ModelStatus:
    loaded: bool = False
    version: str | None = None
    error: str | None = None


@dataclass
class Registry:
    crop_model: Any = None
    crop_scaler: Any = None
    crop_encoder: Any = None
    disease_model: Any = None
    disease_classes: list[str] = field(default_factory=list)
    knowledge: dict[str, Any] = field(default_factory=dict)
    status: dict[str, ModelStatus] = field(default_factory=dict)

    def load_all(self, settings: Settings) -> None:
        self._load_crop(settings.models_path)
        self._load_disease(settings.models_path)
        self._load_knowledge(settings.knowledge_path)

    # --- loaders -------------------------------------------------------------------------------

    def _load_crop(self, models: Path) -> None:
        st = ModelStatus()
        try:
            files = [models / f for f in (CROP_MODEL_FILE, CROP_SCALER_FILE, CROP_ENCODER_FILE)]
            missing = [f.name for f in files if not f.exists()]
            if missing:
                raise FileNotFoundError(f"missing {', '.join(missing)} (run notebooks/02_crop_models)")
            self.crop_model, self.crop_scaler, self.crop_encoder = (joblib.load(f) for f in files)
            st.version = _read_version(models / CROP_META_FILE) or "crop-stack-unversioned"
            st.loaded = True
        except Exception as exc:  # noqa: BLE001 - any failure just disables this model
            st.error = str(exc)
            log.warning("Crop model not loaded: %s", exc)
        self.status["crop"] = st

    def _load_disease(self, models: Path) -> None:
        st = ModelStatus()
        try:
            model_file, classes_file = models / DISEASE_MODEL_FILE, models / DISEASE_CLASSES_FILE
            if not model_file.exists() or not classes_file.exists():
                raise FileNotFoundError(
                    f"missing {DISEASE_MODEL_FILE} / {DISEASE_CLASSES_FILE} (train locally: python -m training.train_disease, or notebooks/03 on Colab)"
                )
            try:
                import tensorflow as tf  # imported lazily: TF is optional and slow to import
            except ImportError as exc:
                raise RuntimeError("tensorflow not installed (pip install -r requirements-tf.txt)") from exc
            self.disease_model = tf.keras.models.load_model(model_file)
            self.disease_classes = json.loads(classes_file.read_text(encoding="utf-8"))
            st.version = "disease-mnv2-" + str(int(model_file.stat().st_mtime))
            st.loaded = True
        except Exception as exc:  # noqa: BLE001
            st.error = str(exc)
            log.warning("Disease model not loaded: %s", exc)
        self.status["disease"] = st

    def _load_knowledge(self, knowledge: Path) -> None:
        for name in ("crop_profiles", "crop_seasons", "disease_treatments", "crop_families", "district_soil", "district_boundaries"):
            f = knowledge / f"{name}.json"
            if f.exists():
                self.knowledge[name] = json.loads(f.read_text(encoding="utf-8"))
        # Fertilizer is rule-based: it only needs the crop profiles (ideal NPK per crop).
        self.status["fertilizer"] = ModelStatus(
            loaded="crop_profiles" in self.knowledge,
            version="fertilizer-rules-v1" if "crop_profiles" in self.knowledge else None,
            error=None if "crop_profiles" in self.knowledge else "knowledge/crop_profiles.json missing",
        )

        # District soil estimates come from the user's Soil Health Card CSV (training/build_district_soil.py).
        ds = self.knowledge.get("district_soil")
        self.status["district_soil"] = ModelStatus(
            loaded=ds is not None,
            version=ds.get("version") if ds else None,
            error=None if ds else "knowledge/district_soil.json missing (run training.build_district_soil)",
        )

    # --- reporting -----------------------------------------------------------------------------

    def summary(self) -> dict[str, Any]:
        return {
            "models": {k: v.__dict__ for k, v in self.status.items()},
            "knowledge": sorted(self.knowledge.keys()),
        }


def _read_version(meta_file: Path) -> str | None:
    if not meta_file.exists():
        return None
    return json.loads(meta_file.read_text(encoding="utf-8")).get("model_version")
