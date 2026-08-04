from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

CATALOG_FILE = data_path("catalog.json")


def load_catalog() -> dict:
    ensure_data_dir()
    if not CATALOG_FILE.exists():
        return {}
    with CATALOG_FILE.open() as f:
        return json.load(f)


def save_catalog(catalog: dict) -> None:
    ensure_data_dir()
    with CATALOG_FILE.open("w") as f:
        json.dump(catalog, f, indent=2)


def catalog_album(catalog: dict, album_id: str, tracks: list[dict]) -> bool:
    """Add unheard tracks for an album to the catalog.
    Skips tracks already present (heard or unheard).
    Returns True if anything was added."""
    album = catalog.setdefault(album_id, {"tracks": {}})
    added = False
    for track in tracks:
        tid = track["track_id"]
        if tid not in album["tracks"]:
            album["tracks"][tid] = {
                "track_name":   track["track_name"],
                "track_number": track["track_number"],
                "duration_ms":  track["duration_ms"],
                "isrc":         track.get("isrc"),
                "heard":        False,
            }
            added = True
    return added


def mark_heard(catalog: dict, track_id: str) -> bool:
    """Mark a track as heard across all albums that contain it.
    Returns True if any entry was updated."""
    updated = False
    for album in catalog.values():
        entry = album.get("tracks", {}).get(track_id)
        if entry and not entry["heard"]:
            entry["heard"] = True
            updated = True
    return updated


def get_album_catalog(catalog: dict, album_id: str) -> dict[str, dict]:
    """Return the tracks dict for an album, or empty dict if not cataloged."""
    return catalog.get(album_id, {}).get("tracks", {})


def completion(catalog: dict, album_id: str, log_track_ids: set[str], album_total_tracks: int | None = None) -> tuple[int, int] | None:
    """Return (heard, total) for a cataloged album, or None if not cataloged.

    If the album has been pruned from the catalog (100% complete), falls back to
    deriving completion purely from the log when album_total_tracks is provided."""
    tracks = get_album_catalog(catalog, album_id)
    if tracks:
        total = len(tracks)
        heard = sum(1 for tid in tracks if tid in log_track_ids or tracks[tid]["heard"])
        return heard, total
    if album_total_tracks:
        heard = len(log_track_ids)
        return heard, album_total_tracks
    return None


def prune_completed(catalog: dict, log: list[dict]) -> int:
    """Remove catalog entries for albums where every track has been heard.
    Returns the number of albums pruned."""
    log_track_ids = {e["track_id"] for e in log}
    to_prune = []
    for album_id, album in catalog.items():
        tracks = album.get("tracks", {})
        if tracks and all(
            tid in log_track_ids or t["heard"]
            for tid, t in tracks.items()
        ):
            to_prune.append(album_id)
    for album_id in to_prune:
        del catalog[album_id]
    return len(to_prune)
