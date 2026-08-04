from __future__ import annotations

from collections import Counter
from datetime import timezone

from insights.stats_insights import build_sessions_data, _parse_played_at, _TZ


def _match_condition(condition: dict, track: dict, lib: dict, session_track_ids: set[str]) -> bool:
    field = condition.get("field")
    op = condition.get("op", "eq")
    value = condition.get("value")
    values = condition.get("values", [])

    if field == "artist":
        artist_names = [a.lower() for a in track.get("artist_names", [])]
        if op == "eq":
            return value.lower() in artist_names
        if op == "in":
            return any(v.lower() in artist_names for v in values)
        if op == "all":
            return all(v.lower() in artist_names for v in values)

    elif field == "album":
        album = track.get("album_name", "").lower()
        if op == "eq":
            return album == value.lower()
        if op == "in":
            return album in [v.lower() for v in values]
        if op == "all":
            return all(album == v.lower() for v in values)

    elif field == "genre":
        artist = track.get("artist_names", [""])[0]
        genres = [g.lower() for g in lib.get("artists", {}).get(artist, {}).get("genres", [])]
        if op == "eq":
            return value.lower() in genres
        if op == "in":
            return any(v.lower() in genres for v in values)
        if op == "all":
            return all(v.lower() in genres for v in values)

    elif field == "track":
        name = track.get("track_name", "").lower()
        if op == "eq":
            return name == value.lower()
        if op == "in":
            return name in [v.lower() for v in values]
        if op == "all":
            return all(name == v.lower() for v in values)

    elif field == "favorited":
        track_id = track.get("track_id", "")
        is_fav = lib.get("tracks", {}).get(track_id, {}).get("favorited", False)
        return is_fav == value

    elif field == "session_id":
        return track.get("track_id") in session_track_ids

    elif field == "release_year":
        year = track.get("release_year")
        if year is None:
            return False
        if op == "eq":
            return year == int(value)
        if op == "range":
            return int(condition.get("from", 0)) <= year <= int(condition.get("to", 9999))

    elif field == "month":
        played_at = track.get("played_at", "")
        try:
            dt = _parse_played_at(played_at)
            month_str = dt.strftime("%B").lower()  # e.g. "april"
            month_num = dt.month
        except Exception:
            return False
        if op == "eq":
            return month_str == value.lower() or month_num == value
        if op == "in":
            return any(month_str == v.lower() or month_num == v for v in values)

    return False


def _match_group(group: dict, track: dict, lib: dict, session_track_ids: set[str]) -> bool:
    conditions = group.get("conditions", [])
    if not conditions:
        return False
    return all(_match_condition(c, track, lib, session_track_ids) for c in conditions)


def _build_session_lookup(playlist: dict, log: list[dict]) -> set[str]:
    """For any session_id conditions, build a set of track_ids that belong to those sessions."""
    needed_session_ids: set[str] = set()
    for group in playlist.get("rule_groups", []):
        for cond in group.get("conditions", []):
            if cond.get("field") == "session_id":
                needed_session_ids.add(cond.get("value", ""))

    if not needed_session_ids:
        return set()

    # Build sessions over all time (days=0 means all)
    sessions = build_sessions_data(log, days=0)
    track_ids: set[str] = set()
    for s in sessions:
        if s["id"] in needed_session_ids:
            for t in s.get("tracks", []):
                track_ids.add(t.get("track_id", ""))
    return track_ids


def evaluate_playlist(playlist: dict, log: list[dict], lib: dict) -> list[dict]:
    """
    Returns deduplicated list of track dicts matching the playlist rules,
    with manual pins added and exclusions removed.
    Rules: groups are OR'd, conditions within a group are AND'd.
    Manual inclusions/exclusions take priority over rules.
    """
    rule_groups = playlist.get("rule_groups", [])
    pinned_ids = set(playlist.get("pinned_track_ids", []))
    excluded_ids = set(playlist.get("excluded_track_ids", []))
    session_track_ids = _build_session_lookup(playlist, log)

    # Deduplicate log by track_id, keeping most recent play per track
    seen_track_ids: set[str] = set()
    unique_tracks: list[dict] = []
    for entry in log:
        tid = entry.get("track_id", "")
        if tid and tid not in seen_track_ids:
            seen_track_ids.add(tid)
            unique_tracks.append(entry)

    result: list[dict] = []
    result_ids: set[str] = set()

    if rule_groups:
        for track in unique_tracks:
            tid = track.get("track_id", "")
            if tid in excluded_ids:
                continue
            if any(_match_group(g, track, lib, session_track_ids) for g in rule_groups):
                if tid not in result_ids:
                    result.append(track)
                    result_ids.add(tid)

    # Add pinned tracks not already in result
    pinned_map = {t.get("track_id"): t for t in unique_tracks}
    for tid in pinned_ids:
        if tid not in result_ids and tid not in excluded_ids and tid in pinned_map:
            result.append(pinned_map[tid])
            result_ids.add(tid)

    # Attach play count per track
    play_counts: dict[str, int] = Counter(e.get("track_id") for e in log)
    for track in result:
        track = track.copy()
        track["_play_count"] = play_counts.get(track.get("track_id", ""), 0)
        track["_pinned"] = track.get("track_id") in pinned_ids

    # Re-attach metadata
    enriched = []
    play_counts_map: dict[str, int] = Counter(e.get("track_id") for e in log)
    for track in result:
        t = dict(track)
        t["_play_count"] = play_counts_map.get(t.get("track_id", ""), 0)
        t["_pinned"] = t.get("track_id") in pinned_ids
        enriched.append(t)

    return enriched


def get_all_sessions(log: list[dict]) -> list[dict]:
    """Returns all sessions with id, label, track_count for use in typeahead."""
    sessions = build_sessions_data(log, days=0)
    result = []
    for s in sessions:
        start = s["start"]
        date_label = start.astimezone(_TZ).strftime("%a %b %-d")
        time_label = start.astimezone(_TZ).strftime("%-I:%M %p")
        duration_minutes = round(s.get("duration_minutes", 0))
        if duration_minutes >= 60:
            hours, minutes = divmod(duration_minutes, 60)
            duration_label = f"{hours}h {minutes}m" if minutes else f"{hours}h"
        else:
            duration_label = f"{duration_minutes}m"
        top_artist = s.get("top_artist") or "Unknown artist"
        result.append({
            "id": s["id"],
            "label": f"{date_label} · {time_label} · {s['track_count']} tracks · {duration_label} · {top_artist}",
            "track_count": s["track_count"],
        })
    return result
