"""
Phase 3: generates static API-response snapshots by running the real (sanitized)
backend once, locally, against the synthetic data/ directory, and saving each
in-scope GET endpoint's actual JSON response as a file the service worker serves.

This is a build-time-only tool. The backend it starts is never deployed and never
runs again after this script finishes — see PRJ-0005 notes.md "Phase 3 scoping"
for the full architecture rationale.

CRITICAL — two things this script guards against, both found the hard way in
session 4 (see PRJ-0005 session log for the full story):

1. Absolute local paths leaking into snapshots. The real backend's
   data_path()-derived fields (e.g. art_local_path) resolve to absolute local
   filesystem paths on whatever machine runs this script (e.g.
   "/Users/<you>/code/av_showcase/data/artwork/foo.jpg"). sanitize_paths()
   strips every such field down to just the filename before anything is
   written to disk.

2. The real backend mutating data/ as a side effect of merely starting up.
   state.py's get_state() runs artwork backfill, log deduplication, and
   album-alias remapping on every startup — none of which this tool wants,
   since data/ is supposed to be pure generator *input*, not something a
   build tool silently rewrites. Rather than chase every individual mutation
   path (more may exist that haven't been found yet), this script snapshots
   every JSON file under data/ (and the artwork/ filename list) before
   starting the backend, and force-restores them afterward, unconditionally.
   The backend is treated as a pure input->output function even though it
   isn't actually written as one.

It also refuses to start if something is already listening on its port,
instead of silently talking to a stray leftover process (which is exactly
what happened the first time this script ran against an unkilled process
from an earlier manual test — it looked like a success and wasn't).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARTWORK_DIR = DATA_DIR / "artwork"
OUT_DIR = ROOT / "frontend" / "public" / "mock-api"
BACKEND_DIR = ROOT / "backend"
PORT = 8123
BASE_URL = f"http://127.0.0.1:{PORT}"

ENDPOINTS = {
    "/api/recent/albums": "recent-albums.json",
    "/api/settings": "settings.json",
    "/api/artists": "artists.json",
    "/api/albums": "albums.json",
    "/api/playlists": "playlists.json",
    "/api/playlists/sessions": "playlist-sessions.json",
    "/api/revisit": "revisit.json",
    "/api/vinyl": "vinyl.json",
    "/api/vinyl/wantlist": "vinyl-wantlist.json",
    "/api/stats/overview": "stats-overview.json",
    "/api/stats/era-data": "stats-era-data.json",
    "/api/stats/trends": "stats-trends.json",
    "/api/stats/sessions": "stats-sessions.json",
    "/api/vinyl/stats": "vinyl-stats.json",
    "/api/vinyl/sessions": "vinyl-sessions.json",
}

# Stats tabs with paginated/parameterized endpoints — bounded by the actual
# synthetic data's real date range (via the real has_older flag) or the
# actual set of release years present (via each metric's own bars), not
# hardcoded guesses. See fetch_stats_extras() in main().
_TIMELINE_METRICS = ["Albums", "Plays", "Vinyl"]

_ABS_PATH_RE = re.compile(r"^/[^\s]*/([^/\s]+)$")
_IMAGE_EXT_RE = re.compile(r"\.(jpe?g|png)$", re.IGNORECASE)


def sanitize_paths(obj):
    if isinstance(obj, dict):
        return {k: sanitize_paths(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_paths(v) for v in obj]
    if isinstance(obj, str):
        m = _ABS_PATH_RE.match(obj)
        if m and ("/Users/" in obj or "/home/" in obj):
            return m.group(1)
    return obj


_HTML_ARTWORK_RE = re.compile(r'/artwork/([^"\'\\]+\.(?:jpe?g|png))', re.IGNORECASE)


def scrub_stale_artwork_html(html: str, valid_names: set) -> str:
    """Same purpose as scrub_stale_artwork(), for the one endpoint that
    returns raw HTML with embedded JSON (genres-page) instead of a JSON
    response — a plain regex pass over /artwork/<file> references rather
    than a structured-object walk, since there's no dict/list to traverse."""
    def _replace(m: re.Match) -> str:
        name = m.group(1).rsplit("/", 1)[-1]
        return m.group(0) if name in valid_names else "/artwork/__missing__.jpg"

    return _HTML_ARTWORK_RE.sub(_replace, html)


def scrub_stale_artwork(obj, valid_names: set):
    """Null out any artwork reference that doesn't survive restore_data_state().

    A response captured mid-run can legitimately name a file that only exists
    because the backend's artwork backfill just downloaded it from Spotify's
    CDN — restore_data_state() then deletes that file (it's new, unreviewed
    content this tool shouldn't silently keep). Without this pass, snapshots
    are left pointing at filenames that don't exist anywhere once the run
    finishes, showing up as broken images in the demo (caught in session 5,
    via a real browser screenshot, on a handful of ArtistsView cards — see
    PRJ-0005 session log). Matches by extension rather than by field name
    (art_filename, art_local_path, ...) since new views keep introducing new
    field names for the same kind of reference."""
    if isinstance(obj, dict):
        return {k: scrub_stale_artwork(v, valid_names) for k, v in obj.items()}
    if isinstance(obj, list):
        return [scrub_stale_artwork(v, valid_names) for v in obj]
    if isinstance(obj, str) and _IMAGE_EXT_RE.search(obj):
        basename = obj.rsplit("/", 1)[-1]
        if basename not in valid_names:
            return None
    return obj


def _get_json(path: str):
    with urlopen(f"{BASE_URL}{path}", timeout=10) as resp:
        return json.load(resp)


_DATA_ARTWORK_PREFIX_RE = re.compile(r"^data/artwork/(.+)$")


def _absolutize(obj):
    if isinstance(obj, dict):
        return {k: _absolutize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_absolutize(v) for v in obj]
    if isinstance(obj, str):
        m = _DATA_ARTWORK_PREFIX_RE.match(obj)
        if m:
            return str(ARTWORK_DIR / m.group(1))
    return obj


def absolutize_artwork_paths_on_disk() -> None:
    """Rewrite every data/*.json file's "data/artwork/..." references to
    absolute paths, in place, before the backend starts.

    Committed data/*.json intentionally stores these as portable relative
    paths (no machine-specific info, unlike the real app's own data, which
    always stores absolute paths). But core/helpers.py::dominant_art_color()
    — real, unmodified code — does a naive Image.open(path) with no
    resolution step, exactly like the real app expects, so it always failed
    against our relative paths and silently fell back to FALLBACK_ART_COLOR
    (#1ed760) for every album, every time — the Sessions tab's per-album
    color strip rendering as one flat block instead of real per-album
    colors, caught by the user directly comparing a real screenshot against
    the demo. This is a PRJ-0005 path-convention mismatch, not a real-app
    bug, so the fix lives entirely here: briefly match the real app's own
    on-disk format while the backend is running, then let the *already*
    unconditional restore_data_state() revert it — no extra code needed to
    undo this, same as every other mutation this script guards against."""
    for path in DATA_DIR.glob("*.json"):
        with path.open() as f:
            data = json.load(f)
        with path.open("w") as f:
            json.dump(_absolutize(data), f, indent=2)


def port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def wait_for_own_server(proc: subprocess.Popen, timeout=15):
    start = time.time()
    while time.time() - start < timeout:
        if proc.poll() is not None:
            raise SystemExit(f"Backend subprocess exited early with code {proc.returncode}.")
        try:
            urlopen(f"{BASE_URL}/api/recent/albums", timeout=1)
            return
        except URLError:
            time.sleep(0.3)
    raise SystemExit("Backend didn't come up in time.")


def snapshot_data_state() -> dict:
    """Record everything under data/ well enough to force-restore it later:
    exact bytes for every top-level JSON file, and just the filename set for
    artwork/ (large binary files — restoring means deleting anything new,
    not re-copying originals that were never touched).

    Recursive (rglob) — artwork/vinyl/ is a real subdirectory (release-id-
    keyed vinyl art, distinct from the artist_album.jpg Spotify slugs at the
    top level), and a non-recursive glob here previously made every vinyl
    art reference look "not in the valid set" to scrub_stale_artwork(),
    silently nulling out all of it. Caught via a real browser screenshot
    showing zero art across the whole vinyl collection. Flat basename set is
    safe across both directories — vinyl filenames are purely numeric
    (release IDs), Spotify slugs always contain underscores, no collision."""
    json_files = {
        p.name: p.read_bytes()
        for p in DATA_DIR.glob("*.json")
    }
    artwork_names = (
        set(p.name for p in ARTWORK_DIR.rglob("*") if p.is_file()) if ARTWORK_DIR.exists() else set()
    )
    return {"json_files": json_files, "artwork_names": artwork_names}


def restore_data_state(before: dict) -> None:
    # Restore known JSON files to their exact original bytes.
    for name, content in before["json_files"].items():
        (DATA_DIR / name).write_bytes(content)
    # Delete any JSON file that didn't exist before (e.g. api_metrics.json,
    # a real-app instrumentation artifact triggered just by running it).
    for p in DATA_DIR.glob("*.json"):
        if p.name not in before["json_files"]:
            print(f"  restore: removing unexpected new file data/{p.name}")
            p.unlink()
    # Delete any artwork file that appeared during the run (a live Spotify
    # CDN download triggered by backfill finding a genuinely-missing local
    # file — legitimate content, but not something this tool should decide
    # to keep silently; re-bundle deliberately via export_catalog_seed.py
    # if broader artwork coverage is wanted).
    if ARTWORK_DIR.exists():
        for p in ARTWORK_DIR.rglob("*"):
            if p.is_file() and p.name not in before["artwork_names"]:
                print(f"  restore: removing unexpected new file data/artwork/{p.relative_to(ARTWORK_DIR)}")
                p.unlink()


def main():
    venv_python = BACKEND_DIR / ".venv" / "bin" / "python3"
    if not venv_python.exists():
        raise SystemExit(f"No venv at {venv_python} — run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")

    if port_in_use():
        raise SystemExit(
            f"Port {PORT} is already in use — refusing to start, since this script "
            "would silently talk to whatever's already there instead of its own "
            "subprocess. Find and stop it first (lsof -i :{PORT})."
        )

    before = snapshot_data_state()
    absolutize_artwork_paths_on_disk()

    env = {**os.environ, "AUDIOVAULT_DATA_DIR": str(DATA_DIR)}
    proc = subprocess.Popen(
        [str(venv_python), "-m", "uvicorn", "app:app", "--port", str(PORT)],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_own_server(proc)

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        valid_artwork = before["artwork_names"]
        artists_list = None
        playlists_list = None
        for path, filename in ENDPOINTS.items():
            with urlopen(f"{BASE_URL}{path}", timeout=10) as resp:
                data = json.load(resp)
            clean = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
            out_path = OUT_DIR / filename
            with out_path.open("w") as f:
                json.dump(clean, f, indent=2)
            print(f"{path} -> {out_path.relative_to(ROOT)}")
            if path == "/api/artists":
                artists_list = clean["artists"]
            if path == "/api/playlists":
                playlists_list = clean["playlists"]

        # Per-playlist evaluated tracklist, keyed by playlist id (ids are plain
        # ASCII already, no encoding concerns). Snapshotted once per playlist —
        # editing a playlist's rules in the demo does NOT re-run live
        # evaluation (there's no live backend to run it against); sw.js keeps
        # serving this same canned tracklist regardless of rule edits, same
        # "no live logic, cosmetic-only edits" spirit as every other mutation
        # in this demo. Consistent with the Phase 1 decision to keep playlists
        # simple (empty rule_groups, pinned-track-driven) in the first place.
        if playlists_list is not None:
            evaluated = {}
            for p in playlists_list:
                pid = p["id"]
                with urlopen(f"{BASE_URL}/api/playlists/{pid}/evaluate", timeout=10) as resp:
                    result = json.load(resp)
                evaluated[pid] = scrub_stale_artwork(sanitize_paths(result["tracks"]), valid_artwork)
            out_path = OUT_DIR / "playlists-evaluate.json"
            with out_path.open("w") as f:
                json.dump(evaluated, f, indent=2)
            print(f"/api/playlists/<id>/evaluate x{len(evaluated)} -> {out_path.relative_to(ROOT)}")

        # Artist detail is keyed by name (not one file per artist) — sidesteps
        # any risk of encodeURIComponent (JS, in sw.js) and quote (Python, here)
        # disagreeing on which characters to escape in artist names and
        # producing mismatched filenames.
        if artists_list is not None:
            details = {}
            for artist in artists_list:
                name = artist["name"]
                encoded = quote(name, safe="")
                with urlopen(f"{BASE_URL}/api/artists/{encoded}", timeout=10) as resp:
                    detail = json.load(resp)
                details[name] = scrub_stale_artwork(sanitize_paths(detail), valid_artwork)
            out_path = OUT_DIR / "artists-detail.json"
            with out_path.open("w") as f:
                json.dump(details, f, indent=2)
            print(f"/api/artists/<name> x{len(details)} -> {out_path.relative_to(ROOT)}")

        # ── Stats tabs: paginated/parameterized endpoints ──────────────────
        # Period (Week/Month) and Time (Month) pagination is walked forward
        # from offset 0 until the real has_older flag goes false — the true
        # boundary of the synthetic data's actual date range, not a guess.
        period_out = {}
        for mode in ("Week", "Month"):
            offset = 0
            while True:
                data = _get_json(f"/api/stats/period?mode={mode}&offset={offset}")
                period_out[f"{mode}|{offset}"] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
                if not data.get("has_older") or offset > 200:  # sanity cap
                    break
                offset += 1
        out_path = OUT_DIR / "stats-period.json"
        with out_path.open("w") as f:
            json.dump(period_out, f, indent=2)
        print(f"/api/stats/period x{len(period_out)} -> {out_path.relative_to(ROOT)}")

        time_out = {}
        month_offset = 0
        while True:
            data = _get_json(f"/api/stats/time?mode=Month&month_offset={month_offset}")
            time_out[f"Month|{month_offset}"] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
            if not data.get("has_older") or month_offset > 200:
                break
            month_offset += 1
        for mode in ("Year", "All Time"):
            data = _get_json(f"/api/stats/time?mode={quote(mode)}&month_offset=0")
            time_out[f"{mode}|0"] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
        out_path = OUT_DIR / "stats-time.json"
        with out_path.open("w") as f:
            json.dump(time_out, f, indent=2)
        print(f"/api/stats/time x{len(time_out)} -> {out_path.relative_to(ROOT)}")

        # Timeline (Eras tab): metric x year drill-down. The set of valid
        # years is discovered from each metric's own aggregate response
        # (release years actually present), not guessed — "Albums"/"Plays"
        # share one release-year universe (state.log), "Vinyl" has its own
        # (the vinyl collection's release years). Unrecognized (metric, year)
        # combos fall back to the aggregate view server-side already
        # (`if selected_year not in years: selected_year = None`), so sw.js
        # mirrors that same fallback for any combo not snapshotted here.
        timeline_out = {}
        for metric in _TIMELINE_METRICS:
            aggregate = _get_json(f"/api/stats/timeline?metric={metric}")
            timeline_out[f"{metric}|"] = scrub_stale_artwork(sanitize_paths(aggregate), valid_artwork)
            years = sorted({b["year"] for b in aggregate.get("bars", []) if b.get("year")})
            for year in years:
                data = _get_json(f"/api/stats/timeline?metric={metric}&year={year}")
                timeline_out[f"{metric}|{year}"] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
        out_path = OUT_DIR / "stats-timeline.json"
        with out_path.open("w") as f:
            json.dump(timeline_out, f, indent=2)
        print(f"/api/stats/timeline x{len(timeline_out)} -> {out_path.relative_to(ROOT)}")

        # Genre network (Genres tab): a full self-contained HTML page with
        # embedded JSON data, not a JSON API response — fetched and scrubbed
        # as raw text instead of a parsed object.
        with urlopen(f"{BASE_URL}/api/stats/genres-page", timeout=10) as resp:
            genres_html = resp.read().decode("utf-8")
        genres_html = scrub_stale_artwork_html(genres_html, valid_artwork)
        out_path = OUT_DIR / "stats-genres-page.html"
        out_path.write_text(genres_html)
        print(f"/api/stats/genres-page -> {out_path.relative_to(ROOT)}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        restore_data_state(before)


if __name__ == "__main__":
    main()
