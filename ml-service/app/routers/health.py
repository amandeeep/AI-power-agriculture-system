"""GET /health: public liveness probe that also reports which models are loaded."""
from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request) -> dict:
    registry = request.app.state.registry
    summary = registry.summary()
    all_loaded = all(m["loaded"] for m in summary["models"].values())
    return {"status": "ok" if all_loaded else "degraded", "service": "ml-service", **summary}
