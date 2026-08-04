from pathlib import Path
from fastapi import APIRouter
from state import get_state

router = APIRouter(prefix="/api/revisit", tags=["revisit"])


@router.get("")
def get_revisit():
    state = get_state()
    lib = state.lib
    tracks_lib = lib.get("tracks", {})
    revisit_ids = {tid for tid, td in tracks_lib.items() if td.get("revisit")}

    result = []
    seen: set[str] = set()
    for entry in state.log:
        tid = entry.get("track_id")
        if not tid or tid in seen or tid not in revisit_ids:
            continue
        seen.add(tid)
        art = entry.get("album_art_local_path", "") or ""
        result.append({
            "track_id": tid,
            "track_name": entry.get("track_name", ""),
            "artist": (entry.get("artist_names") or [""])[0],
            "album_name": entry.get("album_name", ""),
            "album_id": entry.get("album_id", ""),
            "release_year": entry.get("release_year"),
            "art_path": Path(art).name if art else None,
            "last_played": entry.get("played_at", ""),
            "spotify_uri": f"spotify:track:{tid}",
            "favorited": tracks_lib.get(tid, {}).get("favorited", False),
        })

    return {"tracks": result}
