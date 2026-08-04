from __future__ import annotations

import os
import re

from integrations import api_metrics
from core.paths import data_path, ensure_data_dir

ARTWORK_DIR = data_path("artwork")


def _sanitize(name: str) -> str:
    name = name.lower().strip()
    name = re.sub(r"[^\w\s-]", "", name)       # strip non-word chars
    name = re.sub(r"[\s_-]+", "_", name)        # collapse whitespace/dashes
    return name[:48]                             # cap segment length


def artwork_path(artist_name: str, album_name: str) -> str:
    artist = _sanitize(artist_name)
    album = _sanitize(album_name)
    return str(ARTWORK_DIR / f"{artist}_{album}.jpg")


def download_artwork(artist_name: str, album_name: str, image_url: str | None) -> str | None:
    if not image_url:
        return None

    ensure_data_dir()
    ARTWORK_DIR.mkdir(parents=True, exist_ok=True)
    path = artwork_path(artist_name, album_name)

    if os.path.exists(path):
        return path

    try:
        resp = api_metrics.get("Artwork", "spotify_album_art", image_url, timeout=15)
        resp.raise_for_status()
        with open(path, "wb") as f:
            f.write(resp.content)
        return path
    except Exception as e:
        print(f"  Warning: artwork download failed ({artist_name} / {album_name}): {e}")
        return None
