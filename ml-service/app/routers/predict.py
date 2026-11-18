"""Prediction routes. All require the X-Internal-Key header (only the Node server calls them)."""
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status

from app.config import Settings, get_settings
from app.schemas import CropRequest, CropResponse, FertilizerRequest
from app.security import require_internal_key
from app.services import crop as crop_service
from app.services import disease as disease_service
from app.services import fertilizer as fertilizer_service

router = APIRouter(prefix="/predict", tags=["predict"], dependencies=[Depends(require_internal_key)])

MAX_IMAGE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}


def _require_loaded(registry, name: str, hint: str) -> None:
    st = registry.status.get(name)
    if not st or not st.loaded:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            {"message": f"{name} model is not available. {hint}", "reason": st.error if st else None},
        )


@router.post("/crop", response_model=CropResponse)
def predict_crop(body: CropRequest, request: Request) -> dict:
    registry = request.app.state.registry
    _require_loaded(registry, "crop", "Train it with notebooks/02_crop_models.ipynb.")
    if "crop_seasons" not in registry.knowledge or "crop_profiles" not in registry.knowledge:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {"message": "crop knowledge files are missing"})
    return crop_service.recommend(body, registry)


@router.post("/fertilizer")
def predict_fertilizer(body: FertilizerRequest, request: Request) -> dict:
    registry = request.app.state.registry
    _require_loaded(registry, "fertilizer", "knowledge/crop_profiles.json is required.")
    profiles = registry.knowledge["crop_profiles"]
    crop = fertilizer_service.normalize_crop(body.crop, set(profiles["crops"]))
    if crop is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            {"message": f"Unknown crop '{body.crop}'.", "supported_crops": sorted(profiles["crops"])},
        )
    return fertilizer_service.recommend(crop, body.model_dump(include={"N", "P", "K"}), profiles)


@router.post("/disease")
def predict_disease(
    request: Request,
    file: UploadFile = File(..., description="Leaf photo: jpg, png or webp, max 5 MB"),
    settings: Settings = Depends(get_settings),
) -> dict:
    registry = request.app.state.registry
    # Graceful degradation: without the model this one endpoint returns 503; everything else keeps working.
    _require_loaded(registry, "disease", "Train it with notebooks/03_disease_mobilenetv2.ipynb on Colab and "
                                         "copy disease_mnv2.keras + class_names.json into ml-service/models/.")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                            {"message": "Only JPG, PNG or WEBP images are accepted."})
    raw = file.file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, {"message": "Image must be 5 MB or smaller."})
    try:
        return disease_service.predict(raw, registry, settings.disease_confidence_threshold)
    except disease_service.InvalidImageError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, {"message": str(exc)}) from exc
