from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

LASTFM_FILE = data_path("lastfm_genres.json")


def load_lastfm_genres() -> dict[str, list[str]]:
    ensure_data_dir()
    if LASTFM_FILE.exists():
        with LASTFM_FILE.open() as f:
            return json.load(f)
    return {}


def save_lastfm_genres(genres: dict[str, list[str]]) -> None:
    ensure_data_dir()
    with LASTFM_FILE.open("w") as f:
        json.dump(genres, f, indent=2, sort_keys=True)
