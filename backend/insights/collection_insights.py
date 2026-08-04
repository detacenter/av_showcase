from __future__ import annotations

from collections import defaultdict


def build_album_index(log: list[dict]) -> dict[str, dict]:
    albums: dict[str, dict] = {}
    heard_ids: dict[str, set] = {}
    for entry in log:
        album_id = entry["album_id"]
        artist = entry["artist_names"][0] if entry["artist_names"] else ""
        info = albums.setdefault(
            album_id,
            {
                "album_id": album_id,
                "album_name": entry["album_name"],
                "artist": artist,
                "art_path": entry.get("album_art_local_path"),
                "release_year": entry.get("release_year"),
                "album_type": entry.get("album_type"),
                "album_total_tracks": entry.get("album_total_tracks"),
                "latest_played": entry["played_at"],
                "count": 0,
                "plays": [],
            },
        )
        info["count"] += 1
        info["plays"].append(entry)
        tid = entry.get("track_id")
        if tid:
            heard_ids.setdefault(album_id, set()).add(tid)
    for album_id, info in albums.items():
        info["heard_tracks"] = len(heard_ids.get(album_id, set()))
    return albums


def build_artist_catalog(log: list[dict]) -> dict[str, dict]:
    counts: dict[str, int] = defaultdict(int)
    artist_albums: dict[str, dict[str, dict]] = defaultdict(dict)
    latest_played: dict[str, str] = {}
    min_year: dict[str, int] = {}
    for entry in log:
        if not entry.get("artist_names"):
            continue
        primary = entry["artist_names"][0]
        counts[primary] += 1
        latest_played.setdefault(primary, entry["played_at"])

        year = entry.get("release_year")
        if year and (primary not in min_year or year < min_year[primary]):
            min_year[primary] = year

        album_id = entry["album_id"]
        if album_id not in artist_albums[primary]:
            artist_albums[primary][album_id] = {
                "album_id": album_id,
                "art_path": entry.get("album_art_local_path"),
                "count": 0,
                "latest_played": entry["played_at"],
            }
        artist_albums[primary][album_id]["count"] += 1

    return {
        "counts": dict(counts),
        "albums": {name: dict(albums) for name, albums in artist_albums.items()},
        "latest_played": latest_played,
        "min_year": min_year,
    }
