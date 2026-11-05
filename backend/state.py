from dataclasses import dataclass

from core.genre_utils import apply_genre_aliases
from core.paths import resolve_data_path
from insights.collection_insights import find_edition_duplicates
from integrations.spotify.artwork import download_artwork
from persistence.catalog import load_catalog
from persistence.genre_aliases import load_genre_aliases
from persistence.lastfm_genres import load_lastfm_genres
from persistence.library import alias_album, library_lock, load_library, save_library
from persistence.spotify_history import load_history_entries
from persistence.storage import deduplicate_log, load_log, save_log
from persistence.vinyl_links import follow_album_aliases


@dataclass
class AppState:
    log: list        # AV's own play log, newest first
    lib: dict
    catalog: dict
    history: list    # log + the imported Spotify history before it, newest first (Stats reads this)


_state: AppState | None = None
_generation = 0


def _backfill_artwork(log: list) -> None:
    seen: set[str] = set()
    patched = False
    for entry in log:
        album_id = entry.get("album_id")
        if not album_id or album_id in seen:
            continue
        seen.add(album_id)
        local = entry.get("album_art_local_path")
        resolved = resolve_data_path(local)
        if resolved and resolved.exists():
            continue
        artist = entry["artist_names"][0] if entry.get("artist_names") else "unknown"
        path = download_artwork(artist, entry.get("album_name", ""), entry.get("album_art_url"))
        if path:
            for e in log:
                if e.get("album_id") == album_id:
                    e["album_art_local_path"] = path
            patched = True
    if patched:
        save_log(log)


def _load() -> AppState:
    log = load_log()
    _backfill_artwork(log)
    log, removed = deduplicate_log(log)
    if removed:
        save_log(log)
    lib = load_library()
    imported = load_history_entries()
    # Fold Spotify edition duplicates (same artist, title, track count) onto one id. New
    # aliases are written back so ratings/favorites follow and the merge is stable.
    dups = find_edition_duplicates(log + imported, lib.get("album_aliases"))
    if dups:
        with library_lock:
            for old, new in dups.items():
                alias_album(lib, old, new)
            save_library(lib)
    aliases = lib.get("album_aliases", {})
    follow_album_aliases(aliases)   # vinyl links move with merged albums too
    if aliases:
        for entry in log + imported:
            aid = entry.get("album_id")
            if aid in aliases:
                entry["album_id"] = aliases[aid]
    catalog = load_catalog()
    genre_aliases = load_genre_aliases()
    lastfm = load_lastfm_genres()
    artists = lib.setdefault("artists", {})
    # Apply aliases to genres already stored in lib
    if genre_aliases:
        for artist_data in artists.values():
            if artist_data.get("genres"):
                artist_data["genres"] = apply_genre_aliases(artist_data["genres"], genre_aliases)
    # Fill in missing genres from lastfm, applying aliases
    for artist, genres in lastfm.items():
        if genres and not artists.get(artist, {}).get("genres"):
            artists.setdefault(artist, {})["genres"] = apply_genre_aliases(genres, genre_aliases) if genre_aliases else genres
    return AppState(log=log, lib=lib, catalog=catalog, history=log + imported[::-1])


def get_state() -> AppState:
    global _state, _generation
    if _state is None:
        _state = _load()
        _generation += 1
    return _state


def reload_state() -> AppState:
    global _state, _generation
    _state = _load()
    _generation += 1
    return _state


def get_generation() -> int:
    """Bumped every time state is (re)loaded — use to invalidate downstream caches."""
    get_state()
    return _generation
