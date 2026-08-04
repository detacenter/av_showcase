import json
from datetime import datetime, timezone
from fastapi import APIRouter, Query
from core.helpers import normalize_search, dominant_art_color
from core.paths import data_path
from persistence.storage import save_log, add_to_blocklist, record_deletion
from persistence.discogs import load_collection, classify_vinyl_type
from state import get_state, reload_state

router = APIRouter(prefix="/api/recent", tags=["recent"])


def _album_key(entry: dict) -> str:
    if entry.get("album_id"):
        return entry["album_id"]
    artist = (entry.get("artist_names") or [""])[0]
    return f"{entry.get('album_name', '')}|{artist}"


def _track_key(entry: dict) -> str:
    if entry.get("track_id"):
        return entry["track_id"]
    return f"{entry.get('track_number', '')}|{entry.get('track_name', '')}"


def _marquee_session_entries(album_key: str, log: list, album_entries: list) -> list:
    """Keep only entries from the current session. A session break occurs when
    >=28 distinct other albums are played between two consecutive plays."""
    if len(album_entries) <= 1:
        return album_entries
    session_count = 1
    for i in range(len(album_entries) - 1):
        newer_t = album_entries[i]["played_at"]
        older_t = album_entries[i + 1]["played_at"]
        distinct_others: set = set()
        for entry in log:
            t = entry["played_at"]
            if t <= older_t:
                break
            if t >= newer_t:
                continue
            k = _album_key(entry)
            if k != album_key:
                distinct_others.add(k)
                if len(distinct_others) >= 28:
                    break
        if len(distinct_others) >= 28:
            break
        session_count += 1
    return album_entries[:session_count]


def _load_vinyl_albums() -> list[dict]:
    """Return confirmed vinyl sessions shaped as album entries, including active sessions."""
    from routers.vinyl import _session, _load_sessions

    sessions = _load_sessions()
    # Prepend active in-memory session if it has been confirmed (release_id set)
    if _session.get("active") and _session.get("release_id"):
        import time as _time
        sessions = [{
            "id": _session["id"],
            "started_at": _session["started_at"],
            "ended_at": None,
            "duration_seconds": round(_time.time() - _session["started_at"]),
            "status": "active",
            "release_id": _session.get("release_id"),
            "title": _session.get("title"),
            "artists": _session.get("artists", []),
            "art_filename": _session.get("art_filename"),
        }] + sessions

    collection = {str(r["release_id"]): r for r in load_collection() if r.get("release_id")}

    # Deduplicate by release_id — keep only the most recent session per record
    seen: dict[str, dict] = {}
    for vs in sessions:
        if vs.get("status") not in ("confirmed", "active") or not vs.get("release_id"):
            continue
        rid = str(vs["release_id"])
        if rid not in seen or vs["started_at"] > seen[rid]["started_at"]:
            seen[rid] = vs

    result = []
    for vs in seen.values():
        rec = collection.get(str(vs["release_id"]), {})
        artists = vs.get("artists") or rec.get("artists") or []
        played_at = datetime.fromtimestamp(vs["started_at"], tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        art_filename = vs.get("art_filename")
        art_path = str(data_path("artwork", art_filename)) if art_filename else ""
        result.append({
            "album_id": f"vinyl:{vs['release_id']}",
            "album_name": vs.get("title") or rec.get("title", ""),
            "artist": artists[0] if artists else "",
            "release_year": rec.get("original_year") or rec.get("year"),
            "art_local_path": None,
            "art_url": None,
            "art_filename": art_filename,
            "dominant_color": dominant_art_color(art_path),
            "source": "vinyl",
            "vinyl_type": classify_vinyl_type(rec) if rec else "LP",
            "tracklist": rec.get("tracklist") or [],
            "entries": [],
            "_played_at": played_at,
        })
    return result


@router.get("/albums")
def get_recent_albums(q: str = Query("")):
    state = get_state()
    log = state.log  # newest-first
    tracks_lib = state.lib.get("tracks", {})
    query = normalize_search(q) if q else ""

    # Group by album key, track the most recent played_at per album
    albums: dict[str, list] = {}
    album_latest: dict[str, str] = {}
    for entry in log:
        key = _album_key(entry)
        if key not in albums:
            albums[key] = []
        albums[key].append(entry)
        t = entry.get("played_at", "")
        if t > album_latest.get(key, ""):
            album_latest[key] = t
    album_order = sorted(albums, key=lambda k: album_latest[k], reverse=True)

    result = []
    for key in album_order:
        raw_entries = albums[key]
        entries = _marquee_session_entries(key, log, raw_entries)

        # Apply search filter
        if query:
            def _matches(e):
                fields = [
                    e.get("album_name", ""),
                    " ".join(e.get("artist_names") or []),
                    e.get("track_name", ""),
                ]
                return any(query in normalize_search(f) for f in fields if f)
            entries = [e for e in entries if _matches(e)]
            if not entries:
                continue

        first = entries[0]
        artist_names = first.get("artist_names") or []
        artist = artist_names[0] if artist_names else ""
        seen_tracks: set[str] = set()
        track_entries = []
        for e in entries:
            tid = e.get("track_id", "")
            if tid and tid in seen_tracks:
                continue
            if tid:
                seen_tracks.add(tid)
            td = tracks_lib.get(tid, {})
            track_entries.append({
                "played_at": e.get("played_at", ""),
                "track_id": tid,
                "track_name": e.get("track_name", ""),
                "is_favorited": td.get("favorited", False),
                "is_revisit": td.get("revisit", False),
            })

        result.append({
            "album_id": first.get("album_id", ""),
            "album_name": first.get("album_name", ""),
            "artist": artist,
            "release_year": first.get("release_year"),
            "art_local_path": first.get("album_art_local_path"),
            "art_url": first.get("album_art_url"),
            "art_filename": None,
            "dominant_color": dominant_art_color(first.get("album_art_local_path", "")),
            "source": "spotify",
            "vinyl_type": None,
            "tracklist": [],
            "entries": track_entries,
        })

        if len(result) >= 28:
            break

    # Merge vinyl sessions — filter by query if active, then insert chronologically
    vinyl_albums = _load_vinyl_albums()
    if query:
        vinyl_albums = [
            v for v in vinyl_albums
            if query in normalize_search(v.get("album_name", ""))
            or query in normalize_search(v.get("artist", ""))
        ]
    for v in vinyl_albums:
        played_at = v.pop("_played_at")
        # Insert at the correct chronological position
        pos = next((i for i, r in enumerate(result) if r.get("entries") and r["entries"][0]["played_at"] < played_at), len(result))
        result.insert(pos, {**v, "entries": [], "played_at": played_at})

    return {"albums": result}


@router.get("")
def get_recent(
    page: int = Query(1, ge=1),
    per_page: int = Query(200, ge=1, le=500),
    q: str = Query(""),
):
    state = get_state()
    log = state.log

    if q:
        query = normalize_search(q)
        log = [
            e for e in log
            if any(
                query in normalize_search(text)
                for text in [
                    e.get("track_name", ""),
                    e.get("album_name", ""),
                    " ".join(e.get("artist_names", [])),
                ]
                if text
            )
        ]

    total = len(log)
    start = (page - 1) * per_page
    entries = log[start:start + per_page]

    tracks_lib = state.lib.get("tracks", {})
    enriched = []
    for e in entries:
        track_data = tracks_lib.get(e.get("track_id", ""), {})
        enriched.append({
            **e,
            "is_favorited": track_data.get("favorited", False),
            "is_revisit": track_data.get("revisit", False),
        })

    return {
        "entries": enriched,
        "total": total,
        "page": page,
        "per_page": per_page,
        "has_more": start + per_page < total,
    }


@router.delete("/{played_at}")
def delete_entry(played_at: str, track_id: str = Query("")):
    state = get_state()
    new_log = [e for e in state.log if e.get("played_at") != played_at]
    save_log(new_log)
    add_to_blocklist(played_at)
    if track_id:
        record_deletion(track_id)
    reload_state()
    return {"ok": True}
