"""
Rule-based fertilizer recommendation.

Ideal NPK for a crop = the per-crop mean from the training dataset (knowledge/crop_profiles.json).
Soil N, P, K are on the dataset's scale (kg/ha). P and K are treated as P2O5 and K2O equivalents,
the convention used in Indian fertilizer recommendations.

Product maths (per hectare, then converted to per acre):
  DAP  (18-46-0): covers the P deficit       -> DAP  = P_def / 0.46, which also supplies 0.18 * DAP of N
  Urea (46% N)  : covers the N still missing -> Urea = max(0, N_def - N_from_DAP) / 0.46
  MOP  (60% K2O): covers the K deficit       -> MOP  = K_def / 0.60
"""
from __future__ import annotations

import re

HA_PER_ACRE = 1 / 2.471  # 1 acre = 0.4047 ha
MODEL_VERSION = "fertilizer-rules-v1"
DISCLAIMER = (
    "These are approximate quantities from general crop norms. Please consult your local "
    "Krishi Vigyan Kendra / soil test lab before applying fertilizers, and follow the product label."
)

# Common local / alternate crop names -> dataset label.
ALIASES = {
    "paddy": "rice", "dhan": "rice", "corn": "maize", "makka": "maize", "chana": "chickpea", "gram": "chickpea",
    "bengalgram": "chickpea", "rajma": "kidneybeans", "kidneybean": "kidneybeans", "arhar": "pigeonpeas",
    "tur": "pigeonpeas", "toor": "pigeonpeas", "redgram": "pigeonpeas", "pigeonpea": "pigeonpeas",
    "moth": "mothbeans", "mothbean": "mothbeans", "matki": "mothbeans", "moong": "mungbean", "greengram": "mungbean",
    "urad": "blackgram", "masoor": "lentil", "anar": "pomegranate", "kela": "banana", "aam": "mango",
    "angoor": "grapes", "grape": "grapes", "tarbooj": "watermelon", "kharbuja": "muskmelon", "seb": "apple",
    "santra": "orange", "papita": "papaya", "nariyal": "coconut", "kapas": "cotton", "patsan": "jute",
}

# Ratio of actual to ideal within which a nutrient counts as "optimal" (±15%), with a small absolute floor.
TOLERANCE_RATIO = 0.15
TOLERANCE_MIN = 5.0

ORGANIC = {
    "N": [
        "Well-rotted farmyard manure (FYM) or compost: about 2-4 tonnes/acre before sowing",
        "Vermicompost: about 1-2 tonnes/acre",
        "Neem cake: about 100-200 kg/acre (also helps against soil pests)",
        "Green manure (dhaincha / sunhemp) ploughed in before flowering",
        "Biofertilizer: Azotobacter / Azospirillum (Rhizobium seed treatment for pulses)",
    ],
    "P": [
        "Rock phosphate mixed with compost or FYM",
        "Bone meal: about 100-200 kg/acre",
        "Biofertilizer: Phosphate Solubilizing Bacteria (PSB) seed / soil treatment",
    ],
    "K": [
        "Wood ash: about 200-400 kg/acre (avoid on alkaline soils)",
        "Compost made from banana stems or crop residues",
        "Biofertilizer: Potash Mobilizing Bacteria (KMB)",
    ],
}

EXCESS_WARNINGS = {
    "N": "Nitrogen is already high: do not apply urea. Excess N causes soft lush growth, lodging, more pest attack and nitrate leaching into groundwater.",
    "P": "Phosphorus is already high: skip DAP/SSP this season. Excess P can lock up zinc and iron in the soil.",
    "K": "Potassium is already high: skip MOP. Excess K can reduce calcium and magnesium uptake.",
}


def normalize_crop(name: str, known: set[str]) -> str | None:
    key = re.sub(r"[^a-z]", "", name.lower())
    if key in known:
        return key
    return ALIASES.get(key) if ALIASES.get(key) in known else None


def _status(actual: float, ideal: float) -> str:
    tol = max(ideal * TOLERANCE_RATIO, TOLERANCE_MIN)
    if actual < ideal - tol:
        return "deficient"
    if actual > ideal + tol:
        return "excess"
    return "optimal"


def _per_acre(kg_per_ha: float) -> float:
    return round(kg_per_ha * HA_PER_ACRE, 1)


def recommend(crop: str, soil: dict[str, float], profiles: dict) -> dict:
    profile = profiles["crops"][crop]
    nutrients = {}
    for n in ("N", "P", "K"):
        ideal = profile[n]["mean"]
        actual = soil[n]
        nutrients[n] = {
            "actual": actual,
            "ideal": ideal,
            "difference": round(actual - ideal, 2),  # negative = deficit
            "status": _status(actual, ideal),
            "unit": "kg/ha",
        }

    # Fill only real deficits. "Optimal" nutrients within tolerance get no fertilizer.
    deficit = {n: (-v["difference"] if v["status"] == "deficient" else 0.0) for n, v in nutrients.items()}
    dap_ha = deficit["P"] / 0.46
    n_from_dap = 0.18 * dap_ha
    urea_ha = max(0.0, deficit["N"] - n_from_dap) / 0.46
    mop_ha = deficit["K"] / 0.60

    fertilizers = []
    if dap_ha > 0:
        fertilizers.append({
            "name": "DAP", "grade": "18-46-0", "nutrient": "P (also supplies some N)",
            "kg_per_acre": _per_acre(dap_ha), "kg_per_ha": round(dap_ha, 1),
            "when": "Apply fully as basal dose at sowing / transplanting, placed near the root zone.",
        })
    if urea_ha > 0:
        fertilizers.append({
            "name": "Urea", "grade": "46% N", "nutrient": "N",
            "kg_per_acre": _per_acre(urea_ha), "kg_per_ha": round(urea_ha, 1),
            "when": "Split into 2-3 doses: about half at sowing, the rest as top dressing at active growth stages.",
        })
    if mop_ha > 0:
        fertilizers.append({
            "name": "MOP", "grade": "60% K2O", "nutrient": "K",
            "kg_per_acre": _per_acre(mop_ha), "kg_per_ha": round(mop_ha, 1),
            "when": "Apply as basal dose at sowing; on light sandy soils split into two doses.",
        })

    return {
        "crop": crop,
        "nutrients": nutrients,
        "fertilizers": fertilizers,
        "organic_alternatives": {n: ORGANIC[n] for n, v in nutrients.items() if v["status"] == "deficient"},
        "warnings": [EXCESS_WARNINGS[n] for n, v in nutrients.items() if v["status"] == "excess"],
        "balanced": all(v["status"] == "optimal" for v in nutrients.values()),
        "assumptions": [
            "Ideal NPK = average for this crop in the training dataset (kg/ha).",
            "P and K are read as P2O5 and K2O equivalents.",
            f"A nutrient within ±{int(TOLERANCE_RATIO * 100)}% of the ideal is treated as optimal.",
        ],
        "method": "rule-based",
        "confidence": None,  # deterministic rules: no statistical confidence applies
        "model_version": MODEL_VERSION,
        "disclaimer": DISCLAIMER,
    }
