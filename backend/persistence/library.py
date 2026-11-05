from __future__ import annotations

import json
import os
import threading

from core.paths import data_path, ensure_data_dir

LIBRARY_FILE = data_path("library.json")

# Guards the load_library() -> mutate -> save_library() cycle in routers/library.py.
# Backend runs as a single process (no --workers), but FastAPI still runs sync routes
# on a thread pool, so concurrent requests can race on this file without it.
# Re-entrant: routers hold it across reload_state(), and state._load may itself write
# the library (edition aliases it discovers).
library_lock = threading.RLock()

_ALBUM_DEFAULT  = {"rating": 0, "notes": "", "favorited": False}
_ARTIST_DEFAULT = {"favorited": False, "revisit": False, "genres": []}
_TRACK_DEFAULT  = {"favorited": False, "revisit": False}
_LIBRARY_DEFAULT = {"albums": {}, "artists": {}, "tracks": {}, "album_tops": {"decades": {}}}


def _merged(defaults: dict, stored: dict | None) -> dict:
    return {**defaults, **(stored or {})}


def _section(lib: dict, name: str) -> dict:
    return lib.setdefault(name, {})


def _entity_data(lib: dict, section_name: str, entity_id: str, defaults: dict) -> dict:
    return _merged(defaults, _section(lib, section_name).get(entity_id))


def _entity_store(lib: dict, section_name: str, entity_id: str) -> dict:
    return _section(lib, section_name).setdefault(entity_id, {})


def _set_entity_value(lib: dict, section_name: str, entity_id: str, field: str, value) -> None:
    _entity_store(lib, section_name, entity_id)[field] = value
    save_library(lib)


def _toggle_entity_flag(lib: dict, section_name: str, entity_id: str, field: str, default: bool = False) -> bool:
    entity = _entity_store(lib, section_name, entity_id)
    entity[field] = not entity.get(field, default)
    save_library(lib)
    return entity[field]


def load_library() -> dict:
    ensure_data_dir()
    if LIBRARY_FILE.exists():
        with LIBRARY_FILE.open() as f:
            loaded = json.load(f)
            return {
                "albums":        loaded.get("albums", {}),
                "artists":       loaded.get("artists", {}),
                "tracks":        loaded.get("tracks", {}),
                "album_aliases": loaded.get("album_aliases", {}),
                "album_tops":    loaded.get("album_tops", {"decades": {}}),
            }
    return dict(_LIBRARY_DEFAULT)


def save_library(lib: dict) -> None:
    ensure_data_dir()
    tmp_file = LIBRARY_FILE.with_suffix(LIBRARY_FILE.suffix + ".tmp")
    with tmp_file.open("w") as f:
        json.dump(lib, f, indent=2)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, LIBRARY_FILE)


def album_data(lib: dict, album_id: str) -> dict:
    return _entity_data(lib, "albums", album_id, _ALBUM_DEFAULT)


def alias_album(lib: dict, old_id: str, new_id: str) -> bool:
    """Point `old_id` at `new_id` and carry everything keyed on the old id across: the
    rating/notes/favorite, decade Tops entries, and any alias that already pointed at the
    old id. Used when the Spotify trickle replaces an imported album's placeholder id with
    the real one. Returns whether anything changed (caller saves)."""
    if not old_id or not new_id or old_id == new_id:
        return False
    aliases = _section(lib, "album_aliases")
    if aliases.get(old_id) == new_id:
        return False
    albums = _section(lib, "albums")
    old = albums.pop(old_id, None)
    if old:
        target = albums.setdefault(new_id, {})
        for field, default in _ALBUM_DEFAULT.items():
            if target.get(field, default) == default and old.get(field, default) != default:
                target[field] = old[field]
    for decade, ids in lib.get("album_tops", {}).get("decades", {}).items():
        if old_id in ids:
            lib["album_tops"]["decades"][decade] = [new_id if i == old_id else i for i in ids]
    for k, v in list(aliases.items()):
        if v == old_id:
            aliases[k] = new_id
    aliases[old_id] = new_id
    return True


def artist_data(lib: dict, name: str) -> dict:
    return _entity_data(lib, "artists", name, _ARTIST_DEFAULT)


def set_album_rating(lib: dict, album_id: str, rating: int) -> None:
    _set_entity_value(lib, "albums", album_id, "rating", rating)


def set_album_notes(lib: dict, album_id: str, notes: str) -> None:
    _set_entity_value(lib, "albums", album_id, "notes", notes)


def set_artist_pinned_art(lib: dict, name: str, album_id: str) -> None:
    _set_entity_value(lib, "artists", name, "pinned_art_album_id", album_id)


def clear_artist_pinned_art(lib: dict, name: str) -> None:
    _section(lib, "artists").get(name, {}).pop("pinned_art_album_id", None)
    save_library(lib)


def toggle_album_favorite(lib: dict, album_id: str) -> bool:
    return _toggle_entity_flag(lib, "albums", album_id, "favorited", _ALBUM_DEFAULT["favorited"])


def toggle_artist_revisit(lib: dict, name: str) -> bool:
    return _toggle_entity_flag(lib, "artists", name, "revisit", _ARTIST_DEFAULT["revisit"])


def set_artist_genres(lib: dict, name: str, genres: list) -> None:
    _set_entity_value(lib, "artists", name, "genres", genres)


def track_data(lib: dict, track_id: str) -> dict:
    return _entity_data(lib, "tracks", track_id, _TRACK_DEFAULT)


def toggle_track_favorite(lib: dict, track_id: str) -> bool:
    return _toggle_entity_flag(lib, "tracks", track_id, "favorited", _TRACK_DEFAULT["favorited"])


def toggle_track_revisit(lib: dict, track_id: str) -> bool:
    return _toggle_entity_flag(lib, "tracks", track_id, "revisit", _TRACK_DEFAULT["revisit"])


def toggle_artist_favorite(lib: dict, name: str) -> bool:
    return _toggle_entity_flag(lib, "artists", name, "favorited", _ARTIST_DEFAULT["favorited"])
