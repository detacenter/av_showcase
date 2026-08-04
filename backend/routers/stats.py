import calendar
import json as _json
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse
from insights.stats_insights import (
    build_overview_payload,
    build_heatmap_payload,
    build_period_payload,
    build_timeline_payload,
    build_sessions_data,
    filter_entries_by_days,
    build_era_drift,
    build_era_release_profile,
    build_daily,
    build_depth_sessions,
    build_genre_mountain,
    build_discovery_comfort,
    build_discovery_comfort_tracks,
    build_genre_weather,
)
from core.helpers import dominant_art_color
from insights.genre_insights import build_genre_color_map, build_genre_network
from state import get_state

_TZ = ZoneInfo("America/New_York")


def _parse_dt(played_at: str) -> datetime:
    return datetime.fromisoformat(played_at.replace("Z", "+00:00")).astimezone(_TZ)


def _build_daypart_flow(entries: list[dict], n_days: int = 60) -> dict:
    if not entries:
        return {"days": [], "hours": [], "centers": [], "max_hour": 0}
    valid = [e for e in entries if e.get("played_at")]
    if not valid:
        return {"days": [], "hours": [], "centers": [], "max_hour": 0}
    last_day = max(_parse_dt(e["played_at"]).date() for e in valid)
    first_day = min(_parse_dt(e["played_at"]).date() for e in valid)
    start = max(last_day - timedelta(days=n_days - 1), first_day)
    days = [start + timedelta(days=i) for i in range((last_day - start).days + 1)]
    day_idx = {d: i for i, d in enumerate(days)}
    hours = [[0] * 24 for _ in days]
    for entry in valid:
        dt = _parse_dt(entry["played_at"])
        if dt.date() in day_idx:
            hours[day_idx[dt.date()]][dt.hour] += 1
    centers = []
    for row in hours:
        total = sum(row)
        centers.append(sum(h * row[h] for h in range(24)) / total if total else None)
    return {
        "days": [d.isoformat() for d in days],
        "hours": hours,
        "centers": centers,
        "max_hour": max((max(row) for row in hours), default=0),
    }

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("/overview")
def get_overview(days: int = Query(0)):
    state = get_state()
    entries = filter_entries_by_days(state.log, days)
    return build_overview_payload(entries, state.lib, days)


@router.get("/heatmap")
def get_heatmap(days: int = Query(0)):
    state = get_state()
    return build_heatmap_payload(state.log, days)


@router.get("/period")
def get_period(mode: str = Query("Month"), offset: int = Query(0)):
    state = get_state()
    return build_period_payload(state.log, mode, offset, state.lib)


@router.get("/timeline")
def get_timeline(metric: str = Query("Plays"), year: int | None = Query(default=None)):
    state = get_state()
    return build_timeline_payload(state.log, metric, year)


@router.get("/sessions")
def get_sessions():
    state = get_state()
    sessions = build_sessions_data(state.log, 0)
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
                album_colors[key] = dominant_art_color(t.get("album_art_local_path", ""))

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
def get_time(mode: str = Query("Year"), month_offset: int = Query(0)):
    state = get_state()
    log = state.log

    def _ser_days(days_list: list) -> list:
        return [{"date": d["date"].isoformat(), "minutes": d["minutes"]} for d in days_list]

    def _ser_parts(parts: list) -> list:
        return [[{"label": p["label"], "minutes": p["minutes"]} for p in dow] for dow in parts]

    heatmap_all_payload = build_heatmap_payload(log, 0)
    heatmap_all = _ser_days(heatmap_all_payload["heatmap"])

    label = None
    has_older = False
    has_newer = False

    if mode == "Month":
        if log:
            latest = _parse_dt(log[0]["played_at"])
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
    else:
        flow_entries = log
        if mode == "Year":
            time_payload = build_heatmap_payload(log, 0, segment_days=365)
            label = str(datetime.now(_TZ).year)
        else:
            time_payload = heatmap_all_payload

    return {
        "mode":          mode,
        "label":         label,
        "has_older":     has_older,
        "has_newer":     has_newer,
        "heatmap":       _ser_days(time_payload["heatmap"]),
        "heatmap_all":   heatmap_all,
        "minutes_by_dow": time_payload["minutes_by_dow"],
        "day_parts":     _ser_parts(time_payload["day_parts"]),
        "daypart_flow":  _build_daypart_flow(flow_entries),
    }


@router.get("/era-data")
def get_era_data():
    state = get_state()
    return {
        "drift":   build_era_drift(state.log),
        "profile": build_era_release_profile(state.log),
    }


@router.get("/trends")
def get_trends():
    state = get_state()
    color_map = build_genre_color_map(state.log, state.lib)
    weather = build_genre_weather(state.log, state.lib)
    weather["color_map"] = color_map
    return {
        "daily":            build_daily(state.log),
        "depth_sessions":   build_depth_sessions(state.log),
        "genre_mountain":   build_genre_mountain(state.log, state.lib),
        "discovery":        build_discovery_comfort(state.log),
        "discovery_tracks": build_discovery_comfort_tracks(state.log),
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
<script src="https://d3js.org/d3.v7.min.js"></script>
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
svg.call(d3.zoom().scaleExtent([0.15, 6]).on("zoom", e => g.attr("transform", e.transform)));

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

const link = g.append("g").selectAll("line")
    .data(visibleLinks).join("line")
    .attr("stroke", "#282828")
    .attr("stroke-width",   d => 0.3 + (d.weight / maxWeight) * 2)
    .attr("stroke-opacity", d => 0.04 + Math.pow(d.weight / maxWeight, 0.6) * 0.45);

const node = g.append("g").selectAll("g")
    .data(DATA.nodes).join("g")
    .style("cursor", "pointer");

const circle = node.append("circle")
    .attr("r",            d => radiusScale(d.count))
    .attr("fill",         "#1c1c2a")
    .attr("filter",       "url(#glow)")
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
    node.select("circle")
        .attr("fill-opacity", d => connectedIds.has(d.id) ? 1 : 0.12)
        .attr("filter", d => connectedIds.has(d.id) ? "url(#glow)" : "none");
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
    node.select("circle")
        .attr("fill-opacity", d => { if (!id) return 1; return (d.id === id || connectedIds.has(d.id)) ? 1 : 0.15; })
        .attr("filter", d => { if (!id || d.id === id) return "url(#glow)"; return connectedIds.has(d.id) ? "url(#glow)" : "none"; });
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

simulation.on("tick", () => {
    link.attr("x1", d => d.source.x).attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x).attr("y2", d => d.target.y);
    node.attr("transform", d => "translate(" + d.x + "," + d.y + ")");
    if (++_tickCount % 10 === 0) computeColors(false);
}).on("end", () => computeColors(true));

function recenter() {
    w = window.innerWidth;
    h = window.innerHeight;
    svg.attr("width", w).attr("height", h);
    simulation.force("center", d3.forceCenter(w / 2, h / 2));
    simulation.force("x", d3.forceX(w / 2).strength(d => 0.03 + Math.pow(1 / (d.count + 1), 0.5) * 0.08));
    simulation.force("y", d3.forceY(h / 2).strength(d => 0.03 + Math.pow(1 / (d.count + 1), 0.5) * 0.08));
    simulation.alpha(0.3).restart();
}
window.addEventListener("resize", recenter);
// Iframe layout can settle after this script's first run (window.innerWidth/innerHeight
// captured too early), which otherwise leaves the graph clustered near the stale origin.
requestAnimationFrame(recenter);
</script>
</body>
</html>"""


_genres_cache: dict | None = None


@router.get("/genres")
def get_genres():
    global _genres_cache
    if _genres_cache is None:
        state = get_state()
        network = build_genre_network(state.log, state.lib)
        for node in network.get("nodes", []):
            for artist in node.get("artists", []):
                art = artist.get("art") or ""
                if art.startswith("file://"):
                    artist["art"] = Path(art.replace("file://", "")).name
        _genres_cache = network
    return _genres_cache


@router.get("/genres-page", response_class=HTMLResponse)
def get_genres_page():
    state = get_state()
    network = build_genre_network(state.log, state.lib)
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
    return HTMLResponse(
        content=_GENRES_HTML.replace("__DATA__", _json.dumps(network)),
        headers={"Cache-Control": "no-cache"},
    )
