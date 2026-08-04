from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

DISMISSALS_FILE = data_path("genre_dismissals.json")


def load_genre_dismissals() -> set[frozenset[str]]:
    ensure_data_dir()
    if DISMISSALS_FILE.exists():
        with DISMISSALS_FILE.open() as f:
            return {frozenset(pair) for pair in json.load(f)}
    return set()


def save_genre_dismissals(dismissals: set[frozenset[str]]) -> None:
    ensure_data_dir()
    with DISMISSALS_FILE.open("w") as f:
        json.dump(sorted(sorted(pair) for pair in dismissals), f, indent=2)


def add_dismissal_pairs(genres: list[str]) -> None:
    """Record all pairwise combinations from genres as dismissed."""
    existing = load_genre_dismissals()
    for i, a in enumerate(genres):
        for b in genres[i + 1:]:
            existing.add(frozenset({a, b}))
    save_genre_dismissals(existing)
