"""Spotify Extended Streaming History import: the pre-AV listening history.

Lives beside the live play log, never inside it. `import_export()` reads Spotify's
`Streaming_History_Audio_*.json` files into a compact store under
`<data>/spotify_history/`, keeping only music plays of at least MIN_MS that ended
before AV's own log begins. `load_history_entries()` turns the store back into
entries shaped like the live log so the Stats builders can read both at once.

Store layout:
  raw/                 the original export files, copied untouched
  plays.json           {"v", "cutoff", "columns", "rows": [[...], ...]}
  tracks.json          {track_id: {"name", "artist", "album", ...enrichment}}
  import_summary.json  counts from the last import
"""
from __future__ import annotations

import hashlib
import json
import shutil
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from core.paths import data_path, ensure_data_dir

HISTORY_DIR = data_path("spotify_history")
PLAYS_FILE = HISTORY_DIR / "plays.json"
TRACKS_FILE = HISTORY_DIR / "tracks.json"
SUMMARY_FILE = HISTORY_DIR / "import_summary.json"
RAW_DIR = HISTORY_DIR / "raw"

MIN_MS = 30_000
COLUMNS = ["end_ts", "track_id", "ms_played", "reason_start", "reason_end", "shuffle", "skipped", "platform", "offline"]
SOURCE = "spotify_export"


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _iso_z(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def placeholder_album_id(artist: str, album: str) -> str:
    """Stable stand-in until enrichment supplies the real Spotify album id."""
    digest = hashlib.sha1(f"{artist}\n{album}".lower().encode()).hexdigest()
    return f"imp_{digest[:16]}"


def _write_json(path: Path, data) -> None:
    tmp = path.with_suffix(".tmp")
    with tmp.open("w") as f:
        json.dump(data, f, separators=(",", ":"))
    tmp.replace(path)


def import_export(source_dir: Path, cutoff: datetime, copy_raw: bool = True) -> dict:
    """Build the store from a Spotify export folder. `cutoff` is the start of AV's own
    log (UTC): plays ending at or after it are left out so nothing is counted twice."""
    ensure_data_dir()
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    files = sorted(source_dir.glob("Streaming_History_Audio_*.json"))
    if not files:
        raise FileNotFoundError(f"No Streaming_History_Audio_*.json in {source_dir}")

    rows: list[list] = []
    tracks: dict[str, dict] = {}
    counts: Counter = Counter()
    for file in files:
        with file.open() as f:
            for r in json.load(f):
                counts["rows"] += 1
                uri = r.get("spotify_track_uri")
                if not uri:
                    counts["not_music"] += 1
                    continue
                ms = r.get("ms_played") or 0
                if ms < MIN_MS:
                    counts["under_30s"] += 1
                    continue
                end = _parse_ts(r["ts"])
                if end >= cutoff:
                    counts["after_cutoff"] += 1
                    continue
                track_id = uri.rsplit(":", 1)[-1]
                tracks.setdefault(track_id, {
                    "name": r.get("master_metadata_track_name") or "",
                    "artist": r.get("master_metadata_album_artist_name") or "",
                    "album": r.get("master_metadata_album_album_name") or "",
                })
                rows.append([
                    r["ts"], track_id, ms, r.get("reason_start"), r.get("reason_end"),
                    r.get("shuffle"), r.get("skipped"), r.get("platform"), r.get("offline"),
                ])
                counts["kept"] += 1

    rows.sort(key=lambda row: row[0])
    _write_json(PLAYS_FILE, {"v": 1, "cutoff": _iso_z(cutoff), "columns": COLUMNS, "rows": rows})
    # Keep any enrichment an earlier import already gathered.
    if TRACKS_FILE.exists():
        with TRACKS_FILE.open() as f:
            old = json.load(f)
        for tid, info in old.items():
            if tid in tracks:
                tracks[tid] = {**tracks[tid], **{k: v for k, v in info.items() if k not in ("name", "artist", "album")}}
    _write_json(TRACKS_FILE, tracks)

    if copy_raw:
        RAW_DIR.mkdir(parents=True, exist_ok=True)
        for file in source_dir.iterdir():
            if file.is_file():
                shutil.copy2(file, RAW_DIR / file.name)

    summary = {
        "imported_at": _iso_z(datetime.now(timezone.utc)),
        "source": str(source_dir),
        "cutoff": _iso_z(cutoff),
        "files": len(files),
        "plays": len(rows),
        "tracks": len(tracks),
        "first_play": rows[0][0] if rows else None,
        "last_play": rows[-1][0] if rows else None,
        "skipped": {k: counts[k] for k in ("not_music", "under_30s", "after_cutoff")},
    }
    _write_json(SUMMARY_FILE, summary)
    return summary


def load_summary() -> dict | None:
    if not SUMMARY_FILE.exists():
        return None
    with SUMMARY_FILE.open() as f:
        return json.load(f)


def load_tracks() -> dict[str, dict]:
    if not TRACKS_FILE.exists():
        return {}
    with TRACKS_FILE.open() as f:
        return json.load(f)


def save_tracks(tracks: dict[str, dict]) -> None:
    _write_json(TRACKS_FILE, tracks)


_cache: tuple[tuple, list[dict]] | None = None


def _store_stamp() -> tuple:
    return tuple(p.stat().st_mtime_ns if p.exists() else 0 for p in (PLAYS_FILE, TRACKS_FILE))


_counts_cache: tuple[int, dict[str, int]] | None = None


def play_counts() -> dict[str, int]:
    """Plays per track id in the store (for ordering enrichment, most played first).
    Cached by plays.json mtime: callers poll this often and the file is 16 MB."""
    global _counts_cache
    if not PLAYS_FILE.exists():
        return {}
    stamp = PLAYS_FILE.stat().st_mtime_ns
    if _counts_cache and _counts_cache[0] == stamp:
        return _counts_cache[1]
    with PLAYS_FILE.open() as f:
        plays = json.load(f)
    i = plays["columns"].index("track_id")
    counts: dict[str, int] = {}
    for row in plays["rows"]:
        counts[row[i]] = counts.get(row[i], 0) + 1
    _counts_cache = (stamp, counts)
    return counts


def load_history_entries() -> list[dict]:
    """The store as live-log-shaped entries, oldest first. `played_at` is the start of
    the play (Spotify's `ts` is the end) and `duration_ms` is the time actually played,
    so `played_at + duration_ms` is the real end, matching how Sessions reads the log.
    Cached in memory until plays.json or tracks.json changes on disk."""
    global _cache
    if not PLAYS_FILE.exists():
        return []
    stamp = _store_stamp()
    if _cache and _cache[0] == stamp:
        return _cache[1]
    entries = _build_entries()
    _cache = (stamp, entries)
    return entries


def _build_entries() -> list[dict]:
    with PLAYS_FILE.open() as f:
        plays = json.load(f)
    tracks = load_tracks()
    idx = {name: i for i, name in enumerate(plays["columns"])}
    entries: list[dict] = []
    for row in plays["rows"]:
        track_id = row[idx["track_id"]]
        ms = row[idx["ms_played"]]
        t = tracks.get(track_id, {})
        artist = t.get("artist", "")
        end = _parse_ts(row[idx["end_ts"]])
        entries.append({
            "played_at": _iso_z(end - _ms(ms)),
            "track_id": track_id,
            "track_name": t.get("name", ""),
            "artist_names": t.get("artist_names") or ([artist] if artist else []),
            "artist_ids": t.get("artist_ids") or [],
            "album_name": t.get("album_display") or t.get("album", ""),
            "album_id": t.get("album_id") or placeholder_album_id(artist, t.get("album", "")),
            "duration_ms": ms,
            "track_duration_ms": t.get("duration_ms"),
            "release_year": t.get("release_year") or None,   # older imports stored Spotify's "0000" as 0
            "track_number": t.get("track_number"),
            "album_type": t.get("album_type"),
            "album_total_tracks": t.get("album_total_tracks"),
            "album_art_url": t.get("album_art_url"),
            "album_art_local_path": t.get("album_art_local_path"),
            "explicit": t.get("explicit"),
            "isrc": t.get("isrc"),
            "context_type": None,
            "context_uri": None,
            "device_name": None,
            "device_type": row[idx["platform"]],
            "shuffle_state": row[idx["shuffle"]],
            "skipped": row[idx["skipped"]],
            "reason_start": row[idx["reason_start"]],
            "reason_end": row[idx["reason_end"]],
            "offline": row[idx["offline"]],
            "source": SOURCE,
        })
    return entries


def _ms(ms: int):
    from datetime import timedelta
    return timedelta(milliseconds=ms)
