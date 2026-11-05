import calendar
import json as _json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from core.helpers import dominant_art_color
from insights.genre_insights import build_genre_color_map, build_genre_network
from insights.genre_ring import build_genre_ring
from insights.stats_insights import (
    _build_daypart_flow,
    _build_daypart_flow_monthly,
    _ser_days,
    _ser_parts,
    build_daily,
    build_depth_sessions,
    build_discovery_comfort,
    build_discovery_comfort_tracks,
    build_era_drift,
    build_era_release_profile,
    build_genre_mountain,
    build_genre_weather,
    build_heatmap_payload,
    build_overview_payload,
    build_period_payload,
    build_sessions_data,
    build_timeline_payload,
    filter_entries_by_days,
)
from insights.year_recap import build_year_recap
from state import get_generation, get_state

_TZ = ZoneInfo("America/New_York")


def _parse_dt(played_at: str) -> datetime:
    return datetime.fromisoformat(played_at.replace("Z", "+00:00")).astimezone(_TZ)


router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/overview")
def get_overview(days: int = Query(0)):
    state = get_state()
    entries = filter_entries_by_days(state.history, days)
    return build_overview_payload(entries, state.lib, days)


@router.get("/heatmap")
def get_heatmap(days: int = Query(0)):
    state = get_state()
    payload = build_heatmap_payload(state.history, days)
    # Day/hour/weekday totals only: the session lists made this response enormous.
    return {k: payload[k] for k in ("heatmap", "minutes_by_hour", "minutes_by_dow", "caption")}


_payload_cache: dict[tuple, object] = {}


def _cached(key: tuple, build):
    """Memoize a heavy read-only payload until the next state (re)load."""
    full = (get_generation(),) + key
    if full not in _payload_cache:
        if len(_payload_cache) > 64:
            _payload_cache.clear()
        _payload_cache[full] = build()
    return _payload_cache[full]


_sessions_cache: tuple[int, list[dict]] | None = None
_art_color_cache: dict[str, str] = {}


def _all_sessions() -> list[dict]:
    """Session grouping over the whole history, newest first, cached per state load."""
    global _sessions_cache
    gen = get_generation()
    if _sessions_cache and _sessions_cache[0] == gen:
        return _sessions_cache[1]
    sessions = build_sessions_data(get_state().history, 0)
    _sessions_cache = (gen, sessions)
    return sessions


def _art_color(path: str) -> str:
    if path not in _art_color_cache:
        _art_color_cache[path] = dominant_art_color(path)
    return _art_color_cache[path]


@router.get("/history")
def get_history_info():
    """Where AV's own log begins and what the imported Spotify history covers."""
    from persistence.spotify_history import load_summary
    state = get_state()
    own = [e["played_at"] for e in state.log if e.get("played_at")]
    summary = load_summary() or {}
    return {
        "av_began": min(own) if own else None,
        "newest_play": state.history[0]["played_at"] if state.history else None,
        "oldest_play": state.history[-1]["played_at"] if state.history else None,
        "imported_plays": summary.get("plays", 0),
        "imported_first_play": summary.get("first_play"),
        "imported_at": summary.get("imported_at"),
    }


@router.get("/sessions/bounds")
def get_session_bounds():
    sessions = _all_sessions()
    if not sessions:
        return {"oldest_start": None, "newest_start": None}
    return {"oldest_start": sessions[-1]["start"].isoformat(), "newest_start": sessions[0]["start"].isoformat()}


@router.get("/period")
def get_period(mode: str = Query("Month"), offset: int = Query(0)):
    state = get_state()
    return build_period_payload(state.history, mode, offset, state.lib)


@router.get("/year")
def get_year(year: int | None = Query(None)):
    """Periods › Year: one payload for the whole year page (defaults to the latest year)."""
    state = get_state()
    if not state.history:
        return {"year": year, "years": [], "empty": True}
    y = year or _parse_dt(state.history[0]["played_at"]).year
    return _cached(("year", y), lambda: build_year_recap(state.history, state.lib, y, _parse_dt))


@router.get("/timeline")
def get_timeline(metric: str = Query("Plays"), year: int | None = Query(default=None)):
    state = get_state()
    return build_timeline_payload(state.history, metric, year)


@router.get("/sessions")
def get_sessions(start: str = Query(""), days: int = Query(7)):
    """Sessions whose start falls in [start, start + days) local days. Without `start`,
    the window ends on the newest session. The full list is never returned: with the
    imported history it runs to tens of MB."""
    state = get_state()
    all_sessions = _all_sessions()
    if start:
        win_start = datetime.fromisoformat(start).replace(tzinfo=_TZ)
    elif all_sessions:
        newest = all_sessions[0]["start"].astimezone(_TZ)
        win_start = datetime(newest.year, newest.month, newest.day, tzinfo=_TZ) - timedelta(days=days - 1)
    else:
        win_start = datetime.now(_TZ)
    win_end = win_start + timedelta(days=days)
    sessions = [s for s in all_sessions if win_start <= s["start"].astimezone(_TZ) < win_end]
    lib_artists = state.lib.get("artists", {})
    result = []
    for s in sessions:
        tracks = s["tracks"]
        artist_counts = Counter(a for t in tracks for a in t.get("artist_names", []))
        album_counts  = Counter(t.get("album_name", "") for t in tracks if t.get("album_name"))
        artist_genres: dict[str, int] = defaultdict(int)
        for t in tracks:
            for a in t.get("artist_names", []):
                for g in lib_artists.get(a, {}).get("genres", []):
                    artist_genres[g] += 1
        top_genres = [n for n, _ in sorted(artist_genres.items(), key=lambda x: (-x[1], x[0]))[:5]]
        release_years = sorted({y for y in (t.get("release_year") for t in tracks) if y})

        # Compute dominant color per unique album from art files
        album_colors: dict[str, str] = {}
        for t in tracks:
            key = t.get("album_id") or t.get("album_name") or ""
            if key and key not in album_colors:
                album_colors[key] = _art_color(t.get("album_art_local_path", ""))

        result.append({
            "id":               s["id"],
            "start":            s["start"].isoformat(),
            "end":              s["end"].isoformat(),
            "duration_minutes": s["duration_minutes"],
            "track_count":      s["track_count"],
            "top_artist":       s["top_artist"],
            "genres":           top_genres,
            "release_years":    release_years,
            "artist_counts":    artist_counts.most_common(5),
            "album_counts":     album_counts.most_common(5),
            "album_colors":     album_colors,
            "tracks": [
                {
                    "played_at":           t.get("played_at", ""),
                    "track_name":          t.get("track_name", ""),
                    "artist_names":        t.get("artist_names", []),
                    "album_id":            t.get("album_id", ""),
                    "album_name":          t.get("album_name", ""),
                    "duration_ms":         t.get("duration_ms", 0),
                    "release_year":        t.get("release_year"),
                    "album_art_local_path": t.get("album_art_local_path", ""),
                }
                for t in tracks
            ],
        })
    return result


@router.get("/time")
def get_time(mode: str = Query("Year"), month_offset: int = Query(0), year: int | None = Query(None), month: str = Query("")):
    """`year` picks a calendar year for Year mode; `month` (YYYY-MM) picks a month for
    Month mode and overrides `month_offset`. Both default to the latest."""
    return _cached(("time", mode, month_offset, year, month), lambda: _build_time(mode, month_offset, year, month))


def _hour_totals(entries: list[dict]) -> dict:
    plays = [0] * 24
    ms = [0] * 24
    for e in entries:
        h = _parse_dt(e["played_at"]).hour
        plays[h] += 1
        ms[h] += e.get("duration_ms", 0) or 0
    return {"plays": plays, "minutes": [m / 60000 for m in ms]}


def _build_time(mode: str, month_offset: int, year: int | None = None, month: str = ""):
    state = get_state()
    log = state.history

    heatmap_all_payload = build_heatmap_payload(log, 0)
    heatmap_all = _ser_days(heatmap_all_payload["heatmap"])

    label = None
    has_older = False
    has_newer = False
    target_year = None
    target_month = None

    if mode == "Month":
        if log:
            latest = _parse_dt(log[0]["played_at"])
            if month and len(month) == 7 and month[:4].isdigit() and month[5:].isdigit():
                month_offset = max(0, latest.year * 12 + (latest.month - 1) - (int(month[:4]) * 12 + int(month[5:]) - 1))
            total = latest.year * 12 + (latest.month - 1) - month_offset
            target_year = total // 12
            target_month = total % 12 + 1
            month_entries = [
                e for e in log
                if (p := _parse_dt(e["played_at"])).year == target_year and p.month == target_month
            ]
            oldest = _parse_dt(log[-1]["played_at"])
            oldest_total = oldest.year * 12 + (oldest.month - 1)
            has_older = total > oldest_total
            has_newer = month_offset > 0
            label = f"{calendar.month_name[target_month]} {target_year}"
        else:
            month_entries = []
        is_past = month_offset > 0
        time_payload = build_heatmap_payload(month_entries, 0 if is_past else 31, segment_days=31 if is_past else None)
        flow_entries = month_entries
    elif mode == "Year":
        # One calendar year, so the clock, day parts and by-day grid describe that year
        # (they used to be built from the whole history whatever the heatmap showed).
        latest_year = _parse_dt(log[0]["played_at"]).year if log else datetime.now(_TZ).year
        oldest_year = _parse_dt(log[-1]["played_at"]).year if log else latest_year
        target_year = year or latest_year
        year_entries = [e for e in log if _parse_dt(e["played_at"]).year == target_year]
        time_payload = build_heatmap_payload(year_entries, 0, segment_days=365)
        flow_entries = year_entries
        label = str(target_year)
        has_older = target_year > oldest_year
        has_newer = target_year < latest_year
    else:
        flow_entries = log
        time_payload = heatmap_all_payload

    return {
        "mode":          mode,
        "label":         label,
        "year":          target_year,
        "month":         f"{target_year}-{target_month:02d}" if target_month else None,
        "has_older":     has_older,
        "has_newer":     has_newer,
        "heatmap":       _ser_days(time_payload["heatmap"]),
        "heatmap_all":   heatmap_all,
        "minutes_by_dow": time_payload["minutes_by_dow"],
        "day_parts":     _ser_parts(time_payload["day_parts"]),
        "daypart_flow":  _build_daypart_flow(flow_entries),   # last 60 days of the period, for the Flow drill-in
        "clock":         _hour_totals(flow_entries),          # the whole period, for the Daypart Clock
        "daypart_flow_monthly": _build_daypart_flow_monthly(log),
    }


@router.get("/era-data")
def get_era_data():
    return _cached(("era-data",), _build_era_data)


def _build_era_data():
    state = get_state()
    return {
        "drift":   build_era_drift(state.history),
        "profile": build_era_release_profile(state.history),
    }


@router.get("/trends")
def get_trends():
    return _cached(("trends",), _build_trends)


def _build_trends():
    state = get_state()
    color_map = build_genre_color_map(state.history, state.lib)
    weather = build_genre_weather(state.history, state.lib)
    weather["color_map"] = color_map
    return {
        "daily":            build_daily(state.history),
        "depth_sessions":   build_depth_sessions(state.history),
        "genre_mountain":   build_genre_mountain(state.history, state.lib),
        "discovery":        build_discovery_comfort(state.history),
        "discovery_tracks": build_discovery_comfort_tracks(state.history),
        "genre_weather":    weather,
        "genre_color_map":  color_map,
    }


_GENRES_HTML = r"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #121212; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
#tooltip {
    position: absolute;
    background: #1e1e1e; color: #fff;
    padding: 6px 10px; border-radius: 6px; font-size: 12px;
    pointer-events: none; opacity: 0; transition: opacity 0.12s;
    border: 1px solid #333; white-space: nowrap;
}
#search-overlay {
    position: absolute; top: 0; left: 0; width: 100%; height: 100%;
    display: flex; align-items: flex-start; justify-content: center;
    padding-top: 80px;
    pointer-events: none; opacity: 0; transition: opacity 0.15s;
    z-index: 200;
}
#search-overlay.visible { opacity: 1; pointer-events: all; }
#search-box {
    background: #111; border: 1px solid #2a2a2a; border-radius: 14px;
    width: 360px; box-shadow: 0 20px 60px rgba(0,0,0,0.8);
    overflow: hidden;
}
#search-input {
    width: 100%; background: transparent; border: none; outline: none;
    color: #fff; font-size: 15px; padding: 16px 18px;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    letter-spacing: 0.01em;
}
#search-results { border-top: 1px solid #1e1e1e; max-height: 280px; overflow-y: auto; }
.search-result {
    padding: 11px 18px; font-size: 13px; color: #aaa; cursor: pointer;
    transition: background 0.1s, color 0.1s;
    display: flex; align-items: center; gap: 10px;
}
.search-result:hover, .search-result.active { background: #1a1a1a; color: #fff; }
.search-result-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
#search-hint {
    padding: 10px 18px; font-size: 10px; color: #2a2a2a;
    letter-spacing: 0.05em; text-transform: uppercase; border-top: 1px solid #161616;
}
#panel {
    position: absolute;
    pointer-events: none; opacity: 0;
    transition: opacity 0.18s;
    top: 80px; left: 80px;
    z-index: 100;
}
#panel.visible { opacity: 1; pointer-events: all; }
#panel-inner {
    background: #0e0e0e; border-radius: 16px; border: 1px solid #252525;
    padding: 0; width: 480px;
    max-height: 70vh; display: flex; flex-direction: column;
    box-shadow: 0 24px 64px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04);
    overflow: hidden;
}
#panel-drag {
    padding: 14px 16px 12px;
    cursor: grab; user-select: none;
    border-bottom: 1px solid #1a1a1a;
    display: flex; align-items: center; justify-content: space-between;
    flex-shrink: 0; gap: 12px;
}
#panel-drag:active { cursor: grabbing; }
#panel-drag-left { display: flex; flex-direction: column; gap: 3px; min-width: 0; flex: 1; }
#panel-title { font-size: 18px; font-weight: 800; letter-spacing: -0.02em; }
#panel-sub { font-size: 10px; color: #3a3a3a; letter-spacing: 0.1em; text-transform: uppercase; }
#panel-drag-right { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
#panel-filter-btn {
    background: none; border: 1px solid #2a2a2a; color: #444; font-size: 11px;
    cursor: pointer; padding: 3px 9px; border-radius: 20px; line-height: 1.4;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
    font-family: inherit; letter-spacing: 0.04em; white-space: nowrap;
}
#panel-filter-btn:hover { color: #888; border-color: #444; }
#panel-filter-btn.active { color: #aaa; border-color: #555; background: #1a1a1a; }
#panel-pills-row {
    display: none; flex-wrap: nowrap; gap: 5px;
    overflow-x: auto; padding: 8px 16px;
    border-bottom: 1px solid #1a1a1a; flex-shrink: 0;
    scrollbar-width: none;
}
#panel-pills-row.open { display: flex; }
#panel-pills-row::-webkit-scrollbar { display: none; }
.genre-pill {
    padding: 3px 9px; border-radius: 20px; font-size: 10px; font-weight: 600;
    border: 1px solid; cursor: pointer; letter-spacing: 0.02em;
    transition: opacity 0.12s, background 0.12s; white-space: nowrap;
    user-select: none; flex-shrink: 0;
}
.genre-pill.inactive { opacity: 0.25; }
#panel-close {
    background: none; border: none; color: #444; font-size: 18px;
    cursor: pointer; padding: 2px 6px; border-radius: 6px; line-height: 1;
    transition: color 0.12s, background 0.12s;
}
#panel-close:hover { color: #fff; background: #222; }
#panel-body { overflow-y: auto; padding: 16px 20px 20px; flex: 1; }
#panel-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 10px; }
.artist-tile {
    border-radius: 10px; overflow: hidden; background: #141414;
    cursor: default; transition: transform 0.15s ease, box-shadow 0.15s ease; position: relative;
}
.artist-tile:hover { transform: translateY(-2px) scale(1.02); box-shadow: 0 8px 24px rgba(0,0,0,0.6); }
.artist-tile:hover .artist-tile-name { opacity: 1; }
.artist-tile-art { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; }
.artist-tile-placeholder {
    width: 100%; aspect-ratio: 1; display: flex; align-items: center;
    justify-content: center; font-size: 24px; opacity: 0.08; background: #1a1a1a;
}
.artist-tile-name {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    padding: 6px; font-size: 10px; font-weight: 700; text-align: center;
    white-space: normal; overflow: hidden;
    background: rgba(10,10,10,0.72);
    opacity: 0; transition: opacity 0.15s;
    backdrop-filter: blur(1px);
}
</style>
</head>
<body>
<svg id="graph"></svg>
<div id="tooltip"></div>
<div id="search-overlay">
  <div id="search-box">
    <input id="search-input" type="text" placeholder="Search artists…" autocomplete="off" spellcheck="false">
    <div id="search-results"></div>
    <div id="search-hint">↑↓ navigate · enter select · esc close</div>
  </div>
</div>
<div id="panel">
  <div id="panel-inner">
    <div id="panel-drag">
      <div id="panel-drag-left">
        <div id="panel-title"></div>
        <div id="panel-sub"></div>
      </div>
      <div id="panel-drag-right">
        <button id="panel-filter-btn">Filter ▾</button>
        <button id="panel-close">✕</button>
      </div>
    </div>
    <div id="panel-pills-row"></div>
    <div id="panel-body">
      <div id="panel-grid"></div>
    </div>
  </div>
</div>
<script src="/vendor/d3.v7.min.js"></script>
<script>
const DATA = __DATA__;

let w = window.innerWidth, h = window.innerHeight;
const maxCount = d3.max(DATA.nodes, d => d.count) || 1;
const minCount = d3.min(DATA.nodes, d => d.count) || 0;
const maxWeight = d3.max(DATA.links, d => d.weight) || 1;
const isArtists = DATA.mode === "artists";

const radiusScale = d3.scaleSqrt()
    .domain([minCount, maxCount])
    .range(isArtists ? [4, 22] : [4, 46]);

const svg = d3.select("#graph").attr("width", w).attr("height", h);
const defs = svg.append("defs");

const glow = defs.append("filter").attr("id", "glow").attr("x", "-50%").attr("y", "-50%").attr("width", "200%").attr("height", "200%");
glow.append("feGaussianBlur").attr("in", "SourceGraphic").attr("stdDeviation", "3").attr("result", "blur");
const mg = glow.append("feMerge");
mg.append("feMergeNode").attr("in", "blur");
mg.append("feMergeNode").attr("in", "SourceGraphic");

const g = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.15, 6]).on("zoom", e => g.attr("transform", e.transform));
svg.call(zoom);

const visibleLinks = DATA.links;

const simulation = d3.forceSimulation(DATA.nodes)
    .alphaDecay(0.05)
    .force("link",      d3.forceLink(visibleLinks).id(d => d.id)
                          .distance(d => (isArtists ? 20 : 50) + radiusScale(d.source.count||1) + radiusScale(d.target.count||1))
                          .strength(isArtists ? 0.3 : 0.12))
    .force("charge",    d3.forceManyBody().strength(d => isArtists ? -30 - radiusScale(d.count) * 4 : -60 - radiusScale(d.count) * 12))
    .force("center",    d3.forceCenter(w / 2, h / 2))
    .force("x",         d3.forceX(w / 2).strength(d => 0.03 + Math.pow(1 / (d.count + 1), 0.5) * 0.08))
    .force("y",         d3.forceY(h / 2).strength(d => 0.03 + Math.pow(1 / (d.count + 1), 0.5) * 0.08))
    .force("collision", d3.forceCollide().radius(d => radiusScale(d.count) + (isArtists ? 4 : 16)).strength(1.0));

// Every link shapes the layout, but single co-occurrences (two thirds of them) are
// pure noise on screen and most of the per-frame cost, so only weight >= 2 is drawn.
const drawnLinks = visibleLinks.filter(l => l.weight >= 2);
const link = g.append("g").selectAll("line")
    .data(drawnLinks).join("line")
    .attr("stroke", "#282828")
    .attr("stroke-width",   d => 0.3 + (d.weight / maxWeight) * 2)
    .attr("stroke-opacity", d => 0.04 + Math.pow(d.weight / maxWeight, 0.6) * 0.45);
// Single co-occurrences aren't drawn at rest, so a selected genre on the rim (where they
// are often its only links) lit up its neighbors with nothing connecting them. While a
// genre or artist is highlighted, its undrawn links are added here.
const drawnSet = new Set(drawnLinks);
const hlLayer = g.append("g").style("pointer-events", "none");
let hlLink = hlLayer.selectAll("line");
function showHighlightLinks(match, width) {
    hlLink = hlLayer.selectAll("line")
        .data(visibleLinks.filter(l => !drawnSet.has(l) && match(l))).join("line")
        .attr("stroke", l => l.source.color || "#fff")
        .attr("stroke-opacity", 0.7)
        .attr("stroke-width", width)
        .attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
}

const node = g.append("g").selectAll("g")
    .data(DATA.nodes).join("g")
    .style("cursor", "pointer");

const glowSet = new Set(DATA.nodes.slice().sort((a, b) => b.count - a.count).slice(0, 40).map(d => d.id));
const circle = node.append("circle")
    .attr("r",            d => radiusScale(d.count))
    .attr("fill",         "#1c1c2a")
    .attr("filter",       d => glowSet.has(d.id) ? "url(#glow)" : null)   // a blur filter per node was the frame cost
    .attr("stroke",       "rgba(255,255,255,0.08)")
    .attr("stroke-width", 0.7);

const ranked = DATA.nodes.slice().sort((a, b) => b.count - a.count);
const insideCount = isArtists ? 8 : 20;
const belowCount  = isArtists ? 30 : 25;
const labelInsideSet = new Set(ranked.slice(0, insideCount).map(d => d.id));
const labelBelowSet  = new Set(ranked.slice(insideCount, insideCount + belowCount).map(d => d.id));

node.filter(d => labelInsideSet.has(d.id))
    .append("text")
    .text(d => d.id)
    .attr("text-anchor", "middle")
    .attr("dy", "0.35em")
    .attr("fill", "rgba(255,255,255,0.92)")
    .attr("font-size", d => Math.max(8, Math.min(isArtists ? 11 : 14, radiusScale(d.count) * 0.48)) + "px")
    .attr("font-weight", "600")
    .style("pointer-events", "none");

node.filter(d => labelBelowSet.has(d.id))
    .append("text")
    .text(d => d.id)
    .attr("text-anchor", "middle")
    .attr("dy", d => radiusScale(d.count) + 11)
    .attr("fill", "#777")
    .attr("font-size", "9px")
    .style("pointer-events", "none");

let _tickCount = 0;
function computeColors(animate) {
    if (!DATA.nodes.length) return;
    const cx = d3.mean(DATA.nodes, d => d.x);
    const cy = d3.mean(DATA.nodes, d => d.y);
    const maxR = d3.max(DATA.nodes, d => Math.sqrt((d.x - cx) ** 2 + (d.y - cy) ** 2)) || 1;
    const n = DATA.nodes.length;
    const sorted = DATA.nodes.slice().sort((a, b) => {
        const angleA = Math.atan2(a.y - cy, a.x - cx);
        const angleB = Math.atan2(b.y - cy, b.x - cx);
        return angleA - angleB;
    });
    sorted.forEach((d, i) => { d._hueRank = i; });
    DATA.nodes.forEach(d => {
        const dx = d.x - cx, dy = d.y - cy;
        const r = Math.sqrt(dx * dx + dy * dy) / maxR;
        const hue = (d._hueRank / n) * 360;
        const sat = Math.round(52 + r * 30);
        const lit = Math.round(55 - r * 14);
        d.color = `hsl(${hue.toFixed(1)},${sat}%,${lit}%)`;
    });
    if (animate) {
        circle.transition().duration(500).ease(d3.easeCubicOut).attr("fill", d => d.color);
    } else {
        circle.attr("fill", d => d.color);
    }
}

const tooltip = d3.select("#tooltip");
let selectedId = null;

const panel = document.getElementById("panel");
const panelTitle = document.getElementById("panel-title");
const panelSub = document.getElementById("panel-sub");
const panelGrid = document.getElementById("panel-grid");
const panelPillsRow = document.getElementById("panel-pills-row");
const panelFilterBtn = document.getElementById("panel-filter-btn");
let _pillsOpen = false;

panelFilterBtn.addEventListener("click", e => {
    e.stopPropagation();
    _pillsOpen = !_pillsOpen;
    panelPillsRow.classList.toggle("open", _pillsOpen);
    panelFilterBtn.classList.toggle("active", _pillsOpen);
});

let _panelNode = null;
let _activeFilters = new Set();

function renderTiles() {
    const d = _panelNode;
    const allArtistsInNode = d.artists || [];
    const filtered = _activeFilters.size === 0 ? allArtistsInNode :
        allArtistsInNode.filter(a => {
            const ag = new Set(artistGenreMap[a.name] || []);
            return [..._activeFilters].every(g => ag.has(g));
        });
    panelSub.textContent = filtered.length + " artist" + (filtered.length !== 1 ? "s" : "")
        + (allArtistsInNode.length !== filtered.length ? " of " + allArtistsInNode.length : "");
    panelGrid.innerHTML = "";
    filtered.forEach(a => {
        const tile = document.createElement("div");
        tile.className = "artist-tile";
        tile.style.borderColor = d.color + "33";
        tile.addEventListener("mouseover", () => tile.style.borderColor = d.color + "88");
        tile.addEventListener("mouseout",  () => tile.style.borderColor = d.color + "33");
        if (a.art) {
            const img = document.createElement("img");
            img.className = "artist-tile-art";
            img.src = a.art; img.alt = a.name;
            tile.appendChild(img);
        } else {
            const ph = document.createElement("div");
            ph.className = "artist-tile-placeholder";
            ph.textContent = "♪";
            tile.appendChild(ph);
        }
        const label = document.createElement("div");
        label.className = "artist-tile-name";
        label.textContent = a.name;
        label.style.color = "#fff";
        tile.appendChild(label);
        panelGrid.appendChild(tile);
    });
}

function openPanel(d) {
    tooltip.style("opacity", 0);
    _panelNode = d;
    _activeFilters = new Set();
    panelTitle.textContent = d.id;
    panelTitle.style.color = d.color;
    const linkedGenreIds = new Set();
    visibleLinks.forEach(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        if (sid === d.id) linkedGenreIds.add(tid);
        if (tid === d.id) linkedGenreIds.add(sid);
    });
    const artistsHere = new Set((d.artists || []).map(a => a.name));
    const relatedGenres = new Map();
    DATA.nodes.forEach(n => {
        if (!linkedGenreIds.has(n.id)) return;
        const shared = (n.artists || []).filter(a => artistsHere.has(a.name));
        if (shared.length > 0) relatedGenres.set(n.id, { color: n.color, count: shared.length });
    });
    _pillsOpen = false;
    panelPillsRow.classList.remove("open");
    panelFilterBtn.classList.remove("active");
    const pillCount = relatedGenres.size;
    panelFilterBtn.textContent = pillCount > 0 ? `Filter ▾ (${pillCount})` : "Filter ▾";
    panelFilterBtn.style.display = pillCount > 0 ? "" : "none";
    panelPillsRow.innerHTML = "";
    [...relatedGenres.entries()]
        .sort((a, b) => b[1].count - a[1].count)
        .forEach(([gid, info]) => {
            const pill = document.createElement("div");
            pill.className = "genre-pill";
            pill.textContent = gid;
            pill.style.color = info.color;
            pill.style.borderColor = info.color + "55";
            pill.style.background = info.color + "14";
            pill.title = info.count + " shared artist" + (info.count !== 1 ? "s" : "");
            pill.addEventListener("click", e => {
                e.stopPropagation();
                if (_activeFilters.has(gid)) {
                    _activeFilters.delete(gid);
                    pill.classList.remove("active-pill");
                    pill.style.background = info.color + "14";
                } else {
                    _activeFilters.add(gid);
                    pill.classList.add("active-pill");
                    pill.style.background = info.color + "33";
                }
                panelPillsRow.querySelectorAll(".genre-pill").forEach(p => {
                    if (!p.classList.contains("active-pill")) {
                        p.classList.toggle("inactive", _activeFilters.size > 0);
                    }
                });
                renderTiles();
            });
            panelPillsRow.appendChild(pill);
        });
    renderTiles();
    panel.classList.add("visible");
}

function closePanel() {
    panel.classList.remove("visible");
    _activeFilters = new Set();
    _pillsOpen = false;
    panelPillsRow.classList.remove("open");
    panelFilterBtn.classList.remove("active");
}
document.getElementById("panel-close").addEventListener("click", closePanel);

const dragHandle = document.getElementById("panel-drag");
let dragging = false, dragOffX = 0, dragOffY = 0;
dragHandle.addEventListener("mousedown", e => {
    dragging = true;
    const r = panel.getBoundingClientRect();
    dragOffX = e.clientX - r.left;
    dragOffY = e.clientY - r.top;
    e.preventDefault();
});
document.addEventListener("mousemove", e => {
    if (!dragging) return;
    panel.style.left = (e.clientX - dragOffX) + "px";
    panel.style.top  = (e.clientY - dragOffY) + "px";
});
document.addEventListener("mouseup", () => { dragging = false; });
document.addEventListener("keydown", e => {
    if (e.key === "Escape") { closePanel(); closeSearch(); return; }
    if (document.activeElement !== searchInput && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.key === "/") {
            e.preventDefault(); openSearch("artist");
        } else if (e.key.toLowerCase() === "g") {
            e.preventDefault(); openSearch("genre");
        }
    }
});

const artistGenreMap = {};
DATA.nodes.forEach(n => {
    (n.artists || []).forEach(a => {
        if (!artistGenreMap[a.name]) artistGenreMap[a.name] = [];
        artistGenreMap[a.name].push(n.id);
    });
});
const allArtists = Object.keys(artistGenreMap).sort();
const allGenres = DATA.nodes.map(n => n.id).sort((a, b) => a.localeCompare(b));

const searchOverlay = document.getElementById("search-overlay");
const searchInput   = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
let searchActiveIdx = -1;
let searchMode = "artist";
let currentSearchMatches = [];

function openSearch(mode) {
    searchMode = mode === "genre" ? "genre" : "artist";
    searchOverlay.classList.add("visible");
    searchInput.value = "";
    searchInput.placeholder = searchMode === "genre" ? "Search genres…" : "Search artists…";
    searchResults.innerHTML = "";
    searchActiveIdx = -1;
    currentSearchMatches = [];
    searchInput.focus();
}
function closeSearch() {
    searchOverlay.classList.remove("visible");
    searchInput.blur();
}

function renderResults(query) {
    const q = query.toLowerCase().trim();
    const source = searchMode === "genre" ? allGenres : allArtists;
    const matches = q ? source.filter(a => a.toLowerCase().includes(q)).slice(0, 12) : [];
    currentSearchMatches = matches;
    searchResults.innerHTML = "";
    searchActiveIdx = -1;
    matches.forEach((name, i) => {
        const genreNode = searchMode === "genre"
            ? DATA.nodes.find(n => n.id === name)
            : DATA.nodes.find(n => n.id === (artistGenreMap[name] || [])[0]);
        const color = (genreNode || {}).color || "#666";
        const meta = searchMode === "genre"
            ? ((genreNode || {}).count || 0) + " artist" + (((genreNode || {}).count || 0) !== 1 ? "s" : "")
            : (artistGenreMap[name] || []).join(", ");
        const row = document.createElement("div");
        row.className = "search-result";
        row.innerHTML = `<span class="search-result-dot" style="background:${color}"></span>${name}
            <span style="color:#333;font-size:10px;margin-left:auto">${meta}</span>`;
        row.addEventListener("mousedown", e => {
            e.preventDefault();
            if (searchMode === "genre") selectGenre(name);
            else selectArtist(name);
        });
        row.addEventListener("mouseover", () => {
            searchResults.querySelectorAll(".search-result").forEach((r,j) => r.classList.toggle("active", j===i));
            searchActiveIdx = i;
        });
        searchResults.appendChild(row);
    });
}

function selectArtist(name) {
    closeSearch();
    const genres = new Set(artistGenreMap[name] || []);
    if (!genres.size) return;
    const connectedIds = new Set();
    visibleLinks.forEach(l => {
        const sid = l.source.id || l.source;
        const tid = l.target.id || l.target;
        if (genres.has(sid) && genres.has(tid)) { connectedIds.add(sid); connectedIds.add(tid); }
    });
    genres.forEach(g => connectedIds.add(g));
    link
        .attr("stroke", l => {
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            return (genres.has(sid) && genres.has(tid)) ? (l.source.color || "#fff") : "#1a1a1a";
        })
        .attr("stroke-opacity", l => {
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            return (genres.has(sid) && genres.has(tid)) ? 0.8 : 0.03;
        })
        .attr("stroke-width", l => {
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            return (genres.has(sid) && genres.has(tid)) ? 2 + (l.weight / maxWeight) * 3 : 0.3;
        });
    showHighlightLinks(l => genres.has(l.source.id) && genres.has(l.target.id), 2);
    node.select("circle")
        .attr("fill-opacity", d => connectedIds.has(d.id) ? 1 : 0.12)
        .attr("filter", d => connectedIds.has(d.id) && glowSet.has(d.id) ? "url(#glow)" : null);
    node.selectAll("text").attr("fill-opacity", d => connectedIds.has(d.id) ? 1 : 0.08);
    selectedId = null;
}

function selectGenre(id) {
    closeSearch();
    if (!DATA.nodes.some(n => n.id === id)) return;
    applySelection(selectedId === id ? null : id);
}

searchInput.addEventListener("input", e => renderResults(e.target.value));
searchInput.addEventListener("keydown", e => {
    const rows = searchResults.querySelectorAll(".search-result");
    if (e.key === "ArrowDown") {
        e.preventDefault(); searchActiveIdx = Math.min(searchActiveIdx + 1, rows.length - 1);
    } else if (e.key === "ArrowUp") {
        e.preventDefault(); searchActiveIdx = Math.max(searchActiveIdx - 1, 0);
    } else if (e.key === "Enter") {
        if (searchActiveIdx >= 0 && rows[searchActiveIdx]) {
            const name = currentSearchMatches[searchActiveIdx];
            if (name) { if (searchMode === "genre") selectGenre(name); else selectArtist(name); }
        }
        return;
    } else if (e.key === "Escape") { closeSearch(); return; } else { return; }
    rows.forEach((r, i) => r.classList.toggle("active", i === searchActiveIdx));
});

function applySelection(id) {
    selectedId = id;
    const connectedIds = new Set();
    if (id) {
        visibleLinks.forEach(l => {
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            if (sid === id) connectedIds.add(tid);
            if (tid === id) connectedIds.add(sid);
        });
    }
    link
        .attr("stroke", l => {
            if (!id) return "#282828";
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            return (sid === id || tid === id) ? l.source.color || "#fff" : "#1a1a1a";
        })
        .attr("stroke-opacity", l => {
            if (!id) return 0.04 + Math.pow(l.weight / maxWeight, 0.6) * 0.45;
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            return (sid === id || tid === id) ? 0.7 + (l.weight / maxWeight) * 0.3 : 0.03;
        })
        .attr("stroke-width", l => {
            if (!id) return 0.3 + (l.weight / maxWeight) * 2;
            const sid = l.source.id || l.source, tid = l.target.id || l.target;
            return (sid === id || tid === id) ? 1.5 + (l.weight / maxWeight) * 3 : 0.3;
        });
    showHighlightLinks(l => !!id && (l.source.id === id || l.target.id === id), 1.5);
    node.select("circle")
        .attr("fill-opacity", d => { if (!id) return 1; return (d.id === id || connectedIds.has(d.id)) ? 1 : 0.15; })
        .attr("filter", d => { if (!id) return glowSet.has(d.id) ? "url(#glow)" : null; return d.id === id ? "url(#glow)" : null; });
    node.selectAll("text")
        .attr("fill-opacity", d => { if (!id) return null; return (d.id === id || connectedIds.has(d.id)) ? 1 : 0.1; });
}

node
    .on("click", (e, d) => {
        e.stopPropagation();
        if (e.ctrlKey || e.metaKey) { openPanel(d); }
        else { applySelection(selectedId === d.id ? null : d.id); }
    })
    .on("mouseover", (e, d) => {
        tooltip.style("opacity", 1)
               .html("<strong>" + d.id + "</strong><br>" + d.count + " connection" + (d.count !== 1 ? "s" : ""));
    })
    .on("mousemove", e => tooltip.style("left", (e.pageX + 14) + "px").style("top", (e.pageY - 18) + "px"))
    .on("mouseout",  () => tooltip.style("opacity", 0));

svg.on("click", () => applySelection(null));

function renderPositions() {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    hlLink.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
          .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
}

function fitToView(animate) {
    if (!DATA.nodes.length) return;
    const xs = DATA.nodes.map(d => d.x), ys = DATA.nodes.map(d => d.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = 48;
    const scale = Math.min((w - pad * 2) / (x1 - x0 + 1), (h - pad * 2) / (y1 - y0 + 1), 1.0);
    const tx = (w - scale * (x0 + x1)) / 2;
    const ty = (h - scale * (y0 + y1)) / 2;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(scale);
    if (animate) svg.transition().duration(600).call(zoom.transform, transform);
    else svg.call(zoom.transform, transform);
}

// Converge the physics synchronously before the first paint instead of animating
// ~130 frames of live settling — same final layout, without the multi-second wait.
simulation.stop();
while (simulation.alpha() > simulation.alphaMin()) simulation.tick();
renderPositions();
computeColors(true);
fitToView(false);

simulation.on("tick", () => {
    renderPositions();
    if (++_tickCount % 10 === 0) computeColors(false);
}).on("end", () => {
    computeColors(true);
    fitToView(true);
});

function recenter() {
    w = window.innerWidth;
    h = window.innerHeight;
    svg.attr("width", w).attr("height", h);
    simulation.force("center", d3.forceCenter(w / 2, h / 2));
    simulation.force("x", d3.forceX(w / 2).strength(d => 0.03 + Math.pow(1 / (d.count + 1), 0.5) * 0.08));
    simulation.force("y", d3.forceY(h / 2).strength(d => 0.03 + Math.pow(1 / (d.count + 1), 0.5) * 0.08));
    // Settle synchronously (as on first paint) rather than animating: with 500 nodes a
    // live restart meant ~70 frames of full redraws at a few frames a second.
    simulation.stop().alpha(0.3);
    while (simulation.alpha() > simulation.alphaMin()) simulation.tick();
    renderPositions();
    computeColors(true);
    fitToView(false);
}
window.addEventListener("resize", recenter);
// Iframe layout can settle after this script's first run (window.innerWidth/innerHeight
// captured too early), which otherwise leaves the graph clustered near the stale origin.
requestAnimationFrame(recenter);
</script>
</body>
</html>"""


_genres_cache: dict | None = None
_genres_cache_gen: int = -1
_genres_network_cache: dict | None = None
_genres_network_cache_gen: int = -1


@router.get("/genres")
def get_genres():
    global _genres_cache, _genres_cache_gen
    gen = get_generation()
    if _genres_cache is None or _genres_cache_gen != gen:
        state = get_state()
        network = build_genre_network(state.history, state.lib)
        for node in network.get("nodes", []):
            for artist in node.get("artists", []):
                art = artist.get("art") or ""
                if art.startswith("file://"):
                    artist["art"] = Path(art.replace("file://", "")).name
        _genres_cache = network
        _genres_cache_gen = gen
    return _genres_cache


@router.get("/genres-ring")
def get_genres_ring():
    """Stats › Genres › Ring: top genres by hours, families, shared-artist links."""
    def build():
        state = get_state()
        return build_genre_ring(state.history, state.lib)
    return _cached(("genres-ring",), build)


@router.get("/genres-page", response_class=HTMLResponse)
def get_genres_page():
    global _genres_network_cache, _genres_network_cache_gen
    gen = get_generation()
    if _genres_network_cache is None or _genres_network_cache_gen != gen:
        state = get_state()
        network = build_genre_network(state.history, state.lib)
        for node in network.get("nodes", []):
            for artist in node.get("artists", []):
                art = artist.get("art") or ""
                if art.startswith("file://"):
                    art_path = art.replace("file://", "")
                    idx = art_path.find("artwork/")
                    if idx != -1:
                        artist["art"] = f"/artwork/{art_path[idx + 8:]}"
                    else:
                        artist["art"] = f"/artwork/{Path(art_path).name}"
        _genres_network_cache = network
        _genres_network_cache_gen = gen
    html = _GENRES_HTML.replace("__DATA__", _json.dumps(_genres_network_cache))
    return HTMLResponse(content=html, headers={"Cache-Control": "no-store"})
