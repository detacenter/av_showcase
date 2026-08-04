from __future__ import annotations

from collections import defaultdict


def build_vinyl_stats(records: list[dict]) -> dict:
    if not records:
        return {
            "total": 0, "decades": [], "genres": [], "styles": [],
            "labels": [], "artists": [], "countries": [], "formats": [],
        }

    decade_counts: dict[int, int] = defaultdict(int)
    genre_counts: dict[str, int] = defaultdict(int)
    style_counts: dict[str, int] = defaultdict(int)
    label_counts: dict[str, int] = defaultdict(int)
    artist_counts: dict[str, int] = defaultdict(int)
    country_counts: dict[str, int] = defaultdict(int)
    format_desc_counts: dict[str, int] = defaultdict(int)

    for r in records:
        year = r.get("year")
        if year:
            decade_counts[(year // 10) * 10] += 1
        for g in r.get("genres") or []:
            genre_counts[g] += 1
        for s in r.get("styles") or []:
            style_counts[s] += 1
        for l in r.get("labels") or []:
            label_counts[l] += 1
        for a in r.get("artists") or []:
            artist_counts[a] += 1
        country = r.get("country")
        if country:
            country_counts[country] += 1
        for d in r.get("format_descriptions") or []:
            format_desc_counts[d] += 1

    def _ranked(d: dict) -> list[dict]:
        return [{"name": k, "count": v} for k, v in sorted(d.items(), key=lambda x: -x[1])]

    decades = [
        {"decade": d, "label": f"{d}s", "count": c}
        for d, c in sorted(decade_counts.items())
    ]

    return {
        "total": len(records),
        "decades": decades,
        "genres": _ranked(genre_counts),
        "styles": _ranked(style_counts)[:20],
        "labels": _ranked(label_counts)[:20],
        "artists": _ranked(artist_counts),
        "countries": _ranked(country_counts),
        "formats": _ranked(format_desc_counts),
    }


def build_vinyl_gallery(records: list[dict]) -> list[dict]:
    """Sort records for gallery display: by artist then year."""
    return sorted(
        records,
        key=lambda r: (
            (r.get("artists") or [""])[0].lower().lstrip("the "),
            r.get("year") or 0,
        ),
    )
