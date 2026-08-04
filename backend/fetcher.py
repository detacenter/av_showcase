from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

from integrations.spotify.artwork import download_artwork
from integrations.spotify.auth import get_access_token
from integrations.spotify.client import get_recently_played, get_player_state
from integrations.lastfm.client import get_artist_genres
from persistence.catalog import load_catalog, mark_heard, prune_completed, save_catalog
from persistence.storage import load_log, save_log, get_new_entries
from persistence.lastfm_genres import load_lastfm_genres, save_lastfm_genres


def _update_lastfm_genres(log: list) -> None:
    if not os.environ.get("LASTFM_API_KEY"):
        return
    genres = load_lastfm_genres()
    artists = {e["artist_names"][0] for e in log if e.get("artist_names")}
    missing = [a for a in artists if a not in genres or not genres[a]]
    if not missing:
        return
    fetched = 0
    for artist in missing:
        artist_genres = get_artist_genres(artist)
        if artist_genres is None:
            continue
        genres[artist] = artist_genres
        fetched += 1
    if fetched:
        save_lastfm_genres(genres)


def run_once() -> int:
    token = get_access_token()
    plays = get_recently_played(token)

    try:
        state = get_player_state(token)
        if state and state.get("track_id"):
            for p in plays:
                if p["track_id"] == state["track_id"]:
                    p["device_name"] = state["device_name"]
                    p["device_type"] = state["device_type"]
                    p["shuffle_state"] = state["shuffle_state"]
                    break
    except Exception as e:
        print(f"  Player state fetch failed: {e}")

    existing = load_log()
    new_entries = get_new_entries(plays, existing)

    if not new_entries:
        _update_lastfm_genres(existing)
        return 0

    artwork_cache: dict[str, str | None] = {}
    for entry in new_entries:
        album_id = entry["album_id"]
        if album_id not in artwork_cache:
            artist = entry["artist_names"][0] if entry["artist_names"] else "unknown"
            artwork_cache[album_id] = download_artwork(artist, entry["album_name"], entry["album_art_url"])
        entry["album_art_local_path"] = artwork_cache[album_id]

    updated = new_entries + existing
    save_log(updated)
    _update_lastfm_genres(updated)

    catalog = load_catalog()
    if catalog:
        promoted = sum(1 for e in new_entries if mark_heard(catalog, e["track_id"]))
        pruned = prune_completed(catalog, updated)
        if promoted or pruned:
            save_catalog(catalog)

    return len(new_entries)
