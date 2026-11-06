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
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARTWORK_DIR = DATA_DIR / "artwork"
HISTORY_DIR = DATA_DIR / "spotify_history"
OUT_DIR = ROOT / "frontend" / "public" / "mock-api"
BACKEND_DIR = ROOT / "backend"
PORT = 8123
REQUEST_TIMEOUT = 120  # year recaps and the first stats calls build a lot on demand
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
    "/api/stats/sessions/bounds": "stats-sessions-bounds.json",
    "/api/stats/history": "stats-history.json",
    "/api/stats/genres-ring": "stats-genres-ring.json",
    "/api/radar": "radar.json",
    "/api/vinyl/stats": "vinyl-stats.json",
    "/api/vinyl/sessions": "vinyl-sessions.json",
    "/api/tops": "tops.json",
}

# Stats tabs with paginated/parameterized endpoints — bounded by the actual
# synthetic data's real date range (via the real has_older flag) or the
# actual set of release years present (via each metric's own bars), not
# hardcoded guesses. See fetch_stats_extras() in main().
_TIMELINE_METRICS = ["Albums", "Plays", "Vinyl"]
_TIME_SHARED_FIELDS = ("heatmap_all", "daypart_flow_monthly")


def trim_timeline(payload: dict) -> dict:
    """Drop each detail item's full play list: the Eras tab reads only the item's title,
    art and counts, and those lists grow with the whole history (3 MB for a busy year)."""
    for item in payload.get("details", []):
        item.pop("plays", None)
    return payload

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
    with urlopen(f"{BASE_URL}{path}", timeout=REQUEST_TIMEOUT) as resp:
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
    history_files = {p.name: p.read_bytes() for p in HISTORY_DIR.glob("*.json")}
    return {"json_files": json_files, "artwork_names": artwork_names, "history_files": history_files}


def restore_data_state(before: dict) -> None:
    # Restore known JSON files to their exact original bytes.
    for name, content in before["json_files"].items():
        (DATA_DIR / name).write_bytes(content)
    for name, content in before["history_files"].items():
        (HISTORY_DIR / name).write_bytes(content)
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

    # AUDIOVAULT_NO_ENRICH: never let the backend's history fill-in reach out to Spotify,
    # Last.fm or MusicBrainz. The store is written as already enriched too; this is the
    # second lock on the same door.
    env = {**os.environ, "AUDIOVAULT_DATA_DIR": str(DATA_DIR), "AUDIOVAULT_NO_ENRICH": "1"}
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
        albums_list = None
        playlists_list = None
        tops_decades = None
        for path, filename in ENDPOINTS.items():
            with urlopen(f"{BASE_URL}{path}", timeout=REQUEST_TIMEOUT) as resp:
                data = json.load(resp)
            clean = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
            out_path = OUT_DIR / filename
            with out_path.open("w") as f:
                json.dump(clean, f, separators=(",", ":"))
            print(f"{path} -> {out_path.relative_to(ROOT)}")
            if path == "/api/artists":
                artists_list = clean["artists"]
            if path == "/api/albums":
                albums_list = clean["albums"]
            if path == "/api/playlists":
                playlists_list = clean["playlists"]
            if path == "/api/tops":
                tops_decades = [d["decade"] for d in clean["decades"]]

        # Per-decade eligible-favorites list for the Tops editor (favorited
        # albums in that decade not already in the top 10) — same "snapshot
        # every real parameterized response, one file per key" pattern as
        # playlists-evaluate/artists-detail above.
        if tops_decades is not None:
            catalog_seed = json.loads((DATA_DIR / "catalog_seed.json").read_text())
            real_eligible_order = catalog_seed.get("eligible_order", {})

            eligible_out = {}
            for decade in tops_decades:
                encoded = quote(decade, safe="")
                with urlopen(f"{BASE_URL}/api/tops/{encoded}/eligible", timeout=REQUEST_TIMEOUT) as resp:
                    result = json.load(resp)
                result = scrub_stale_artwork(sanitize_paths(result), valid_artwork)
                # Re-sort to match the real app's own order (real rating + real play
                # count) instead of the order this run's synthetic-data-driven backend
                # computed (same rating, but a synthetic play-count tiebreak) — see
                # export_catalog_seed.py's "eligible_order" comment and PRJ-0005
                # session log. Anything not in the real order (shouldn't normally
                # happen — eligibility itself is entirely real-field-driven) keeps its
                # existing relative order, appended after every ranked album.
                order = real_eligible_order.get(decade, [])
                rank = {aid: i for i, aid in enumerate(order)}
                result["albums"].sort(key=lambda a: rank.get(a["album_id"], len(order)))
                eligible_out[decade] = result
            out_path = OUT_DIR / "tops-eligible.json"
            with out_path.open("w") as f:
                json.dump(eligible_out, f, separators=(",", ":"))
            print(f"/api/tops/<decade>/eligible x{len(eligible_out)} -> {out_path.relative_to(ROOT)}")

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
                with urlopen(f"{BASE_URL}/api/playlists/{pid}/evaluate", timeout=REQUEST_TIMEOUT) as resp:
                    result = json.load(resp)
                evaluated[pid] = scrub_stale_artwork(sanitize_paths(result["tracks"]), valid_artwork)
            out_path = OUT_DIR / "playlists-evaluate.json"
            with out_path.open("w") as f:
                json.dump(evaluated, f, separators=(",", ":"))
            print(f"/api/playlists/<id>/evaluate x{len(evaluated)} -> {out_path.relative_to(ROOT)}")

        # Album detail, keyed by id. The list endpoint leaves track_plays out (only the
        # open side panel needs them), so this is where they live.
        if albums_list is not None:
            album_details = {}
            for album in albums_list:
                album_id = album["album_id"]
                detail = _get_json(f"/api/albums/{quote(album_id, safe='')}")
                album_details[album_id] = scrub_stale_artwork(sanitize_paths(detail), valid_artwork)
            out_path = OUT_DIR / "albums-detail.json"
            with out_path.open("w") as f:
                json.dump(album_details, f, separators=(",", ":"))
            print(f"/api/albums/<id> x{len(album_details)} -> {out_path.relative_to(ROOT)}")

        # Artist detail is keyed by name (not one file per artist) — sidesteps
        # any risk of encodeURIComponent (JS, in sw.js) and quote (Python, here)
        # disagreeing on which characters to escape in artist names and
        # producing mismatched filenames.
        if artists_list is not None:
            details = {}
            for artist in artists_list:
                name = artist["name"]
                encoded = quote(name, safe="")
                with urlopen(f"{BASE_URL}/api/artists/{encoded}", timeout=REQUEST_TIMEOUT) as resp:
                    detail = json.load(resp)
                details[name] = scrub_stale_artwork(sanitize_paths(detail), valid_artwork)
            out_path = OUT_DIR / "artists-detail.json"
            with out_path.open("w") as f:
                json.dump(details, f, separators=(",", ":"))
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
                if not data.get("has_older") or offset > 1000:  # sanity cap; ~9 years of weeks is ~480
                    break
                offset += 1
        out_path = OUT_DIR / "stats-period.json"
        with out_path.open("w") as f:
            json.dump(period_out, f, separators=(",", ":"))
        print(f"/api/stats/period x{len(period_out)} -> {out_path.relative_to(ROOT)}")

        time_out = {}
        month_offset = 0
        while True:
            data = _get_json(f"/api/stats/time?mode=Month&month_offset={month_offset}")
            time_out[f"Month|{month_offset}"] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
            if not data.get("has_older") or month_offset > 1000:
                break
            month_offset += 1
        for mode in ("Year", "All Time"):
            data = _get_json(f"/api/stats/time?mode={quote(mode)}&month_offset=0")
            time_out[f"{mode}|0"] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
        # Year mode pages by calendar year (the `year` param), walked back through the
        # same has_older flag. Month mode's `month` param needs no snapshot of its own:
        # sw.js converts YYYY-MM to the offset, the same arithmetic the backend does.
        year_page = time_out["Year|0"]
        while year_page.get("has_older"):
            prior = year_page["year"] - 1
            data = _get_json(f"/api/stats/time?mode=Year&month_offset=0&year={prior}")
            year_page = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
            time_out[f"Year@{prior}"] = year_page
        # heatmap_all and daypart_flow_monthly describe the whole history, so every entry
        # carries an identical copy: stored once under _shared, put back by sw.js.
        shared = {k: time_out["All Time|0"][k] for k in _TIME_SHARED_FIELDS}
        for entry in time_out.values():
            for k in _TIME_SHARED_FIELDS:
                if entry.get(k) == shared[k]:
                    del entry[k]
        time_out["_shared"] = shared
        out_path = OUT_DIR / "stats-time.json"
        with out_path.open("w") as f:
            json.dump(time_out, f, separators=(",", ":"))
        print(f"/api/stats/time x{len(time_out)} -> {out_path.relative_to(ROOT)}")

        # Sessions come one Monday-started week at a time. Weeks are walked from the real
        # bounds, not guessed; sw.js answers [] for any week outside them, which is what
        # the real backend returns there too.
        bounds = _get_json("/api/stats/sessions/bounds")
        # One file per calendar year of the week's Monday: nine years in a single file
        # would be tens of MB for the browser to parse on every week change.
        sessions_out: dict[str, dict] = {}
        if bounds.get("oldest_start"):
            oldest = datetime.fromisoformat(bounds["oldest_start"]).date()
            newest = datetime.fromisoformat(bounds["newest_start"]).date()
            # A day early: bounds may be UTC, and a late-Sunday local session reads as Monday.
            first = oldest - timedelta(days=1)
            week = first - timedelta(days=first.weekday())
            while week <= newest:
                key = week.isoformat()
                data = _get_json(f"/api/stats/sessions?start={key}&days=7")
                sessions_out.setdefault(key[:4], {})[key] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
                week += timedelta(days=7)
        sessions_dir = OUT_DIR / "stats-sessions"
        if sessions_dir.exists():
            shutil.rmtree(sessions_dir)
        sessions_dir.mkdir()
        (OUT_DIR / "stats-sessions.json").unlink(missing_ok=True)
        for year, weeks in sessions_out.items():
            with (sessions_dir / f"{year}.json").open("w") as f:
                json.dump(weeks, f, separators=(",", ":"))
        total_weeks = sum(len(w) for w in sessions_out.values())
        print(f"/api/stats/sessions x{total_weeks} weeks in {len(sessions_out)} files -> {sessions_dir.relative_to(ROOT)}/")

        # Periods > Year: one full payload per year the data covers. "latest" is the
        # no-param response, which is what the page asks for first.
        latest_year = _get_json("/api/stats/year")
        year_out = {"latest": scrub_stale_artwork(sanitize_paths(latest_year), valid_artwork)}
        for y in latest_year.get("years", []):
            year_value = y["year"] if isinstance(y, dict) else y
            data = _get_json(f"/api/stats/year?year={year_value}")
            year_out[str(year_value)] = scrub_stale_artwork(sanitize_paths(data), valid_artwork)
        out_path = OUT_DIR / "stats-year.json"
        with out_path.open("w") as f:
            json.dump(year_out, f, separators=(",", ":"))
        print(f"/api/stats/year x{len(year_out) - 1} -> {out_path.relative_to(ROOT)}")

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
            timeline_out[f"{metric}|"] = trim_timeline(scrub_stale_artwork(sanitize_paths(aggregate), valid_artwork))
            years = sorted({b["year"] for b in aggregate.get("bars", []) if b.get("year")})
            for year in years:
                data = _get_json(f"/api/stats/timeline?metric={metric}&year={year}")
                timeline_out[f"{metric}|{year}"] = trim_timeline(scrub_stale_artwork(sanitize_paths(data), valid_artwork))
        out_path = OUT_DIR / "stats-timeline.json"
        with out_path.open("w") as f:
            json.dump(timeline_out, f, separators=(",", ":"))
        print(f"/api/stats/timeline x{len(timeline_out)} -> {out_path.relative_to(ROOT)}")

        # Genre network (Genres tab): a full self-contained HTML page with
        # embedded JSON data, not a JSON API response — fetched and scrubbed
        # as raw text instead of a parsed object.
        with urlopen(f"{BASE_URL}/api/stats/genres-page", timeout=REQUEST_TIMEOUT) as resp:
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
