"""District lookup for the soil fallback: by coordinates (point-in-polygon on the SHC district
boundaries) or by name. Pure Python; the ~780 simplified polygons are bbox-filtered first, so a
lookup takes well under a millisecond."""
from __future__ import annotations

import re


def name_key(name: str) -> str:
    return re.sub(r"[^a-z]", "", name.lower())


def _in_ring(x: float, y: float, ring: list) -> bool:
    """Ray casting (even-odd rule)."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def point_in_polygon(x: float, y: float, polygon: list) -> bool:
    """GeoJSON polygon: first ring is the outline, the rest are holes."""
    return bool(polygon) and _in_ring(x, y, polygon[0]) and not any(_in_ring(x, y, h) for h in polygon[1:])


def locate_lgd(lat: float, lon: float, boundaries: dict) -> int | None:
    """LGD district code containing the point, or None (outside India / between simplified borders)."""
    for d in boundaries["districts"]:
        x0, y0, x1, y1 = d["bbox"]
        if x0 <= lon <= x1 and y0 <= lat <= y1 and any(point_in_polygon(lon, lat, p) for p in d["polygons"]):
            return d["lgd"]
    return None


def find_by_name(districts: list[dict], district: str, state: str | None) -> list[dict]:
    dk, sk = name_key(district), name_key(state) if state else None
    return [d for d in districts if name_key(d["district"]) == dk and (sk is None or name_key(d["state"]) == sk)]
