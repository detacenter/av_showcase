from pathlib import Path
from fastapi import APIRouter
from insights import build_artist_catalog
from insights.artist_insights import build_artist_detail_snapshot
from state import get_state

router = APIRouter(prefix="/api/artists", tags=["artists"])


from core.paths import data_path as _data_path
_ARTWORK_DIR = _data_path("artwork")


def _art_filename(path: str | None) -> str | None:
    if not path:
        return None
    p = Path(path)
    try:
        return str(p.relative_to(_ARTWORK_DIR))
    except ValueError:
        pass
    try:
        return str(p.relative_to("data/artwork"))
    except ValueError:
        pass
    return p.name


def _classify_album_type(album_type: str | None, total_tracks: int | None) -> str:
    if album_type == "compilation":
        return "Compilation"
    if album_type == "album":
        return "Album"
    if album_type == "single":
        return "EP" if (total_tracks or 0) > 1 else "Single"
    return "Album"


def _classify_vinyl_type(record: dict) -> str:
    descs = set(record.get("format_descriptions") or [])
    if "Compilation" in descs:
        return "Compilation"
    if '7"' in descs:
        return '7"'
    if '12"' in descs and "LP" not in descs:
        return '12"'
    if "EP" in descs:
        return "EP"
    return "LP"


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
def get_artists():
    state = get_state()
    catalog = build_artist_catalog(state.log)
    lib = state.lib
    artists_lib = lib.get("artists", {})

    counts = catalog.get("counts", {})
    latest_played_map = catalog.get("latest_played", {})
    albums_catalog = catalog.get("albums", {})

    artists_list = []
    all_genres: set[str] = set()

    for name, count in counts.items():
        a_lib = artists_lib.get(name, {})
        genres = a_lib.get("genres") or []
        for g in genres:
            all_genres.add(g)

        albums = sorted(
            albums_catalog.get(name, {}).values(),
            key=lambda x: x.get("latest_played", ""),
            reverse=True,
        )

        artists_list.append({
            "name": name,
            "play_count": count,
            "latest_played": latest_played_map.get(name, ""),
            "is_favorited": bool(a_lib.get("favorited", False)),
            "genres": genres,
            "hero_art_filename": a_lib.get("hero_art_filename") or None,
            "albums": [
                {
                    "album_id": a.get("album_id", ""),
                    "art_filename": _art_filename(a.get("art_path")),
                    "count": a.get("count", 0),
                    "latest_played": a.get("latest_played", ""),
                }
                for a in albums[:6]
            ],
        })

    return {
        "artists": artists_list,
        "all_genres": sorted(all_genres),
    }


@router.get("/{name:path}")
def get_artist(name: str):
    state = get_state()
    snapshot = build_artist_detail_snapshot(state.log, state.lib, name)
    lib = state.lib
    a_lib = lib.get("artists", {}).get(name, {})

    albums_lib = lib.get("albums", {})
    albums_out = []
    for album in snapshot["albums"]:
        classified = _classify_album_type(album.get("album_type"), album.get("album_total_tracks"))
        a_data = albums_lib.get(album["album_id"], {})
        albums_out.append({
            "album_id": album["album_id"],
            "album_name": album["album_name"],
            "artist": album["artist"],
            "art_filename": _art_filename(album.get("art_path")),
            "release_year": album.get("release_year"),
            "album_type": album.get("album_type"),
            "album_total_tracks": album.get("album_total_tracks"),
            "count": album["count"],
            "classified_type": classified,
            "is_favorited": bool(a_data.get("favorited", False)),
            "rating": int(a_data.get("rating", 0)),
            "notes": a_data.get("notes", ""),
            "heard_tracks": album.get("heard_tracks", 0),
            "track_plays": _album_track_plays(album.get("plays", []), lib),
        })

    top_tracks = [
        {"track_id": t[0], "track_name": t[1], "count": t[2]}
        for t in snapshot["top_tracks"]
    ]

    # Load vinyl from Discogs collection
    vinyl_out = []
    try:
        from persistence.discogs import load_collection
        from persistence.vinyl_links import vinyl_ids_for_album

        all_vinyl = load_collection()
        all_vinyl_map = {r["release_id"]: r for r in all_vinyl}
        vinyl_ids: set[int] = set()
        for album in snapshot["albums"]:
            for vid in vinyl_ids_for_album(album["album_id"]):
                vinyl_ids.add(vid)
        artist_lower = name.lower()
        for r in all_vinyl:
            artists = r.get("artists", [])
            if isinstance(artists, list):
                if any(a.lower() == artist_lower for a in artists):
                    vinyl_ids.add(r["release_id"])
            elif isinstance(artists, str) and artists.lower() == artist_lower:
                vinyl_ids.add(r["release_id"])

        for vid in vinyl_ids:
            r = all_vinyl_map.get(vid)
            if not r:
                continue
            vinyl_out.append({
                "release_id": r.get("release_id"),
                "title": r.get("title", ""),
                "artists": r.get("artists", []),
                "art_filename": _art_filename(r.get("art_path")),
                "year": r.get("year"),
                "original_year": r.get("original_year"),
                "formats": r.get("formats", []),
                "format_descriptions": r.get("format_descriptions", []),
                "labels": r.get("labels", []),
                "catnos": r.get("catnos", []),
                "tracklist": r.get("tracklist", []),
                "vinyl_type": _classify_vinyl_type(r),
            })
    except Exception:
        pass

    return {
        "name": name,
        "play_count": snapshot["play_count"],
        "artist_id": snapshot["artist_id"],
        "genres": snapshot["genres"],
        "is_favorited": bool(a_lib.get("favorited", False)),
        "albums": albums_out,
        "top_tracks": top_tracks,
        "vinyl": vinyl_out,
    }
