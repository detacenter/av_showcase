from __future__ import annotations

from collections import defaultdict


def summarize_album_tracks(plays: list[dict]) -> tuple[list[tuple[str, str, int]], int]:
    track_counts: dict[str, int] = defaultdict(int)
    track_names: dict[str, str] = {}
    track_numbers: dict[str, int | None] = {}

    for entry in plays:
        track_id = entry["track_id"]
        track_counts[track_id] += 1
        track_names[track_id] = entry["track_name"]
        if track_id not in track_numbers:
            track_numbers[track_id] = entry.get("track_number")

    has_track_numbers = any(value is not None for value in track_numbers.values())
    if has_track_numbers:
        ordered = sorted(
            track_counts.items(),
            key=lambda item: (track_numbers.get(item[0]) or 9999, item[0]),
        )
    else:
        ordered = sorted(track_counts.items(), key=lambda item: track_names[item[0]].lower())

    rows = [(track_id, track_names[track_id], count) for track_id, count in ordered]
    max_count = max(track_counts.values()) if track_counts else 1
    return rows, max_count
