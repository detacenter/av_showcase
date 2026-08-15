from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from core.album_type import classify_album_type
from persistence.discogs import load_collection

_TZ = ZoneInfo("America/New_York")


def filter_entries_by_days(log: list[dict], days: int) -> list[dict]:
    if not days:
        return log
    cutoff = datetime.now(_TZ) - timedelta(days=days)
    return [
        entry
        for entry in log
        if _parse_played_at(entry["played_at"]) >= cutoff
    ]


def build_stats_snapshot(entries: list[dict], lib: dict) -> dict:
    artist_counts: dict[str, int] = defaultdict(int)
    track_counts: dict[str, int] = defaultdict(int)
    track_names: dict[str, str] = {}
    decade_counts: dict[int, int] = defaultdict(int)
    genre_counts: dict[str, int] = defaultdict(int)
    total_ms = 0

    for entry in entries:
        total_ms += entry.get("duration_ms", 0)
        if entry.get("artist_names"):
            primary = entry["artist_names"][0]
            artist_counts[primary] += 1
            for genre in lib.get("artists", {}).get(primary, {}).get("genres", []):
                genre_counts[genre] += 1
        track_id = entry["track_id"]
        track_counts[track_id] += 1
        track_names[track_id] = f"{entry['track_name']}  —  {', '.join(entry.get('artist_names', []))}"
        year = entry.get("release_year")
        if year:
            decade_counts[(year // 10) * 10] += 1

    return {
        "total_ms": total_ms,
        "artist_counts": dict(artist_counts),
        "track_counts": dict(track_counts),
        "track_names": track_names,
        "decade_counts": dict(decade_counts),
        "genre_counts": dict(genre_counts),
    }


def days_span_for_entries(entries: list[dict], selected_days: int) -> int:
    if not entries:
        return 1
    first = datetime.fromisoformat(entries[0]["played_at"].replace("Z", "+00:00"))
    last = datetime.fromisoformat(entries[-1]["played_at"].replace("Z", "+00:00"))
    observed_span = max(1, (first - last).days + 1)
    if not selected_days:
        return observed_span
    return min(selected_days, observed_span)


def build_overview_payload(entries: list[dict], lib: dict, selected_days: int) -> dict | None:
    if not entries:
        return None
    snapshot = build_stats_snapshot(entries, lib)
    artist_counts = snapshot["artist_counts"]
    track_counts = snapshot["track_counts"]
    track_names = snapshot["track_names"]
    album_counts: dict[str, dict] = {}
    artist_album_counts: dict[str, dict[str, dict]] = defaultdict(dict)
    for entry in entries:
        album_id = entry.get("album_id")
        if not album_id:
            continue
        album = album_counts.setdefault(
            album_id,
            {
                "title": entry.get("album_name", ""),
                "subtitle": entry["artist_names"][0] if entry.get("artist_names") else "",
                "count": 0,
                "art_path": entry.get("album_art_local_path"),
                "art_key": f"overview_album_{album_id}",
            },
        )
        album["count"] += 1
        artist = entry["artist_names"][0] if entry.get("artist_names") else ""
        if artist:
            artist_album = artist_album_counts[artist].setdefault(
                album_id,
                {
                    "album_title": entry.get("album_name", ""),
                    "art_path": entry.get("album_art_local_path"),
                    "release_year": entry.get("release_year"),
                    "count": 0,
                },
            )
            artist_album["count"] += 1

    top_artists = []
    for name, count in sorted(artist_counts.items(), key=lambda item: -item[1])[:10]:
        album_map = artist_album_counts.get(name, {})
        featured = max(
            album_map.values(),
            key=lambda item: (item["count"], item.get("release_year") or 0, item.get("album_title", "").lower()),
            default={},
        )
        top_artists.append(
            {
                "name": name,
                "count": count,
                "album_title": featured.get("album_title", ""),
                "art_path": featured.get("art_path"),
                "release_year": featured.get("release_year"),
            }
        )

    top_tracks = [
        (track_names[track_id], count)
        for track_id, count in sorted(track_counts.items(), key=lambda item: -item[1])[:10]
    ]
    by_decade = [(f"{decade}s", count) for decade, count in sorted(snapshot["decade_counts"].items())]
    by_genre = [(genre, count) for genre, count in sorted(snapshot["genre_counts"].items(), key=lambda item: -item[1])[:12]]
    top_albums = sorted(album_counts.values(), key=lambda a: -a["count"])[:12]

    time_of_day = {"morning": 0, "afternoon": 0, "evening": 0, "night": 0}
    genre_raw: dict[str, dict] = {}
    for entry in entries:
        try:
            h = _parse_played_at(entry["played_at"]).hour
        except Exception:
            h = 12
        if 6 <= h < 12:
            time_of_day["morning"] += 1
        elif 12 <= h < 18:
            time_of_day["afternoon"] += 1
        elif 18 <= h < 22:
            time_of_day["evening"] += 1
        else:
            time_of_day["night"] += 1
        primary = (entry.get("artist_names") or [""])[0]
        track_id = entry.get("track_id", "")
        for genre in lib.get("artists", {}).get(primary, {}).get("genres", []):
            if genre not in genre_raw:
                genre_raw[genre] = {"plays": 0, "hour_sum": 0.0, "unique": set()}
            gs = genre_raw[genre]
            gs["plays"] += 1
            gs["hour_sum"] += h
            gs["unique"].add(track_id)

    genre_detail = sorted(
        [
            {
                "name": genre,
                "plays": gs["plays"],
                "avg_hour": gs["hour_sum"] / gs["plays"],
                "unique_tracks": len(gs["unique"]),
            }
            for genre, gs in genre_raw.items()
            if gs["plays"] >= 3
        ],
        key=lambda g: -g["plays"],
    )[:9]

    return {
        "play_count": len(entries),
        "total_ms": snapshot["total_ms"],
        "days_span": days_span_for_entries(entries, selected_days),
        "top_artists": top_artists,
        "top_tracks": top_tracks,
        "by_decade": by_decade,
        "by_genre": by_genre,
        "top_albums": top_albums,
        "time_of_day": time_of_day,
        "unique_artists": len(artist_counts),
        "unique_albums": len(album_counts),
        "genre_detail": genre_detail,
    }


_SESSION_GAP_S = 30 * 60  # 30 minutes


def _make_session(tracks: list[dict]) -> dict:
    start = _parse_played_at(tracks[0]["played_at"])
    last  = tracks[-1]
    end   = _parse_played_at(last["played_at"]) + timedelta(milliseconds=last.get("duration_ms", 0))
    artist_counts = Counter(a for t in tracks for a in t.get("artist_names", []))
    top_artist = artist_counts.most_common(1)[0][0] if artist_counts else ""
    return {
        "id":               start.isoformat(),
        "start":            start,
        "end":              end,
        "duration_minutes": (end - start).total_seconds() / 60,
        "track_count":      len(tracks),
        "tracks":           tracks,
        "top_artist":       top_artist,
    }


def build_sessions_data(log: list[dict], days: int) -> list[dict]:
    entries = filter_entries_by_days(log, days)
    if not entries:
        return []
    chron = list(reversed(entries))  # oldest first
    sessions: list[dict] = []
    group = [chron[0]]
    for i in range(1, len(chron)):
        prev_end = _parse_played_at(group[-1]["played_at"]) + timedelta(milliseconds=group[-1].get("duration_ms", 0))
        gap_s    = (_parse_played_at(chron[i]["played_at"]) - prev_end).total_seconds()
        if gap_s <= _SESSION_GAP_S:
            group.append(chron[i])
        else:
            sessions.append(_make_session(group))
            group = [chron[i]]
    sessions.append(_make_session(group))
    long_sessions = [s for s in sessions if s["duration_minutes"] >= 30]
    return list(reversed(long_sessions))


def build_heatmap_payload(log: list[dict], days: int, *, segment_days: int | None = None) -> dict:
    entries = filter_entries_by_days(log, days)
    sessions = build_sessions_data(log, days)
    _seg = segment_days if segment_days is not None else days
    minutes_by_day: dict[date, int] = defaultdict(int)
    for entry in entries:
        played = _parse_played_at(entry["played_at"]).date()
        minutes_by_day[played] += entry.get("duration_ms", 0) // 60000

    if entries:
        end_date = _parse_played_at(entries[0]["played_at"]).date()
        start_date = _parse_played_at(entries[-1]["played_at"]).date()
    else:
        end_date = datetime.now(timezone.utc).date()
        start_date = end_date - timedelta(days=max(29, days - 1 if days else 364))

    if days:
        start_date = max(start_date, end_date - timedelta(days=days - 1))
    day_count = (end_date - start_date).days + 1
    days_data = []
    for index in range(day_count):
        current = start_date + timedelta(days=index)
        days_data.append({"date": current, "minutes": minutes_by_day.get(current, 0)})

    minutes_by_hour = [0] * 24
    minutes_by_dow  = [0] * 7   # 0=Monday ... 6=Sunday (isoweekday-1), reordered to Sun=0
    for entry in entries:
        played = _parse_played_at(entry["played_at"])
        minutes_by_hour[played.hour] += entry.get("duration_ms", 0) // 60000
        # weekday(): Mon=0 Sun=6 → remap to Sun=0 Sat=6
        dow = (played.weekday() + 1) % 7
        minutes_by_dow[dow] += entry.get("duration_ms", 0) // 60000

    total_minutes = sum(day["minutes"] for day in days_data)
    avg = round(total_minutes / len(days_data)) if days_data else 0
    sessions_by_dow: list[list[dict]] = [[] for _ in range(7)]
    for session in sessions:
        dow = (session["start"].astimezone(_TZ).weekday() + 1) % 7
        sessions_by_dow[dow].append(session)
    return {
        "heatmap": days_data,
        "minutes_by_hour": minutes_by_hour,
        "minutes_by_dow": minutes_by_dow,
        "day_parts": _build_day_parts(entries, _seg),
        "day_sessions": sessions_by_dow,
        "sessions": sessions,
        "caption": f"{total_minutes} total minutes listened · {avg} avg minutes per day",
    }


def _build_day_parts(entries: list[dict], days: int) -> list[list[dict]]:
    parts_by_dow: list[list[dict]] = [[] for _ in range(7)]
    if not entries:
        return parts_by_dow

    buckets: dict[tuple[int, object], int] = defaultdict(int)
    labels: dict[tuple[int, object], str] = {}

    for entry in reversed(entries):
        played = _parse_played_at(entry["played_at"])
        dow = (played.weekday() + 1) % 7
        if days == 0:
            key = played.year
            label = str(played.year)
        elif days >= 365:
            key = (played.year, played.month)
            label = played.strftime("%b")
        else:
            key = played.date()
            label = played.strftime("%b %-d")
        bucket_key = (dow, key)
        buckets[bucket_key] += entry.get("duration_ms", 0) // 60000
        labels[bucket_key] = label

    for (dow, key), minutes in buckets.items():
        parts_by_dow[dow].append({"sort_key": key, "label": labels[(dow, key)], "minutes": minutes})

    for dow in range(7):
        parts_by_dow[dow].sort(key=lambda item: item["sort_key"])

    return parts_by_dow


def _build_daypart_flow(entries: list[dict], n_days: int = 60) -> dict:
    if not entries:
        return {"days": [], "hours": [], "minutes": [], "centers": [], "max_hour": 0}
    valid = [e for e in entries if e.get("played_at")]
    if not valid:
        return {"days": [], "hours": [], "minutes": [], "centers": [], "max_hour": 0}
    last_day = max(_parse_played_at(e["played_at"]).date() for e in valid)
    first_day = min(_parse_played_at(e["played_at"]).date() for e in valid)
    start = max(last_day - timedelta(days=n_days - 1), first_day)
    days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
    day_idx = {d: i for i, d in enumerate(days)}
    hours = [[0] * 24 for _ in days]
    minutes = [[0.0] * 24 for _ in days]
    for entry in valid:
        dt = _parse_played_at(entry["played_at"])
        if dt.date() in day_idx:
            hours[day_idx[dt.date()]][dt.hour] += 1
            minutes[day_idx[dt.date()]][dt.hour] += entry.get("duration_ms", 0) / 60000
    centers = []
    for row in hours:
        total = sum(row)
        centers.append(sum(h * row[h] for h in range(24)) / total if total else None)
    return {
        "days": [d.isoformat() for d in days],
        "hours": hours,
        "minutes": minutes,
        "centers": centers,
        "max_hour": max((max(row) for row in hours), default=0),
    }


def _build_daypart_flow_monthly(entries: list[dict]) -> dict:
    valid = [e for e in entries if e.get("played_at")]
    if not valid:
        return {"months": [], "hours": [], "minutes": []}
    by_month: dict[tuple[int, int], dict] = {}
    for entry in valid:
        dt = _parse_played_at(entry["played_at"])
        key = (dt.year, dt.month)
        bucket = by_month.setdefault(key, {"hours": [0] * 24, "minutes": [0.0] * 24})
        bucket["hours"][dt.hour] += 1
        bucket["minutes"][dt.hour] += entry.get("duration_ms", 0) / 60000
    keys = sorted(by_month.keys())
    return {
        "months":  [{"year": y, "month": m} for y, m in keys],
        "hours":   [by_month[k]["hours"] for k in keys],
        "minutes": [by_month[k]["minutes"] for k in keys],
    }


def _ser_days(days_list: list) -> list:
    return [{"date": d["date"].isoformat(), "minutes": d["minutes"]} for d in days_list]


def _ser_parts(parts: list) -> list:
    return [[{"label": p["label"], "minutes": p["minutes"]} for p in dow] for dow in parts]


def build_period_payload(log: list[dict], mode: str, offset: int, lib: dict | None = None) -> dict:
    period_entries, start, end = _entries_for_period(log, mode, offset)
    label = _format_period_label(mode, start, end)
    album_header = _format_period_album_header(mode, start, end)
    total_minutes = sum(entry.get("duration_ms", 0) for entry in period_entries) // 60000

    lib_albums = (lib or {}).get("albums", {})

    # Album IDs seen in log entries strictly before this period (for new-discovery bonus)
    seen_before: set[str] = {
        entry["album_id"]
        for entry in log
        if entry.get("album_id") and _parse_played_at(entry["played_at"]) < start
    }

    artist_counts: dict[str, int] = defaultdict(int)
    artist_art: dict[str, str | None] = {}
    album_counts: dict[str, dict] = {}
    for entry in period_entries:
        if entry.get("artist_names"):
            artist = entry["artist_names"][0]
            artist_counts[artist] += 1
            artist_art.setdefault(artist, entry.get("album_art_local_path"))
        album_id = entry.get("album_id")
        if not album_id:
            continue
        album = album_counts.setdefault(
            album_id,
            {
                "title": entry.get("album_name", ""),
                "subtitle": entry["artist_names"][0] if entry.get("artist_names") else "",
                "play_count": 0,
                "days": set(),
                "distinct_tracks": set(),
                "total_tracks": entry.get("album_total_tracks") or 0,
                "album_type": classify_album_type(entry.get("album_type"), entry.get("album_total_tracks")),
                "art_path": entry.get("album_art_local_path"),
                "art_key": f"period_album_{album_id}",
            },
        )
        album["play_count"] += 1
        album["days"].add(_parse_played_at(entry["played_at"]).date())
        if entry.get("track_id"):
            album["distinct_tracks"].add(entry["track_id"])

    def _eligible_album(album_id: str, album: dict) -> bool:
        rating = lib_albums.get(album_id, {}).get("rating", 0)
        has_favorite = bool(lib_albums.get(album_id, {}).get("favorited", False))
        if 0 < rating < 15 and not has_favorite:
            return False
        is_single = album.get("album_type") == "Single"
        if not is_single:
            total = album.get("total_tracks") or 0
            distinct = len(album.get("distinct_tracks", set()))
            coverage = distinct / total if total else 1.0
            threshold = 0.25 if (has_favorite and rating > 0) else 0.50
            if coverage < threshold:
                return False
        return True

    def _score(album_id: str, album: dict) -> float:
        la = lib_albums.get(album_id, {})
        rating = la.get("rating", 0)          # 0–20 internal scale
        favorited = bool(la.get("favorited", False))

        play_count = album["play_count"]
        distinct_tracks = len(album.get("distinct_tracks", set())) or 1
        distinct_days = len(album["days"])

        # replay_rate > 1 means you replayed tracks, not just swept through once.
        # Splitting a first listen across two days shouldn't count as re-engagement.
        replay_rate = play_count / distinct_tracks

        engagement = replay_rate * 5.0 + distinct_days * 1.0
        rating_score = rating * 0.6           # 0–20 → 0–12
        favorite_bonus = 25.0 if favorited else 0.0

        score = engagement + rating_score + favorite_bonus
        if album.get("album_type") == "Single":
            score *= 0.5
        return score

    artist_tiles = []
    for artist, count in sorted(artist_counts.items(), key=lambda item: -item[1])[:9]:
        artist_tiles.append(
            {
                "title": artist,
                "subtitle": f"{count} plays",
                "meta": "Top artist",
                "art_path": artist_art.get(artist),
                "art_key": f"period_artist_{artist}",
            }
        )

    album_tiles = []
    eligible_albums = [(album_id, album) for album_id, album in album_counts.items() if _eligible_album(album_id, album)]
    for album_id, album in sorted(eligible_albums, key=lambda item: -_score(item[0], item[1]))[:16]:
        distinct_days = len(album["days"])
        meta = f"{album['play_count']} plays"
        if distinct_days > 1:
            meta += f" · {distinct_days} days"
        album_tiles.append(
            {
                "title": album["title"],
                "subtitle": album["subtitle"],
                "meta": meta,
                "art_path": album["art_path"],
                "art_key": album["art_key"],
            }
        )

    first_seen: dict[str, datetime] = {}
    for entry in reversed(log):
        if entry.get("artist_names"):
            first_seen.setdefault(entry["artist_names"][0], _parse_played_at(entry["played_at"]))

    new_artist_counts = [
        (artist, count)
        for artist, count in artist_counts.items()
        if start <= first_seen.get(artist, start - timedelta(days=1)) <= end
    ]
    new_artist_counts.sort(key=lambda item: -item[1])
    top_new_artist = None
    if new_artist_counts:
        artist, count = new_artist_counts[0]
        top_new_artist = {"name": artist, "count": count}

    older_entries, _, _ = _entries_for_period(log, mode, offset + 1)
    return {
        "label": label,
        "album_header": album_header,
        "offset": offset,
        "minutes": _format_minutes(total_minutes),
        "plays_label": f"{len(period_entries)} plays",
        "artist_tiles": artist_tiles,
        "album_tiles": album_tiles,
        "top_new_artist": top_new_artist,
        "has_older": len(older_entries) > 0,
    }


def _vinyl_release_year(record: dict) -> int | None:
    year = record.get("original_year")
    if isinstance(year, int):
        return year
    if isinstance(year, str) and year[:4].isdigit():
        return int(year[:4])
    released = str(record.get("released") or "")
    return int(released[:4]) if released[:4].isdigit() else None


def _build_vinyl_timeline_payload(selected_year: int | None) -> dict:
    years: dict[int, dict] = defaultdict(lambda: {"records": []})
    artist_years: dict[str, set[int]] = defaultdict(set)
    for record in load_collection():
        release_year = _vinyl_release_year(record)
        if not release_year:
            continue
        years[release_year]["records"].append(record)
        for artist in record.get("artists") or []:
            artist_years[artist].add(release_year)

    ordered_years = sorted(years)
    bars = [
        {
            "year": year,
            "value": len(years[year]["records"]),
            "plays": 0,
            "albums": len(years[year]["records"]),
            "vinyl": len(years[year]["records"]),
        }
        for year in ordered_years
    ]
    if selected_year not in years:
        selected_year = None

    details: list[dict] = []
    selected_totals = {"vinyl": 0, "albums": 0, "plays": 0}
    if selected_year in years:
        selected_records = sorted(
            years[selected_year]["records"],
            key=lambda record: (", ".join(record.get("artists") or []).lower(), record.get("title", "").lower()),
        )
        selected_totals = {"vinyl": len(selected_records), "albums": len(selected_records), "plays": 0}
        for record in selected_records:
            release_id = str(record.get("release_id") or "")
            artist = ", ".join(record.get("artists") or [])
            formats = " · ".join((record.get("formats") or []) + (record.get("format_descriptions") or [])[:2])
            details.append({
                "source": "vinyl",
                "release_id": record.get("release_id"),
                "album_id": release_id,
                "album_name": record.get("title", ""),
                "artist": artist,
                "count": 1,
                "plays": [],
                "release_year": selected_year,
                "title": record.get("title", ""),
                "subtitle": artist,
                "meta": formats,
                "art_path": record.get("art_path"),
                "art_key": f"timeline_vinyl_{selected_year}_{release_id}",
            })

    summary = "No vinyl release-year data yet."
    if ordered_years:
        summary = f"{ordered_years[0]}–{ordered_years[-1]} · {len(ordered_years)} vinyl release years mapped"

    return {
        "bars": bars,
        "selected_year": selected_year,
        "summary": summary,
        "detail_title": f"Vinyl From {selected_year}" if selected_year is not None else "Select a year",
        "detail_totals": selected_totals,
        "grid_title": f"Vinyl From {selected_year}" if selected_year is not None else "Vinyl",
        "details": details,
        "lib": {},
        "timeline_source": "vinyl",
        "timeline_artist_years": {artist: sorted(values) for artist, values in artist_years.items()},
    }


def build_timeline_payload(log: list[dict], metric: str, selected_year: int | None) -> dict:
    if metric == "Vinyl":
        return _build_vinyl_timeline_payload(selected_year)

    years: dict[int, dict] = defaultdict(lambda: {"plays": 0, "albums": set(), "items": {}})
    for entry in log:
        year = entry.get("release_year")
        if not year:
            continue
        year_info = years[year]
        year_info["plays"] += 1
        year_info["albums"].add(entry["album_id"])
        item = year_info["items"].setdefault(
            entry["album_id"],
            {
                "album_name": entry["album_name"],
                "artist": entry["artist_names"][0] if entry.get("artist_names") else "",
                "plays": 0,
                "play_rows": [],
                "art_path": entry.get("album_art_local_path"),
                "album_id": entry["album_id"],
                "release_year": year,
            },
        )
        item["plays"] += 1
        item["play_rows"].append(entry)

    ordered_years = sorted(years)
    metric_key = "plays" if metric == "Plays" else "albums"
    bars = []
    if ordered_years:
        for year in ordered_years:
            year_info = years[year]
            value = year_info["plays"] if metric_key == "plays" else len(year_info["albums"])
            bars.append({
                "year": year,
                "value": value,
                "plays": year_info["plays"],
                "albums": len(year_info["albums"]),
            })
    if selected_year not in years:
        selected_year = None

    details: list[dict] = []
    selected_totals = {"albums": 0, "plays": 0}
    if selected_year in years:
        selected_totals = {
            "albums": len(years[selected_year]["albums"]),
            "plays": years[selected_year]["plays"],
        }
        ordered_albums = sorted(
            years[selected_year]["items"].values(),
            key=lambda item: (-item["plays"], item["album_name"].lower()),
        )
        for album in ordered_albums:
            details.append(
                {
                    "album_id": album["album_id"],
                    "album_name": album["album_name"],
                    "artist": album["artist"],
                    "count": album["plays"],
                    "plays": album["play_rows"],
                    "release_year": album.get("release_year"),
                    "title": album["album_name"],
                    "subtitle": album["artist"],
                    "meta": f"{album['plays']} plays",
                    "art_path": album["art_path"],
                    "art_key": f"timeline_{selected_year}_{album['album_id']}",
                }
            )

    summary = "No timeline data yet."
    if ordered_years:
        summary = f"{ordered_years[0]}–{ordered_years[-1]} · {len(ordered_years)} release years mapped"

    detail_title = f"Albums From {selected_year}" if selected_year is not None else "Select a year"
    return {
        "bars": bars,
        "selected_year": selected_year,
        "summary": summary,
        "detail_title": detail_title,
        "detail_totals": selected_totals,
        "grid_title": f"Albums From {selected_year}" if selected_year is not None else "Albums",
        "details": details,
        "lib": {},
    }


def build_decade_genre_matrix(log: list[dict], lib: dict) -> dict | None:
    if not log:
        return None
    genre_totals: dict[str, int] = defaultdict(int)
    decade_genre: dict[int, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for entry in log:
        year = entry.get("release_year")
        if not year:
            continue
        decade = (year // 10) * 10
        primary = (entry.get("artist_names") or [""])[0]
        for genre in lib.get("artists", {}).get(primary, {}).get("genres", []):
            genre_totals[genre] += 1
            decade_genre[decade][genre] += 1
    if not genre_totals or not decade_genre:
        return None
    top_genres = [g for g, _ in sorted(genre_totals.items(), key=lambda x: -x[1])[:8]]
    decades = sorted(decade_genre.keys())
    cells = {d: {g: decade_genre[d].get(g, 0) for g in top_genres} for d in decades}
    return {
        "decades": decades,
        "genres": top_genres,
        "cells": cells,
        "decade_totals": {d: sum(decade_genre[d].values()) for d in decades},
        "genre_totals": {g: genre_totals[g] for g in top_genres},
    }


def range_days_from_label(label: str) -> int:
    return {"Month": 30, "Quarter": 90, "Year": 365, "All Time": 0}.get(label, 365)


def _parse_played_at(played_at: str) -> datetime:
    return datetime.fromisoformat(played_at.replace("Z", "+00:00")).astimezone(_TZ)


def _entries_for_period(log: list[dict], mode: str, offset: int) -> tuple[list[dict], datetime, datetime]:
    if not log:
        now = datetime.now(timezone.utc)
        return [], now, now
    latest = _parse_played_at(log[0]["played_at"])
    if mode == "Month":
        year = latest.year
        month = latest.month - offset
        while month <= 0:
            month += 12
            year -= 1
        start = datetime(year, month, 1, tzinfo=timezone.utc)
        if month == 12:
            end = datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(microseconds=1)
        else:
            end = datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(microseconds=1)
    else:
        latest_day = latest.date()
        start_day = latest_day - timedelta(days=latest_day.weekday()) - timedelta(weeks=offset)
        end_day = start_day + timedelta(days=6)
        start = datetime.combine(start_day, datetime.min.time(), tzinfo=timezone.utc)
        end = datetime.combine(end_day, datetime.max.time(), tzinfo=timezone.utc)

    entries = [entry for entry in log if start <= _parse_played_at(entry["played_at"]) <= end]
    return entries, start, end


def _format_period_label(mode: str, start: datetime, end: datetime) -> str:
    if mode == "Month":
        return start.strftime("%B %Y")
    return f"{start.strftime('%b %d')} – {end.strftime('%b %d, %Y')}"


def _format_period_album_header(mode: str, start: datetime, end: datetime) -> str:
    if mode == "Month":
        return f"Top Albums {start.strftime('%B')}"
    return f"Top Albums {start.strftime('%m/%d')} - {end.strftime('%m/%d')}"


def _format_minutes(total_minutes: int) -> str:
    hours, minutes = divmod(total_minutes, 60)
    if hours:
        return f"{hours}h {minutes}m"
    return f"{minutes}m"


def build_era_drift(log: list[dict], n_days: int = 90) -> dict:
    entries = [e for e in log if e.get("played_at") and isinstance(e.get("release_year"), int)]
    if not entries:
        return {"days": [], "points": [], "avg_years": [], "current_avg": 0}
    last_day = max(_parse_played_at(e["played_at"]).date() for e in entries)
    first_day = min(_parse_played_at(e["played_at"]).date() for e in entries)
    start = max(last_day - timedelta(days=n_days - 1), first_day)
    days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
    day_idx = {d: i for i, d in enumerate(days)}
    day_years: list[list[int]] = [[] for _ in days]
    points = []
    for entry in entries:
        dt = _parse_played_at(entry["played_at"])
        d = dt.date()
        if d not in day_idx:
            continue
        year = entry["release_year"]
        idx = day_idx[d]
        day_years[idx].append(year)
        points.append({"i": idx, "year": year})
    daily_avg = [sum(ys) / len(ys) if ys else 0 for ys in day_years]
    avg_years = []
    for i in range(len(days)):
        chunk = [v for v in daily_avg[max(0, i - 6):i + 1] if v]
        avg_years.append(sum(chunk) / len(chunk) if chunk else 0)
    current_avg = round(next((v for v in reversed(avg_years) if v), 0))
    return {
        "days": [d.isoformat() for d in days],
        "points": points,
        "avg_years": avg_years,
        "current_avg": current_avg,
    }


def build_era_release_profile(log: list[dict]) -> dict:
    entries = [e for e in log if isinstance(e.get("release_year"), int)]
    if not entries:
        return {
            "avg_year": 0, "median_year": 0, "min_year": 0, "max_year": 0,
            "total_plays": 0, "album_count": 0, "years": [], "decades": [], "dominant_decade": "",
        }
    year_plays: dict[int, int] = defaultdict(int)
    year_albums: dict[int, set] = defaultdict(set)
    decade_plays: dict[int, int] = defaultdict(int)
    album_ids: set = set()
    weighted_sum = 0
    ordered_years: list[int] = []
    for entry in entries:
        year = entry["release_year"]
        album_id = entry.get("album_id")
        year_plays[year] += 1
        decade_plays[(year // 10) * 10] += 1
        weighted_sum += year
        ordered_years.append(year)
        if album_id:
            year_albums[year].add(album_id)
            album_ids.add(album_id)
    ordered_years.sort()
    mid = len(ordered_years) // 2
    median_year = ordered_years[mid] if len(ordered_years) % 2 else round((ordered_years[mid - 1] + ordered_years[mid]) / 2)
    years_data = [
        {"year": y, "plays": p, "albums": len(year_albums.get(y, set()))}
        for y, p in sorted(year_plays.items())
    ]
    decades_data = [
        {"decade": d, "label": f"{d}s", "plays": p}
        for d, p in sorted(decade_plays.items())
    ]
    dominant = max(decades_data, key=lambda d: d["plays"], default={"label": ""})
    return {
        "avg_year": round(weighted_sum / len(entries)),
        "median_year": median_year,
        "min_year": ordered_years[0],
        "max_year": ordered_years[-1],
        "total_plays": len(entries),
        "album_count": len(album_ids),
        "years": years_data,
        "decades": decades_data,
        "dominant_decade": dominant["label"],
    }


# ── Trends payload builders ───────────────────────────────────────────────────

def _rolling(values: list[float], window: int = 7) -> list[float]:
    out = []
    for i in range(len(values)):
        chunk = values[max(0, i - window + 1): i + 1]
        out.append(sum(chunk) / len(chunk) if chunk else 0.0)
    return out


def build_daily(log: list[dict], n_days: int = 90) -> list[dict]:
    today = date.today()
    start = today - timedelta(days=n_days - 1)
    stats: dict[date, dict] = defaultdict(lambda: {
        "plays": 0, "time_ms": 0, "artists": set(), "albums": set(),
    })
    for entry in log:
        d = _parse_played_at(entry["played_at"]).date()
        if d < start or d > today:
            continue
        s = stats[d]
        s["plays"] += 1
        s["time_ms"] += entry.get("duration_ms", 0)
        for artist in entry.get("artist_names", []):
            s["artists"].add(artist)
        aid = entry.get("album_id")
        if aid:
            s["albums"].add(aid)
    result = []
    d = start
    while d <= today:
        s = stats[d]
        result.append({
            "date":    d.isoformat(),
            "plays":   s["plays"],
            "time_h":  round(s["time_ms"] / 3_600_000, 2),
            "artists": len(s["artists"]),
            "albums":  len(s["albums"]),
        })
        d += timedelta(days=1)
    first_play = next((i for i, r in enumerate(result) if r["plays"] > 0), 0)
    first_month_start = datetime.fromisoformat(result[first_play]["date"]).replace(day=1).date()
    trim = next((i for i, r in enumerate(result) if datetime.fromisoformat(r["date"]).date() >= first_month_start), 0)
    return result[trim:]


def build_depth_sessions(log: list[dict]) -> list[dict]:
    _GAP_SECS = 30 * 60
    entries = sorted(
        [e for e in log if e.get("played_at")],
        key=lambda e: e["played_at"],
    )
    sessions: list[dict] = []
    i = 0
    while i < len(entries):
        e = entries[i]
        n_plays = 1
        albums = {e.get("album_id", "")}
        j = i + 1
        while j < len(entries):
            gap = (_parse_played_at(entries[j]["played_at"]) - _parse_played_at(entries[j - 1]["played_at"])).total_seconds()
            if gap > _GAP_SECS:
                break
            albums.add(entries[j].get("album_id", ""))
            n_plays += 1
            j += 1
        albums.discard("")
        n_albums = max(1, len(albums))
        depth = n_plays / n_albums
        sessions.append({
            "n_plays":  n_plays,
            "n_albums": n_albums,
            "depth":    round(depth, 3),
        })
        i = j
    return sessions


def build_genre_mountain(log: list[dict], lib: dict, top_n: int = 12) -> dict:
    name_to_primary: dict[str, str] = {}
    for name, a in lib.get("artists", {}).items():
        genres = a.get("genres", [])
        if genres:
            name_to_primary[name] = genres[0]

    def _entry_day(entry: dict) -> date:
        return _parse_played_at(entry["played_at"]).date()

    def _cumulative_mode(title: str, subtitle: str, category_for, *, top: int | None = None, label_sort=None) -> dict:
        day_category: dict[date, dict[str, int]] = defaultdict(lambda: defaultdict(int))
        day_total: dict[date, int] = defaultdict(int)
        category_totals: dict[str, int] = defaultdict(int)
        for entry in log:
            d = _entry_day(entry)
            day_total[d] += 1
            category = category_for(entry)
            if category:
                day_category[d][category] += 1
                category_totals[category] += 1
        if not day_total:
            return {"title": title, "subtitle": subtitle, "weeks": [], "labels": [], "cumulative": {}, "total_cum": []}
        ranked = sorted(category_totals.items(), key=lambda x: -x[1])
        labels = [g for g, _ in (ranked[:top] if top else ranked)]
        if label_sort:
            labels = sorted(labels, key=label_sort)
        first_day = min(day_total)
        last_day = max(day_total)
        all_days = [first_day + timedelta(days=i) for i in range((last_day - first_day).days + 1)]
        running = {g: 0 for g in labels}
        running_total = 0
        cumulative: dict[str, list[int]] = {g: [] for g in labels}
        total_cum: list[int] = []
        for d in all_days:
            running_total += day_total.get(d, 0)
            total_cum.append(running_total)
            for g in labels:
                running[g] += day_category[d].get(g, 0)
                cumulative[g].append(running[g])
        origin = all_days[0] - timedelta(days=1)
        all_days = [origin] + all_days
        total_cum = [0] + total_cum
        for g in labels:
            cumulative[g] = [0] + cumulative[g]
        return {
            "title": title, "subtitle": subtitle,
            "weeks": [d.isoformat() for d in all_days],
            "labels": labels,
            "cumulative": cumulative,
            "total_cum": total_cum,
        }

    def genre_for(entry: dict) -> str | None:
        for name in entry.get("artist_names", []):
            g = name_to_primary.get(name)
            if g:
                return g
        return None

    def decade_for(entry: dict) -> str | None:
        year = entry.get("release_year")
        if not isinstance(year, int):
            return None
        return f"{(year // 10) * 10}s"

    def weekday_for(entry: dict) -> str:
        dt = _parse_played_at(entry["played_at"])
        return ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[dt.weekday()]

    def month_for(entry: dict) -> str:
        dt = _parse_played_at(entry["played_at"])
        return dt.strftime("%b %Y")

    def decade_sort(label: str) -> int:
        return int(label[:4]) if label[:4].isdigit() else 9999

    def weekday_sort(label: str) -> int:
        return {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}.get(label, 99)

    def month_sort(label: str) -> tuple[int, int]:
        dt = datetime.strptime(label, "%b %Y")
        return dt.year, dt.month

    genre_mode = _cumulative_mode("Genre Mountain", "cumulative plays · bands = genre composition", genre_for, top=top_n)
    decade_mode = _cumulative_mode("Decade Mountain", "cumulative plays · bands = release decade", decade_for, label_sort=decade_sort)
    weekday_mode = _cumulative_mode("Weekday Mountain", "cumulative plays · bands = day of week", weekday_for, label_sort=weekday_sort)
    month_mode = _cumulative_mode("Timeline Month Mountain", "cumulative plays · bands = calendar month", month_for, label_sort=month_sort)

    return {
        "default_mode": "Genres",
        "modes": {
            "Genres": genre_mode,
            "Decades": decade_mode,
            "Weekday": weekday_mode,
            "Month": month_mode,
        },
    }


def build_discovery_comfort(log: list[dict], n_days: int = 90) -> dict:
    if not log:
        return {"days": [], "new": [], "returning": [], "ratio": [], "cumulative": [], "total_new": 0}
    entries = sorted((e for e in log if e.get("played_at")), key=lambda e: e["played_at"])
    last_day = max(_parse_played_at(e["played_at"]).date() for e in entries)
    start = last_day - timedelta(days=n_days - 1)
    first_real = min(_parse_played_at(e["played_at"]).date() for e in entries)
    start = max(start, first_real.replace(day=1))
    days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
    day_idx = {d: i for i, d in enumerate(days)}
    seen_artists: set[str] = set()
    day_new = [0] * len(days)
    day_returning = [0] * len(days)
    day_artist_seen: list[set[str]] = [set() for _ in days]
    cumulative = [0] * len(days)
    for entry in entries:
        d = _parse_played_at(entry["played_at"]).date()
        raw = entry.get("artist_names") or []
        names = [raw[0]] if raw and raw[0] else []
        in_window = d in day_idx
        if in_window:
            i = day_idx[d]
            for name in names:
                if name in day_artist_seen[i]:
                    continue
                day_artist_seen[i].add(name)
                if name in seen_artists:
                    day_returning[i] += 1
                else:
                    day_new[i] += 1
        for name in names:
            seen_artists.add(name)
        if in_window:
            cumulative[day_idx[d]] = len(seen_artists)
    running = 0
    for i, value in enumerate(cumulative):
        running = max(running, value)
        cumulative[i] = running
    first_active = next((i for i, (n, r) in enumerate(zip(day_new, day_returning)) if n or r), 0)
    if first_active:
        days = days[first_active:]
        day_new = day_new[first_active:]
        day_returning = day_returning[first_active:]
        cumulative = cumulative[first_active:]
    raw_ratio = [day_new[i] / max(day_new[i] + day_returning[i], 1) for i in range(len(days))]
    return {
        "days": [d.isoformat() for d in days],
        "new": day_new,
        "returning": day_returning,
        "ratio": _rolling(raw_ratio, 7),
        "cumulative": cumulative,
        "total_new": max(cumulative) if cumulative else 0,
    }


def build_discovery_comfort_tracks(log: list[dict], n_days: int = 90) -> dict:
    if not log:
        return {"days": [], "new": [], "returning": [], "ratio": [], "cumulative": [], "total_new": 0}
    entries = sorted((e for e in log if e.get("played_at")), key=lambda e: e["played_at"])
    last_day = max(_parse_played_at(e["played_at"]).date() for e in entries)
    start = last_day - timedelta(days=n_days - 1)
    first_real = min(_parse_played_at(e["played_at"]).date() for e in entries)
    start = max(start, first_real.replace(day=1))
    days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
    day_idx = {d: i for i, d in enumerate(days)}
    seen_tracks: set[str] = set()
    day_new = [0] * len(days)
    day_returning = [0] * len(days)
    day_track_seen: list[set[str]] = [set() for _ in days]
    cumulative = [0] * len(days)
    for entry in entries:
        d = _parse_played_at(entry["played_at"]).date()
        track_id = entry.get("track_id")
        if not track_id:
            continue
        in_window = d in day_idx
        if in_window:
            i = day_idx[d]
            if track_id not in day_track_seen[i]:
                day_track_seen[i].add(track_id)
                if track_id in seen_tracks:
                    day_returning[i] += 1
                else:
                    day_new[i] += 1
        seen_tracks.add(track_id)
        if in_window:
            cumulative[day_idx[d]] = len(seen_tracks)
    running = 0
    for i, value in enumerate(cumulative):
        running = max(running, value)
        cumulative[i] = running
    first_active = next((i for i, (n, r) in enumerate(zip(day_new, day_returning)) if n or r), 0)
    if first_active:
        days = days[first_active:]
        day_new = day_new[first_active:]
        day_returning = day_returning[first_active:]
        cumulative = cumulative[first_active:]
    raw_ratio = [day_new[i] / max(day_new[i] + day_returning[i], 1) for i in range(len(days))]
    return {
        "days": [d.isoformat() for d in days],
        "new": day_new,
        "returning": day_returning,
        "ratio": _rolling(raw_ratio, 7),
        "cumulative": cumulative,
        "total_new": max(cumulative) if cumulative else 0,
    }


def build_genre_weather(log: list[dict], lib: dict, n_days: int = 60) -> dict:
    entries = [e for e in log if e.get("played_at")]
    if not entries:
        return {"days": [], "genres": [], "counts": {}, "totals": [], "diversity": [], "leader": ""}
    name_to_primary: dict[str, str] = {}
    for name, artist in (lib or {}).get("artists", {}).items():
        genres = artist.get("genres", [])
        if genres:
            name_to_primary[name] = genres[0]
    last_day = max(_parse_played_at(e["played_at"]).date() for e in entries)
    first_day = min(_parse_played_at(e["played_at"]).date() for e in entries)
    start = max(last_day - timedelta(days=n_days - 1), first_day)
    days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
    day_idx = {d: i for i, d in enumerate(days)}
    day_genre: list[dict[str, int]] = [defaultdict(int) for _ in days]
    genre_totals: dict[str, int] = defaultdict(int)
    for entry in entries:
        d = _parse_played_at(entry["played_at"]).date()
        if d not in day_idx:
            continue
        genre = None
        for name in entry.get("artist_names", []):
            genre = name_to_primary.get(name)
            if genre:
                break
        if not genre:
            genre = "unmapped"
        day_genre[day_idx[d]][genre] += 1
        genre_totals[genre] += 1
    genres = [g for g, _ in sorted(genre_totals.items(), key=lambda x: -x[1]) if g != "unmapped"]
    counts: dict[str, list[int]] = {g: [day_genre[i].get(g, 0) for i in range(len(days))] for g in genres}
    totals = [sum(day_genre[i].values()) for i in range(len(days))]
    diversity = []
    n_genres = max(len(genres), 2)
    for i, total in enumerate(totals):
        if total <= 0:
            diversity.append(0.0)
            continue
        entropy = 0.0
        for genre in genres:
            p = counts[genre][i] / total
            if p > 0:
                entropy -= p * math.log(p)
        diversity.append(entropy / math.log(n_genres))
    return {
        "days": [d.isoformat() for d in days],
        "genres": genres,
        "counts": counts,
        "totals": totals,
        "diversity": _rolling(diversity, 5),
        "leader": genres[0] if genres else "",
    }
