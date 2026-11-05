from __future__ import annotations

import re
from collections import defaultdict


_EDITION = re.compile(
    r"\b(deluxe|remaster(?:ed)?|edition|expanded|version|bonus|anniversary|re-?issue|explicit|clean|"
    r"special|collector'?s?|digital|international|japan(?:ese)?|redux|mono|stereo|u\.s\.|uk|ep|single)\b", re.I)


def normalize_title(s: str) -> str:
    """Spotify lists editions as separate albums: "X", "X (Deluxe Edition)", "X - 2013
    Remaster". Fold those onto one key. Only tags that read as an edition are dropped;
    "(Part II)" or "(Acoustic)" name a different record and stay."""
    s = (s or "").lower()
    s = re.sub(r"\s*[\(\[]([^)\]]*)[\)\]]", lambda m: "" if _EDITION.search(m.group(1)) else m.group(0), s)
    tail = re.search(r"\s+-\s+([^-]*)$", s)
    if tail and _EDITION.search(tail.group(1)):
        s = s[:tail.start()]
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def track_key(entry: dict) -> str:
    """One key per song within an album. Merged editions carry a different Spotify track
    id per edition for the same song, so ids alone would count "Peacebone" twice."""
    return normalize_title(entry.get("track_name", "")) or entry.get("track_id", "")


def heard_count(entries: list[dict], total: int | None) -> int:
    """How many of the album's songs have been heard, for the "heard/total" badge. Demos,
    remixes, live takes and bonus tracks ("Secondary - 2000 Demo", "Heartless - Vapor Wave
    Remix") are real plays and stay in the panel, but they are versions of a song on the
    record, or extras beyond it, so they count toward their base song and the count never
    exceeds the album's own track total."""
    base = {re.sub(r"[^a-z0-9]+", " ", re.split(r"\s+-\s+|\s*[\(\[]", (e.get("track_name") or "").lower())[0]).strip()
            for e in entries if e.get("track_id")}
    base.discard("")
    return min(len(base), total) if total else len(base)


def album_track_plays(plays: list[dict], lib: dict) -> list[dict]:
    """Per-song play counts for an album's panel. Songs are folded by `track_key`; the
    reported track_id is the most-played id (what Open/Play use), favorite is true if any
    of the song's ids is favorited."""
    tracks_lib = lib.get("tracks", {})
    songs: dict[str, dict] = {}
    id_plays: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for entry in plays:
        key = track_key(entry)
        tid = entry["track_id"]
        song = songs.setdefault(key, {
            "track_id": tid,
            "track_name": entry["track_name"],
            "track_number": entry.get("track_number", 0),
            "play_count": 0,
            "is_favorited": False,
        })
        song["play_count"] += 1
        if song["track_number"] is None and entry.get("track_number") is not None:
            song["track_number"] = entry["track_number"]
        song["is_favorited"] = song["is_favorited"] or bool(tracks_lib.get(tid, {}).get("favorited", False))
        id_plays[key][tid] += 1
    for key, song in songs.items():
        song["track_id"] = max(id_plays[key], key=lambda i: (id_plays[key][i], i))
    return sorted(
        songs.values(),
        key=lambda x: (x["track_number"] is None, x["track_number"], x["track_name"]),
    )


def find_edition_duplicates(entries: list[dict], aliases: dict | None = None) -> dict[str, str]:
    """Album ids that are the same record under another Spotify edition: same primary
    artist, same title once edition tags are stripped, same track count (both known).
    Returns {duplicate_id: canonical_id}; canonical is the most-played id, preferring a
    real Spotify id over an imported placeholder. Ids already aliased are skipped."""
    plays: dict[tuple, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for e in entries:
        aid = e.get("album_id")
        total = e.get("album_total_tracks")
        if not aid or total is None or (aliases and aid in aliases) or not e.get("artist_names"):
            continue
        key = (normalize_title(e["artist_names"][0]), normalize_title(e.get("album_name", "")), total)
        plays[key][aid] += 1
    out: dict[str, str] = {}
    for ids in plays.values():
        if len(ids) < 2:
            continue
        canon = max(ids, key=lambda i: (not i.startswith("imp_"), ids[i], i))
        for i in ids:
            if i != canon:
                out[i] = canon
    return out


def build_album_index(log: list[dict]) -> dict[str, dict]:
    albums: dict[str, dict] = {}
    for entry in log:
        album_id = entry["album_id"]
        artist = entry["artist_names"][0] if entry["artist_names"] else ""
        info = albums.setdefault(
            album_id,
            {
                "album_id": album_id,
                "album_name": entry["album_name"],
                "artist": artist,
                "art_path": entry.get("album_art_local_path"),
                "release_year": entry.get("release_year"),
                "album_type": entry.get("album_type"),
                "album_total_tracks": entry.get("album_total_tracks"),
                "latest_played": entry["played_at"],
                "count": 0,
                "plays": [],
            },
        )
        info["count"] += 1
        info["plays"].append(entry)
        info["first_played"] = entry["played_at"]   # log is newest first: the last one seen is the oldest
    for info in albums.values():
        info["heard_tracks"] = heard_count(info["plays"], info.get("album_total_tracks"))
    return albums


def build_artist_catalog(log: list[dict]) -> dict[str, dict]:
    counts: dict[str, int] = defaultdict(int)
    artist_albums: dict[str, dict[str, dict]] = defaultdict(dict)
    latest_played: dict[str, str] = {}
    first_played: dict[str, str] = {}
    min_year: dict[str, int] = {}
    for entry in log:
        if not entry.get("artist_names"):
            continue
        primary = entry["artist_names"][0]
        counts[primary] += 1
        latest_played.setdefault(primary, entry["played_at"])
        first_played[primary] = entry["played_at"]

        year = entry.get("release_year")
        if year and (primary not in min_year or year < min_year[primary]):
            min_year[primary] = year

        album_id = entry["album_id"]
        if album_id not in artist_albums[primary]:
            artist_albums[primary][album_id] = {
                "album_id": album_id,
                "art_path": entry.get("album_art_local_path"),
                "count": 0,
                "latest_played": entry["played_at"],
            }
        artist_albums[primary][album_id]["count"] += 1

    return {
        "counts": dict(counts),
        "albums": {name: dict(albums) for name, albums in artist_albums.items()},
        "latest_played": latest_played,
        "first_played": first_played,
        "min_year": min_year,
    }
