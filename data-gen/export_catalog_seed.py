"""
Stage 1 of the synthetic data pipeline: one-time, local-only tool.

Reads REAL catalog metadata (artist/album/track/genre/vinyl names, structure) from
the real av app's data directory and writes data/catalog_seed.json — a weighted
sample of real catalog vocabulary with ZERO behavioral data (no play timestamps,
no personal notes/dates, no session info), with a handful of deliberate exceptions:
real per-album star ratings, and (session 7, user's explicit ask) real
album/track/artist favorite flags. These are all curated opinions about public
albums/artists, not privacy-sensitive in the way timestamps/session patterns are —
the user wants their actual taste reflected rather than a randomized stand-in, and
specifically doesn't want to see an album favorited in the demo that isn't
favorited in real life. Every other behavioral field (timestamps, notes,
session/device patterns) stays fully synthetic, generated fresh in stage 2.

This script is meant to be run once by the repo owner, locally, against their own
real data directory. It is never run as part of the public demo and never ships
personal behavioral data anywhere. The real data directory path is read from an
env var (mirroring the real app's own core/paths.py default-resolution logic) —
never hardcoded to a machine-specific value.

Output (data/catalog_seed.json) IS committed to the repo: it's real catalog
metadata (artist/album/genre names, public Discogs release info), already decided
as fine to reuse — see PRJ-0005 notes.md "Data strategy".
"""
from __future__ import annotations

import json
import os
import random
import re
import shutil
from pathlib import Path

from config import (
    CATALOG_SEED,
    ARTIST_SAMPLE_TARGET,
    WEIGHT_ALBUMS_MULTIPLIER,
    WEIGHT_GENRES_MULTIPLIER,
    WEIGHT_BASE,
)

REAL_DATA_DIR = Path(
    os.environ.get("AUDIOVAULT_DATA_DIR")
    or (Path.home() / "Library" / "Application Support" / "Audiovault")
)
REAL_ARTWORK_DIR = REAL_DATA_DIR / "artwork"

OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "catalog_seed.json"
OUT_ARTWORK_DIR = Path(__file__).resolve().parent.parent / "data" / "artwork"


def _sanitize(name: str) -> str:
    """Mirrors the real app's integrations/spotify/artwork.py::_sanitize exactly,
    so filenames match the real local artwork cache without needing to re-download."""
    name = (name or "").lower().strip()
    name = re.sub(r"[^\w\s-]", "", name)
    name = re.sub(r"[\s_-]+", "_", name)
    return name[:48]


def bundle_artwork(artist_name: str, album_name: str) -> str | None:
    """Copy the real cached artwork file into the repo's data/artwork/ if it
    exists locally. Returns the path to use in generated data, or None if no
    cached file was found (real app only caches art for albums it has actually
    fetched — some selected albums may not have a local file).

    Returns a "data/..."-prefixed path, not a bare "artwork/..." one — this
    matters beyond cosmetics: the real backend's core.paths.resolve_data_path()
    only recognizes paths starting with "data" as resolvable against the data
    directory; anything else falls through unresolved and (relative to the
    backend's own cwd) never exists. That mismatch made state.py's
    _backfill_artwork() think every album's art was missing on every server
    startup, silently rewriting listening_log.json with absolute
    machine-specific paths and re-downloading from Spotify's CDN each time —
    caught in session 4 (see PRJ-0005 session log) after it happened twice."""
    slug = f"{_sanitize(artist_name)}_{_sanitize(album_name)}.jpg"
    src = REAL_ARTWORK_DIR / slug
    if not src.exists():
        return None
    OUT_ARTWORK_DIR.mkdir(parents=True, exist_ok=True)
    dst = OUT_ARTWORK_DIR / slug
    if not dst.exists():
        shutil.copyfile(src, dst)
    return f"data/artwork/{slug}"

# Personal/behavioral/machine-specific fields deliberately excluded when copying
# real Discogs records — these get synthesized fresh in stage 2, never carried
# from real data. `art_path` is a local filesystem path on the real machine
# (caught during output inspection — see PRJ-0005 session log).
_DISCOGS_PERSONAL_FIELDS = {"instance_id", "date_added", "user_rating", "notes", "art_path"}


def _load(name: str):
    path = REAL_DATA_DIR / name
    if not path.exists():
        return None
    with path.open() as f:
        return json.load(f)


def weight(n_albums: int, n_genres: int) -> float:
    return n_albums * WEIGHT_ALBUMS_MULTIPLIER + n_genres * WEIGHT_GENRES_MULTIPLIER + WEIGHT_BASE


def weighted_sample_without_replacement(items: list[str], weights: list[float], k: int, seed: int) -> list[str]:
    """Efraimidis-Spirakis weighted reservoir sampling: reproducible, no replacement."""
    rng = random.Random(seed)
    keyed = []
    for item, w in zip(items, weights):
        u = rng.random()
        key = u ** (1.0 / w)
        keyed.append((key, item))
    keyed.sort(reverse=True)
    return [item for _, item in keyed[:k]]


def main() -> None:
    log = _load("listening_log.json")
    catalog = _load("catalog.json") or {}
    genres = _load("lastfm_genres.json") or {}
    vinyl_links = _load("vinyl_links.json") or {"confirmed": [], "dismissed": []}
    discogs_collection = _load("discogs_collection.json") or []
    real_library = _load("library.json") or {}
    real_album_ratings = real_library.get("albums", {})
    real_track_favorites = real_library.get("tracks", {})
    real_artist_favorites = real_library.get("artists", {})

    if log is None:
        raise SystemExit(
            f"No real listening_log.json found at {REAL_DATA_DIR}. "
            "Set AUDIOVAULT_DATA_DIR to point at the real av data directory."
        )

    # Aggregate catalog-shape info from the log: artist -> albums, album -> tracks.
    # Only structural/catalog fields are read here (names, ids, durations, art) —
    # played_at and any other behavioral field is never touched.
    artist_albums: dict[str, set[str]] = {}
    albums: dict[str, dict] = {}
    album_tracks: dict[str, dict[str, dict]] = {}
    artist_id_by_name: dict[str, str] = {}

    for e in log:
        album_id = e.get("album_id")
        if album_id and album_id not in albums:
            albums[album_id] = {
                "album_id": album_id,
                "album_name": e.get("album_name"),
                "release_year": e.get("release_year"),
                "album_type": e.get("album_type"),
                "album_total_tracks": e.get("album_total_tracks"),
                "album_art_url": e.get("album_art_url"),
                "artist_names": e.get("artist_names", []),
            }
        if album_id:
            tracks = album_tracks.setdefault(album_id, {})
            tid = e.get("track_id")
            if tid and tid not in tracks:
                tracks[tid] = {
                    "track_id": tid,
                    "track_name": e.get("track_name"),
                    "track_number": e.get("track_number"),
                    "duration_ms": e.get("duration_ms"),
                    "isrc": e.get("isrc"),
                }
        # Only the primary (index-0) credited artist accrues weight/albums here —
        # matches the real app's own insights/collection_insights.py::
        # build_artist_catalog exactly, which does the same (`primary =
        # entry["artist_names"][0]`). Looping over every credited artist here
        # instead (an earlier version of this script did) let feature/guest
        # credits on someone else's track — a Dungeon Family interlude
        # co-credited to "Big Rube" or "TMO" on an OutKast album, say — get
        # sampled as if they were headline artists in their own right, each
        # showing a fragment of an album that wasn't really theirs. Caught in
        # session 5 via a real browser screenshot ("what are these made up
        # ones?? TMO?") — see PRJ-0005 session log.
        e_artist_names = e.get("artist_names", [])
        e_artist_ids = e.get("artist_ids", [])
        if e_artist_names:
            name = e_artist_names[0]
            if album_id:
                artist_albums.setdefault(name, set()).add(album_id)
            if e_artist_ids and e_artist_ids[0] and name not in artist_id_by_name:
                artist_id_by_name[name] = e_artist_ids[0]

    # Fill in any unheard tracks from catalog.json so tracklists are as complete
    # as what's available locally (catalog-shape data only — "heard" flag dropped).
    for album_id, entry in catalog.items():
        tracks = album_tracks.setdefault(album_id, {})
        for tid, t in entry.get("tracks", {}).items():
            if tid not in tracks:
                tracks[tid] = {
                    "track_id": tid,
                    "track_name": t.get("track_name"),
                    "track_number": t.get("track_number"),
                    "duration_ms": t.get("duration_ms"),
                    "isrc": t.get("isrc"),
                }

    artist_names = list(artist_albums.keys())
    weights = [weight(len(artist_albums[a]), len(genres.get(a, []))) for a in artist_names]

    selected = weighted_sample_without_replacement(
        artist_names, weights, ARTIST_SAMPLE_TARGET, CATALOG_SEED
    )
    selected_set = set(selected)

    # Build the seed: per-artist real metadata + their real albums/tracks.
    seed_artists = []
    confirmed_album_ids = {p["album_id"] for p in vinyl_links.get("confirmed", [])}
    discogs_by_release_id = {r["release_id"]: r for r in discogs_collection}
    album_id_to_release_id = {p["album_id"]: p["release_id"] for p in vinyl_links.get("confirmed", [])}

    seed_album_count = 0
    for name in selected:
        artist_album_ids = sorted(artist_albums[name])
        artist_albums_out = []
        for album_id in artist_album_ids:
            album = albums[album_id]
            tracks_sorted = sorted(
                album_tracks.get(album_id, {}).values(),
                key=lambda t: (t.get("track_number") is None, t.get("track_number")),
            )
            # Real per-track favorite (session 7, user's explicit ask) — same
            # "curated opinion, not behavioral data" tier as ratings/tops above.
            # Only set when the real track is actually favorited; nothing here
            # is synthesized.
            for t in tracks_sorted:
                if real_track_favorites.get(t["track_id"], {}).get("favorited"):
                    t["real_favorited"] = True
            # Real tracks can be credited to multiple artists (collabs/features).
            # Filter down to only the curated/reviewed artist set — otherwise a
            # collaborator who was never sampled or shown for review leaks
            # through verbatim via the real entry's full artist_names list.
            # (Caught in session 4 when the real backend's artwork backfill hit
            # an unreviewed collaborator's name — see PRJ-0005 session log.)
            filtered_names = [n for n in album["artist_names"] if n in selected_set] or [name]
            # Bundle artwork under filtered_names[0], not the outer loop's
            # `name` — stage 2 sets entry["artist_names"] = filtered_names, and
            # the real backend's artwork backfill keys off artist_names[0]. If
            # that ever differs from what we bundled under (possible when two
            # co-credited artists are both in the sample), the slug won't
            # match and a spurious re-download/rewrite gets triggered again.
            local_art = bundle_artwork(filtered_names[0], album["album_name"])
            album_out = {
                **album,
                "artist_names": filtered_names,
                "tracks": tracks_sorted,
                "local_artwork": local_art,
            }

            # Real per-album star rating (raw 0-20 scale) — the one deliberate
            # behavioral-data exception, per the user's explicit rule change.
            # Only carried over when the real rating is actually set; stage 2
            # must not invent one for albums the user never rated.
            real_rating = real_album_ratings.get(album_id, {}).get("rating", 0)
            if real_rating:
                album_out["real_rating"] = real_rating

            # Real per-album favorite (session 7, user's explicit ask) — same
            # "curated opinion, not behavioral data" tier as the rating above.
            # Only carried over when actually favorited in real life.
            if real_album_ratings.get(album_id, {}).get("favorited"):
                album_out["real_favorited"] = True

            # If this real album has a real confirmed vinyl link, carry over the
            # real Discogs catalog metadata (never the personal fields).
            release_id = album_id_to_release_id.get(album_id)
            if release_id and release_id in discogs_by_release_id:
                real_record = discogs_by_release_id[release_id]
                discogs_catalog = {
                    k: v for k, v in real_record.items() if k not in _DISCOGS_PERSONAL_FIELDS
                }
                # Discogs' own "artists" field is a separate real credit list
                # from Spotify's, and can also include unreviewed collaborators
                # (or just differently-cased/accented spellings of a selected
                # artist). Always use the curated Spotify-canonical name instead
                # of trying to fuzzy-match casing safely.
                discogs_catalog["artists"] = filtered_names
                album_out["discogs_catalog"] = discogs_catalog
            artist_albums_out.append(album_out)
            seed_album_count += 1

        seed_artist = {
            "artist_name": name,
            "artist_id": artist_id_by_name.get(name),
            "genres": genres.get(name, []),
            "albums": artist_albums_out,
        }
        # Real per-artist favorite (session 7, user's explicit ask) — same tier
        # as the album/track favorites above.
        if real_artist_favorites.get(name, {}).get("favorited"):
            seed_artist["real_favorited"] = True
        seed_artists.append(seed_artist)

    # Full real vinyl collection (session 5, user's explicit ask) — every real
    # discogs_collection.json record, independent of whether it's linked to a
    # Spotify album (vinyl_links.confirmed is only the subset ALSO matched to
    # a Spotify play — using that as the source undercounted badly, 53 vs the
    # real 142, caught immediately by the user via a real browser screenshot
    # next to the real desktop app's own vinyl view) or whether its artist
    # made the 200-artist sample (streaming and vinyl-collecting habits don't
    # fully overlap in real life — a vinyl-only artist with no plays is
    # expected, not a bug). Real Discogs catalog metadata (public release
    # info) is the same "fine to reuse" tier as the rest of the catalog data
    # — personal fields excluded exactly as above; date_added/user_rating/
    # notes are still synthesized fresh in stage 2. Discogs' own real
    # "artists" credit is used as-is (unlike the curated-artist-page join
    # above) since these entries don't live under any specific reviewed
    # artist's own page — no unreviewed-collaborator-leak risk.
    #
    # Art comes from the real app's own per-release local cache
    # (artwork/vinyl/<release_id>.jpg), NOT the Spotify-slug bundle_artwork()
    # lookup used elsewhere — that almost never matches here, since Discogs'
    # own title/artist formatting (disambiguation suffixes like "Atoms For
    # Peace (2)", different capitalization) rarely lines up with the
    # Spotify-cached filename convention. Also caught via screenshot: every
    # card showed the empty placeholder instead of real art.
    release_id_to_album_id = {
        p["release_id"]: p["album_id"] for p in vinyl_links.get("confirmed", [])
    }
    REAL_VINYL_ART_DIR = REAL_ARTWORK_DIR / "vinyl"
    OUT_VINYL_ART_DIR = OUT_ARTWORK_DIR / "vinyl"

    def bundle_vinyl_art(release_id) -> str | None:
        src = REAL_VINYL_ART_DIR / f"{release_id}.jpg"
        if not src.exists():
            return None
        OUT_VINYL_ART_DIR.mkdir(parents=True, exist_ok=True)
        dst = OUT_VINYL_ART_DIR / f"{release_id}.jpg"
        if not dst.exists():
            shutil.copyfile(src, dst)
        return f"data/artwork/vinyl/{release_id}.jpg"

    vinyl_collection = []
    for real_record in discogs_collection:
        release_id = real_record.get("release_id")
        if not release_id:
            continue
        discogs_catalog = {
            k: v for k, v in real_record.items() if k not in _DISCOGS_PERSONAL_FIELDS
        }
        vinyl_collection.append({
            "album_id": release_id_to_album_id.get(release_id),
            "discogs_catalog": discogs_catalog,
            "local_artwork": bundle_vinyl_art(release_id),
        })

    # Real per-decade "top 10 albums" picks (session 6) — a curated opinion
    # about public albums, same "safe to reuse" tier as the real ratings
    # already carried through above, not behavioral/timing data. Filtered to
    # only album_ids actually present in this seed's catalog — a top pick
    # for an album outside the seed can never resolve to anything real
    # downstream anyway (the real app's own /api/tops builds its album index
    # from the log, same filtering it already does for stored-but-untouched
    # picks).
    seed_album_ids = {al["album_id"] for a in seed_artists for al in a["albums"]}
    real_album_tops = real_library.get("album_tops", {}).get("decades", {})
    album_tops = {
        decade: [aid for aid in ids if aid in seed_album_ids]
        for decade, ids in real_album_tops.items()
    }

    # Real Tops-editor "eligible" ordering (session 7) — the real /api/tops/{decade}/
    # eligible endpoint sorts by (-rating, -play_count, name), and rating is already
    # real/carried-through above, but play_count comes from whichever log the backend
    # is pointed at. Stage 2's synthetic log gives a different play-count tiebreak than
    # the user's real listening history, so two albums tied on rating can land in a
    # different order than the real app shows — caught by the user directly comparing
    # a real screenshot against the demo's Tops editor. Fixed by precomputing the real
    # order here (real ratings + real play counts, both from real data) and having
    # generate_api_snapshots.py re-sort the demo's eligible list to match it, instead of
    # trusting whatever order the synthetic-data-driven backend run happens to produce.
    real_play_count_by_album: dict[str, int] = {}
    for e in log:
        aid = e.get("album_id")
        if aid:
            real_play_count_by_album[aid] = real_play_count_by_album.get(aid, 0) + 1

    def _decade_for_year(year: int | None) -> str:
        if not year:
            return "Unknown"
        return f"{(year // 10) * 10}s"

    eligible_rows: dict[str, list[tuple]] = {}
    for album_id, entry in real_album_ratings.items():
        if not entry.get("favorited"):
            continue
        album = albums.get(album_id)
        if not album:
            continue
        decade = _decade_for_year(album.get("release_year"))
        eligible_rows.setdefault(decade, []).append((
            -entry.get("rating", 0),
            -real_play_count_by_album.get(album_id, 0),
            (album.get("album_name") or "").lower(),
            album_id,
        ))
    eligible_order = {
        decade: [aid for (*_ , aid) in sorted(rows) if aid in seed_album_ids]
        for decade, rows in eligible_rows.items()
    }

    out = {
        "_meta": {
            "generated_by": "export_catalog_seed.py",
            "catalog_seed": CATALOG_SEED,
            "artist_sample_target": ARTIST_SAMPLE_TARGET,
            "artist_count": len(seed_artists),
            "album_count": seed_album_count,
            "vinyl_collection_count": len(vinyl_collection),
        },
        "artists": seed_artists,
        "vinyl_collection": vinyl_collection,
        "album_tops": album_tops,
        "eligible_order": eligible_order,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(out, f, indent=2)

    print(f"Selected {len(seed_artists)} artists, {seed_album_count} albums, {len(vinyl_collection)} vinyl records.")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
