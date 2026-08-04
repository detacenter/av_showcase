from __future__ import annotations

import threading
from fastapi import APIRouter
from state import get_state

router = APIRouter(prefix="/api/claudio", tags=["claudio"])

_lock = threading.Lock()
_generating = False
_error: str | None = None


@router.get("/status")
def claudio_status():
    return {"generating": _generating, "error": _error}


@router.get("/history")
def claudio_history():
    from ai.recommendations import load_history
    return load_history()


@router.post("/generate")
def claudio_generate():
    global _generating, _error

    with _lock:
        if _generating:
            return {"started": False, "reason": "already running"}
        _generating = True
        _error = None

    def _run():
        global _generating, _error
        try:
            from ai.recommendations import fetch_recommendations, enrich_with_spotify, save_recommendations, append_to_history
            from integrations.spotify.auth import get_access_token
            from datetime import datetime, timezone

            from ai.recommendations import load_history

            state = get_state()

            # Build blacklist: albums the user owns OR has ever been recommended
            blacklist: set[tuple[str, str]] = set()

            for entry in state.log:
                album = (entry.get("album_name") or "").lower().strip()
                artist = ((entry.get("artist_names") or [""])[0]).lower().strip()
                if album:
                    blacklist.add((album, artist))

            for batch in load_history().get("batches", []):
                for r in batch.get("recommendations", []):
                    blacklist.add((r["album"].lower().strip(), r["artist"].lower().strip()))

            recs = fetch_recommendations(state.log, state.lib)

            # Hard-filter: drop anything Claude returned that's on the blacklist
            dropped = [r for r in recs if (r["album"].lower().strip(), r["artist"].lower().strip()) in blacklist]
            if dropped:
                print(f"  Claudio: filtered {len(dropped)} blacklisted recs: {[r['album'] for r in dropped]}")
            recs = [r for r in recs if (r["album"].lower().strip(), r["artist"].lower().strip()) not in blacklist]

            token = get_access_token()
            recs = enrich_with_spotify(recs, token)

            now = datetime.now(timezone.utc).isoformat()
            batch = {"generated_at": now, "recommendations": recs}
            save_recommendations(batch)
            append_to_history(batch)
        except Exception as e:
            _error = str(e)
        finally:
            _generating = False

    threading.Thread(target=_run, daemon=True).start()
    return {"started": True}


@router.post("/feedback")
def claudio_feedback(body: dict):
    """Save thumbs up/down feedback for a recommendation in a specific batch."""
    import json as _json
    from ai.recommendations import HISTORY_FILE, load_history, load_recommendations, save_recommendations

    batch_idx = body.get("batch_idx")
    rec_idx = body.get("rec_idx")
    feedback = body.get("feedback")  # "up" / "down" / None

    history = load_history()
    batches = history.get("batches", [])
    if 0 <= batch_idx < len(batches):
        recs = batches[batch_idx].get("recommendations", [])
        if 0 <= rec_idx < len(recs):
            recs[rec_idx]["feedback"] = feedback
            with open(HISTORY_FILE, "w") as f:
                _json.dump(history, f, indent=2)

    # Keep recommendations.json in sync if this is the latest batch
    if batch_idx == len(batches) - 1:
        data = load_recommendations()
        cur = data.get("recommendations", [])
        if 0 <= rec_idx < len(cur):
            cur[rec_idx]["feedback"] = feedback
            save_recommendations(data)

    return {"ok": True}
