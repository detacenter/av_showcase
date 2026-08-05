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
import math
import random
import uuid
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import (
    BEHAVIOR_SEED,
    TIMESPAN_MONTHS,
    AVG_PLAYS_PER_DAY,
    ARTIST_ZIPF_EXPONENT,
    GENRE_DRIFT_ERAS,
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


def assign_genre_eras(artists: list[dict], n_eras: int) -> dict[str, int]:
    """Split distinct primary genres into contiguous eras ordered by the
    genre's own average catalog release year — not a random shuffle — so the
    active era's artists have a genuinely different average release year and
    the "drift" over time is a real, guaranteed trend rather than an
    incidental (and in practice nearly invisible) correlation. Session 5:
    caught via a real browser screenshot showing an almost perfectly flat
    drift line despite this mechanic supposedly driving it."""
    genre_years: dict[str, list[int]] = defaultdict(list)
    for a in artists:
        primary = a["genres"][0] if a["genres"] else "unknown"
        for al in a["albums"]:
            if al.get("release_year"):
                genre_years[primary].append(al["release_year"])
    avg_year = {g: sum(ys) / len(ys) for g, ys in genre_years.items() if ys}
    all_genres = sorted({(a["genres"][0] if a["genres"] else "unknown") for a in artists})
    ordered = sorted(all_genres, key=lambda g: avg_year.get(g, 2000))
    era_of_genre = {}
    band_size = max(1, len(ordered) / n_eras)
    for i, g in enumerate(ordered):
        era_of_genre[g] = min(n_eras - 1, int(i / band_size))
    return era_of_genre


def era_weight(artist: dict, era: int, era_of_genre: dict[str, int]) -> float:
    # Mild lean (previously an extreme 50x ratio) — real listening mixes
    # decades broadly within any given period (checked against the real
    # app's own listening_log.json: per-play release-year stdev of 12-17
    # years within a single month), so eras should nudge, not lock. Session
    # 5, second pass — the first attempt at strengthening this overcorrected
    # into an artificial, unrealistically clean drift.
    primary = artist["genres"][0] if artist["genres"] else "unknown"
    return 2.2 if era_of_genre.get(primary) == era else 0.7


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
    # Weight also factors in catalog depth (session 5) — without this, an
    # artist who happens to land the #1 Zipf rank by pure shuffle luck but
    # has a tiny catalog (in the worst real case found: 1 album, 1 track)
    # gets hammered picked over and over, since a 1-track "session" barely
    # drains the day's remaining play budget, so the outer loop just rolls
    # again — one album ended up with 547 of ~4750 total plays, visible as
    # an impossible flat line in the Drift chart. sqrt-scaled and capped so
    # it only meaningfully discounts genuinely small catalogs (<8 tracks),
    # not a mild penalty for every non-prolific artist.
    ranked_artists = artists[:]
    rng.shuffle(ranked_artists)
    track_count = {
        a["artist_name"]: sum(len(al["tracks"]) for al in a["albums"])
        for a in artists
    }
    base_weight = {
        a["artist_name"]: (1.0 / ((i + 1) ** ARTIST_ZIPF_EXPONENT))
        * min(1.0, (max(1, track_count[a["artist_name"]]) / 8) ** 0.5)
        for i, a in enumerate(ranked_artists)
    }
    artist_by_name = {a["artist_name"]: a for a in artists}

    # Real per-album ratings, carried over verbatim from catalog_seed.json (the
    # one deliberate behavioral-data exception — see export_catalog_seed.py's
    # docstring and PRJ-0005 session log, session 5). Only albums the user
    # actually rated in real life show up here; nothing here is synthesized.
    album_real_rating = {
        al["album_id"]: al["real_rating"]
        for a in artists for al in a["albums"] if al.get("real_rating")
    }

    era_of_genre = assign_genre_eras(artists, GENRE_DRIFT_ERAS)

    # ── Timespan ─────────────────────────────────────────────────────────
    end_date = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    total_days = round(TIMESPAN_MONTHS * 30.44)
    start_date = end_date - timedelta(days=total_days)

    # ── Artist introduction schedule (session 5) ────────────────────────────
    # Without this, nearly every artist gets sampled within the first couple
    # weeks — a few thousand plays drawn from only 200 artists exhausts the
    # pool fast — so "new artist" discovery events cluster entirely at the
    # start instead of spreading across the whole window like real discovery
    # does. Caught via a real browser screenshot of the Discovery Balance
    # chart showing almost no "new" activity past the first couple weeks.
    # Top-ranked artists form the immediate "core rotation" (always
    # available); the rest unlock on a random day spread across most of the
    # timespan, so new-artist events keep happening throughout instead of
    # concentrating early.
    #
    # Session 5, sixth pass: this was previously capped to the first ~40% of
    # the timespan — an earlier attempt at spreading across the *full* span
    # (under the old, narrower 200-artist catalog) had starved overall
    # coverage (~192/200 -> ~124/200 artists ever played), since a
    # late-unlocking artist needs real runway to actually get sampled. But
    # capping at 40% has its own real cost, invisible until checked directly:
    # every artist's *first-ever* appearance ends up crammed into the first
    # ~108 of 270 days, so any trailing window (e.g. Trends' default "last 3
    # months") shows literally zero new-artist events for its entire span —
    # not thin, exactly zero, every day — because discovery has already
    # structurally finished. Now that the catalog is 362 artists (up from
    # 200) with healthy 360/362 coverage even before this change, there's
    # real headroom to widen this back out — leaving ~15% of the timespan as
    # a tail so a late unlock still gets some runway, rather than 0%.
    # Own seeded stream (session 5, seventh pass) — this used to draw from the
    # shared `rng`, which meant every tuning attempt on the unlock spread also
    # silently reshuffled every *other* random decision in the whole
    # simulation (day volume, artist picks, track selection — all downstream
    # of the same stream), making the effect of any single change unpredictable
    # and hard to reason about. Isolated the same way month_multiplier already
    # is, so retuning this going forward only changes who unlocks when.
    unlock_rng = random.Random(f"{BEHAVIOR_SEED}-unlock")
    core_count = max(1, len(ranked_artists) // 5)
    unlock_day: dict[str, int] = {}
    for i, a in enumerate(ranked_artists):
        name = a["artist_name"]
        unlock_day[name] = 0 if i < core_count else unlock_rng.randint(0, max(1, int(total_days * 0.98)))

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
    # Per-album cooldown (session 5) — real listening has variety; without
    # this, rng.choice(artist["albums"]) can pick the same album repeatedly
    # within a short window purely by chance, especially for heavily-
    # weighted top artists. Caught via a real browser screenshot of the
    # Periods|Week tab showing the same album several times in one week.
    # Relaxed (falls back to any album) only when every one of an artist's
    # albums is on cooldown — mainly single/two-album artists, where a
    # strict no-repeat would make them unplayable for months at a time.
    album_last_played_day: dict[str, int] = {}
    ALBUM_COOLDOWN_DAYS = 90
    # Per-calendar-month volume multiplier (session 5) — the previous model
    # only varied day-to-day (weekday/weekend + Gaussian noise) around one
    # constant mean for the entire 9 months, which averages out to an
    # almost perfectly linear cumulative total. Real listening has heavier
    # and quieter stretches. Derived from its own seed (not the shared rng)
    # so it stays reproducible independent of how many other rng draws
    # happen before a given month is first reached.
    month_multiplier_cache: dict[tuple[int, int], float] = {}
    # "Listening mood" (session 5, second pass) — a random walk over era
    # buckets instead of a fixed linear march through them. A monotonic
    # progression (era 0 -> 1 -> 2 -> ...) produces an artificially clean,
    # ever-climbing average release year; real listening has no such
    # narrative arc (checked against the real app's own data — real
    # month-to-month averages jump around with no consistent direction).
    # The mood persists for roughly 1-2.5 weeks before randomly switching to
    # a (possibly different, possibly the same) era, which combined with the
    # now-mild era_weight lean produces noisy, non-monotonic drift instead.
    mood_era = 0
    days_until_mood_change = 0

    _dbg_deadend = 0
    _dbg_success_picks = 0

    day = start_date
    day_index = 0
    while day < end_date:
        is_weekend = day.weekday() >= 5
        if days_until_mood_change <= 0:
            mood_era = rng.randrange(GENRE_DRIFT_ERAS)
            days_until_mood_change = rng.randint(5, 18)
        days_until_mood_change -= 1
        era = mood_era

        month_key = (day.year, day.month)
        if month_key not in month_multiplier_cache:
            month_rng = random.Random(f"{BEHAVIOR_SEED}-month-{day.year}-{day.month}")
            month_multiplier_cache[month_key] = month_rng.uniform(0.55, 1.6)
        month_multiplier = month_multiplier_cache[month_key]

        day_multiplier = 1.15 if is_weekend else 1.0
        # Log-normal, not Gaussian (session 5, eighth pass) — checked against
        # the real listening_log's actual daily play counts (non-invasive:
        # aggregate stats only, no real values copied through): real days
        # ranged 4-192 plays with a coefficient of variation of ~0.51 (stdev
        # 44 / mean 86), a heavily right-skewed "mostly quiet, occasional
        # binge day" shape. A symmetric Gaussian at 0.3 CV was structurally
        # incapable of producing that — real listening doesn't cluster near
        # the mean, it has rare big spikes pulling the average up. Log-normal
        # reproduces both the right skew and gives new-artist discovery counts
        # (drawn from this same day's budget) the same day-to-day burstiness,
        # without needing a separate mechanic for it.
        target_mean = max(1.0, AVG_PLAYS_PER_DAY * day_multiplier * month_multiplier)
        _cv = 0.55
        _sigma = math.sqrt(math.log(1 + _cv ** 2))
        _mu = math.log(target_mean) - _sigma ** 2 / 2
        plays_today = max(0, round(rng.lognormvariate(_mu, _sigma)))

        remaining = plays_today
        current_time = None
        # Same-day fatigue (session 5, third pass — the actual root cause of
        # the Drift chart's impossible flat line): the inner loop below
        # re-draws from this same Zipf-weighted distribution ~15-25 times
        # per day, once per session. Zipf weight alone means whichever
        # artist lands the #1 rank wins a large fraction of *those draws*,
        # every single day, for the whole 9 months — not just a realistic
        # "favorite artist" share, but 943 of 4763 total plays (19.8%) to
        # one album. Real listening doesn't replay one artist all day every
        # day for months. Decaying per-day penalty breaks that without
        # touching the long-run rotation weight at all.
        picks_today: dict[str, int] = {}
        while remaining > 0:
            # Discovery-spike boost (session 5, second pass): a plain unlock
            # schedule left new-artist events to Zipf-weighted chance, which
            # for tail artists meant "unlocked" rarely translated into an
            # actual visible play near their unlock day — Discovery Balance
            # stayed thin. A short, strong boost right at unlock guarantees
            # a real discovery event shows up there, without permanently
            # inflating that artist's long-run rotation weight.
            #
            # Weights fold in album-cooldown eligibility directly (session 5,
            # fourth pass) rather than drawing blind and retrying on a miss:
            # a draw-then-retry design here (tried first) hit ~77 wasted
            # retries per successful pick, because 54% of this catalog is
            # single-album and a 90-day cooldown means "album on cooldown" is
            # the *common* case, not rare. Filtering eligibility into the
            # weights up front makes every draw either succeed or reflect a
            # genuine dead end — no retry loop, no stall-guard needed, and an
            # accurate signal for how much of the day's budget dead-ends.
            eligible_by_artist: dict[str, list] = {}
            weights = []
            for a in artists:
                name = a["artist_name"]
                if unlock_day[name] > day_index or picks_today.get(name, 0) >= 3:
                    weights.append(0)
                    continue
                elig = [
                    al for al in a["albums"]
                    if day_index - album_last_played_day.get(al["album_id"], -(ALBUM_COOLDOWN_DAYS + 1)) >= ALBUM_COOLDOWN_DAYS
                ]
                if not elig:
                    weights.append(0)
                    continue
                eligible_by_artist[name] = elig
                weights.append(
                    base_weight[name] * era_weight(a, era, era_of_genre)
                    * (6.0 if 0 <= day_index - unlock_day[name] <= 3 else 1.0)
                    * (0.3 ** picks_today.get(name, 0))
                )
            if not any(weights):
                # No artist has both an unlocked slot and an eligible album
                # today — a real dead end, so it does consume budget.
                remaining -= 1
                _dbg_deadend += 1
                continue
            artist = rng.choices(artists, weights=weights, k=1)[0]
            picks_today[artist["artist_name"]] = picks_today.get(artist["artist_name"], 0) + 1
            album = rng.choice(eligible_by_artist[artist["artist_name"]])
            album_last_played_day[album["album_id"]] = day_index
            tracks = album["tracks"]
            if not tracks:
                remaining -= 1
                continue

            # Session shape (session 5, ninth pass — the actual root cause of
            # Periods' sparse album grids). Checked against the real
            # listening_log: when a real album gets played at all in a given
            # week, it almost always gets *most or all* of its tracks played
            # (25/29 albums in a sample real week hit >=80% real-tracklist
            # coverage, several with play/distinct-track ratios up to ~4.7x —
            # i.e. multiple full passes, not one partial sample). The old
            # `session_length()` (~3.6 tracks on average, geometric) could
            # never cross the real app's own 50%-of-tracklist Periods
            # eligibility bar for a typical 8-15 track album, no matter how
            # much catalog width, volume, or cooldown tuning happened
            # upstream — that mismatch, not catalog size, was the real bug.
            if album["album_id"] in partial_albums:
                # Sticky-partial albums are a small, deliberate subset kept
                # below full completion on purpose (shows the real app's
                # "still working through this album" UI state) — always
                # low-coverage, not random.
                cutoff = max(1, int(len(tracks) * 0.6))
                eligible_tracks = tracks[:cutoff]
                coverage_frac = 1.0
            else:
                eligible_tracks = tracks
                coverage_frac = rng.uniform(0.8, 1.0) if rng.random() < 0.85 else rng.uniform(0.1, 0.5)

            n = max(1, min(round(len(eligible_tracks) * coverage_frac), len(eligible_tracks)))
            start_idx = rng.randrange(0, max(1, len(eligible_tracks) - n + 1))
            session_tracks = eligible_tracks[start_idx:start_idx + n]

            # How many times through this sitting — real data shows repeat
            # listens within the same week for some albums, not just one pass.
            n_passes = rng.choices([1, 2, 3, 4, 5], weights=[0.55, 0.2, 0.12, 0.08, 0.05], k=1)[0]
            n_passes = max(1, min(n_passes, max(1, remaining // n)))

            session_start = daypart_time(rng, day, is_weekend)
            t = session_start
            ctx_type = weighted_choice(rng, CONTEXT_CHOICES)
            device_name, device_type, _ = rng.choices(DEVICES, weights=[d[2] for d in DEVICES], k=1)[0]
            shuffle_state = rng.random() < 0.35

            for _pass in range(n_passes):
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

            remaining -= n * n_passes
            _dbg_success_picks += 1

        day += timedelta(days=1)
        day_index += 1

    print(f"  [debug] day-loop: {_dbg_success_picks} successful picks, "
          f"{_dbg_deadend} dead-end budget losses")

    # Newest-first — matches the real app's actual invariant for
    # listening_log.json/state.log (routers/recent.py: "log = state.log  #
    # newest-first"; insights/stats_insights.py::_entries_for_period reads
    # log[0] as the latest play). Sorting ascending here (as this line
    # previously did) silently broke that assumption for the whole pipeline
    # — recent.py's marquee/session-continuity logic degrades quietly since
    # it explicitly re-sorts consumers elsewhere, but stats.py's period/time
    # pagination anchors directly off log[0] and breaks outright (has_older
    # goes false at offset 0). Caught only once Stats' pagination made it
    # impossible to miss.
    log_entries.sort(key=lambda e: e["played_at"], reverse=True)

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

    notes_pool = HANDWRITTEN_NOTES[:]
    rng.shuffle(notes_pool)
    noted_albums = played_album_ids[:HANDWRITTEN_NOTES_COUNT]

    top_albums_by_plays = sorted(play_counts_by_album, key=lambda k: -play_counts_by_album[k])
    favorited_album_ids = set(top_albums_by_plays[:max(1, len(top_albums_by_plays) // 6)])

    library_albums = {}
    for album_id in played_album_ids:
        entry = {}
        if album_id in album_real_rating:
            entry["rating"] = album_real_rating[album_id]
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

    # Track-level revisit flags — sparse subset, disjoint from favorited (a
    # gap fixed session 5: the generator only ever set revisit at the artist
    # level, so /api/revisit — which reads library.json's per-track revisit
    # flag, per routers/revisit.py — was always empty).
    non_favorited_tracks = [t for t in play_counts_by_track if t not in favorited_tracks]
    revisit_tracks = set(rng.sample(non_favorited_tracks, k=min(18, len(non_favorited_tracks))))
    for tid in revisit_tracks:
        library_tracks.setdefault(tid, {})["revisit"] = True

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

    # Decade smart playlists (session 5) — mirrors a real pattern the user
    # keeps in the real app (decade-filter playlists), using a rule_group so
    # the real playlist-evaluation engine (insights/playlist_insights.py)
    # does the actual filtering, not a pinned-track list. Nothing behavioral
    # here — just a release_year range rule over the already-real catalog.
    decade_track_ids: dict[int, set[str]] = {}
    for e in log_entries:
        year = e.get("release_year")
        if year:
            decade = (year // 10) * 10
            decade_track_ids.setdefault(decade, set()).add(e["track_id"])

    for decade in sorted(decade_track_ids):
        if len(decade_track_ids[decade]) < 5:
            continue  # not enough real tracks in this decade to be worth a playlist
        pid = f"pl-{rng.randrange(10**8, 10**9)}"
        playlists_out.append({
            "id": pid,
            "name": f"{decade}s",
            "created_at": now_iso,
            "updated_at": now_iso,
            "rule_groups": [{
                "conditions": [{"field": "release_year", "op": "range", "from": decade, "to": decade + 9}],
            }],
            "pinned_track_ids": [],
            "excluded_track_ids": [],
        })

    # ── discogs_collection.json + vinyl_links.json ─────────────────────────
    # Full real vinyl collection (session 5) — every entry stage 1 exported in
    # catalog_seed.json's vinyl_collection, independent of played_album_ids.
    # Only date_added/user_rating/notes are synthesized; everything else is
    # real Discogs catalog data, already personal-field-excluded in stage 1.
    vinyl_collection = seed_data.get("vinyl_collection", [])

    discogs_out = []
    confirmed_links = []
    next_synthetic_release_id = 9_000_000

    for i, entry in enumerate(vinyl_collection):
        real_catalog = entry["discogs_catalog"]
        release_id = real_catalog["release_id"]
        base = dict(real_catalog)
        # /api/vinyl's actual displayed art comes from art_path (see
        # routers/vinyl.py::_art_filename), not thumb/cover_image (those only
        # back the separate wantlist view) — art_path was previously
        # hardcoded to None here, silently nulling out every real bundled
        # image. Caught via a real browser screenshot showing zero art
        # across the whole collection next to the real app showing all of it.
        base["art_path"] = entry.get("local_artwork")
        base["thumb"] = entry.get("local_artwork")
        base["cover_image"] = entry.get("local_artwork")

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
            "notes": notes,
        }
        discogs_out.append(record)
        # Only a real subset of the collection has a genuine Spotify-album
        # link (see stage 1's comment) — don't invent a confirmed pairing
        # for the rest.
        if entry.get("album_id"):
            confirmed_links.append({"release_id": release_id, "album_id": entry["album_id"]})

    dismissed_links = []
    vinyl_album_id_set = {e["album_id"] for e in vinyl_collection if e.get("album_id")}
    near_miss_candidates = [aid for aid in played_album_ids if aid not in vinyl_album_id_set]
    rng.shuffle(near_miss_candidates)
    for i in range(min(2, len(near_miss_candidates))):
        dismissed_links.append({
            "release_id": next_synthetic_release_id + i,
            "album_id": near_miss_candidates[i],
        })

    vinyl_links_out = {"confirmed": confirmed_links, "dismissed": dismissed_links}

    # ── vinyl_sessions.json (session 5, user's explicit ask) ─────────────
    # The real app tracks actual physical turntable spins via Pi hardware —
    # there's no real signal to reuse for this at all (unlike the vinyl
    # collection itself, which is real catalog/possession data), so these
    # sessions are fully synthetic, same treatment as listening_log.json.
    # Roughly half the real collection gets "played" at least once — an
    # unplayed remainder is realistic (everyone has records they haven't
    # gotten to yet), matching the Vinyl tab's own played/unplayed framing.
    def _resolved_art_filename(art_path: str | None) -> str | None:
        prefix = "data/artwork/"
        if not art_path:
            return None
        return art_path[len(prefix):] if art_path.startswith(prefix) else Path(art_path).name

    played_records = rng.sample(discogs_out, k=round(len(discogs_out) * 0.5))
    vinyl_sessions_out = []
    for record in played_records:
        n_sessions = rng.choices([1, 2, 3, 4], weights=[0.5, 0.3, 0.15, 0.05], k=1)[0]

        total_secs = 0
        for t in record.get("tracklist", []):
            parts = (t.get("duration") or "").split(":")
            if len(parts) == 2 and parts[0].isdigit() and parts[1].isdigit():
                total_secs += int(parts[0]) * 60 + int(parts[1])
        if total_secs <= 0:
            total_secs = rng.randint(20 * 60, 45 * 60)  # no tracklist duration data — plausible LP length

        for _ in range(n_sessions):
            started = start_date + timedelta(
                days=rng.randint(0, total_days), seconds=rng.randint(0, 86399),
            )
            duration = round(total_secs * rng.uniform(0.7, 1.05))  # occasionally stopped early
            ended = started + timedelta(seconds=duration)
            vinyl_sessions_out.append({
                "id": str(uuid.uuid4()),
                "started_at": started.timestamp(),
                "ended_at": ended.timestamp(),
                "duration_seconds": duration,
                "status": "confirmed",
                "release_id": record["release_id"],
                "title": record["title"],
                "artists": record["artists"],
                "art_filename": _resolved_art_filename(record.get("art_path")),
            })
    vinyl_sessions_out.sort(key=lambda s: s["started_at"], reverse=True)

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
    with (OUT_DIR / "vinyl_sessions.json").open("w") as f:
        json.dump(vinyl_sessions_out, f, indent=2)

    print(f"listening_log.json: {len(log_entries)} plays")
    print(f"catalog.json: {len(catalog_out)} partially-completed albums")
    print(f"library.json: {len(library_albums)} rated/noted/favorited albums, {len(library_artists)} artists, {len(favorited_tracks)} favorited + {len(revisit_tracks)} revisit tracks")
    print(f"playlists.json: {len(playlists_out)} playlists")
    print(f"discogs_collection.json / vinyl_links.json: {len(discogs_out)} vinyl records")
    print(f"vinyl_sessions.json: {len(vinyl_sessions_out)} sessions across {len(played_records)} played records")


if __name__ == "__main__":
    main()
