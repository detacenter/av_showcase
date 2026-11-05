"""Week/Month recap for Stats › Periods: stat tiles, pace vs. usual, new artists,
release decades, genre shift vs. usual, and each day's most-played album."""
from __future__ import annotations

from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

BASELINE_MONTHS = 6
GENRES_PER_ARTIST = 3
GENRE_ROWS = 10
NEW_ARTIST_TILES = 6


def _month_start(d: date, back: int = 0) -> date:
    y, m = d.year, d.month - back
    while m <= 0:
        m += 12
        y -= 1
    return date(y, m, 1)


def _genre_shares(entries: list[dict], artists: dict) -> dict[str, float]:
    """Each play splits evenly across its primary artist's top genres."""
    weights: Counter = Counter()
    for entry in entries:
        names = entry.get("artist_names") or []
        genres = (artists.get(names[0], {}).get("genres") or [])[:GENRES_PER_ARTIST] if names else []
        for g in genres:
            weights[g] += 1 / len(genres)
    total = sum(weights.values())
    return {g: 100 * w / total for g, w in weights.items()} if total else {}


def _fmt_minutes(minutes: int) -> str:
    hours, mins = divmod(int(minutes), 60)
    return f"{hours}h {mins}m" if hours else f"{mins}m"


def build_recap(
    log: list[dict],
    lib: dict,
    mode: str,
    start_day: date,
    end_day: date,
    parse,
    period_minutes_by_offset,
) -> dict:
    """`parse` turns played_at into a local datetime; `period_minutes_by_offset(k)`
    returns (minutes, start date) of the period k steps older, or None once that
    period is before the history begins."""
    artists = lib.get("artists", {})
    dated = [(parse(e["played_at"]), e) for e in log if e.get("played_at")]
    period = [(t, e) for t, e in dated if start_day <= t.date() <= end_day]
    before = [(t, e) for t, e in dated if t.date() < start_day]
    latest_day = max((t.date() for t, _ in dated), default=end_day)
    n_days = (end_day - start_day).days + 1
    elapsed = max(1, min(n_days, (latest_day - start_day).days + 1))
    in_progress = latest_day < end_day

    minutes = sum(e.get("duration_ms", 0) for _, e in period) / 60000

    # Usual = the 6 full calendar months before the period's month, per day of history.
    base_start = _month_start(start_day, BASELINE_MONTHS)
    base_end = _month_start(start_day) - timedelta(days=1)
    baseline = [(t, e) for t, e in before if base_start <= t.date() <= base_end]
    usual_minutes = None
    if baseline:
        first = max(base_start, min(t.date() for t, _ in baseline))
        base_days = (base_end - first).days + 1
        per_day = sum(e.get("duration_ms", 0) for _, e in baseline) / 60000 / base_days
        usual_minutes = round(per_day * n_days)
    projected = round(minutes / elapsed * n_days) if in_progress else round(minutes)

    # "Biggest since": the most recent older period with at least this many minutes.
    # Only worth saying when it beats the last 4 periods.
    biggest_since = None
    if not in_progress and minutes > 0:
        k = 1
        while True:
            older = period_minutes_by_offset(k)
            if older is None:
                biggest_since = {"kind": "ever"} if k > 4 else None
                break
            older_minutes, older_start = older
            if older_minutes >= minutes:
                biggest_since = {"kind": "since", "date": older_start.isoformat()} if k > 4 else None
                break
            k += 1

    # New artists / albums: first-ever play falls inside the period.
    seen_artists = {e["artist_names"][0] for _, e in before if e.get("artist_names")}
    seen_albums = {e.get("album_id") for _, e in before}
    artist_plays: Counter = Counter()
    artist_art: dict[str, str | None] = {}
    album_ids: set[str] = set()
    for _, e in period:
        if e.get("artist_names"):
            a = e["artist_names"][0]
            artist_plays[a] += 1
            artist_art.setdefault(a, e.get("album_art_local_path"))
        if e.get("album_id"):
            album_ids.add(e["album_id"])
    new_artists = [(a, n) for a, n in artist_plays.most_common() if a not in seen_artists]
    new_albums = [a for a in album_ids if a not in seen_albums]

    # Each day's total listening and most-played album by minutes.
    day_album: dict[date, Counter] = defaultdict(Counter)
    day_minutes: Counter = Counter()
    album_info: dict[str, dict] = {}
    for t, e in period:
        m = e.get("duration_ms", 0) / 60000
        key = e.get("album_id") or e.get("album_name", "")
        day_album[t.date()][key] += m
        day_minutes[t.date()] += m
        album_info.setdefault(key, {
            "title": e.get("album_name", ""),
            "artist": (e.get("artist_names") or [""])[0],
            "art_path": e.get("album_art_local_path"),
        })
    days = []
    for i in range(n_days):
        d = start_day + timedelta(days=i)
        if d > latest_day:
            days.append({"date": d.isoformat(), "future": True})
            continue
        if not day_album[d]:
            days.append({"date": d.isoformat(), "minutes": 0})
            continue
        key, top = day_album[d].most_common(1)[0]
        days.append({
            "date": d.isoformat(),
            "minutes": round(day_minutes[d]),
            "top_minutes": round(top),
            **album_info[key],
        })
    biggest = max((x for x in days if x.get("minutes")), key=lambda x: x["minutes"], default=None)

    decades: Counter = Counter()
    for _, e in period:
        y = e.get("release_year")
        if isinstance(y, int) and y > 0:
            decades[(y // 10) * 10] += 1
    dec_total = sum(decades.values())

    genres = []
    if baseline:
        now, usual = _genre_shares([e for _, e in period], artists), _genre_shares([e for _, e in baseline], artists)
        names = sorted(set(now) | set(usual), key=lambda g: -abs(now.get(g, 0) - usual.get(g, 0)))[:GENRE_ROWS]
        rows = [{"name": g, "now": round(now.get(g, 0)), "usual": round(usual.get(g, 0))} for g in names]
        genres = sorted(rows, key=lambda r: -(r["now"] - r["usual"]))

    return {
        "in_progress": in_progress,
        "through": latest_day.isoformat() if in_progress else None,
        "days_elapsed": elapsed,
        "days_total": n_days,
        "minutes": round(minutes),
        "listening": _fmt_minutes(minutes),
        "projected_minutes": projected,
        "usual_minutes": usual_minutes,
        "usual_label": f"{base_start.strftime('%b')}–{base_end.strftime('%b')}" if baseline else None,
        "biggest_since": biggest_since,
        "artists_played": len(artist_plays),
        "new_artist_count": len(new_artists),
        "albums_played": len(album_ids),
        "new_album_count": len(new_albums),
        "new_artists": [
            {"name": a, "plays": n, "art_path": artist_art.get(a)} for a, n in new_artists[:NEW_ARTIST_TILES]
        ],
        "biggest_day": {"date": biggest["date"], "minutes": biggest["minutes"], "label": _fmt_minutes(biggest["minutes"])} if biggest else None,
        "decades": [{"decade": d, "pct": round(100 * n / dec_total, 1)} for d, n in sorted(decades.items())],
        "genres": genres,
        "days": days,
    }
