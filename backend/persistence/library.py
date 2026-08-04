from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

LIBRARY_FILE = data_path("library.json")

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
    with LIBRARY_FILE.open("w") as f:
        json.dump(lib, f, indent=2)


def album_data(lib: dict, album_id: str) -> dict:
    return _entity_data(lib, "albums", album_id, _ALBUM_DEFAULT)


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
