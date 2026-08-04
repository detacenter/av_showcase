from __future__ import annotations

import json
from .paths import data_path, ensure_data_dir

_SETTINGS_PATH = data_path("settings.json")

_APP_ICON_ALIASES = {
    "icon_2b": "play_burst",
    "icon_3": "fan",
    "icon_3a": "fan_av",
    "icon_3b": "fan_down",
    "icon_3b-3": "fan_down_av",
    "icon_7": "lines",
    "icon_8a": "prism",
    "icon_9": "bloom",
}

_DEFAULTS: dict = {
    "accent_color": "#1DB954",
    "splash_style": "ribbons",
    "app_icon": "prism",
    "sidebar_logo": "rings",
}


def load_settings() -> dict:
    ensure_data_dir()
    try:
        with _SETTINGS_PATH.open() as f:
            data = json.load(f)
        return {**_DEFAULTS, **data}
    except (FileNotFoundError, json.JSONDecodeError):
        return dict(_DEFAULTS)


def save_settings(settings: dict) -> None:
    ensure_data_dir()
    with _SETTINGS_PATH.open("w") as f:
        json.dump(settings, f, indent=2)


def get_accent() -> str:
    return load_settings().get("accent_color", _DEFAULTS["accent_color"])


def set_accent(color: str) -> None:
    s = load_settings()
    s["accent_color"] = color
    save_settings(s)


def get_splash_style() -> str:
    return load_settings().get("splash_style", _DEFAULTS["splash_style"])


def set_splash_style(style: str) -> None:
    s = load_settings()
    s["splash_style"] = style
    save_settings(s)


def get_app_icon() -> str:
    key = load_settings().get("app_icon", _DEFAULTS["app_icon"])
    return _APP_ICON_ALIASES.get(key, key)


def set_app_icon(key: str) -> None:
    s = load_settings()
    s["app_icon"] = _APP_ICON_ALIASES.get(key, key)
    save_settings(s)


def get_sidebar_logo() -> str:
    return load_settings().get("sidebar_logo", _DEFAULTS["sidebar_logo"])


def set_sidebar_logo(key: str) -> None:
    s = load_settings()
    s["sidebar_logo"] = key
    save_settings(s)
