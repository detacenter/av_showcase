"""Self-contained port of OGAV's ui/components/query_engine.py — no Qt deps."""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

SOURCES = {"log", "albums", "artists", "tracks"}

_DEFAULT_FIELDS: dict[str, list[str]] = {
    "log":     ["played_at", "artist", "track_name", "album_name", "album_type"],
    "albums":  ["album_name", "artist", "type", "play_count", "rating", "favorited"],
    "artists": ["name", "play_count", "genres", "favorited"],
    "tracks":  ["track_name", "artist", "album_name", "play_count", "favorited"],
}

_OPS = [">=", "<=", "!=", "not contains", "contains", "starts with", "=", ">", "<"]


def _classify_album_type(album_type: str | None, total_tracks: int | None) -> str:
    if album_type == "compilation":
        return "Compilation"
    if album_type == "album":
        return "Album"
    if album_type == "single":
        return "EP" if (total_tracks or 0) > 1 else "Single"
    return "Album"


def _build_album_index(log: list[dict]) -> dict[str, dict]:
    albums: dict[str, dict] = {}
    for entry in log:
        album_id = entry.get("album_id", "")
        if not album_id:
            continue
        artist = entry["artist_names"][0] if entry.get("artist_names") else ""
        info = albums.setdefault(album_id, {
            "album_id":          album_id,
            "album_name":        entry.get("album_name", ""),
            "artist":            artist,
            "release_year":      entry.get("release_year"),
            "album_type":        entry.get("album_type"),
            "album_total_tracks":entry.get("album_total_tracks"),
            "count":             0,
        })
        info["count"] += 1
    return albums


def build_datasets(log: list, lib: dict) -> dict[str, list[dict]]:
    # ── log ───────────────────────────────────────────────────────────────────
    log_records: list[dict] = []
    for entry in log:
        played = entry.get("played_at", "")
        try:
            dt = datetime.fromisoformat(played.replace("Z", "+00:00"))
            date_str = dt.strftime("%Y-%m-%d %H:%M")
        except Exception:
            date_str = played[:16]
        log_records.append({
            "played_at":    date_str,
            "artist":       ", ".join(entry.get("artist_names", [])),
            "track_name":   entry.get("track_name", ""),
            "album_name":   entry.get("album_name", ""),
            "album_type":   entry.get("album_type", ""),
            "album_id":     entry.get("album_id", ""),
            "track_id":     entry.get("track_id", ""),
            "device_name":  entry.get("device_name") or "",
            "context_type": entry.get("context_type") or "",
        })

    # ── albums ────────────────────────────────────────────────────────────────
    album_index = _build_album_index(log)
    albums: list[dict] = []
    for album_id, info in album_index.items():
        adata = lib.get("albums", {}).get(album_id, {})
        raw_rating = adata.get("rating", 0)
        albums.append({
            "album_id":     album_id,
            "album_name":   info.get("album_name", ""),
            "artist":       info.get("artist", ""),
            "album_type":   info.get("album_type", ""),
            "type":         _classify_album_type(info.get("album_type"), info.get("album_total_tracks")),
            "release_year": info.get("release_year") or "",
            "play_count":   info.get("count", 0),
            "rating":       round(raw_rating / 2, 1) if raw_rating else 0,
            "favorited":    bool(adata.get("favorited", False)),
            "notes":        adata.get("notes", "") or "",
        })
    albums.sort(key=lambda x: -x["play_count"])

    # ── artists ───────────────────────────────────────────────────────────────
    artist_plays: dict[str, int] = {}
    for entry in log:
        for name in entry.get("artist_names", []):
            artist_plays[name] = artist_plays.get(name, 0) + 1
    artists: list[dict] = []
    for name, count in sorted(artist_plays.items(), key=lambda x: -x[1]):
        adata = lib.get("artists", {}).get(name, {})
        artists.append({
            "name":       name,
            "play_count": count,
            "genres":     ", ".join(adata.get("genres", [])),
            "favorited":  bool(adata.get("favorited", False)),
        })

    # ── tracks ────────────────────────────────────────────────────────────────
    tracks_map: dict[str, dict] = {}
    for entry in log:
        tid = entry.get("track_id", "")
        if not tid:
            continue
        if tid not in tracks_map:
            tracks_map[tid] = {
                "track_id":   tid,
                "track_name": entry.get("track_name", ""),
                "artist":     ", ".join(entry.get("artist_names", [])),
                "album_name": entry.get("album_name", ""),
                "play_count": 0,
                "favorited":  bool(lib.get("tracks", {}).get(tid, {}).get("favorited", False)),
            }
        tracks_map[tid]["play_count"] += 1
    tracks = sorted(tracks_map.values(), key=lambda x: -x["play_count"])

    return {"log": log_records, "albums": albums, "artists": artists, "tracks": tracks}


def parse_query(text: str) -> dict | str:
    text = text.strip()
    if not text:
        return {"source": "log", "conditions": [], "fields": None, "limit": 100}

    m = re.match(r'^(\w+)(.*)', text, re.IGNORECASE | re.DOTALL)
    if not m:
        return "Syntax error. Try: albums where rating > 8"

    source = m.group(1).lower()
    rest   = m.group(2).strip()

    if source not in SOURCES:
        return f"Unknown source '{source}'. Available: {', '.join(sorted(SOURCES))}"

    limit = 200
    limit_m = re.search(r'\blimit\s+(\d+)', rest, re.IGNORECASE)
    if limit_m:
        limit = int(limit_m.group(1))
        rest  = (rest[:limit_m.start()] + rest[limit_m.end():]).strip()

    fields = None
    show_m = re.search(r'\bshow\s+([\w,\s]+?)(?=\bwhere\b|\blimit\b|$)', rest, re.IGNORECASE)
    if show_m:
        fields = [f.strip() for f in show_m.group(1).split(",") if f.strip()]
        rest   = (rest[:show_m.start()] + rest[show_m.end():]).strip()

    conditions: list[dict] = []
    where_m = re.search(r'\bwhere\s+(.+)', rest, re.IGNORECASE | re.DOTALL)
    if where_m:
        where_str = where_m.group(1).strip()
        for part in re.split(r'\s+and\s+', where_str, flags=re.IGNORECASE):
            cond = _parse_condition(part.strip())
            if isinstance(cond, str):
                return cond
            conditions.append(cond)

    return {"source": source, "conditions": conditions, "fields": fields, "limit": limit}


def _parse_condition(text: str) -> dict | str:
    for op in _OPS:
        m = re.match(rf'^(\w+)\s*{re.escape(op)}\s*(.+)$', text, re.IGNORECASE)
        if m:
            return {"field": m.group(1).lower(), "op": op, "value": m.group(2).strip().strip("\"'")}
    return f"Can't parse condition: '{text}'. Example: rating > 8"


def execute_query(parsed: dict, datasets: dict) -> tuple[list[dict], str]:
    records: list[dict] = list(datasets.get(parsed["source"], []))

    for cond in parsed["conditions"]:
        records = [r for r in records if _eval_condition(r, cond)]

    total = len(records)
    limit = parsed.get("limit") or 200
    records = records[:limit]

    fields = parsed.get("fields")
    if fields:
        records = [{f: r.get(f, "") for f in fields} for r in records]
    else:
        defaults = _DEFAULT_FIELDS.get(parsed["source"], [])
        if defaults:
            records = [{f: r.get(f, "") for f in defaults} for r in records]

    truncated = total > limit
    note = f" — showing first {limit}" if truncated else ""
    return records, f"{total} result{'s' if total != 1 else ''}{note}"


def _eval_condition(record: dict, cond: dict) -> bool:
    actual: Any = record.get(cond["field"])
    if actual is None:
        return False

    op  = cond["op"]
    raw = cond["value"]

    if isinstance(actual, bool):
        test: Any       = raw.lower() in ("true", "yes", "1")
        actual_cmp: Any = actual
        test_cmp: Any   = test
    elif isinstance(actual, (int, float)):
        try:
            test_cmp   = float(raw)
            actual_cmp = float(actual)
        except ValueError:
            return False
    else:
        actual_cmp = str(actual).lower()
        test_cmp   = raw.lower()

    if op == "=":            return actual_cmp == test_cmp
    if op == "!=":           return actual_cmp != test_cmp
    if op == ">":            return actual_cmp > test_cmp
    if op == "<":            return actual_cmp < test_cmp
    if op == ">=":           return actual_cmp >= test_cmp
    if op == "<=":           return actual_cmp <= test_cmp
    if op == "contains":     return str(test_cmp) in str(actual_cmp)
    if op == "not contains": return str(test_cmp) not in str(actual_cmp)
    if op == "starts with":  return str(actual_cmp).startswith(str(test_cmp))
    return False
