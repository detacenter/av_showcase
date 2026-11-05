"""Find the Discogs master page for a Spotify album, for the "Open in Discogs" link.

Records in the Discogs collection/wantlist already carry a master_id; anything else is
looked up with Discogs search. Hits are cached by Spotify album id, so each album costs
at most a couple of API calls once. Misses aren't cached and fall back to a search URL.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlencode

from core.paths import data_path, ensure_data_dir

_SITE = "https://www.discogs.com"
_CACHE_FILE = data_path("discogs_master_links.json")

# Spotify release-variant noise: "(Remastered 1999)", "[Deluxe Edition]", "- 2015 Remaster".
_VARIANT = r"remaster|deluxe|edition|expanded|anniversary|mono|stereo|version|reissue|bonus|mix"
_BRACKETED = re.compile(rf"\s*[\(\[][^)\]]*({_VARIANT})[^)\]]*[\)\]]", re.I)
_DASHED = re.compile(rf"\s+-\s+[^-]*({_VARIANT}).*$", re.I)
# Discogs disambiguates artists as "Name (2)" and marks name variations with "*".
_DISCOGS_ARTIST_NOISE = re.compile(r"\s*\(\d+\)|\*")


def clean_title(title: str) -> str:
    return _DASHED.sub("", _BRACKETED.sub("", title)).strip()


def _norm(s: str) -> str:
    s = _DISCOGS_ARTIST_NOISE.sub("", s).lower().replace("&", "and")
    s = re.sub(r"^the\s+", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def _same_artist(a: str, b: str) -> bool:
    a, b = _norm(a), _norm(b)
    return bool(a and b) and (a == b or a in b or b in a)


def vinyl_url(uri: str) -> str:
    return f"{_SITE}{uri}?format=Vinyl"


def search_url(artist: str, title: str) -> str:
    return f"{_SITE}/search/?" + urlencode({"q": f"{artist} {clean_title(title)}", "type": "master", "format_exact": "Vinyl"})


def pick_master(results: list[dict], artist: str, title: str) -> dict | None:
    """First search result whose "Artist - Title" matches the album exactly (after cleanup)."""
    want = _norm(clean_title(title))
    for r in results:
        if r.get("type") != "master" or not r.get("uri"):
            continue
        r_artist, sep, r_title = (r.get("title") or "").partition(" - ")
        if sep and _norm(r_title) == want and _same_artist(r_artist, artist):
            return r
    return None


def owned_master_id(records: list[dict], artist: str, title: str) -> int | None:
    want = _norm(clean_title(title))
    for rec in records:
        if rec.get("master_id") and _norm(rec.get("title") or "") == want and any(
            _same_artist(a, artist) for a in rec.get("artists") or []
        ):
            return rec["master_id"]
    return None


def _load_cache() -> dict:
    try:
        return json.loads(_CACHE_FILE.read_text())
    except Exception:
        return {}


def _save_cache(cache: dict) -> None:
    ensure_data_dir()
    tmp = _CACHE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(cache, indent=1))
    tmp.replace(_CACHE_FILE)


def find_master_link(album_id: str, artist: str, title: str) -> dict:
    """{"url", "kind": "master" | "search"}."""
    cache = _load_cache()
    if album_id and album_id in cache:
        return {"url": vinyl_url(cache[album_id]["uri"]), "kind": "master"}

    from integrations.discogs.client import _get
    from persistence.discogs import load_collection, load_wantlist

    uri = None
    try:
        master_id = owned_master_id(load_collection() + load_wantlist(), artist, title)
        if master_id:
            uri = _get(f"/masters/{master_id}").get("uri", "").replace(_SITE, "") or None
        if not uri:
            params = {"type": "master", "artist": artist, "release_title": clean_title(title), "per_page": 10}
            hit = pick_master(_get("/database/search", params).get("results") or [], artist, title)
            uri = hit["uri"] if hit else None
    except Exception as exc:
        print(f"  Discogs master lookup failed ({artist} - {title}): {exc}")

    if not uri:
        return {"url": search_url(artist, title), "kind": "search"}
    if album_id:
        cache[album_id] = {"uri": uri, "artist": artist, "title": title}
        _save_cache(cache)
    return {"url": vinyl_url(uri), "kind": "master"}
