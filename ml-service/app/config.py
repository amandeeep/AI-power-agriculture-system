"""Service configuration, loaded from environment variables / ml-service/.env."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SERVICE_ROOT = Path(__file__).resolve().parent.parent  # ml-service/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=SERVICE_ROOT / ".env", extra="ignore")

    internal_api_key: str = ""
    models_dir: Path = Path("models")
    knowledge_dir: Path = Path("knowledge")
    disease_confidence_threshold: float = 0.5
    cors_origins: str = "http://localhost:5000"

    def resolve(self, p: Path) -> Path:
        """Relative paths are resolved against ml-service/, not the CWD."""
        return p if p.is_absolute() else SERVICE_ROOT / p

    @property
    def models_path(self) -> Path:
        return self.resolve(self.models_dir)

    @property
    def knowledge_path(self) -> Path:
        return self.resolve(self.knowledge_dir)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
