from pathlib import Path
from fastapi import APIRouter, HTTPException
from insights.collection_insights import build_album_index
from core.album_type import classify_album_type
from persistence.vinyl_links import confirmed_album_ids
from state import get_state

router = APIRouter(prefix="/api/albums", tags=["albums"])


def _art_filename(path: str | None) -> str | None:
    return Path(path).name if path else None


def _album_track_plays(plays: list[dict], lib: dict) -> list[dict]:
    tracks: dict[str, dict] = {}
    tracks_lib = lib.get("tracks", {})
    for entry in plays:
        tid = entry["track_id"]
        if tid not in tracks:
            tracks[tid] = {
                "track_id": tid,
                "track_name": entry["track_name"],
                "track_number": entry.get("track_number", 0),
                "play_count": 0,
                "is_favorited": bool(tracks_lib.get(tid, {}).get("favorited", False)),
            }
        tracks[tid]["play_count"] += 1
    return sorted(tracks.values(), key=lambda x: (x["track_number"], x["track_name"]))


@router.get("")
def get_albums():
    state = get_state()
    albums_data = build_album_index(state.log)
    lib = state.lib
    albums_lib = lib.get("albums", {})
    artists_lib = lib.get("artists", {})

    vinyl_ids = confirmed_album_ids()

    all_genres: set[str] = set()
    for info in albums_data.values():
        for g in artists_lib.get(info["artist"], {}).get("genres", []):
            all_genres.add(g)

    years = sorted(
        y for info in albums_data.values()
        if (y := info.get("release_year"))
    )
    year_bounds = {"min": years[0], "max": years[-1]} if years else None

    albums_out = []
    for album_id, info in albums_data.items():
        a_lib = albums_lib.get(album_id, {})
        classified = classify_album_type(info.get("album_type"), info.get("album_total_tracks"))
        albums_out.append({
            "album_id": album_id,
            "album_name": info["album_name"],
            "artist": info["artist"],
            "art_filename": _art_filename(info.get("art_path")),
            "release_year": info.get("release_year"),
            "album_type": info.get("album_type"),
            "album_total_tracks": info.get("album_total_tracks"),
            "latest_played": info.get("latest_played", ""),
            "count": info.get("count", 0),
            "classified_type": classified,
            "has_vinyl": album_id in vinyl_ids,
            "is_favorited": bool(a_lib.get("favorited", False)),
            "rating": int(a_lib.get("rating", 0)),
            "notes": a_lib.get("notes", ""),
            "genres": artists_lib.get(info["artist"], {}).get("genres", []),
            "heard_tracks": info.get("heard_tracks", 0),
            "track_plays": _album_track_plays(info.get("plays", []), lib),
        })

    return {
        "albums": albums_out,
        "all_genres": sorted(all_genres),
        "year_bounds": year_bounds,
    }


def _build_album_dict(album_id: str, info: dict, lib: dict, vinyl_ids: set) -> dict:
    albums_lib = lib.get("albums", {})
    artists_lib = lib.get("artists", {})
    a_lib = albums_lib.get(album_id, {})
    classified = classify_album_type(info.get("album_type"), info.get("album_total_tracks"))
    return {
        "album_id": album_id,
        "album_name": info["album_name"],
        "artist": info["artist"],
        "art_filename": _art_filename(info.get("art_path")),
        "release_year": info.get("release_year"),
        "album_type": info.get("album_type"),
        "album_total_tracks": info.get("album_total_tracks"),
        "latest_played": info.get("latest_played", ""),
        "count": info.get("count", 0),
        "classified_type": classified,
        "has_vinyl": album_id in vinyl_ids,
        "is_favorited": bool(a_lib.get("favorited", False)),
        "rating": int(a_lib.get("rating", 0)),
        "notes": a_lib.get("notes", ""),
        "genres": artists_lib.get(info["artist"], {}).get("genres", []),
        "heard_tracks": info.get("heard_tracks", 0),
        "track_plays": _album_track_plays(info.get("plays", []), lib),
    }


@router.get("/{album_id}")
def get_album(album_id: str):
    state = get_state()
    albums_data = build_album_index(state.log)
    info = albums_data.get(album_id)
    if not info:
        raise HTTPException(status_code=404, detail="Album not found")
    vinyl_ids = confirmed_album_ids()
    return _build_album_dict(album_id, info, state.lib, vinyl_ids)
