"""Background fill-in for the imported Spotify history.

Spotify's export has names only. A Spotify development-mode app gets only a few hundred
catalog calls a day (QUOTA_EXCEEDED, 24 h lockout, seen 2026-10-30 after 568 calls), so
the bulk comes from sources without a daily quota, and Spotify is a slow trickle:

  albums   per (artist, album): Last.fm album.getInfo for the cover, the tracklist (track
           numbers, lengths) and a MusicBrainz id; MusicBrainz for the release year;
           cover downloaded through the same artwork cache the live log uses.
  genres   Last.fm top tags for artists AV hasn't seen, into lastfm_genres.json.
  spotify  one GET /v1/tracks/{id} per album, SPOTIFY_DAILY_BUDGET a day, spread out:
           gives the real Spotify album id (so "Open in Spotify" works), album type,
           exact release year and total tracks for every track of that album.

Progress lives in tracks.json (`enriched_at` / `enriched_from` / `album_id` per track),
so stopping and starting again picks up where it left off. Runs as daemon threads inside
the backend. Tracks AV has logged itself are copied first, no requests at all.
"""
from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from datetime import date, datetime, timezone

from persistence import spotify_history as sh

log = logging.getLogger(__name__)

LASTFM_PAUSE_S = 0.3
MB_PAUSE_S = 1.1              # MusicBrainz asks for 1 request/second
GENRE_PAUSE_S = 0.5
SAVE_EVERY = 200              # albums between tracks.json writes (each refreshes the Stats cache)
MAX_CONSECUTIVE_ERRORS = 25

SPOTIFY_DAILY_BUDGET = int(os.environ.get("AUDIOVAULT_SPOTIFY_BUDGET", "288"))
SPOTIFY_INTERVAL_S = 86400 / max(SPOTIFY_DAILY_BUDGET, 1)   # 288/day = one every 5 min
RATE_LIMIT_EXTRA_S = 600
BUDGET_FILE = sh.HISTORY_DIR / "spotify_budget.json"

status: dict = {
    "running": False,
    "phase": None,            # "albums" | "genres" | "done"
    "done": 0,
    "total": 0,
    "errors": 0,
    "started_at": None,
    "finished_at": None,
    "last_error": None,
    "spotify": {"running": False, "today": 0, "budget": SPOTIFY_DAILY_BUDGET, "remaining_albums": 0,
                "rate_limited_until": None, "last_error": None},
}
_stop = threading.Event()
_thread: threading.Thread | None = None
_spotify_thread: threading.Thread | None = None
_lock = threading.Lock()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    s = re.sub(r"\s*[\(\[][^)\]]*[\)\]]", "", (s or "").lower())      # drop "(remastered)" etc.
    s = re.sub(r"\s+-\s+.*$", "", s)                                  # drop " - 2011 remaster"
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def album_groups(tracks: dict[str, dict], only_pending: bool = True) -> dict[tuple[str, str], list[str]]:
    groups: dict[tuple[str, str], list[str]] = {}
    for tid, t in tracks.items():
        if only_pending and (t.get("enriched_at") or t.get("gone")):
            continue
        groups.setdefault((t.get("artist", ""), t.get("album", "")), []).append(tid)
    return groups


def _by_plays(groups: dict, counts: dict[str, int]) -> list[tuple[str, str]]:
    """Most-played albums first, so what you actually see fills in first."""
    return sorted(groups, key=lambda k: -sum(counts.get(t, 0) for t in groups[k]))


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ── Step 0: copy what AV already knows ────────────────────────────────────────

LIVE_FIELDS = ("artist_names", "artist_ids", "album_id", "album_type", "album_total_tracks",
               "album_art_url", "album_art_local_path", "release_year", "track_number", "explicit", "isrc")


def seed_from_live_log(tracks: dict[str, dict], log_entries: list[dict]) -> int:
    """Tracks AV has logged itself already carry everything (the cover is even
    downloaded). Copy those instead of asking anyone. Returns how many."""
    seeded = 0
    for e in log_entries:
        t = tracks.get(e.get("track_id"))
        if not t or t.get("enriched_at") or not e.get("album_id") or not e.get("duration_ms"):
            continue
        t.update({k: e.get(k) for k in LIVE_FIELDS})
        t["name"] = e.get("track_name") or t.get("name", "")
        t["album_display"] = e.get("album_name") or None   # "artist"/"album" stay the export's grouping keys
        t["duration_ms"] = e.get("duration_ms")
        t["enriched_at"] = _now()
        t["enriched_from"] = "live_log"
        seeded += 1
    propagate_album_fields(tracks)
    return seeded


ALBUM_FIELDS = ("album_display", "album_id", "album_type", "album_total_tracks", "album_art_url",
                "album_art_local_path", "release_year")


def _art(artist: str, album: str, url: str | None) -> str | None:
    from integrations.spotify.artwork import download_artwork
    return download_artwork(artist, album, url)


def fill_covers(tracks: dict[str, dict]) -> int:
    """Make sure every album that knows a cover URL has the file. Two gaps this closes:
    the Spotify trickle used to record `album_art_url` without downloading it (the first
    ~570 albums it resolved had no cover), and paths seeded from the live log can be
    `data/artwork/...` relative or point at another machine, which the Albums grid
    tolerates (it serves by basename) but `os.path.exists` checks do not. Returns the
    number of albums changed."""
    from core.paths import resolve_data_path

    changed = 0
    for (artist, album), tids in album_groups(tracks, only_pending=False).items():
        t = tracks[tids[0]]
        path = t.get("album_art_local_path")
        resolved = resolve_data_path(path)
        if resolved and resolved.exists():
            new = str(resolved)
        elif t.get("album_art_url"):
            new = _art(artist, album, t["album_art_url"])
            if not new:
                continue
        else:
            continue
        if new == path:
            continue
        for tid in tids:
            tracks[tid]["album_art_local_path"] = new
        changed += 1
    return changed


def propagate_album_fields(tracks: dict[str, dict]) -> None:
    """Once any track on an (artist, album) knows the album, its siblings know it too."""
    for tids in album_groups(tracks, only_pending=False).values():
        known = next((tracks[t] for t in tids if tracks[t].get("album_id")), None)
        if not known:
            continue
        for tid in tids:
            t = tracks[tid]
            if not t.get("album_id"):
                t.update({k: known.get(k) for k in ALBUM_FIELDS})


# ── Step 1: Last.fm + MusicBrainz per album ───────────────────────────────────

def lastfm_album(artist: str, album: str) -> dict | None:
    from integrations import api_metrics

    key = os.environ.get("LASTFM_API_KEY", "")
    if not key:
        return None
    params = {"method": "album.getInfo", "artist": artist, "album": album, "autocorrect": 1, "api_key": key, "format": "json"}
    resp = api_metrics.get("Last.fm", "album_info", "https://ws.audioscrobbler.com/2.0/", params=params, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if data.get("error"):
        return None
    return data.get("album") or None


def musicbrainz_year(mbid: str) -> int | None:
    from integrations import api_metrics

    for attempt in range(2):   # MusicBrainz answers 503 when it's busy; one retry after a pause
        resp = api_metrics.get("MusicBrainz", "release", f"https://musicbrainz.org/ws/2/release/{mbid}",
                               params={"inc": "release-groups", "fmt": "json"},
                               headers={"User-Agent": "Audiovault/1.0 (personal listening archive)"}, timeout=15)
        if resp.status_code in (503, 429) and attempt == 0:
            time.sleep(3)
            continue
        break
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    data = resp.json()
    d = (data.get("release-group") or {}).get("first-release-date") or data.get("date") or ""
    return int(d[:4]) if d[:4].isdigit() else None


def apply_lastfm(tracks: dict[str, dict], tids: list[str], info: dict, year: int | None) -> dict:
    """Fill the album's tracks from a Last.fm album object. Returns the cover URL (if any)."""
    images = [i.get("#text") for i in info.get("image") or [] if i.get("#text")]
    cover = images[-1] if images else None
    tl = (info.get("tracks") or {}).get("track") or []
    if isinstance(tl, dict):
        tl = [tl]
    by_name: dict[str, dict] = {}
    for item in tl:
        by_name.setdefault(_norm(item.get("name", "")), item)
    for tid in tids:
        t = tracks[tid]
        item = by_name.get(_norm(t.get("name", "")))
        if item:
            rank = (item.get("@attr") or {}).get("rank")
            if str(rank).isdigit():
                t["track_number"] = int(rank)
            dur = item.get("duration")
            if dur and str(dur).isdigit() and int(dur) > 0:
                t["duration_ms"] = int(dur) * 1000
        if not t.get("album_id"):   # Spotify's facts win when we already have them
            t["album_total_tracks"] = len(tl) or None
            t["album_art_url"] = cover
            t["release_year"] = year
        t["lastfm_mbid"] = info.get("mbid") or None
        t["enriched_at"] = _now()
        t["enriched_from"] = "lastfm"
    return {"cover": cover}


def _enrich_albums() -> None:
    from integrations.spotify.artwork import download_artwork
    from persistence.storage import load_log

    tracks = sh.load_tracks()
    seeded = seed_from_live_log(tracks, load_log())
    if seeded:
        log.info("History: %d tracks copied from the live log", seeded)
        with _lock:
            sh.save_tracks(tracks)
    groups = album_groups(tracks)
    order = _by_plays(groups, sh.play_counts())
    limit = int(os.environ.get("AUDIOVAULT_ENRICH_LIMIT", "0") or 0)
    status.update(phase="albums", total=len(order), done=0)
    consecutive = 0
    since_save = 0
    for n, key in enumerate(order):
        if _stop.is_set() or (limit and n >= limit):
            break
        artist, album = key
        tids = groups[key]
        try:
            info = lastfm_album(artist, album)
            year = None
            if info and info.get("mbid"):
                if _stop.wait(MB_PAUSE_S):
                    break
                try:
                    year = musicbrainz_year(info["mbid"])
                except Exception as exc:  # noqa: BLE001
                    status["last_error"] = f"musicbrainz {artist} / {album}: {type(exc).__name__}"[:200]
            if info:
                res = apply_lastfm(tracks, tids, info, year)
                if res["cover"] and not all(tracks[t].get("album_art_local_path") for t in tids):
                    path = download_artwork(artist, album, res["cover"])
                    if path:
                        for tid in tids:
                            tracks[tid].setdefault("album_art_local_path", path)
            else:
                for tid in tids:  # nothing known: mark so we don't ask again, Spotify may still fill it
                    tracks[tid]["enriched_at"] = _now()
                    tracks[tid]["enriched_from"] = "none"
            consecutive = 0
        except Exception as exc:  # noqa: BLE001
            consecutive += 1
            status["errors"] += 1
            status["last_error"] = f"{artist} / {album}: {type(exc).__name__}: {exc}"[:200]
            if consecutive >= MAX_CONSECUTIVE_ERRORS:
                log.error("History albums: %d consecutive errors, stopping", consecutive)
                break
        status["done"] += 1
        since_save += 1
        if since_save >= SAVE_EVERY:
            with _lock:
                sh.save_tracks(tracks)
            since_save = 0
        if _stop.wait(LASTFM_PAUSE_S):
            break
    with _lock:
        sh.save_tracks(tracks)


# ── Step 2: genres ────────────────────────────────────────────────────────────

def _enrich_genres() -> None:
    from integrations.lastfm.client import get_artist_genres
    from persistence.lastfm_genres import load_lastfm_genres, save_lastfm_genres
    from persistence.library import load_library

    tracks = sh.load_tracks()
    known = set(load_lastfm_genres())
    known |= {a for a, d in load_library().get("artists", {}).items() if d.get("genres")}
    names: list[str] = []
    seen: set[str] = set()
    for t in tracks.values():
        for a in (t.get("artist_names") or [t.get("artist", "")])[:1]:
            if a and a not in known and a not in seen:
                seen.add(a)
                names.append(a)
    status.update(phase="genres", total=len(names), done=0)
    fetched: dict[str, list[str]] = {}

    def flush() -> None:
        if fetched:
            current = load_lastfm_genres()   # read-merge-write: the live fetcher writes this file too
            current.update(fetched)
            save_lastfm_genres(current)
            fetched.clear()

    for name in names:
        if _stop.is_set():
            break
        genres = get_artist_genres(name)
        if genres is not None:
            fetched[name] = genres
        status["done"] += 1
        if len(fetched) >= 50:
            flush()
        if _stop.wait(GENRE_PAUSE_S):
            break
    flush()


# ── Spotify trickle: real album ids, a few hundred calls a day ────────────────

class RateLimited(Exception):
    def __init__(self, retry_after: float):
        self.retry_after = retry_after


class Gone(Exception):
    pass


def _spotify_get(url: str, token: str) -> dict:
    from integrations import api_metrics

    resp = api_metrics.get("Spotify", "history_track", url, headers={"Authorization": f"Bearer {token}"}, timeout=20)
    if resp.status_code == 429:
        raise RateLimited(float(resp.headers.get("Retry-After", "3600")))
    if resp.status_code in (400, 404):
        raise Gone()
    resp.raise_for_status()
    return resp.json()


def track_fields(t: dict) -> dict:
    """Map a Spotify track object onto the catalog fields the entries read."""
    album = t.get("album") or {}
    images = sorted(album.get("images") or [], key=lambda x: x.get("width", 0), reverse=True)
    release = album.get("release_date") or ""
    return {
        "name": t.get("name") or "",
        "artist_names": [a["name"] for a in t.get("artists") or []],
        "artist_ids": [a["id"] for a in t.get("artists") or []],
        "album_display": album.get("name") or None,
        "album_id": album.get("id"),
        "album_type": album.get("album_type"),
        "album_total_tracks": album.get("total_tracks"),
        "album_art_url": images[0]["url"] if images else None,
        "release_year": (int(release[:4]) or None) if release[:4].isdigit() else None,  # Spotify sends "0000" when it doesn't know
        "track_number": t.get("track_number"),
        "duration_ms": t.get("duration_ms"),
        "explicit": t.get("explicit"),
        "isrc": (t.get("external_ids") or {}).get("isrc"),
        "enriched_at": _now(),
        "enriched_from": "spotify",
    }


def album_fields(f: dict) -> dict:
    """The part of a track's Spotify data that applies to every track on its album."""
    return {k: f[k] for k in ("album_display", "album_id", "album_type", "album_total_tracks", "album_art_url",
                              "album_art_local_path", "release_year") if k in f}


def _load_budget() -> dict:
    try:
        with BUDGET_FILE.open() as f:
            b = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        b = {}
    if b.get("day") != date.today().isoformat():
        b = {"day": date.today().isoformat(), "used": 0}
    return b


def _save_budget(b: dict) -> None:
    sh.HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    tmp = BUDGET_FILE.with_suffix(".tmp")
    with tmp.open("w") as f:
        json.dump(b, f)
    tmp.replace(BUDGET_FILE)


def spotify_pending(tracks: dict[str, dict]) -> dict[tuple[str, str], list[str]]:
    """Albums still carrying a placeholder id (one Spotify call fixes the whole album)."""
    groups = album_groups(tracks, only_pending=False)
    return {k: tids for k, tids in groups.items()
            if not any(tracks[t].get("album_id") for t in tids) and not all(tracks[t].get("gone") for t in tids)}


def _record_alias(placeholder: str, real_id: str | None) -> None:
    """The album's entries switch from the placeholder id to the real one at the next state
    reload; anything the user attached to the placeholder (rating, notes, favorite, Tops)
    and any link still holding it has to follow. The alias is read by state._load and by
    GET /api/albums/{id}."""
    from persistence.library import alias_album, library_lock, load_library, save_library

    if not real_id or real_id == placeholder:
        return
    try:
        with library_lock:
            lib = load_library()
            if alias_album(lib, placeholder, real_id):
                save_library(lib)
    except Exception as exc:  # noqa: BLE001
        log.warning("could not record album alias %s -> %s: %s", placeholder, real_id, exc)


def _spotify_trickle() -> None:
    from integrations.spotify.auth import get_access_token

    sp = status["spotify"]
    sp["running"] = True
    try:
        while not _stop.is_set():
            budget = _load_budget()
            sp["today"] = budget["used"]
            tracks = sh.load_tracks()
            pending = spotify_pending(tracks)
            sp["remaining_albums"] = len(pending)
            if not pending:
                break
            if budget["used"] >= SPOTIFY_DAILY_BUDGET:
                if _stop.wait(3600):   # wait for tomorrow, checking hourly
                    break
                continue
            counts = sh.play_counts()
            key = _by_plays(pending, counts)[0]
            tids = pending[key]
            tid = max(tids, key=lambda t: counts.get(t, 0))
            try:
                data = _spotify_get(f"https://api.spotify.com/v1/tracks/{tid}", get_access_token())
                budget["used"] += 1
                _save_budget(budget)
                f = track_fields(data)
                f["album_art_local_path"] = _art(key[0], key[1], f.get("album_art_url"))
                tracks[tid].update(f)
                shared = album_fields(f)
                for other in tids:
                    if other != tid:
                        tracks[other].update(shared)
                        tracks[other].setdefault("enriched_at", _now())
                with _lock:
                    sh.save_tracks(tracks)
                _record_alias(sh.placeholder_album_id(*key), f.get("album_id"))
            except Gone:
                budget["used"] += 1
                _save_budget(budget)
                tracks[tid]["gone"] = True
                with _lock:
                    sh.save_tracks(tracks)
            except RateLimited as rl:
                wait = rl.retry_after + RATE_LIMIT_EXTRA_S
                sp["rate_limited_until"] = time.time() + wait
                budget["used"] = SPOTIFY_DAILY_BUDGET  # treat today as spent
                _save_budget(budget)
                log.warning("Spotify 429 on the history trickle, pausing %.0fs", wait)
                if _stop.wait(wait):
                    break
                sp["rate_limited_until"] = None
                continue
            except Exception as exc:  # noqa: BLE001
                sp["last_error"] = f"{tid}: {type(exc).__name__}: {exc}"[:200]
            if _stop.wait(SPOTIFY_INTERVAL_S):
                break
    finally:
        sp["running"] = False


# ── Control ───────────────────────────────────────────────────────────────────

def _fill_covers_step() -> None:
    tracks = sh.load_tracks()
    status.update(phase="covers", total=0, done=0)
    n = fill_covers(tracks)
    if n:
        log.info("History: covers filled for %d albums", n)
        with _lock:
            sh.save_tracks(tracks)


def _run(delay_s: float) -> None:
    try:
        if _stop.wait(delay_s):
            return
        status.update(running=True, started_at=_now(), finished_at=None, errors=0, last_error=None)
        for step in (_fill_covers_step, _enrich_albums, _enrich_genres):
            if _stop.is_set():
                break
            step()
        if not _stop.is_set():
            status["phase"] = "done"
        from state import reload_state
        reload_state()
    except Exception as exc:  # noqa: BLE001
        log.exception("History enrichment crashed")
        status["last_error"] = f"{type(exc).__name__}: {exc}"[:200]
    finally:
        status.update(running=False, finished_at=_now())


_remaining_cache: tuple[int, dict] | None = None


def remaining() -> dict:
    """Counts for the status panel. Cached by tracks.json mtime: the Dev panel and the
    watchdog poll this every few seconds, and reloading 21k tracks each time churned
    the Pi's memory."""
    global _remaining_cache
    stamp = sh.TRACKS_FILE.stat().st_mtime_ns
    if _remaining_cache and _remaining_cache[0] == stamp:
        return _remaining_cache[1]
    tracks = sh.load_tracks()
    out = {
        "albums": len(album_groups(tracks)),
        "spotify_albums": len(spotify_pending(tracks)),
        "total_tracks": len(tracks),
        "total_albums": len(album_groups(tracks, only_pending=False)),
    }
    _remaining_cache = (stamp, out)
    return out


def start(delay_s: float = 0.0) -> bool:
    """Start (or resume) the album/genre pass and the Spotify trickle in the background."""
    global _thread, _spotify_thread
    if not sh.TRACKS_FILE.exists():
        return False
    started = False
    _stop.clear()
    if not (_thread and _thread.is_alive()):
        _thread = threading.Thread(target=_run, args=(delay_s,), name="history-enrich", daemon=True)
        _thread.start()
        started = True
    if not os.environ.get("AUDIOVAULT_NO_SPOTIFY_TRICKLE") and not (_spotify_thread and _spotify_thread.is_alive()):
        _spotify_thread = threading.Thread(target=lambda: (_stop.wait(delay_s) or _spotify_trickle()),
                                           name="history-spotify", daemon=True)
        _spotify_thread.start()
        started = True
    return started


def stop() -> None:
    _stop.set()


def get_status() -> dict:
    out = {**status, "spotify": {**status["spotify"], "budget": SPOTIFY_DAILY_BUDGET}}
    if sh.TRACKS_FILE.exists():
        out["remaining"] = remaining()
        out["spotify"]["today"] = _load_budget()["used"]
    else:
        out["remaining"] = None
    return out
