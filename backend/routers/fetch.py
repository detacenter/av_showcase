import threading
import time
from fastapi import APIRouter
from state import reload_state, get_state
from integrations.spotify.auth import SpotifyAuthExpired

router = APIRouter(prefix="/api/fetch", tags=["fetch"])

_lock = threading.Lock()
_fetching = False
_new_plays: int | None = None
_last_fetch_time: float = 0.0

AUTO_POLL_INTERVAL = 180  # seconds


@router.get("/status")
def fetch_status():
    return {"fetching": _fetching, "new_plays": _new_plays}


@router.post("")
def trigger_fetch():
    global _fetching, _new_plays

    with _lock:
        if _fetching:
            return {"started": False, "reason": "already running"}
        _fetching = True
        _new_plays = None

    def _run():
        global _fetching, _new_plays, _last_fetch_time
        try:
            from fetcher import run_once
            count = run_once()
            reload_state()
            _new_plays = count
            _last_fetch_time = time.time()
        except SpotifyAuthExpired:
            # Refresh token expired — needs_reauth flag already set by auth.py.
            # Keep polling at the normal interval; it's a harmless no-op until
            # the user reconnects via the desktop app's reauth banner.
            _last_fetch_time = time.time()
        except Exception as e:
            # On 429, respect Retry-After so we don't keep hammering Spotify
            retry_after = AUTO_POLL_INTERVAL
            try:
                from requests.exceptions import HTTPError
                if isinstance(e, HTTPError) and e.response is not None and e.response.status_code == 429:
                    retry_after = int(e.response.headers.get("Retry-After", AUTO_POLL_INTERVAL))
                    print(f"Spotify 429 — backing off {retry_after}s")
            except Exception:
                pass
            _last_fetch_time = time.time() + retry_after - AUTO_POLL_INTERVAL
        finally:
            _fetching = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


def run_if_due() -> bool:
    """Run a fetch if auto-poll is enabled and the interval has elapsed."""
    global _last_fetch_time
    from core.settings import load_settings
    if not load_settings().get("auto_poll", False):
        return False
    if _fetching:
        return False
    if time.time() - _last_fetch_time < AUTO_POLL_INTERVAL:
        return False
    _last_fetch_time = time.time()  # claim the slot before spawning
    trigger_fetch()
    return True


@router.get("/dry-run")
def dry_run():
    from integrations.spotify.auth import get_access_token
    from integrations.spotify.client import get_recently_played
    from persistence.storage import load_log, load_blocklist, is_track_blocked, _parse_ts
    from datetime import datetime, timezone
    import math

    token = get_access_token()
    plays = get_recently_played(token)
    existing = load_log()

    seen_timestamps = {e["played_at"] for e in existing} | load_blocklist()
    existing_by_track: dict = {}
    for e in existing:
        tid = e.get("track_id", "")
        t = _parse_ts(e.get("played_at", ""))
        if tid and t:
            existing_by_track.setdefault(tid, []).append(t)

    accepted_by_track: dict = {}
    result = []
    for e in plays:
        tid = e.get("track_id", "")
        t = _parse_ts(e.get("played_at", ""))
        status = "accept"
        reason = None

        if e["played_at"] in seen_timestamps:
            status, reason = "skip", "timestamp already in log"
        elif is_track_blocked(tid):
            status, reason = "skip", "track blocked (too many deletes)"
        elif tid and t:
            for et in existing_by_track.get(tid, []):
                if abs((t - et).total_seconds()) < 10:
                    status, reason = "skip", f"near-duplicate: same track within 10s of existing entry"
                    break
            if status == "accept":
                for at in accepted_by_track.get(tid, []):
                    if abs((t - at).total_seconds()) < 10:
                        status, reason = "skip", "near-duplicate: same track within 10s in this batch"
                        break

        if status == "accept" and tid and t:
            accepted_by_track.setdefault(tid, []).append(t)

        result.append({
            "track": e.get("track_name", ""),
            "artist": e.get("artist_names", [None])[0],
            "album": e.get("album_name", ""),
            "played_at": e.get("played_at", ""),
            "status": status,
            "reason": reason,
        })

    return {
        "spotify_returned": len(plays),
        "would_accept": sum(1 for r in result if r["status"] == "accept"),
        "would_skip": sum(1 for r in result if r["status"] == "skip"),
        "plays": result,
    }
