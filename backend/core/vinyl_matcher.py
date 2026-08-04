from __future__ import annotations

import re
from difflib import SequenceMatcher

# Parenthetical content that is safe to strip before comparing titles.
# Must be a full match (re.fullmatch) against the lowercased content.
_SAFE_STRIP = [
    r'remaster(?:ed)?(?:\s+version)?(?:\s+original\s+album)?',
    r'\d{4}\s+remaster(?:ed)?(?:\s+.*)?',
    r'deluxe\s+remaster(?:ed)?',
    r'deluxe(?:\s+(?:edition|version))?',
    r'(?:expanded|bonus|extended|special|platinum|collector\'?s?)\s+(?:edition|version)',
    r're-?issue',
    r'\d+(?:st|nd|rd|th)\s+anniversary(?:\s+.*)?',
    r'anniversary\s+edition',
    r'\d{4}\s+(?:digital\s+)?remaster(?:ed)?',
]

_ARTIST_THRESHOLD = 0.75
_TITLE_THRESHOLD  = 0.82


def _is_safe(content: str) -> bool:
    if not content.strip():
        return False
    c = content.strip().lower()
    return any(re.fullmatch(pat, c) for pat in _SAFE_STRIP)


def normalize_title(title: str) -> str:
    def _replace(m: re.Match) -> str:
        return "" if _is_safe(m.group(1)) else m.group(0)

    t = re.sub(r"\s*[\(\[](.*?)[\)\]]", _replace, title)
    t = t.lower()
    t = re.sub(r"[^\w\s]", "", t)
    return re.sub(r"\s+", " ", t).strip()


def normalize_artist(artist: str) -> str:
    a = artist.lower().strip()
    a = re.sub(r"^the\s+", "", a)
    a = re.sub(r",\s*the$", "", a)
    a = re.sub(r"[^\w\s]", "", a)
    return re.sub(r"\s+", " ", a).strip()


def _sim(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()


def find_candidates(
    vinyl_records: list[dict],
    album_index: dict[str, dict],
    confirmed: set[tuple[int, str]],
    dismissed: set[tuple[int, str]],
) -> list[dict]:
    """
    Return a list of candidate matches sorted by confidence (descending).
    Each entry: {vinyl, album_id, album_info, artist_sim, title_sim, confidence}
    """
    candidates = []

    for vinyl in vinyl_records:
        release_id = vinyl.get("release_id")
        v_artists = [normalize_artist(a) for a in (vinyl.get("artists") or [])]
        v_title   = normalize_title(vinyl.get("title", ""))

        for album_id, info in album_index.items():
            if (release_id, album_id) in confirmed:
                continue
            if (release_id, album_id) in dismissed:
                continue

            a_artist = normalize_artist(info.get("artist", ""))
            a_title  = normalize_title(info.get("album_name", ""))

            artist_sim = max((_sim(va, a_artist) for va in v_artists), default=0.0)
            if artist_sim < _ARTIST_THRESHOLD:
                continue

            title_sim = _sim(v_title, a_title)
            if title_sim < _TITLE_THRESHOLD:
                continue

            candidates.append({
                "vinyl":      vinyl,
                "album_id":   album_id,
                "album_info": info,
                "artist_sim": artist_sim,
                "title_sim":  title_sim,
                "confidence": artist_sim * title_sim,
            })

    candidates.sort(key=lambda x: -x["confidence"])
    return candidates
