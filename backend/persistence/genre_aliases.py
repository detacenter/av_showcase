from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

ALIASES_FILE = data_path("genre_aliases.json")


def load_genre_aliases() -> dict[str, str]:
    ensure_data_dir()
    if ALIASES_FILE.exists():
        with ALIASES_FILE.open() as f:
            return json.load(f)
    return {}


def save_genre_aliases(aliases: dict[str, str]) -> None:
    ensure_data_dir()
    with ALIASES_FILE.open("w") as f:
        json.dump(aliases, f, indent=2, sort_keys=True)
