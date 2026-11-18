"""Pydantic request/response schemas, with realistic validation ranges."""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class WeatherInput(BaseModel):
    """Live conditions used for weather_score. Any field may be omitted.

    rainfall uses the dataset's scale (mm over roughly a month / growing period), not mm/day.
    The Node server converts a forecast to this scale before calling.
    """
    temperature: float | None = Field(None, ge=-20, le=60, description="°C")
    humidity: float | None = Field(None, ge=0, le=100, description="% relative humidity")
    rainfall: float | None = Field(None, ge=0, le=5000, description="mm")


class CropContext(BaseModel):
    """Location/history context for the extended score (Phase 6.5). Every field is optional.

    When `context` is sent, the score uses the extended weights (rotation + area components).
    """
    previous_crops: list[str] = Field(default_factory=list, max_length=20,
                                      description="Crops grown on this field, most recent season first")
    area_counts: dict[str, int] = Field(default_factory=dict,
                                        description="Nearby farms: crop -> number of records (grown or recommended)")
    soil_source: str | None = Field(None, max_length=40, description="field_tests | district_estimate | manual")


class CropRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {
        "N": 90, "P": 42, "K": 43, "temperature": 21, "humidity": 82, "ph": 6.5, "rainfall": 203, "month": 7}})

    N: float = Field(..., ge=0, le=300, description="Nitrogen, kg/ha")
    P: float = Field(..., ge=0, le=300, description="Phosphorus, kg/ha")
    K: float = Field(..., ge=0, le=400, description="Potassium, kg/ha")
    temperature: float = Field(..., ge=-20, le=60, description="°C")
    humidity: float = Field(..., ge=0, le=100, description="%")
    ph: float = Field(..., ge=0, le=14)
    rainfall: float = Field(..., ge=0, le=5000, description="mm")
    weather: WeatherInput | None = Field(None, description="Live weather; falls back to the soil/climate inputs")
    month: int | None = Field(None, ge=1, le=12, description="1-12; defaults to the current month")
    context: CropContext | None = Field(None, description="Rotation/area context; switches to extended weights")


class CropScore(BaseModel):
    crop: str
    probability: float = Field(..., description="Stacked-model probability (0-1)")
    season_score: float = Field(..., description="1 current season, 0.5 upcoming season, 0 otherwise")
    weather_score: float = Field(..., description="Fit of weather to the crop's ideal range (0-1)")
    final_score: float = Field(..., description="Weighted sum of the components (see `weights`)")
    seasons: list[str]
    weather_detail: dict[str, float]
    rotation_score: float | None = Field(None, description="Crop-rotation fit given the field's past crops (0-1)")
    rotation_reason: str | None = None
    area_score: float | None = Field(None, description="Popularity among nearby farms (0-1)")


class FertilizerRequest(BaseModel):
    model_config = ConfigDict(json_schema_extra={"example": {"crop": "rice", "N": 40, "P": 30, "K": 45}})

    crop: str = Field(..., min_length=2, max_length=40, description="Crop name, e.g. rice, maize, chana")
    N: float = Field(..., ge=0, le=300, description="Soil nitrogen, kg/ha")
    P: float = Field(..., ge=0, le=300, description="Soil phosphorus (P2O5), kg/ha")
    K: float = Field(..., ge=0, le=400, description="Soil potassium (K2O), kg/ha")


class CropResponse(BaseModel):
    top: list[CropScore]
    confidence: float = Field(..., description="Highest model probability among all crops")
    current_season: str
    month: int
    weights: dict[str, float]
    model_version: str
    soil_source: str | None = None
    area_records: int | None = Field(None, description="Nearby records behind area_score (0 = not used)")
