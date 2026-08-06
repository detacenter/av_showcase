import json
from datetime import datetime, timezone, timedelta

from core.paths import data_path, ensure_data_dir

LOG_FILE             = data_path("listening_log.json")
BLOCKLIST_FILE       = data_path("deleted_plays.json")
DELETION_COUNTS_FILE = data_path("deletion_counts.json")
TRACK_BLOCKS_FILE    = data_path("track_blocks.json")
TRACK_OVERRIDES_FILE = data_path("track_overrides.json")

_DELETION_WINDOW_MIN = 30   # sliding window to count deletions
_DELETION_THRESHOLD  = 3    # deletions within window that triggers a block
_BLOCK_DURATION_MIN  = 10   # how long the timed block lasts


# ── Blocklist (played_at timestamp dedup) ─────────────────────────────────────

def load_blocklist() -> set[str]:
    ensure_data_dir()
    if not BLOCKLIST_FILE.exists():
        return set()
    with BLOCKLIST_FILE.open() as f:
        return set(json.load(f))


def add_to_blocklist(played_at: str) -> None:
    blocked = load_blocklist()
    blocked.add(played_at)
    ensure_data_dir()
    with BLOCKLIST_FILE.open("w") as f:
        json.dump(sorted(blocked), f, indent=2)


# ── Timed track blocks ────────────────────────────────────────────────────────

def _load_track_blocks() -> dict[str, str]:
    """Returns {track_id: expiry_iso_string}."""
    ensure_data_dir()
    if not TRACK_BLOCKS_FILE.exists():
        return {}
    with TRACK_BLOCKS_FILE.open() as f:
        return json.load(f)


def _save_track_blocks(blocks: dict[str, str]) -> None:
    ensure_data_dir()
    with TRACK_BLOCKS_FILE.open("w") as f:
        json.dump(blocks, f, indent=2)


def is_track_blocked(track_id: str) -> bool:
    blocks = _load_track_blocks()
    expiry_str = blocks.get(track_id)
    if not expiry_str:
        return False
    expiry = datetime.fromisoformat(expiry_str)
    return datetime.now(timezone.utc) < expiry


def _block_track(track_id: str) -> None:
    blocks = _load_track_blocks()
    expiry = datetime.now(timezone.utc) + timedelta(minutes=_BLOCK_DURATION_MIN)
    blocks[track_id] = expiry.isoformat()
    _save_track_blocks(blocks)


# ── Deletion history ──────────────────────────────────────────────────────────

def _load_deletion_counts() -> dict[str, list[str]]:
    """Returns {track_id: [iso_timestamp, ...]} of recent deletions."""
    ensure_data_dir()
    if not DELETION_COUNTS_FILE.exists():
        return {}
    with DELETION_COUNTS_FILE.open() as f:
        return json.load(f)


def _save_deletion_counts(counts: dict[str, list[str]]) -> None:
    ensure_data_dir()
    with DELETION_COUNTS_FILE.open("w") as f:
        json.dump(counts, f, indent=2)


def record_deletion(track_id: str) -> bool:
    """
    Record that a play of track_id was manually deleted.
    If this is the _DELETION_THRESHOLD-th deletion within _DELETION_WINDOW_MIN
    minutes, impose a _BLOCK_DURATION_MIN-minute timed block.
    Returns True if a timed block was applied.
    """
    if not track_id:
        return False

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(minutes=_DELETION_WINDOW_MIN)

    counts = _load_deletion_counts()
    timestamps = counts.get(track_id, [])

    # Keep only deletions within the window
    recent = [
        t for t in timestamps
        if datetime.fromisoformat(t) > cutoff
    ]
    recent.append(now.isoformat())
    counts[track_id] = recent
    _save_deletion_counts(counts)

    if len(recent) >= _DELETION_THRESHOLD:
        _block_track(track_id)
        return True
    return False


# ── Core log helpers ──────────────────────────────────────────────────────────

def deduplicate_log(entries: list[dict]) -> tuple[list[dict], int]:
    """Remove duplicate consecutive entries caused by mid-song device switches."""
    if len(entries) < 2:
        return entries, 0

    def _ts(s: str) -> datetime | None:
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00"))
        except Exception:
            return None

    cleaned: list[dict] = []
    removed = 0
    i = 0
    while i < len(entries):
        cur = entries[i]
        nxt = entries[i + 1] if i + 1 < len(entries) else None

        if nxt and cur.get("track_id") and cur.get("track_id") == nxt.get("track_id"):
            t1 = _ts(cur.get("played_at", ""))
            t2 = _ts(nxt.get("played_at", ""))
            if t1 and t2:
                gap_ms      = abs((t1 - t2).total_seconds() * 1000)
                duration_ms = cur.get("duration_ms") or 0
                if gap_ms < 1_000 or (duration_ms > 0 and gap_ms < duration_ms):
                    removed += 1
                    i += 1
                    continue

        cleaned.append(cur)
        i += 1

    return cleaned, removed


# ── Track overrides ───────────────────────────────────────────────────────────

def load_track_overrides() -> dict[str, dict]:
    ensure_data_dir()
    if not TRACK_OVERRIDES_FILE.exists():
        return {}
    with TRACK_OVERRIDES_FILE.open() as f:
        return json.load(f)


def save_track_overrides(overrides: dict[str, dict]) -> None:
    ensure_data_dir()
    with TRACK_OVERRIDES_FILE.open("w") as f:
        json.dump(overrides, f, indent=2)


def _apply_overrides(entries: list[dict]) -> list[dict]:
    overrides = load_track_overrides()
    if not overrides:
        return entries
    for entry in entries:
        ov = overrides.get(entry.get("track_id", ""))
        if ov:
            entry.update(ov)
    return entries


def load_log() -> list[dict]:
    ensure_data_dir()
    if not LOG_FILE.exists():
        return []
    with LOG_FILE.open() as f:
        entries = json.load(f)
    return _apply_overrides(entries)


def save_log(entries: list[dict]) -> None:
    ensure_data_dir()
    with LOG_FILE.open("w") as f:
        json.dump(entries, f, indent=2)


def _parse_ts(s: str) -> datetime | None:
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def get_new_entries(fetched: list[dict], existing: list[dict]) -> list[dict]:
    seen_timestamps = {e["played_at"] for e in existing} | load_blocklist()

    # Index existing by track_id for near-duplicate detection (same track within 10s)
    existing_by_track: dict[str, list[datetime]] = {}
    for e in existing:
        tid = e.get("track_id", "")
        t = _parse_ts(e.get("played_at", ""))
        if tid and t:
            existing_by_track.setdefault(tid, []).append(t)

    result: list[dict] = []
    accepted_by_track: dict[str, list[datetime]] = {}

    for e in fetched:
        if e["played_at"] in seen_timestamps:
            continue
        if is_track_blocked(e.get("track_id", "")):
            continue

        tid = e.get("track_id", "")
        t = _parse_ts(e.get("played_at", ""))

        if tid and t:
            # Check against existing log
            for et in existing_by_track.get(tid, []):
                if abs((t - et).total_seconds()) < 10:
                    break
            else:
                # Check against entries already accepted this batch
                for at in accepted_by_track.get(tid, []):
                    if abs((t - at).total_seconds()) < 10:
                        break
                else:
                    result.append(e)
                    accepted_by_track.setdefault(tid, []).append(t)
        else:
            result.append(e)

    return result
