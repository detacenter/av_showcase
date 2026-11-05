from __future__ import annotations

import json

from .paths import data_path, ensure_data_dir

_SETTINGS_PATH = data_path("settings.json")

_DEFAULTS: dict = {
    "accent_color": "#1DB954",
}
# Settings that no longer exist; dropped from settings.json the next time it's saved.
_RETIRED = ("splash_style", "app_icon", "sidebar_logo")


def load_settings() -> dict:
    ensure_data_dir()
    try:
        with _SETTINGS_PATH.open() as f:
            data = json.load(f)
        return {**_DEFAULTS, **{k: v for k, v in data.items() if k not in _RETIRED}}
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
