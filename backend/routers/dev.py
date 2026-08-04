import json
import shutil
import subprocess

from fastapi import APIRouter, Body, Query
from core.paths import data_path
from query_engine import build_datasets, execute_query, parse_query
from state import get_state, reload_state
from core.genre_utils import find_genre_clusters
from persistence.genre_aliases import load_genre_aliases, save_genre_aliases
from persistence.genre_dismissals import load_genre_dismissals, add_dismissal_pairs

_JQ_BIN = shutil.which("jq") or "jq"

_DATA_FILES = {
    "listening_log": "listening_log.json",
    "library":       "library.json",
    "catalog":       "catalog.json",
    "lastfm_genres": "lastfm_genres.json",
}

router = APIRouter(prefix="/api/dev", tags=["dev"])

_datasets_cache: dict | None = None


def _get_datasets() -> dict:
    global _datasets_cache
    if _datasets_cache is None:
        state = get_state()
        _datasets_cache = build_datasets(state.log, state.lib)
    return _datasets_cache


def invalidate_datasets() -> None:
    global _datasets_cache
    _datasets_cache = None


def _path_size(path) -> int:
    from pathlib import Path as _P
    p = _P(path)
    if not p.exists():
        return 0
    if p.is_file():
        try: return p.stat().st_size
        except OSError: return 0
    total = 0
    for child in p.rglob("*"):
        if child.is_file():
            try: total += child.stat().st_size
            except OSError: pass
    return total


def _human_size(num_bytes: int) -> str:
    size = float(max(0, num_bytes))
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024 or unit == "TB":
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return str(num_bytes)


_PARTNER_COLORS = {
    "Spotify":   "#1DB954",
    "Discogs":   "#c4a96e",
    "Last.fm":   "#d51007",
    "Anthropic": "#b388eb",
    "Artwork":   "#1ddbd1",
}


def _load_api_events() -> list[dict]:
    p = data_path("api_metrics.json")
    if not p.exists():
        return []
    try:
        raw = json.loads(p.read_text())
        events = raw.get("events", raw) if isinstance(raw, dict) else raw
        return events if isinstance(events, list) else []
    except Exception:
        return []


def _parse_ts(value: str | None):
    if not value:
        return None
    try:
        from datetime import datetime, timezone
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _avg_ms(events: list[dict]) -> int:
    durations = [e["duration_ms"] for e in events if isinstance(e.get("duration_ms"), int)]
    return int(sum(durations) / len(durations)) if durations else 0


def _time_ago(ts) -> str:
    if ts is None:
        return "never"
    from datetime import datetime, timezone
    delta = datetime.now(timezone.utc) - ts
    s = int(delta.total_seconds())
    if s < 60:   return "just now"
    if s < 3600: return f"{s // 60}m ago"
    if s < 86400:return f"{s // 3600}h ago"
    return f"{s // 86400}d ago"


@router.get("/api-metrics")
def get_api_metrics(scope: str = Query(default="all"), since: str = Query(default="")):
    from datetime import datetime, timezone, timedelta
    from collections import defaultdict

    all_events = _load_api_events()
    now = datetime.now(timezone.utc)

    def filter_events(events):
        if scope == "all":   return events
        if scope == "7d":    cutoff = now - timedelta(days=7)
        elif scope == "today":
            cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif scope == "session" and since:
            cutoff = _parse_ts(since)
            if cutoff is None: return events
        else: return events
        return [e for e in events if (ts := _parse_ts(e.get("timestamp"))) and ts >= cutoff]

    events      = filter_events(all_events)
    parsed_all  = [_parse_ts(e.get("timestamp")) for e in all_events]
    today_count = sum(1 for ts in parsed_all if ts and ts.date() == now.date())
    week_cutoff = now - timedelta(days=7)
    week_count  = sum(1 for ts in parsed_all if ts and ts >= week_cutoff)
    errors      = sum(1 for e in events if e.get("ok") is False)
    avg_ms_val  = _avg_ms(events)
    valid_ts    = [ts for ts in parsed_all if ts]
    last_seen   = _time_ago(max(valid_ts) if valid_ts else None)

    scope_label = {"all": "all-time", "7d": "last 7d", "today": "today", "session": "session"}.get(scope, "all-time")
    if all_events:
        summary = f"{scope_label}  {len(events)} of {len(all_events)} calls   ·   today {today_count}   ·   7d {week_count}   ·   errors {errors}   ·   avg {avg_ms_val} ms   ·   last {last_seen}"
    else:
        summary = "No API calls logged yet."

    # Partner rows
    by_partner: dict[str, list] = defaultdict(list)
    for e in events:
        by_partner[str(e.get("service", "Unknown"))].append(e)
    partner_rows = sorted([
        {
            "service":     svc,
            "calls":       len(evs),
            "errors":      sum(1 for e in evs if e.get("ok") is False),
            "avg_ms":      _avg_ms(evs),
            "last_status": str(evs[-1].get("status", "")) if evs else "",
            "color":       _PARTNER_COLORS.get(svc, "#8ecae6"),
        }
        for svc, evs in by_partner.items()
    ], key=lambda r: -r["calls"])

    # Operation rows
    by_op: dict[tuple, list] = defaultdict(list)
    for e in events:
        key = (str(e.get("service","")), str(e.get("operation","")), str(e.get("method","")))
        by_op[key].append(e)
    operation_rows = sorted([
        {
            "service":     k[0], "operation": k[1], "method": k[2],
            "calls":       len(evs),
            "errors":      sum(1 for e in evs if e.get("ok") is False),
            "avg_ms":      _avg_ms(evs),
            "last_status": str(evs[-1].get("status", "")) if evs else "",
        }
        for k, evs in by_op.items()
    ], key=lambda r: -r["calls"])

    # Recent error events (newest first, capped at 50)
    error_events = [
        {
            "timestamp": e.get("timestamp", ""),
            "service":   e.get("service", ""),
            "operation": e.get("operation", ""),
            "status":    e.get("status", ""),
            "error_body": e.get("error_body") or "",
        }
        for e in reversed(all_events)
        if e.get("ok") is False
    ][:50]

    return {"summary": summary, "partner_rows": partner_rows, "operation_rows": operation_rows, "error_events": error_events}


@router.get("/storage")
def get_storage():
    from core.paths import APP_ROOT, data_dir
    active_data_dir = data_dir()
    workspace_size  = _path_size(APP_ROOT)
    data_size       = _path_size(active_data_dir)
    tracked_files   = sum(1 for c in active_data_dir.rglob("*") if c.is_file()) if active_data_dir.exists() else 0

    data_paths = [
        ("Artwork",       active_data_dir / "artwork",             "#1ddbd1"),
        ("Listening Log", active_data_dir / "listening_log.json",  "#ffb703"),
        ("Library",       active_data_dir / "library.json",        "#7be495"),
        ("Catalog",       active_data_dir / "catalog.json",        "#fb8500"),
        ("Last.fm Genres",active_data_dir / "lastfm_genres.json",  "#ee6c4d"),
        ("Playlists",     active_data_dir / "playlists.json",      "#b388eb"),
    ]
    data_rows, data_major_total = [], 0
    for label, path, color in data_paths:
        b = _path_size(path)
        data_major_total += b
        data_rows.append({"name": label, "bytes": b, "size": _human_size(b), "share": 0.0, "color": color})
    other_b = max(0, data_size - data_major_total)
    data_rows.append({"name": "Data Other", "bytes": other_b, "size": _human_size(other_b), "share": 0.0, "color": "#5c677d"})
    for row in data_rows:
        row["share"] = round(row["bytes"] / data_size * 100, 1) if data_size else 0.0
    data_rows.sort(key=lambda r: -r["bytes"])

    palette = ["#8ecae6","#ffb703","#fb8500","#90be6d","#f28482","#84a59d","#cdb4db","#adb5bd"]
    system_rows, hidden_total, ci = [], 0, 0
    for child in sorted(APP_ROOT.iterdir(), key=lambda p: p.name.lower()):
        if child.name == "data": continue
        if child.name == ".spotify_token.json":
            hidden_total += _path_size(child); continue
        b = _path_size(child)
        if b <= 0: continue
        system_rows.append({
            "name": f"{child.name}/" if child.is_dir() else child.name,
            "bytes": b, "size": _human_size(b), "share": 0.0,
            "color": palette[ci % len(palette)],
        })
        ci += 1
    if hidden_total:
        system_rows.append({"name": "Misc hidden", "bytes": hidden_total, "size": _human_size(hidden_total), "share": 0.0, "color": "#5c677d"})
    sys_total = sum(r["bytes"] for r in system_rows)
    for row in system_rows:
        row["share"] = round(row["bytes"] / sys_total * 100, 1) if sys_total else 0.0
    system_rows.sort(key=lambda r: -r["bytes"])

    return {
        "summary": f"workspace {_human_size(workspace_size)}   ·   data {_human_size(data_size)}   ·   system {_human_size(max(0, workspace_size - data_size))}   ·   tracked files {tracked_files}",
        "data_rows": data_rows,
        "data_total": _human_size(data_size),
        "system_rows": system_rows,
        "system_total": _human_size(sys_total),
    }


@router.get("/jq-bookmarks")
def get_jq_bookmarks():
    p = data_path("jq_bookmarks.json")
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


@router.post("/jq-bookmarks")
def save_jq_bookmarks(bookmarks: list = Body(...)):
    p = data_path("jq_bookmarks.json")
    p.write_text(json.dumps(bookmarks, indent=2))
    return {"ok": True}


@router.get("/jq")
def run_jq(file: str = Query(...), expr: str = Query(...)):
    if file not in _DATA_FILES:
        return {"output": "", "lines": 0, "error": f"Unknown file: {file}"}
    file_path = data_path(_DATA_FILES[file])
    if not file_path.exists():
        return {"output": "", "lines": 0, "error": f"File not found: {_DATA_FILES[file]}"}
    try:
        result = subprocess.run(
            [_JQ_BIN, expr, str(file_path)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            output = result.stdout
            return {"output": output, "lines": output.count("\n"), "error": None}
        return {"output": "", "lines": 0, "error": result.stderr.strip()}
    except FileNotFoundError:
        return {"output": "", "lines": 0, "error": f"jq not found at {_JQ_BIN}"}
    except subprocess.TimeoutExpired:
        return {"output": "", "lines": 0, "error": "jq timed out (10s)"}


def _art_url(art_path: str | None) -> str | None:
    if not art_path:
        return None
    from pathlib import Path as _P
    p = _P(art_path)
    artwork_root = data_path("artwork")
    try:
        rel = p.relative_to(artwork_root)
        return f"/artwork/{rel}"
    except ValueError:
        pass
    parts = p.parts
    if "artwork" in parts:
        i = parts.index("artwork")
        return "/artwork/" + "/".join(parts[i + 1:])
    return None


@router.get("/vinyl-matcher/candidates")
def get_vinyl_candidates():
    from persistence.discogs import load_collection
    from persistence.vinyl_links import confirmed_pairs, dismissed_pairs
    from insights.collection_insights import build_album_index
    from core.vinyl_matcher import find_candidates

    vinyl = load_collection()
    if not vinyl:
        return {"candidates": [], "status": "no_vinyl"}

    state = get_state()
    albums = build_album_index(state.log)
    if not albums:
        return {"candidates": [], "status": "no_albums"}

    raw = find_candidates(vinyl, albums, confirmed_pairs(), dismissed_pairs())

    candidates = []
    for c in raw:
        v = c["vinyl"]
        info = c["album_info"]
        candidates.append({
            "vinyl": {
                "release_id": v.get("release_id"),
                "title":      v.get("title", ""),
                "artists":    v.get("artists") or [],
                "year":       v.get("year"),
                "labels":     v.get("labels") or [],
                "art_url":    _art_url(v.get("art_path")),
            },
            "album": {
                "album_id":     c["album_id"],
                "album_name":   info.get("album_name", ""),
                "artist":       info.get("artist", ""),
                "release_year": info.get("release_year"),
                "art_url":      _art_url(info.get("art_path")),
            },
            "artist_sim":  round(c["artist_sim"], 3),
            "title_sim":   round(c["title_sim"], 3),
            "confidence":  round(c["confidence"], 3),
        })

    return {"candidates": candidates, "status": "ok"}


@router.post("/vinyl-matcher/confirm")
def confirm_vinyl_match(body: dict = Body(...)):
    from persistence.vinyl_links import add_confirmed
    add_confirmed(int(body["release_id"]), str(body["album_id"]))
    return {"ok": True}


@router.post("/vinyl-matcher/dismiss")
def dismiss_vinyl_match(body: dict = Body(...)):
    from persistence.vinyl_links import add_dismissed
    add_dismissed(int(body["release_id"]), str(body["album_id"]))
    return {"ok": True}


@router.get("/backup-status")
def get_backup_status():
    from pathlib import Path

    repo = Path.home() / "av_backup_data"
    log_path = Path.home() / "backup.log"

    # ── Parse backup log for last run time + success ──────────────────────────
    last_run: str | None = None
    success: bool | None = None
    if log_path.exists():
        lines = [l for l in log_path.read_text().splitlines() if l.strip()]
        for line in reversed(lines):
            if last_run is None and "backup" in line.lower() and any(c.isdigit() for c in line):
                last_run = line.strip()
            if success is None:
                if "backup complete" in line.lower():
                    success = True
                elif "error" in line.lower() or "fatal" in line.lower():
                    success = False
            if last_run and success is not None:
                break

    # ── Read current snapshot from backup repo ────────────────────────────────
    def _read_json(path: Path):
        try:
            return json.loads(path.read_text())
        except Exception:
            return None

    def _read_git_json(filename: str):
        try:
            r = subprocess.run(
                ["git", "show", f"HEAD~1:{filename}"],
                capture_output=True, text=True, cwd=str(repo), timeout=5,
            )
            if r.returncode == 0:
                return json.loads(r.stdout)
        except Exception:
            pass
        return None

    def _snapshot(log, lib) -> dict:
        if log is None:
            return {}
        plays       = len(log)
        tracks      = len({e.get("track_id")  for e in log if e.get("track_id")})
        artists     = len({n for e in log for n in (e.get("artist_names") or [])})
        albums      = len({e.get("album_id")  for e in log if e.get("album_id")})
        favorited_albums  = sum(1 for v in (lib or {}).get("albums",  {}).values() if v.get("favorited"))
        favorited_tracks  = sum(1 for v in (lib or {}).get("tracks",  {}).values() if v.get("favorited"))
        rated_albums      = sum(1 for v in (lib or {}).get("albums",  {}).values() if v.get("rating", 0) > 0)
        return dict(plays=plays, tracks=tracks, artists=artists, albums=albums,
                    favorited_albums=favorited_albums, favorited_tracks=favorited_tracks,
                    rated_albums=rated_albums)

    cur_log = _read_json(repo / "listening_log.json")
    cur_lib = _read_json(repo / "library.json")
    cur     = _snapshot(cur_log, cur_lib)

    prev_log = _read_git_json("listening_log.json")
    prev_lib = _read_git_json("library.json")
    prev     = _snapshot(prev_log, prev_lib) if prev_log is not None else {}

    # ── Track overrides ───────────────────────────────────────────────────────
    cur_overrides  = len(_read_json(repo / "track_overrides.json") or {})
    prev_ov_raw    = None
    try:
        r = subprocess.run(["git", "show", "HEAD~1:track_overrides.json"],
                           capture_output=True, text=True, cwd=str(repo), timeout=5)
        if r.returncode == 0:
            prev_ov_raw = len(json.loads(r.stdout))
    except Exception:
        pass
    prev_overrides = prev_ov_raw if prev_ov_raw is not None else cur_overrides

    # ── Build stats rows ──────────────────────────────────────────────────────
    CORE = [("plays", "Plays"), ("tracks", "Tracks"), ("artists", "Artists"), ("albums", "Albums")]
    OPTIONAL = [
        ("rated_albums",     "Rated albums"),
        ("favorited_albums", "Favorited albums"),
        ("favorited_tracks", "Favorited tracks"),
    ]

    stats = []
    for key, label in CORE:
        total = cur.get(key, 0)
        diff  = (cur.get(key, 0) - prev.get(key, 0)) if prev else None
        stats.append({"label": label, "total": total, "diff": diff, "always": True})

    for key, label in OPTIONAL:
        total = cur.get(key, 0)
        diff  = (cur.get(key, 0) - prev.get(key, 0)) if prev else None
        if diff:
            stats.append({"label": label, "total": total, "diff": diff, "always": False})

    if cur_overrides or (prev_overrides != cur_overrides):
        diff = (cur_overrides - prev_overrides) if prev_ov_raw is not None else None
        stats.append({"label": "Track overrides", "total": cur_overrides, "diff": diff, "always": False})

    return {"last_run": last_run, "success": success, "stats": stats}


@router.get("/system")
def get_system():
    from datetime import datetime, timezone

    SERVICES = [
        ("audiovault",    "Audiovault Backend"),
        ("vinyl_monitor", "Vinyl Monitor"),
    ]

    def _service_info(name: str) -> dict:
        try:
            r = subprocess.run(
                ["systemctl", "show", name,
                 "--property=ActiveState,SubState,ActiveEnterTimestamp,InactiveEnterTimestamp,ExecMainPID"],
                capture_output=True, text=True, timeout=5,
            )
            props = dict(line.split("=", 1) for line in r.stdout.strip().splitlines() if "=" in line)
        except Exception:
            return {"name": name, "active": False, "state": "unknown", "uptime": None, "pid": None}

        active = props.get("ActiveState") == "active"
        state  = props.get("SubState", "unknown")
        pid    = props.get("ExecMainPID") or None

        uptime_str = None
        ts_key = "ActiveEnterTimestamp" if active else "InactiveEnterTimestamp"
        ts_raw = props.get(ts_key, "")
        if ts_raw:
            try:
                from datetime import datetime
                dt = datetime.strptime(ts_raw, "%a %Y-%m-%d %H:%M:%S %Z")
                now = datetime.utcnow()
                secs = int((now - dt).total_seconds())
                if secs < 60:    uptime_str = f"{secs}s"
                elif secs < 3600: uptime_str = f"{secs // 60}m"
                elif secs < 86400: uptime_str = f"{secs // 3600}h {(secs % 3600) // 60}m"
                else:            uptime_str = f"{secs // 86400}d {(secs % 86400) // 3600}h"
            except Exception:
                uptime_str = ts_raw

        return {"name": name, "label": dict(SERVICES).get(name, name),
                "active": active, "state": state, "uptime": uptime_str, "pid": pid}

    services = [_service_info(name) for name, _ in SERVICES]

    # Pi vitals
    vitals: dict = {}
    try:
        mem_lines = subprocess.run(["free", "-m"], capture_output=True, text=True).stdout.splitlines()
        for line in mem_lines:
            if line.startswith("Mem:"):
                parts = line.split()
                total, used, free = int(parts[1]), int(parts[2]), int(parts[3])
                vitals["mem_total_mb"] = total
                vitals["mem_used_mb"]  = used
                vitals["mem_free_mb"]  = free
                vitals["mem_pct"]      = round(used / total * 100, 1)
    except Exception:
        pass

    try:
        df = subprocess.run(["df", "-h", "/"], capture_output=True, text=True).stdout.splitlines()
        if len(df) > 1:
            parts = df[1].split()
            vitals["disk_total"] = parts[1]
            vitals["disk_used"]  = parts[2]
            vitals["disk_free"]  = parts[3]
            vitals["disk_pct"]   = parts[4]
    except Exception:
        pass

    try:
        load = subprocess.run(["uptime"], capture_output=True, text=True).stdout.strip()
        # extract load averages
        if "load average:" in load:
            la = load.split("load average:")[-1].strip()
            vitals["load_avg"] = la
        if "up " in load:
            uptime_part = load.split("up ")[1].split(",")[0].strip()
            vitals["uptime"] = uptime_part
    except Exception:
        pass

    try:
        temp = subprocess.run(["vcgencmd", "measure_temp"], capture_output=True, text=True).stdout.strip()
        vitals["cpu_temp"] = temp.replace("temp=", "")
    except Exception:
        pass

    return {"services": services, "vitals": vitals}


@router.post("/service/{name}/restart")
def restart_service(name: str):
    ALLOWED = {"audiovault", "vinyl_monitor"}
    if name not in ALLOWED:
        from fastapi import HTTPException
        raise HTTPException(400, f"Unknown service: {name}")
    try:
        r = subprocess.run(["sudo", "systemctl", "restart", name],
                           capture_output=True, text=True, timeout=15)
        return {"ok": r.returncode == 0, "output": r.stderr.strip() or r.stdout.strip()}
    except Exception as e:
        return {"ok": False, "output": str(e)}


@router.get("/logs")
def get_logs(lines: int = Query(default=100)):
    try:
        result = subprocess.run(
            ["journalctl", "-u", "audiovault", f"-n{lines}", "--no-pager", "--output=short-iso"],
            capture_output=True, text=True, timeout=10,
        )
        raw = result.stdout.strip()
    except Exception as e:
        raw = f"[error reading logs: {e}]"
    return {"lines": raw.splitlines()}


@router.get("/genre-consolidation/clusters")
def get_genre_clusters():
    state = get_state()
    genre_counts: dict[str, int] = {}
    for artist_data in state.lib.get("artists", {}).values():
        for g in (artist_data.get("genres") or []):
            genre_counts[g] = genre_counts.get(g, 0) + 1
    dismissals = load_genre_dismissals()
    clusters = find_genre_clusters(genre_counts, dismissals)
    return {
        "clusters": clusters,
        "existing_aliases": load_genre_aliases(),
        "dismissal_count": len(dismissals),
    }


@router.post("/genre-consolidation/aliases")
def apply_genre_aliases_endpoint(body: dict = Body(...)):
    aliases = body.get("aliases", {})
    save_genre_aliases(aliases)
    reload_state()
    return {"ok": True, "count": len(aliases)}


@router.post("/genre-consolidation/dismiss")
def dismiss_genre_cluster(body: dict = Body(...)):
    genres = body.get("genres", [])
    if len(genres) >= 2:
        add_dismissal_pairs(genres)
    return {"ok": True}


@router.get("/query")
def run_query(q: str = Query(default="")):
    parsed = parse_query(q)
    if isinstance(parsed, str):
        return {"records": [], "columns": [], "status": "", "error": parsed}

    datasets = _get_datasets()
    records, status = execute_query(parsed, datasets)
    columns = list(records[0].keys()) if records else []
    return {"records": records, "columns": columns, "status": status, "error": None}
