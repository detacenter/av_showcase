from .album_insights import summarize_album_tracks
from .genre_insights import build_artist_network, build_genre_color_map, build_genre_network
from .artist_insights import (
    artist_plays,
    build_artist_album_index,
    build_artist_detail_snapshot,
    resolve_artist_id,
    top_artist_tracks,
)
from .collection_insights import build_album_index, build_artist_catalog
from .trends_insights import build_trends_payload
from .stats_insights import (
    build_decade_genre_matrix,
    build_heatmap_payload,
    build_overview_payload,
    build_period_payload,
    build_stats_snapshot,
    build_timeline_payload,
    days_span_for_entries,
    filter_entries_by_days,
    range_days_from_label,
)

__all__ = [
    "summarize_album_tracks",
    "build_artist_network",
    "build_genre_color_map",
    "build_genre_network",
    "artist_plays",
    "build_artist_album_index",
    "build_artist_detail_snapshot",
    "build_album_index",
    "build_artist_catalog",
    "build_trends_payload",
    "build_heatmap_payload",
    "build_overview_payload",
    "build_period_payload",
    "resolve_artist_id",
    "top_artist_tracks",
    "build_timeline_payload",
    "build_stats_snapshot",
    "days_span_for_entries",
    "filter_entries_by_days",
    "range_days_from_label",
    "build_decade_genre_matrix",
]
