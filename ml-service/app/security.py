"""Internal-key guard: only the Node server (which knows the shared secret) may call predict routes."""
import secrets

from fastapi import Depends, Header, HTTPException, status

from app.config import Settings, get_settings


def require_internal_key(
    x_internal_key: str | None = Header(default=None),
    settings: Settings = Depends(get_settings),
) -> None:
    if not settings.internal_api_key:
        # Fail closed: a misconfigured service must not be open to the world.
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "INTERNAL_API_KEY is not configured")
    # Constant-time compare avoids leaking the key via timing.
    if not x_internal_key or not secrets.compare_digest(x_internal_key, settings.internal_api_key):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or missing X-Internal-Key")
