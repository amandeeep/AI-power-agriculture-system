import os

import pytest

# Fixed key for tests, set before the app reads settings.
os.environ.setdefault("INTERNAL_API_KEY", "test-internal-key")

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def client():
    get_settings.cache_clear()
    with TestClient(create_app()) as c:  # context manager runs the lifespan (model loading)
        yield c


@pytest.fixture
def auth_headers():
    return {"X-Internal-Key": os.environ["INTERNAL_API_KEY"]}
