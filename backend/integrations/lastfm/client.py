from __future__ import annotations

import os

from integrations import api_metrics

LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/"


def get_artist_genres(artist_name: str) -> list[str] | None:
    api_key = os.environ.get("LASTFM_API_KEY", "")
    if not api_key:
        return None
    params = {
        "method": "artist.getTopTags",
        "artist": artist_name,
        "autocorrect": 1,
        "api_key": api_key,
        "format": "json",
    }
    try:
        resp = api_metrics.get("Last.fm", "artist_genres", LASTFM_BASE, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()
        if data.get("error"):
            print(f"  Last.fm genre fetch failed for {artist_name}: {data.get('message', 'unknown error')}")
            return None
        tags = data.get("toptags", {}).get("tag", [])
        return [tag["name"].lower() for tag in tags[:5] if tag.get("name")]
    except Exception as exc:
        print(f"  Last.fm genre fetch failed for {artist_name}: {type(exc).__name__}")
        return None
