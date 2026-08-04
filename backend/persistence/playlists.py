from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from core.paths import data_path, ensure_data_dir

_FILE = data_path("playlists.json")


def load_playlists() -> list[dict]:
    ensure_data_dir()
    if not _FILE.exists():
        return []
    with _FILE.open() as f:
        return json.load(f)


def save_playlists(playlists: list[dict]) -> None:
    ensure_data_dir()
    with _FILE.open("w") as f:
        json.dump(playlists, f, indent=2)


def _unique_name(base: str, existing_names: list[str]) -> str:
    if base not in existing_names:
        return base
    i = 2
    while f"{base}_{i}" in existing_names:
        i += 1
    return f"{base}_{i}"


def new_playlist(playlists: list[dict], name: str = "") -> dict:
    existing_names = [p["name"] for p in playlists]
    name = _unique_name(name or "Untitled", existing_names)
    now = datetime.now(timezone.utc).isoformat()
    playlist = {
        "id": str(uuid.uuid4()),
        "name": name,
        "created_at": now,
        "updated_at": now,
        "rule_groups": [],
        "pinned_track_ids": [],
        "excluded_track_ids": [],
    }
    playlists.append(playlist)
    save_playlists(playlists)
    return playlist


def rename_playlist(playlists: list[dict], playlist_id: str, name: str) -> None:
    existing_names = [p["name"] for p in playlists if p["id"] != playlist_id]
    name = _unique_name(name or "Untitled", existing_names)
    for p in playlists:
        if p["id"] == playlist_id:
            p["name"] = name
            p["updated_at"] = datetime.now(timezone.utc).isoformat()
            break
    save_playlists(playlists)


def save_playlist(playlists: list[dict], playlist: dict) -> None:
    playlist["updated_at"] = datetime.now(timezone.utc).isoformat()
    for i, p in enumerate(playlists):
        if p["id"] == playlist["id"]:
            playlists[i] = playlist
            break
    save_playlists(playlists)


def delete_playlist(playlists: list[dict], playlist_id: str) -> None:
    playlists[:] = [p for p in playlists if p["id"] != playlist_id]
    save_playlists(playlists)
