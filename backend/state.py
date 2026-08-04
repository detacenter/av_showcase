from dataclasses import dataclass

from persistence.catalog import load_catalog
from persistence.library import load_library
from persistence.storage import deduplicate_log, load_log, save_log
from persistence.lastfm_genres import load_lastfm_genres
from persistence.genre_aliases import load_genre_aliases
from core.genre_utils import apply_genre_aliases
from integrations.spotify.artwork import download_artwork
from core.paths import resolve_data_path


@dataclass
class AppState:
    log: list
    lib: dict
    catalog: dict


_state: AppState | None = None


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
    aliases = lib.get("album_aliases", {})
    if aliases:
        for entry in log:
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
    return AppState(log=log, lib=lib, catalog=catalog)


def get_state() -> AppState:
    global _state
    if _state is None:
        _state = _load()
    return _state


def reload_state() -> AppState:
    global _state
    _state = _load()
    return _state
