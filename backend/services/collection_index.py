"""Album and artist indexes over the whole history (AV's log plus the imported Spotify
export), built once per state generation.

Albums, Artists and Tops used to index `state.log` on every request. With nine years of
plays behind it the index is ~8k albums over ~150k entries; cheap to build (well under a
second on the Pi) but not something to redo per keystroke, and the lists must agree with
each other within a generation, so they share one build."""
from __future__ import annotations

import threading

from insights.collection_insights import build_album_index, build_artist_catalog
from state import get_generation, get_state

_lock = threading.Lock()
_albums: tuple[int, dict] | None = None
_artists: tuple[int, dict] | None = None


def album_index() -> dict[str, dict]:
    global _albums
    gen = get_generation()
    if _albums and _albums[0] == gen:
        return _albums[1]
    with _lock:
        if _albums and _albums[0] == gen:
            return _albums[1]
        built = build_album_index(get_state().history)
        _albums = (gen, built)
        return built


def artist_catalog() -> dict[str, dict]:
    global _artists
    gen = get_generation()
    if _artists and _artists[0] == gen:
        return _artists[1]
    with _lock:
        if _artists and _artists[0] == gen:
            return _artists[1]
        built = build_artist_catalog(get_state().history)
        _artists = (gen, built)
        return built


def resolve_album_id(album_id: str) -> str:
    """Follow a stale id (a placeholder the Spotify trickle has since replaced, or a merged
    album) to the id the index uses now."""
    aliases = get_state().lib.get("album_aliases", {})
    return aliases.get(album_id, album_id)
