from fastapi import APIRouter
from pydantic import BaseModel

from core.settings import load_settings, save_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingsUpdate(BaseModel):
    accent_color: str | None = None
    auto_poll: bool | None = None
    saved_accents: list[str] | None = None


@router.get("")
def get_settings():
    return load_settings()


@router.patch("")
def update_settings(body: SettingsUpdate):
    settings = load_settings()
    for key, val in body.model_dump(exclude_none=True).items():
        settings[key] = val
    save_settings(settings)
    return settings
