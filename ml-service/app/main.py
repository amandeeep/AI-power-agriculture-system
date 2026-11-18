"""FastAPI entry point for the ML service. Run: uvicorn app.main:app --port 8000"""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import health, predict, soil
from app.services.registry import Registry

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Load every model exactly once; request handlers read from app.state.registry.
    registry = Registry()
    registry.load_all(get_settings())
    app.state.registry = registry
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Agri-DSS ML Service", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(predict.router)
    app.include_router(soil.router)
    return app


app = create_app()
