from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.paths import data_path, ensure_data_dir
from persistence.discogs import classify_vinyl_type, load_collection, save_collection, load_wantlist, save_wantlist

router = APIRouter(prefix="/api/vinyl", tags=["vinyl"])

# ── Sync state ────────────────────────────────────────────────────────────────

_sync_state: dict = {"running": False, "message": "", "progress": 0, "total": 0, "phase": ""}


def _run_sync() -> None:
    from integrations.discogs.client import smart_sync

    def _cb(message: str, progress: int, total: int, phase: str) -> None:
        _sync_state.update(message=message, progress=progress, total=total, phase=phase)

    existing = {r["release_id"]: r for r in load_collection() if r.get("release_id")}
    try:
        records = smart_sync(existing, progress_cb=_cb)
        save_collection(records)
        _sync_state["message"] = f"Done — {len(records)} records"
    except Exception as exc:
        _sync_state["message"] = f"Error: {exc}"
    finally:
        _sync_state["running"] = False


@router.post("/sync")
def start_sync():
    if _sync_state["running"]:
        return {"status": "already_running"}
    _sync_state.update(running=True, message="Starting…", progress=0, total=0, phase="")
    threading.Thread(target=_run_sync, daemon=True).start()
    return {"status": "started"}


@router.get("/sync/status")
def sync_status():
    return _sync_state

# ── Persistence ───────────────────────────────────────────────────────────────

_SESSIONS_FILE = data_path("vinyl_sessions.json")


def _load_sessions() -> list[dict]:
    ensure_data_dir()
    if not _SESSIONS_FILE.exists():
        return []
    with _SESSIONS_FILE.open() as f:
        return json.load(f)


def _save_sessions(sessions: list[dict]) -> None:
    ensure_data_dir()
    with _SESSIONS_FILE.open("w") as f:
        json.dump(sessions, f, indent=2)


def _upsert_session(sess: dict) -> None:
    sessions = _load_sessions()
    for i, s in enumerate(sessions):
        if s["id"] == sess["id"]:
            sessions[i] = sess
            _save_sessions(sessions)
            return
    sessions.insert(0, sess)
    _save_sessions(sessions)


# ── In-memory active session ──────────────────────────────────────────────────

_session: dict = {}


class SessionConfirm(BaseModel):
    release_id: str
    title: str
    artists: list[str] = []
    art_filename: str | None = None

_ARTWORK_DIR = data_path("artwork")


def _art_filename(art_path: str | None) -> str | None:
    if not art_path:
        return None
    p = Path(art_path)
    try:
        return str(p.relative_to(_ARTWORK_DIR))
    except ValueError:
        pass
    try:
        return str(p.relative_to("data/artwork"))
    except ValueError:
        pass
    # art_path may be an absolute path from another machine (e.g. Mac); use the
    # filename and check if it lives in the vinyl/ subdirectory on this host.
    name = p.name
    if (_ARTWORK_DIR / "vinyl" / name).exists():
        return f"vinyl/{name}"
    return None


@router.post("/session/start")
def session_start():
    global _session
    if _session.get("active"):
        return {"status": "already_active", "session_id": _session["id"]}
    _session = {
        "id": str(uuid.uuid4()),
        "active": True,
        "started_at": time.time(),
        "dismissed": False,
        "confirmed": False,
        "release_id": None,
        "title": None,
        "artists": [],
        "art_filename": None,
    }
    return {"status": "started", "session_id": _session["id"]}


@router.post("/session/end")
def session_end():
    global _session
    if not _session.get("active"):
        return {"status": "no_active_session"}
    duration = round(time.time() - _session["started_at"])
    status = "confirmed" if _session.get("confirmed") else "unconfirmed"
    persisted = {
        "id": _session["id"],
        "started_at": _session["started_at"],
        "ended_at": time.time(),
        "duration_seconds": duration,
        "status": status,
        "release_id": _session.get("release_id"),
        "title": _session.get("title"),
        "artists": _session.get("artists", []),
        "art_filename": _session.get("art_filename"),
    }
    _upsert_session(persisted)
    _session = {}
    return {"status": "ended", "duration_seconds": duration}


@router.get("/session/current")
def session_current():
    if not _session.get("active"):
        return {"active": False}
    return {
        "active": True,
        "session_id": _session["id"],
        "started_at": _session["started_at"],
        "show_prompt": not _session.get("dismissed") and not _session.get("confirmed"),
        "confirmed": _session.get("confirmed", False),
        "release_id": _session.get("release_id"),
    }


@router.post("/session/confirm")
def session_confirm(body: SessionConfirm):
    if not _session.get("active"):
        raise HTTPException(status_code=400, detail="No active session")
    _session["confirmed"] = True
    _session["release_id"] = body.release_id
    _session["title"] = body.title
    _session["artists"] = body.artists
    _session["art_filename"] = body.art_filename
    return {"status": "confirmed", "release_id": body.release_id}


@router.post("/session/dismiss")
def session_dismiss():
    if _session.get("active"):
        _session["dismissed"] = True
    return {"status": "dismissed"}


@router.get("/sessions")
def get_sessions():
    sessions = _load_sessions()
    if _session.get("active"):
        active = {
            "id": _session["id"],
            "started_at": _session["started_at"],
            "ended_at": None,
            "duration_seconds": round(time.time() - _session["started_at"]),
            "status": "active",
            "release_id": _session.get("release_id"),
            "title": _session.get("title"),
            "artists": _session.get("artists", []),
            "art_filename": _session.get("art_filename"),
        }
        return [active] + sessions
    return sessions


@router.delete("/sessions/{session_id}")
def delete_session(session_id: str):
    global _session
    if _session.get("id") == session_id:
        _session = {}
        return {"status": "deleted"}
    sessions = _load_sessions()
    new_sessions = [s for s in sessions if s["id"] != session_id]
    if len(new_sessions) == len(sessions):
        raise HTTPException(status_code=404, detail="Session not found")
    _save_sessions(new_sessions)
    return {"status": "deleted"}


@router.post("/sessions/{session_id}/confirm")
def confirm_past_session(session_id: str, body: SessionConfirm):
    sessions = _load_sessions()
    for s in sessions:
        if s["id"] == session_id:
            s["status"] = "confirmed"
            s["release_id"] = body.release_id
            s["title"] = body.title
            s["artists"] = body.artists
            s["art_filename"] = body.art_filename
            _save_sessions(sessions)
            return {"status": "confirmed"}
    raise HTTPException(status_code=404, detail="Session not found")


@router.get("")
def get_vinyl():
    records = load_collection()
    all_genres = sorted({g for r in records for g in (r.get("genres") or []) if g})
    sorted_records = sorted(
        records,
        key=lambda r: (
            (r.get("artists") or [""])[0].lower().lstrip("the "),
            r.get("year") or 0,
        ),
    )
    result = [
        {
            "release_id": r.get("release_id"),
            "title": r.get("title", ""),
            "artists": r.get("artists") or [],
            "art_filename": _art_filename(r.get("art_path")),
            "year": r.get("year"),
            "original_year": r.get("original_year"),
            "released": r.get("released"),
            "country": r.get("country"),
            "labels": r.get("labels") or [],
            "catnos": r.get("catnos") or [],
            "genres": r.get("genres") or [],
            "styles": r.get("styles") or [],
            "formats": r.get("formats") or [],
            "format_descriptions": r.get("format_descriptions") or [],
            "tracklist": r.get("tracklist") or [],
            "community_have": r.get("community_have", 0),
            "community_want": r.get("community_want", 0),
            "community_rating_avg": r.get("community_rating_avg", 0.0),
            "community_rating_count": r.get("community_rating_count", 0),
            "date_added": r.get("date_added"),
            "user_rating": r.get("user_rating", 0),
            "notes": r.get("notes") or "",
            "barcode": r.get("barcode"),
            "matrix": r.get("matrix"),
            "vinyl_type": classify_vinyl_type(r),
        }
        for r in sorted_records
    ]
    return {"records": result, "all_genres": all_genres}


@router.get("/stats")
def get_vinyl_stats():
    from collections import Counter

    collection = load_collection()
    sessions = _load_sessions()
    confirmed = [s for s in sessions if s.get("status") == "confirmed" and s.get("release_id")]

    collection_by_id = {str(r["release_id"]): r for r in collection if r.get("release_id")}

    # Sessions per release
    plays_by_release: Counter = Counter(str(s["release_id"]) for s in confirmed)
    played_ids = set(plays_by_release.keys())

    total_seconds = sum(s.get("duration_seconds") or 0 for s in confirmed)

    # Top played
    top = sorted(plays_by_release.items(), key=lambda x: -x[1])[:10]
    top_records = []
    for rid, count in top:
        r = collection_by_id.get(rid, {})
        top_records.append({
            "release_id": int(rid),
            "title": r.get("title", "Unknown"),
            "artists": r.get("artists") or [],
            "art_filename": _art_filename(r.get("art_path")),
            "year": r.get("original_year") or r.get("year"),
            "sessions": count,
        })

    # Unplayed records
    unplayed_count = sum(1 for r in collection if str(r.get("release_id", "")) not in played_ids)

    return {
        "collection_size": len(collection),
        "played_count": len(played_ids),
        "unplayed_count": unplayed_count,
        "total_sessions": len(confirmed),
        "total_minutes": round(total_seconds / 60),
        "top_records": top_records,
    }


# ── Wantlist ──────────────────────────────────────────────────────────────────

_wantlist_sync_state: dict = {"running": False, "message": "", "progress": 0, "total": 0}


@router.get("/wantlist")
def get_wantlist():
    wants = load_wantlist()
    all_genres = sorted({g for r in wants for g in (r.get("genres") or []) if g})
    return {"wants": wants, "all_genres": all_genres, "count": len(wants)}


@router.post("/wantlist/sync")
def sync_wantlist():
    if _wantlist_sync_state["running"]:
        return {"status": "already_running"}
    _wantlist_sync_state.update(running=True, message="Fetching…", progress=0, total=0)

    def _run():
        from integrations.discogs.client import fetch_wantlist
        def _cb(done, total):
            _wantlist_sync_state.update(message=f"{done}/{total}", progress=done, total=total)
        try:
            wants = fetch_wantlist(progress_cb=_cb)
            save_wantlist(wants)
            _wantlist_sync_state["message"] = f"Done — {len(wants)} wants"
        except Exception as exc:
            _wantlist_sync_state["message"] = f"Error: {exc}"
        finally:
            _wantlist_sync_state["running"] = False

    import threading
    threading.Thread(target=_run, daemon=True).start()
    return {"status": "started"}


@router.get("/wantlist/sync/status")
def wantlist_sync_status():
    return _wantlist_sync_state
