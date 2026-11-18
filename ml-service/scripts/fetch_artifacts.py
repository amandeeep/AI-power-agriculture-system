"""Download the trained model + district soil files at deploy time (they are gitignored).

Used by the Render build command:
    python scripts/fetch_artifacts.py

Env:
    ARTIFACTS_URL    direct link to agri-dss-artifacts.zip (e.g. a GitHub Release asset)
    ARTIFACTS_TOKEN  optional; a GitHub token for a PRIVATE repo. Then ARTIFACTS_URL must be the
                     API asset URL (https://api.github.com/repos/<owner>/<repo>/releases/assets/<id>)

The zip is extracted into ml-service/, so it must contain models/... and knowledge/... paths.
"""
import io
import os
import sys
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent  # ml-service/
REQUIRED = [
    "models/crop_stack.joblib",
    "models/scaler.joblib",
    "models/label_encoder.joblib",
    "models/crop_model_meta.json",
]
OPTIONAL = ["knowledge/district_soil.json", "knowledge/district_boundaries.json"]


def main() -> int:
    url = os.environ.get("ARTIFACTS_URL", "").strip()
    if not url:
        print("[artifacts] ARTIFACTS_URL is not set", file=sys.stderr)
        return 1
    headers = {"User-Agent": "agri-dss-deploy"}
    token = os.environ.get("ARTIFACTS_TOKEN", "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
        headers["Accept"] = "application/octet-stream"

    print(f"[artifacts] downloading {url.split('?')[0]}")
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=120) as r:
        data = r.read()
    print(f"[artifacts] {len(data) / 1e6:.1f} MB")

    with zipfile.ZipFile(io.BytesIO(data)) as z:
        for name in z.namelist():  # refuse paths that escape ml-service/
            target = (ROOT / name).resolve()
            if ROOT not in target.parents and target != ROOT:
                print(f"[artifacts] unsafe path in zip: {name}", file=sys.stderr)
                return 1
        z.extractall(ROOT)

    missing = [p for p in REQUIRED if not (ROOT / p).is_file()]
    if missing:
        print(f"[artifacts] missing after extract: {missing}", file=sys.stderr)
        return 1
    for p in OPTIONAL:
        if not (ROOT / p).is_file():
            print(f"[artifacts] note: {p} not in zip, so district soil estimates will be disabled")
    print("[artifacts] OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
