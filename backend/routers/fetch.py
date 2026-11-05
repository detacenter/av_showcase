import threading
import time
from datetime import date

from fastapi import APIRouter

from integrations.spotify.auth import SpotifyAuthExpired
from services.poll_schedule import PollSchedule
from state import reload_state

router = APIRouter(prefix="/api/fetch", tags=["fetch"])

_lock = threading.Lock()
_fetching = False
_new_plays: int | None = None

# Auto-poll timing: random gaps from PollSchedule, short while music is playing, long
# while it isn't. 0 means "as soon as auto-poll is on". Every fetch (Cmd+R too) re-rolls it.
_schedule = PollSchedule()
_next_poll_at: float = 0.0
DAILY_POLL_CAP = 100   # ~200 Spotify calls; a heavy listening day uses about 60 polls
_poll_day = ""
_polls_today = 0


def _schedule_next(playing: bool, at_least: float = 0) -> None:
    global _next_poll_at
    wait = max(_schedule.next_wait(playing), at_least)
    _next_poll_at = time.time() + wait
    print(f"Spotify poll: {'playing' if playing else 'idle'}, next auto-poll in "
          f"{int(wait // 60)}m{int(wait % 60):02d}s ({time.strftime('%H:%M:%S', time.localtime(_next_poll_at))})")


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
        global _fetching, _new_plays
        import fetcher
        try:
            count = fetcher.run_once()
            reload_state()
            _new_plays = count
            print(f"Spotify poll: {count} new play{'' if count == 1 else 's'}")
            _schedule_next(fetcher.last_run_playing)
        except SpotifyAuthExpired:
            # Refresh token expired: needs_reauth flag already set by auth.py.
            # Keep polling; it's a harmless no-op until the user reconnects via the
            # desktop app's reauth banner.
            _schedule_next(False)
        except Exception as e:
            # On 429, wait at least as long as Spotify asks, and log which call it was
            # so a block is never a mystery again.
            retry_after = 0
            try:
                from requests.exceptions import HTTPError
                if isinstance(e, HTTPError) and e.response is not None and e.response.status_code == 429:
                    retry_after = int(e.response.headers.get("Retry-After", 3600))
                    print(f"Spotify 429 on {e.response.url}: Retry-After {retry_after}s")
                else:
                    print(f"Spotify poll failed: {e}")
            except Exception:
                pass
            _schedule_next(fetcher.last_run_playing, at_least=retry_after)
        finally:
            _fetching = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


def run_if_due() -> bool:
    """Run a fetch if auto-poll is enabled and the next poll is due."""
    global _poll_day, _polls_today
    from core.settings import load_settings
    if not load_settings().get("auto_poll", False):
        return False
    if _fetching or time.time() < _next_poll_at:
        return False
    today = date.today().isoformat()
    if today != _poll_day:
        _poll_day, _polls_today = today, 0
    if _polls_today >= DAILY_POLL_CAP:
        return False
    _polls_today += 1
    if _polls_today == DAILY_POLL_CAP:
        print(f"Spotify poll: daily cap of {DAILY_POLL_CAP} auto-polls reached; Cmd+R still works")
    trigger_fetch()
    return True


@router.get("/dry-run")
def dry_run():

    from integrations.spotify.auth import get_access_token
    from integrations.spotify.client import get_recently_played
    from persistence.storage import (
        _parse_ts,
        is_track_blocked,
        load_blocklist,
        load_log,
    )

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
                    status, reason = "skip", "near-duplicate: same track within 10s of existing entry"
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
