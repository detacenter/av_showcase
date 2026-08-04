from __future__ import annotations

_ORDER = ["Album", "EP", "Single", "Compilation"]


def classify_album_type(album_type: str | None, total_tracks: int | None) -> str:
    if album_type == "compilation":
        return "Compilation"
    if album_type == "album":
        return "Album"
    if album_type == "single":
        return "EP" if (total_tracks or 0) > 1 else "Single"
    return "Album"


def type_sort_key(classified: str) -> int:
    try:
        return _ORDER.index(classified)
    except ValueError:
        return len(_ORDER)
