"""District soil estimates (Soil Health Card aggregates). Internal key required, like /predict.

GET /soil/district?lat=..&lon=..           district from coordinates (point-in-polygon), preferred
GET /soil/district?district=..&state=..    district by name
GET /soil/districts                        list for autocomplete
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.security import require_internal_key
from app.services.soil import find_by_name, locate_lgd

router = APIRouter(prefix="/soil", tags=["soil"], dependencies=[Depends(require_internal_key)])

NOT_INSTALLED = ("District soil data is not available yet. Run: "
                 ".venv/Scripts/python.exe -m training.build_district_soil --download")


def _data(request: Request) -> dict:
    ds = request.app.state.registry.knowledge.get("district_soil")
    if ds is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, {"message": NOT_INSTALLED})
    return ds


def _response(d: dict, ds: dict, matched_by: str) -> dict:
    return {**d, "soil_source": "district_estimate", "matched_by": matched_by, "version": ds.get("version"),
            "scale_note": ds.get("scale_note"), "source": ds.get("source")}


@router.get("/districts")
def list_districts(request: Request) -> dict:
    ds = _data(request)
    return {
        "version": ds.get("version"),
        "districts": [{"state": d["state"], "district": d["district"]} for d in ds["districts"]],
    }


@router.get("/district")
def district_soil(
    request: Request,
    district: str | None = Query(None, min_length=2, max_length=80),
    state: str | None = Query(None, max_length=80),
    lat: float | None = Query(None, ge=-90, le=90),
    lon: float | None = Query(None, ge=-180, le=180),
) -> dict:
    ds = _data(request)
    if (lat is None) != (lon is None):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"message": "Give both lat and lon."})
    if lat is None and not district:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, {"message": "Give lat/lon or a district name."})

    # 1. Coordinates: exact district from the boundaries (no spelling problems).
    bounds = request.app.state.registry.knowledge.get("district_boundaries")
    if lat is not None and bounds:
        lgd = locate_lgd(lat, lon, bounds)
        hit = next((d for d in ds["districts"] if d.get("lgd") == lgd), None) if lgd is not None else None
        if hit:
            return _response(hit, ds, "coordinates")
        if lgd is not None and not district:
            raise HTTPException(status.HTTP_404_NOT_FOUND, {
                "message": "This district has too few Soil Health Card samples for an estimate.", "lgd": lgd})

    # 2. Name (fallback, or when no coordinates were given).
    if district:
        hits = find_by_name(ds["districts"], district, state)
        if len(hits) == 1:
            return _response(hits[0], ds, "name")
        if len(hits) > 1:
            raise HTTPException(status.HTTP_409_CONFLICT, {
                "message": f"District name '{district}' exists in several states; pass state.",
                "states": sorted(h["state"] for h in hits)})
    raise HTTPException(status.HTTP_404_NOT_FOUND, {"message": "No soil data for this location."})
