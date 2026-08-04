from __future__ import annotations

from collections import defaultdict


def artist_plays(log: list[dict], artist_name: str) -> list[dict]:
    return [entry for entry in log if artist_name in entry.get("artist_names", [])]


def resolve_artist_id(plays: list[dict], artist_name: str) -> str | None:
    for entry in plays:
        ids = entry.get("artist_ids", [])
        names = entry.get("artist_names", [])
        if artist_name in names:
            idx = names.index(artist_name)
            if idx < len(ids):
                return ids[idx]
    return None


def build_artist_album_index(plays: list[dict], artist_name: str) -> dict[str, dict]:
    albums: dict[str, dict] = {}
    heard_ids: dict[str, set] = {}
    for entry in plays:
        album_id = entry["album_id"]
        info = albums.setdefault(
            album_id,
            {
                "album_id": album_id,
                "album_name": entry["album_name"],
                "artist": artist_name,
                "art_path": entry.get("album_art_local_path"),
                "release_year": entry.get("release_year"),
                "album_type": entry.get("album_type"),
                "album_total_tracks": entry.get("album_total_tracks"),
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


def top_artist_tracks(plays: list[dict], limit: int = 7) -> list[tuple[str, str, int]]:
    track_counts: dict[str, int] = defaultdict(int)
    track_names: dict[str, str] = {}
    for entry in plays:
        track_id = entry["track_id"]
        track_counts[track_id] += 1
        track_names[track_id] = entry["track_name"]
    ranked = sorted(track_counts.items(), key=lambda item: -item[1])[:limit]
    return [(track_id, track_names[track_id], count) for track_id, count in ranked]


def build_artist_detail_snapshot(
    log: list[dict],
    lib: dict,
    artist_name: str,
    *,
    top_track_limit: int = 7,
    recent_play_limit: int = 30,
) -> dict:
    plays = artist_plays(log, artist_name)
    albums = build_artist_album_index(plays, artist_name)
    return {
        "name": artist_name,
        "play_count": len(plays),
        "artist_id": resolve_artist_id(plays, artist_name),
        "genres": lib.get("artists", {}).get(artist_name, {}).get("genres", []),
        "albums": sorted(albums.values(), key=lambda item: -item["count"]),
        "top_tracks": top_artist_tracks(plays, limit=top_track_limit),
        "recent_plays": plays[:recent_play_limit],
    }
