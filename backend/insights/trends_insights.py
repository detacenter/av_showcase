from __future__ import annotations

import calendar
from datetime import date, datetime
from zoneinfo import ZoneInfo

_TZ = ZoneInfo("America/New_York")


def _parse(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(_TZ)


# ── Period-key helpers ────────────────────────────────────────────────────────

def _key_month(dt: datetime) -> tuple:
    return (dt.year, dt.month)


def _key_week(dt: datetime) -> tuple:
    """ISO week Monday as (year, month, day)."""
    iso = dt.isocalendar()
    monday = date.fromisocalendar(iso[0], iso[1], 1)
    return (monday.year, monday.month, monday.day)


def _key_day(dt: datetime) -> tuple:
    return (dt.year, dt.month, dt.day)


def _label_month(key: tuple) -> str:
    return calendar.month_abbr[key[1]]


def _label_week(key: tuple) -> str:
    mon = date(*key)
    return f"{calendar.month_abbr[mon.month]} {mon.day}"


def _label_day(key: tuple) -> str:
    d = date(*key)
    return f"{calendar.month_abbr[d.month]} {d.day}"


# ── Main builder ──────────────────────────────────────────────────────────────

def build_trends_payload(
    log: list[dict],
    granularity: str = "month",
    n_periods: int | None = None,
) -> dict:
    """
    Returns per-period stats for the Trends view.

    granularity : "month" | "week" | "day"
    n_periods   : how many periods to include (defaults: month=12, week=16, day=30)

    Keys returned
    -------------
    months       : list[str]   — period labels
    month_keys   : list[tuple] — period key tuples (used for year/month separators)
    metrics      : dict        — plays / time_h / artists / albums per period
    """
    _defaults = {"month": 12, "week": 16, "day": 30}
    if n_periods is None:
        n_periods = _defaults.get(granularity, 12)

    empty = {"months": [], "month_keys": [], "metrics": {
        "plays": [], "time_h": [], "artists": [], "albums": [],
    }}

    if not log:
        return empty

    if granularity == "month":
        key_fn, label_fn = _key_month, _label_month
    elif granularity == "week":
        key_fn, label_fn = _key_week, _label_week
    else:  # day
        key_fn, label_fn = _key_day, _label_day

    # ── Collect all period keys present in log ────────────────────────────────
    all_keys: set[tuple] = set()
    for entry in log:
        all_keys.add(key_fn(_parse(entry["played_at"])))

    periods_sorted = sorted(all_keys)[-n_periods:]
    periods_set    = set(periods_sorted)

    # ── Accumulate per-period stats ───────────────────────────────────────────
    stats: dict[tuple, dict] = {
        k: {
            "plays":   0,
            "time_ms": 0,
            "artists": set(),
            "albums":  set(),
        }
        for k in periods_sorted
    }

    for entry in log:
        k = key_fn(_parse(entry["played_at"]))
        if k not in periods_set:
            continue
        s = stats[k]
        s["plays"]   += 1
        s["time_ms"] += entry.get("duration_ms", 0)
        for artist in entry.get("artist_names", []):
            s["artists"].add(artist)
        aid = entry.get("album_id")
        if aid:
            s["albums"].add(aid)

    return {
        "months":     [label_fn(k) for k in periods_sorted],
        "month_keys": periods_sorted,
        "metrics": {
            "plays":   [stats[k]["plays"]                          for k in periods_sorted],
            "time_h":  [round(stats[k]["time_ms"] / 3_600_000, 1) for k in periods_sorted],
            "artists": [len(stats[k]["artists"])                   for k in periods_sorted],
            "albums":  [len(stats[k]["albums"])                    for k in periods_sorted],
        },
    }
