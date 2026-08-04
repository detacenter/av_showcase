"""
Stage 1 of the synthetic data pipeline: one-time, local-only tool.

Reads REAL catalog metadata (artist/album/track/genre/vinyl names, structure) from
the real av app's data directory and writes data/catalog_seed.json — a weighted
sample of real catalog vocabulary with ZERO behavioral data (no play timestamps,
no personal ratings/notes/dates, no session info).

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
        e_artist_names = e.get("artist_names", [])
        e_artist_ids = e.get("artist_ids", [])
        for i, name in enumerate(e_artist_names):
            if album_id:
                artist_albums.setdefault(name, set()).add(album_id)
            if i < len(e_artist_ids) and e_artist_ids[i] and name not in artist_id_by_name:
                artist_id_by_name[name] = e_artist_ids[i]

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

        seed_artists.append({
            "artist_name": name,
            "artist_id": artist_id_by_name.get(name),
            "genres": genres.get(name, []),
            "albums": artist_albums_out,
        })

    out = {
        "_meta": {
            "generated_by": "export_catalog_seed.py",
            "catalog_seed": CATALOG_SEED,
            "artist_sample_target": ARTIST_SAMPLE_TARGET,
            "artist_count": len(seed_artists),
            "album_count": seed_album_count,
        },
        "artists": seed_artists,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_PATH.open("w") as f:
        json.dump(out, f, indent=2)

    print(f"Selected {len(seed_artists)} artists, {seed_album_count} albums.")
    print(f"Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
