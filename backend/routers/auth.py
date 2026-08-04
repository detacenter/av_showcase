from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/auth", tags=["auth"])


class CallbackBody(BaseModel):
    code: str


@router.get("/status")
def auth_status():
    from integrations.spotify.auth import needs_reauth
    return {"needs_reauth": needs_reauth()}


@router.get("/authorize-url")
def authorize_url():
    from integrations.spotify.auth import build_authorize_url
    return {"url": build_authorize_url()}


@router.post("/callback")
def callback(body: CallbackBody):
    from integrations.spotify.auth import exchange_code
    try:
        exchange_code(body.code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ok": True}


@router.post("/simulate-expired")
def simulate_expired():
    """Dev-only: flip the needs_reauth flag without a real Spotify call, so the
    reconnect flow can be exercised end-to-end before real tokens expire."""
    from integrations.spotify.auth import _set_needs_reauth
    _set_needs_reauth(True)
    return {"ok": True}
