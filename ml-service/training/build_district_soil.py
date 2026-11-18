"""
Builds the district soil estimates used as the fallback when a field has no soil test of its own.

Source: Soil Health Card (SHC) district nutrient status, Ministry of Agriculture & Farmers Welfare,
published as the Esri India Living Atlas layer "Macro Nutrient Soil Health Card" (779 districts,
LGD codes, % of samples Low / Medium / High for N, P, K, organic carbon, pH class, salinity,
for 2023-24, 2024-25 and 2025-26) plus the district boundaries.

Outputs (both gitignored; regenerate with this script):
    knowledge/district_soil.json        per district: model-scale N, P, K, pH + status + 3-year history
    knowledge/district_boundaries.json  simplified polygons (~1 km), so coordinates -> district

Conversion to the crop model's scale (the model was trained on the Kaggle dataset, whose N/P/K are
NOT SHC kg/ha):
    N, P, K: each SHC class is anchored to a fixed point of the TRAINING distribution
             (Low -> 1/6 quantile, Medium -> median, High -> 5/6 quantile) and the district value is
             the share-weighted mean. This keeps districts in the right relative order on the scale the
             model understands; it is an estimate, not a lab value.
    pH:      SHC classes have real pH bands (acidic < 6.5, neutral 6.5-7.5, alkaline > 7.5), so the
             district pH is the share-weighted mean of 6.0 / 7.0 / 8.0.
    Year:    per nutrient, the newest year with >= MIN_SAMPLES samples (2025-26, else 2024-25, else
             2023-24); if none reaches it, the year with the most samples.

Usage (from ml-service/):
    .venv/Scripts/python.exe -m training.build_district_soil            # uses data/shc_esri/ if present
    .venv/Scripts/python.exe -m training.build_district_soil --download # (re)download first
"""
from __future__ import annotations

import argparse
import json
import math
import urllib.parse
import urllib.request
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "shc_esri"
TRAIN_CSV = ROOT / "data" / "Crop_recommendation.csv"
OUT_SOIL = ROOT / "knowledge" / "district_soil.json"
OUT_BOUNDS = ROOT / "knowledge" / "district_boundaries.json"

LAYER = "https://livingatlas.esri.in/server1/rest/services/Soil/Macro_Nutrients_in_Soil/MapServer/0/query"
USER_AGENT = "agri-dss/0.1 (B.Tech student project)"
YEARS = ["25_26", "24_25", "23_24"]  # newest first
YEAR_LABEL = {"25_26": "2025-26", "24_25": "2024-25", "23_24": "2023-24"}
NUTRIENTS = {"N": "n", "P": "p", "K": "k"}
CLASS_QUANTILE = {"l": 1 / 6, "m": 0.5, "h": 5 / 6}
PH_CLASS_VALUE = {"aci": 6.0, "neu": 7.0, "alk": 8.0}
MAX_CONFIDENCE = 0.7  # a district average is never as good as the field's own soil test
MIN_SAMPLES = 30      # a year with fewer samples than this is only used if no year has more
MIN_DISTRICT_SAMPLES = 10  # below this a district average is meaningless: leave it out (farmer is asked for a test)
SOURCE = ("Soil Health Card district nutrient status (Ministry of Agriculture & Farmers Welfare), "
          "via Esri India Living Atlas 'Macro Nutrient Soil Health Card'")


# --- download --------------------------------------------------------------------------------------

def _get(params: dict, out: Path) -> None:
    url = f"{LAYER}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=300) as res:  # noqa: S310 - fixed https URL
        data = res.read()
    json.loads(data)  # fail early on an error page
    out.write_bytes(data)
    print(f"downloaded {out.name}: {len(data) / 1e6:.1f} MB")


def download() -> None:
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    _get({"where": "1=1", "outFields": "*", "returnGeometry": "false", "f": "json"}, RAW_DIR / "attributes.json")
    _get({"where": "1=1", "outFields": "objectid,lgd_district_code", "returnGeometry": "true", "outSR": "4326",
          "maxAllowableOffset": "0.01", "geometryPrecision": "3", "f": "geojson"}, RAW_DIR / "boundaries.geojson")


# --- conversion (pure functions, unit-tested) ------------------------------------------------------

def class_shares(row: dict, prefix: str, classes: list[str], year: str) -> dict[str, float] | None:
    """{'l': 0.2, 'm': 0.5, 'h': 0.3} from the % fields, or None if that year has no data."""
    vals = [row.get(f"per_{prefix}_{c}_{year}") for c in classes]
    if any(v is None for v in vals) or sum(vals) <= 0:
        return None
    total = float(sum(vals))
    return {c: v / total for c, v in zip(classes, vals)}


def sample_count(row: dict, prefix: str, classes: list[str], year: str) -> int:
    # One field in the source is misspelled (val_p_l24_25), so try both spellings.
    n = 0
    for c in classes:
        v = row.get(f"val_{prefix}_{c}_{year}")
        if v is None:
            v = row.get(f"val_{prefix}_{c}{year}")
        n += int(v or 0)
    return n


def to_model_scale(shares: dict[str, float], anchors: dict[str, float]) -> float:
    return sum(shares[c] * anchors[c] for c in shares)


def confidence(samples: int, dominance: float) -> float:
    """More samples and a clearer majority class -> more confidence; capped at MAX_CONFIDENCE."""
    sample_factor = min(1.0, math.log10(1 + samples) / 3)  # ~1000 samples -> 1.0
    return round(MAX_CONFIDENCE * sample_factor * (0.5 + 0.5 * dominance), 2)


def pick_year(row: dict, prefix: str, classes: list[str]) -> tuple[str, dict[str, float], int] | None:
    """(year, shares, samples) for the newest year with enough samples, else the best-sampled year."""
    found = [(y, sh, sample_count(row, prefix, classes, y)) for y in YEARS
             if (sh := class_shares(row, prefix, classes, y))]
    if not found:
        return None
    return next((f for f in found if f[2] >= MIN_SAMPLES), max(found, key=lambda f: f[2]))


def build_district(row: dict, anchors: dict[str, dict[str, float]]) -> dict | None:
    out = {
        "state": row["state_name"].strip(),
        "district": row["district_name"].strip(),
        "lgd": int(row["lgd_district_code"]) if row.get("lgd_district_code") is not None else None,
    }
    status, history, years_used, samples, dominance = {}, {}, {}, [], []
    for key, prefix in NUTRIENTS.items():
        picked = pick_year(row, prefix, ["l", "m", "h"])
        if picked:
            y, sh, n = picked
            out[key] = round(to_model_scale(sh, anchors[key]), 1)
            status[key] = {"low": round(sh["l"] * 100, 1), "medium": round(sh["m"] * 100, 1), "high": round(sh["h"] * 100, 1)}
            years_used[key] = YEAR_LABEL[y]
            samples.append(n)
            dominance.append(max(sh.values()))
        # Past record: the class split for every year that has data.
        for y in YEARS:
            sh = class_shares(row, prefix, ["l", "m", "h"], y)
            if sh:
                history.setdefault(YEAR_LABEL[y], {})[key] = {"low": round(sh["l"] * 100, 1), "medium": round(sh["m"] * 100, 1), "high": round(sh["h"] * 100, 1)}
    picked = pick_year(row, "ph", ["aci", "neu", "alk"])
    if picked:
        y, sh, _ = picked
        out["ph"] = round(sum(sh[c] * PH_CLASS_VALUE[c] for c in sh), 2)
        status["ph"] = {"acidic": round(sh["aci"] * 100, 1), "neutral": round(sh["neu"] * 100, 1), "alkaline": round(sh["alk"] * 100, 1)}
        years_used["ph"] = YEAR_LABEL[y]
    if not all(k in out for k in ("N", "P", "K", "ph")):
        return None  # no usable data in any year
    out["samples"] = int(min(samples)) if samples else 0
    if out["samples"] < MIN_DISTRICT_SAMPLES:
        return None
    out["confidence"] = confidence(out["samples"], sum(dominance) / len(dominance))
    out["year"] = max(years_used.values())
    out["years_used"] = years_used
    out["status"] = status
    out["history"] = dict(sorted(history.items()))
    return out


# --- boundaries ------------------------------------------------------------------------------------

def _bbox(rings: list) -> list[float]:
    xs = [p[0] for ring in rings for p in ring]
    ys = [p[1] for ring in rings for p in ring]
    return [round(min(xs), 3), round(min(ys), 3), round(max(xs), 3), round(max(ys), 3)]


def build_boundaries(geojson: dict, lgd_by_objectid: dict[int, int]) -> list[dict]:
    out = []
    for f in geojson["features"]:
        g, props = f.get("geometry"), f.get("properties", {})
        lgd = props.get("lgd_district_code") or lgd_by_objectid.get(props.get("objectid"))
        if not g or lgd is None:
            continue
        polys = [g["coordinates"]] if g["type"] == "Polygon" else g["coordinates"] if g["type"] == "MultiPolygon" else []
        if not polys:
            continue
        out.append({"lgd": int(lgd), "polygons": polys, "bbox": _bbox([ring for poly in polys for ring in poly])})
    return out


# --- main ------------------------------------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--download", action="store_true", help="(re)download the SHC layer first")
    args = ap.parse_args()
    if args.download or not (RAW_DIR / "attributes.json").exists():
        download()

    train = pd.read_csv(TRAIN_CSV)
    anchors = {k: {c: float(train[k].quantile(q)) for c, q in CLASS_QUANTILE.items()} for k in NUTRIENTS}
    rows = [f["attributes"] for f in json.loads((RAW_DIR / "attributes.json").read_text(encoding="utf-8"))["features"]]

    districts = [d for d in (build_district(r, anchors) for r in rows) if d]
    districts.sort(key=lambda d: (d["state"], d["district"]))
    version = f"shc-districts-{date.today():%Y%m%d}"
    OUT_SOIL.write_text(json.dumps({
        "version": version,
        "source": SOURCE,
        "scale_note": ("District average from Soil Health Card class shares (Low/Medium/High), converted to the "
                       "crop model's scale: Low/Medium/High = 1/6 quantile / median / 5/6 quantile of the training "
                       "data; pH from acidic/neutral/alkaline shares (6.0/7.0/8.0). An estimate, not a lab value."),
        "anchors": {k: {c: round(v, 1) for c, v in a.items()} for k, a in anchors.items()},
        "districts": districts,
    }, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")

    lgd_by_objectid = {r["objectid"]: r["lgd_district_code"] for r in rows}
    bounds = build_boundaries(json.loads((RAW_DIR / "boundaries.geojson").read_text(encoding="utf-8")), lgd_by_objectid)
    OUT_BOUNDS.write_text(json.dumps({"version": version, "source": SOURCE, "districts": bounds}, separators=(",", ":")), encoding="utf-8")

    print(f"{len(districts)} of {len(rows)} districts have usable data -> {OUT_SOIL.relative_to(ROOT)} "
          f"({OUT_SOIL.stat().st_size / 1e3:.0f} kB)")
    print(f"{len(bounds)} boundaries -> {OUT_BOUNDS.relative_to(ROOT)} ({OUT_BOUNDS.stat().st_size / 1e6:.1f} MB)")
    print("anchors (model scale):", {k: {c: round(v, 1) for c, v in a.items()} for k, a in anchors.items()})


if __name__ == "__main__":
    main()
