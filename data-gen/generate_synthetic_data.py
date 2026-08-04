"""
Stage 2 of the synthetic data pipeline: fully self-contained, no dependency on any
real data directory. Reads data/catalog_seed.json (real catalog vocabulary, zero
behavioral data) plus config.py's tunables, and produces the 6 JSON files the real
app's persistence layer expects — all values in this stage are synthetic, generated
from a statistical "plausible listener" model with zero derivation from any real
listening behavior.

Deterministic: re-running with the same config produces byte-identical output.
"""
from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import (
    BEHAVIOR_SEED,
    TIMESPAN_MONTHS,
    AVG_PLAYS_PER_DAY,
    ARTIST_ZIPF_EXPONENT,
    GENRE_DRIFT_ERAS,
    ALBUM_RATING_FRACTION,
    VINYL_COVERAGE_FRACTION,
    HANDWRITTEN_NOTES_COUNT,
)

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "data" / "catalog_seed.json"
OUT_DIR = ROOT / "data"

HANDWRITTEN_NOTES = [
    "Didn't expect to like this as much as I did. Kept it on repeat for a week.",
    "Grower, not a shower. Took three listens before it clicked.",
    "Perfect for late-night drives. The production really opens up on good speakers.",
    "First half is stronger than the back half, but worth it for the singles alone.",
    "Recommended by a friend, wasn't sure at first — now can't stop coming back to it.",
    "The kind of record that rewards headphones. Missed so much on tiny speakers.",
    "Solid front-to-back, no skips. Rare these days.",
    "Weird pacing but the highs are genuinely high.",
    "Been meaning to give this a proper relisten — revisiting after a couple years.",
    "One of those albums that sounds better with every listen.",
    "Mood music. Not for every day, but perfect when it fits.",
    "Discovered through a genre rabbit hole and glad I did.",
]

DEVICES = [
    ("Web Player (Chrome)", "Computer", 0.35),
    ("iPhone", "Smartphone", 0.30),
    ("Desktop App", "Computer", 0.25),
    ("Living Room Speaker", "Speaker", 0.10),
]

CONTEXT_CHOICES = [
    ("album", 0.45),
    ("playlist", 0.30),
    ("artist", 0.10),
    ("collection", 0.05),
    (None, 0.10),
]


def weighted_choice(rng: random.Random, choices):
    items, weights = zip(*[(c[0], c[1]) for c in choices])
    return rng.choices(items, weights=weights, k=1)[0]


def load_seed() -> dict:
    if not SEED_PATH.exists():
        raise SystemExit(f"No {SEED_PATH} — run export_catalog_seed.py first.")
    with SEED_PATH.open() as f:
        return json.load(f)


def assign_genre_eras(rng: random.Random, artists: list[dict], n_eras: int) -> dict[str, int]:
    """Deterministically split distinct primary genres across eras for genre drift."""
    primary_genres = sorted({(a["genres"][0] if a["genres"] else "unknown") for a in artists})
    rng.shuffle(primary_genres)
    era_of_genre = {}
    for i, g in enumerate(primary_genres):
        era_of_genre[g] = i % n_eras
    return era_of_genre


def era_weight(artist: dict, era: int, era_of_genre: dict[str, int]) -> float:
    primary = artist["genres"][0] if artist["genres"] else "unknown"
    return 2.0 if era_of_genre.get(primary) == era else 0.5


def daypart_time(rng: random.Random, day: datetime, is_weekend: bool) -> datetime:
    if is_weekend:
        windows = [((11, 16), 0.5), ((19, 23), 0.5)]
    else:
        windows = [((7, 9), 0.3), ((12, 13), 0.1), ((18, 23), 0.6)]
    start_h, end_h = weighted_choice(rng, windows)
    start_minutes = start_h * 60
    end_minutes = end_h * 60
    minute = rng.randint(start_minutes, max(start_minutes, end_minutes - 1))
    return day.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(minutes=minute)


def session_length(rng: random.Random, remaining: int) -> int:
    # geometric-ish: mostly short sessions, occasional long album-through listens
    length = 1
    while rng.random() < 0.72 and length < 16:
        length += 1
    return min(length, remaining)


def make_context_uri(rng: random.Random, ctx_type: str | None, album_id: str, playlist_ids: list[str], artist_id: str | None) -> str | None:
    if ctx_type == "album":
        return f"spotify:album:{album_id}"
    if ctx_type == "playlist" and playlist_ids:
        return f"spotify:playlist:{rng.choice(playlist_ids)}"
    if ctx_type == "artist" and artist_id:
        return f"spotify:artist:{artist_id}"
    if ctx_type == "collection":
        return "spotify:collection:tracks"
    return None


def fmt_duration(ms: int | None) -> str:
    if not ms:
        return ""
    total_sec = ms // 1000
    return f"{total_sec // 60}:{total_sec % 60:02d}"


def main() -> None:
    seed_data = load_seed()
    artists = seed_data["artists"]
    if not artists:
        raise SystemExit("catalog_seed.json has no artists — nothing to generate from.")

    rng = random.Random(BEHAVIOR_SEED)

    # ── Rank artists by a fixed shuffle, assign Zipf base weights ──────────
    ranked_artists = artists[:]
    rng.shuffle(ranked_artists)
    base_weight = {
        a["artist_name"]: 1.0 / ((i + 1) ** ARTIST_ZIPF_EXPONENT)
        for i, a in enumerate(ranked_artists)
    }
    artist_by_name = {a["artist_name"]: a for a in artists}

    era_of_genre = assign_genre_eras(rng, artists, GENRE_DRIFT_ERAS)

    # ── Timespan ─────────────────────────────────────────────────────────
    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    total_days = round(TIMESPAN_MONTHS * 30.44)
    start_date = end_date - timedelta(days=total_days)

    # ── Pick a small set of "sticky partial" albums from the final era ────
    # (kept below 100% catalog completion on purpose, to show the "still
    # working through this album" UI state rather than everything pruned).
    final_era_candidates = [
        (a["artist_name"], al["album_id"])
        for a in artists
        for al in a["albums"]
        if len(al["tracks"]) >= 4 and era_of_genre.get(a["genres"][0] if a["genres"] else "unknown") == GENRE_DRIFT_ERAS - 1
    ]
    rng.shuffle(final_era_candidates)
    partial_albums = {album_id for _, album_id in final_era_candidates[:4]}

    # ── Generate synthetic playlists up front (need ids for context_uri) ──
    n_playlists = 4
    playlist_ids = [f"pl-{rng.randrange(10**8, 10**9)}" for _ in range(n_playlists)]

    # ── Simulate day by day ────────────────────────────────────────────────
    log_entries = []
    play_counts_by_track: dict[str, int] = {}
    play_counts_by_album: dict[str, int] = {}
    play_counts_by_artist: dict[str, int] = {}
    album_of_track: dict[str, str] = {}
    artist_of_album: dict[str, str] = {}

    day = start_date
    day_index = 0
    while day < end_date:
        is_weekend = day.weekday() >= 5
        era = min(day_index // max(1, total_days // GENRE_DRIFT_ERAS), GENRE_DRIFT_ERAS - 1)

        day_multiplier = 1.15 if is_weekend else 1.0
        plays_today = max(0, round(rng.gauss(AVG_PLAYS_PER_DAY * day_multiplier, AVG_PLAYS_PER_DAY * 0.3)))

        remaining = plays_today
        current_time = None
        while remaining > 0:
            weights = [
                base_weight[a["artist_name"]] * era_weight(a, era, era_of_genre)
                for a in artists
            ]
            artist = rng.choices(artists, weights=weights, k=1)[0]
            if not artist["albums"]:
                remaining -= 1
                continue
            album = rng.choice(artist["albums"])
            tracks = album["tracks"]
            if not tracks:
                remaining -= 1
                continue

            eligible_tracks = tracks
            if album["album_id"] in partial_albums:
                cutoff = max(1, int(len(tracks) * 0.6))
                eligible_tracks = tracks[:cutoff]

            n = min(session_length(rng, remaining), len(eligible_tracks))
            start_idx = rng.randrange(0, max(1, len(eligible_tracks) - n + 1))
            session_tracks = eligible_tracks[start_idx:start_idx + n]

            session_start = daypart_time(rng, day, is_weekend)
            t = session_start
            ctx_type = weighted_choice(rng, CONTEXT_CHOICES)
            device_name, device_type, _ = rng.choices(DEVICES, weights=[d[2] for d in DEVICES], k=1)[0]
            shuffle_state = rng.random() < 0.35

            for track in session_tracks:
                artist_ids = [artist["artist_id"]] if artist.get("artist_id") else []
                entry = {
                    "played_at": t.isoformat().replace("+00:00", "Z"),
                    "track_name": track["track_name"],
                    "artist_names": album.get("artist_names") or [artist["artist_name"]],
                    "artist_ids": artist_ids,
                    "album_name": album["album_name"],
                    "track_id": track["track_id"],
                    "album_id": album["album_id"],
                    "duration_ms": track["duration_ms"],
                    "explicit": False,
                    "isrc": track.get("isrc"),
                    "album_type": album.get("album_type"),
                    "album_total_tracks": album.get("album_total_tracks"),
                    "album_art_url": album.get("album_art_url"),
                    "album_art_local_path": album.get("local_artwork"),
                    "release_year": album.get("release_year"),
                    "track_number": track.get("track_number"),
                    "context_type": ctx_type,
                    "context_uri": make_context_uri(rng, ctx_type, album["album_id"], playlist_ids, artist.get("artist_id")),
                    "device_name": device_name,
                    "device_type": device_type,
                    "shuffle_state": shuffle_state,
                }
                log_entries.append(entry)

                play_counts_by_track[track["track_id"]] = play_counts_by_track.get(track["track_id"], 0) + 1
                play_counts_by_album[album["album_id"]] = play_counts_by_album.get(album["album_id"], 0) + 1
                play_counts_by_artist[artist["artist_name"]] = play_counts_by_artist.get(artist["artist_name"], 0) + 1
                album_of_track[track["track_id"]] = album["album_id"]
                artist_of_album[album["album_id"]] = artist["artist_name"]

                gap_s = rng.expovariate(1 / 15) if rng.random() < 0.15 else 0
                t = t + timedelta(milliseconds=track["duration_ms"] or 200_000) + timedelta(seconds=gap_s)

            remaining -= n

        day += timedelta(days=1)
        day_index += 1

    log_entries.sort(key=lambda e: e["played_at"])

    # ── catalog.json: partial/heard state for albums that got any plays ───
    catalog_out = {}
    for a in artists:
        for al in a["albums"]:
            album_id = al["album_id"]
            if album_id not in play_counts_by_album:
                continue
            played_track_ids = {
                e["track_id"] for e in log_entries if e["album_id"] == album_id
            }
            all_track_ids = {t["track_id"] for t in al["tracks"]}
            if played_track_ids >= all_track_ids and album_id not in partial_albums:
                continue  # fully heard -> pruned, matches real behavior
            catalog_out[album_id] = {
                "tracks": {
                    t["track_id"]: {
                        "track_name": t["track_name"],
                        "track_number": t.get("track_number"),
                        "duration_ms": t.get("duration_ms"),
                        "isrc": t.get("isrc"),
                        "heard": t["track_id"] in played_track_ids,
                    }
                    for t in al["tracks"]
                }
            }

    # ── library.json ───────────────────────────────────────────────────────
    played_album_ids = list(play_counts_by_album.keys())
    rng.shuffle(played_album_ids)
    rated_count = round(len(played_album_ids) * ALBUM_RATING_FRACTION)
    rated_albums = set(played_album_ids[:rated_count])

    notes_pool = HANDWRITTEN_NOTES[:]
    rng.shuffle(notes_pool)
    noted_albums = played_album_ids[:HANDWRITTEN_NOTES_COUNT]

    top_albums_by_plays = sorted(play_counts_by_album, key=lambda k: -play_counts_by_album[k])
    favorited_album_ids = set(top_albums_by_plays[:max(1, len(top_albums_by_plays) // 6)])

    library_albums = {}
    for album_id in played_album_ids:
        entry = {}
        if album_id in rated_albums:
            entry["rating"] = rng.choices([2, 3, 4, 5], weights=[0.1, 0.25, 0.35, 0.3], k=1)[0]
        if album_id in noted_albums:
            entry["notes"] = notes_pool[noted_albums.index(album_id) % len(notes_pool)]
        if album_id in favorited_album_ids:
            entry["favorited"] = True
        if entry:
            library_albums[album_id] = entry

    top_artists_by_plays = sorted(play_counts_by_artist, key=lambda k: -play_counts_by_artist[k])
    favorited_artists = set(top_artists_by_plays[:max(1, len(top_artists_by_plays) // 8)])
    revisit_artists = set(rng.sample(
        [a for a in play_counts_by_artist if a not in favorited_artists],
        k=min(5, max(0, len(play_counts_by_artist) - len(favorited_artists))),
    ))
    library_artists = {}
    for name in play_counts_by_artist:
        entry = {"genres": artist_by_name[name]["genres"][:5]}
        if name in favorited_artists:
            entry["favorited"] = True
        if name in revisit_artists:
            entry["revisit"] = True
        library_artists[name] = entry

    top_tracks_by_plays = sorted(play_counts_by_track, key=lambda k: -play_counts_by_track[k])
    favorited_tracks = set(top_tracks_by_plays[:max(1, len(top_tracks_by_plays) // 10)])
    library_tracks = {tid: {"favorited": True} for tid in favorited_tracks}

    decades: dict[str, int] = {}
    for album_id in played_album_ids:
        artist_name = artist_of_album.get(album_id)
        album = next((al for al in artist_by_name[artist_name]["albums"] if al["album_id"] == album_id), None)
        year = album.get("release_year") if album else None
        if year:
            decade = f"{(year // 10) * 10}s"
            decades[decade] = decades.get(decade, 0) + 1

    library_out = {
        "albums": library_albums,
        "artists": library_artists,
        "tracks": library_tracks,
        "album_tops": {"decades": decades},
    }

    # ── playlists.json ───────────────────────────────────────────────────
    playlist_names = ["Heavy Rotation", "Late Night", "Discovery Pile", "Sunday Morning"]
    now_iso = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    playlists_out = []
    for pid, pname in zip(playlist_ids, playlist_names):
        pinned = rng.sample(top_tracks_by_plays, k=min(10, len(top_tracks_by_plays)))
        playlists_out.append({
            "id": pid,
            "name": pname,
            "created_at": now_iso,
            "updated_at": now_iso,
            "rule_groups": [],
            "pinned_track_ids": pinned,
            "excluded_track_ids": [],
        })

    # ── discogs_collection.json + vinyl_links.json ─────────────────────────
    target_vinyl_count = round(len(played_album_ids) * VINYL_COVERAGE_FRACTION)
    with_real_discogs = [
        aid for aid in played_album_ids
        if any(al["album_id"] == aid and "discogs_catalog" in al for a in artists for al in a["albums"])
    ]
    without_real_discogs = [aid for aid in played_album_ids if aid not in with_real_discogs]
    rng.shuffle(without_real_discogs)
    vinyl_album_ids = (with_real_discogs + without_real_discogs)[:target_vinyl_count]

    def find_album(album_id: str):
        for a in artists:
            for al in a["albums"]:
                if al["album_id"] == album_id:
                    return a, al
        return None, None

    discogs_out = []
    confirmed_links = []
    next_synthetic_release_id = 9_000_000

    for i, album_id in enumerate(vinyl_album_ids):
        artist, album = find_album(album_id)
        real_catalog = album.get("discogs_catalog")

        if real_catalog:
            release_id = real_catalog["release_id"]
            base = dict(real_catalog)
            # Reuse the same album's real Spotify art rather than the real
            # Discogs-hosted image, per the art-sourcing decision.
            local_or_remote_art = album.get("local_artwork") or album.get("album_art_url")
            base["thumb"] = local_or_remote_art
            base["cover_image"] = local_or_remote_art
        else:
            release_id = next_synthetic_release_id
            next_synthetic_release_id += 1
            primary_genre = (artist["genres"][0].title() if artist["genres"] else "Rock")
            base = {
                "release_id": release_id,
                "master_id": None,
                "title": album["album_name"],
                "artists": album.get("artist_names") or [artist["artist_name"]],
                "year": album.get("release_year"),
                "released": None,
                "country": None,
                "labels": ["Independent"],
                "catnos": [],
                "genres": [primary_genre],
                "styles": [],
                "formats": ["Vinyl"],
                "format_descriptions": ["LP", "Album"],
                "thumb": album.get("local_artwork") or album.get("album_art_url"),
                "cover_image": album.get("local_artwork") or album.get("album_art_url"),
                "tracklist": [
                    {
                        "position": str(t.get("track_number") or idx + 1),
                        "title": t["track_name"],
                        "duration": fmt_duration(t.get("duration_ms")),
                    }
                    for idx, t in enumerate(album["tracks"])
                ],
                "community_have": rng.randint(5, 400),
                "community_want": rng.randint(1, 200),
                "community_rating_avg": round(rng.uniform(3.0, 4.8), 2),
                "community_rating_count": rng.randint(1, 150),
                "barcode": None,
                "matrix": None,
            }

        days_into_span = rng.randint(0, total_days)
        date_added = (start_date + timedelta(days=days_into_span)).isoformat().replace("+00:00", "Z")
        user_rating = rng.choices([0, 3, 4, 5], weights=[0.6, 0.15, 0.15, 0.1], k=1)[0]
        notes = ""
        if rng.random() < 0.15:
            notes = notes_pool[i % len(notes_pool)]

        record = {
            **base,
            "instance_id": 100_000 + i,
            "release_id": release_id,
            "date_added": date_added,
            "user_rating": user_rating,
            "folder_id": 1,
            "art_path": None,
            "notes": notes,
            "original_year": None,
        }
        discogs_out.append(record)
        confirmed_links.append({"release_id": release_id, "album_id": album_id})

    dismissed_links = []
    other_albums = [aid for aid in played_album_ids if aid not in vinyl_album_ids]
    for i in range(min(2, len(other_albums))):
        dismissed_links.append({
            "release_id": next_synthetic_release_id + i,
            "album_id": other_albums[i],
        })

    vinyl_links_out = {"confirmed": confirmed_links, "dismissed": dismissed_links}

    # ── write everything ────────────────────────────────────────────────
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with (OUT_DIR / "listening_log.json").open("w") as f:
        json.dump(log_entries, f, indent=2)
    with (OUT_DIR / "catalog.json").open("w") as f:
        json.dump(catalog_out, f, indent=2)
    with (OUT_DIR / "library.json").open("w") as f:
        json.dump(library_out, f, indent=2)
    with (OUT_DIR / "playlists.json").open("w") as f:
        json.dump(playlists_out, f, indent=2)
    with (OUT_DIR / "vinyl_links.json").open("w") as f:
        json.dump(vinyl_links_out, f, indent=2)
    with (OUT_DIR / "discogs_collection.json").open("w") as f:
        json.dump(discogs_out, f, indent=2)

    print(f"listening_log.json: {len(log_entries)} plays")
    print(f"catalog.json: {len(catalog_out)} partially-completed albums")
    print(f"library.json: {len(library_albums)} rated/noted/favorited albums, {len(library_artists)} artists, {len(library_tracks)} favorited tracks")
    print(f"playlists.json: {len(playlists_out)} playlists")
    print(f"discogs_collection.json / vinyl_links.json: {len(discogs_out)} vinyl records")


if __name__ == "__main__":
    main()
