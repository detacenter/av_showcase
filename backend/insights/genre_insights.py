from __future__ import annotations

import colorsys
import math
import os
from collections import defaultdict

from .stats_insights import filter_entries_by_days


def _label_propagation(nodes: list[str], edges: dict[tuple[str, str], int]) -> dict[str, int]:
    """Deterministic label propagation community detection."""
    label = {n: i for i, n in enumerate(sorted(nodes))}
    adj: dict[str, dict[str, int]] = defaultdict(dict)
    for (a, b), w in edges.items():
        adj[a][b] = w
        adj[b][a] = w

    for _ in range(20):
        changed = False
        for n in sorted(nodes):
            if not adj[n]:
                continue
            tally: dict[int, float] = defaultdict(float)
            for nb, w in adj[n].items():
                tally[label[nb]] += w
            best = max(tally, key=lambda k: (tally[k], -k))
            if best != label[n]:
                label[n] = best
                changed = True
        if not changed:
            break

    # Renumber communities 0..N-1
    seen: dict[int, int] = {}
    result: dict[str, int] = {}
    for n in sorted(nodes):
        c = label[n]
        if c not in seen:
            seen[c] = len(seen)
        result[n] = seen[c]
    return result


def _circular_mean_hue(hue_weights: list[tuple[float, float]]) -> float:
    """Weighted circular mean of hues (degrees)."""
    sin_sum = cos_sum = 0.0
    for h, w in hue_weights:
        r = math.radians(h)
        sin_sum += w * math.sin(r)
        cos_sum += w * math.cos(r)
    return math.degrees(math.atan2(sin_sum, cos_sum)) % 360


def _hsl(h: float, s: float = 65, l: float = 45) -> str:
    return f"hsl({h:.1f},{s:.0f}%,{l:.0f}%)"


def _hsl_to_hex(h: float, s: float = 70, l: float = 62) -> str:
    r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    return f"#{round(r * 255):02x}{round(g * 255):02x}{round(b * 255):02x}"


_ELECTRONIC_KEYWORDS = frozenset({
    "electronic", "electronica", "edm", "techno", "house", "trance",
    "drum and bass", "dnb", "dubstep", "idm", "synthpop", "electropop",
    "electro", "downtempo", "chillwave", "vaporwave", "glitch",
    "industrial", "rave", "breakbeat",
})
_ELECTRONIC_HUE = 270  # purple


def _electronic_weight(genre: str) -> float:
    """
    0.0 = no electronic character, 1.0 = purely electronic.
    Position of keyword in the genre name determines weight:
      exact / leading  → 1.0 / 0.85  ("electronic", "techno funk")
      trailing         → 0.45         ("indie electronic")
      interior         → 0.35         ("new age electronic music")
    """
    g = genre.lower().strip()
    for kw in _ELECTRONIC_KEYWORDS:
        if g == kw:
            return 1.0
        if g.startswith(kw + " ") or g.startswith(kw + "-"):
            return 0.85
        if g.endswith(" " + kw) or g.endswith("-" + kw):
            return 0.45
        if (" " + kw + " ") in g or ("-" + kw + "-") in g:
            return 0.35
    return 0.0


def build_artist_bubbles(lib: dict, log: list[dict] | None = None) -> dict:
    """Packed-bubble layout: genres as large circles, artists as dots inside their primary genre."""
    artists = lib.get("artists", {})

    # Build artist -> most recent art path from log
    artist_art: dict[str, str] = {}
    if log:
        for entry in log:
            artist = (entry.get("artist_names") or [None])[0]
            art = entry.get("album_art_local_path")
            if artist and art and artist not in artist_art:
                artist_art[artist] = "file://" + os.path.abspath(art)

    genre_artists: dict[str, list[str]] = defaultdict(list)
    for name, data in artists.items():
        genres = data.get("genres", [])
        if genres:
            genre_artists[genres[0]].append(name)

    if not genre_artists:
        return {"genres": [], "mode": "bubbles"}

    # Only genres with 2+ artists
    genre_artists = {g: a for g, a in genre_artists.items() if len(a) >= 2}

    genre_list = list(genre_artists)
    n = len(genre_list)
    genre_list_sorted = sorted(genre_list, key=lambda g: -len(genre_artists[g]))
    genre_colors = {}
    for i, genre in enumerate(genre_list_sorted):
        base_h = (200 + i * 360 / n) % 360
        e_w = _electronic_weight(genre)
        if e_w > 0:
            h = _circular_mean_hue([(base_h, 1.0 - e_w), (_ELECTRONIC_HUE, e_w)])
        else:
            h = base_h
        genre_colors[genre] = _hsl(h)

    genres = [
        {
            "id": g,
            "color": genre_colors[g],
            "count": len(genre_artists[g]),
            "artists": [
                {"name": a, "art": artist_art.get(a)}
                for a in sorted(genre_artists[g])
            ],
        }
        for g in genre_list_sorted
    ]

    # Genre-to-genre similarity links based on shared artists
    genre_set = {g["id"]: set(a["name"] for a in g["artists"]) for g in genres}
    links = []
    gids = [g["id"] for g in genres]
    for i in range(len(gids)):
        for j in range(i + 1, len(gids)):
            shared = len(genre_set[gids[i]] & genre_set[gids[j]])
            if shared:
                links.append({"source": gids[i], "target": gids[j], "weight": shared})

    return {"genres": genres, "links": links, "mode": "bubbles"}


def build_artist_network(lib: dict) -> dict:
    artists = lib.get("artists", {})

    artist_genres: dict[str, set[str]] = {
        name: set(data.get("genres", []))
        for name, data in artists.items()
        if data.get("genres")
    }

    if not artist_genres:
        return {"nodes": [], "links": []}

    artist_list = list(artist_genres)
    n_artists = len(artist_list)

    # IDF: genres shared by many artists carry little signal
    genre_freq: dict[str, int] = defaultdict(int)
    for genres in artist_genres.values():
        for g in genres:
            genre_freq[g] += 1
    genre_idf = {g: math.log(n_artists / freq) for g, freq in genre_freq.items()}

    # Edge weight = sum of IDF scores for shared genres (rare shared genres = strong edge)
    edge_weights: dict[tuple[str, str], float] = {}
    for i in range(len(artist_list)):
        for j in range(i + 1, len(artist_list)):
            a, b = artist_list[i], artist_list[j]
            shared = artist_genres[a] & artist_genres[b]
            if not shared:
                continue
            score = sum(genre_idf[g] for g in shared)
            # Normalise by artist genre breadth so genre-heavy artists don't dominate
            score /= math.sqrt(len(artist_genres[a]) * len(artist_genres[b]))
            if score >= 0.15:  # threshold — drop very weak connections
                edge_weights[tuple(sorted([a, b]))] = round(score, 4)

    # Community detection on IDF-weighted graph
    int_edges = {k: int(v * 100) for k, v in edge_weights.items()}
    community = _label_propagation(artist_list, int_edges)

    n_communities = max(community.values()) + 1 if community else 1
    community_hue = {c: (200 + c * 360 / n_communities) % 360 for c in range(n_communities)}

    adj: dict[str, dict[str, float]] = defaultdict(dict)
    for (a, b), w in edge_weights.items():
        adj[a][b] = w
        adj[b][a] = w

    node_colors: dict[str, str] = {}
    for name in artist_list:
        if not adj[name]:
            node_colors[name] = _hsl(community_hue[community[name]])
            continue
        hue_weights = [(community_hue[community[name]], sum(adj[name].values()))]
        for nb, w in adj[name].items():
            c = community[nb]
            if c != community[name]:
                hue_weights.append((community_hue[c], w * 0.4))
        node_colors[name] = _hsl(_circular_mean_hue(hue_weights))

    degree: dict[str, int] = defaultdict(int)
    for (a, b) in edge_weights:
        degree[a] += 1
        degree[b] += 1

    sorted_artists = sorted([a for a in artist_list if degree[a] >= 2], key=lambda a: -degree[a])
    kept = set(sorted_artists)
    nodes = [{"id": a, "count": degree[a], "color": node_colors[a]} for a in sorted_artists]
    links = [{"source": a, "target": b, "weight": w} for (a, b), w in edge_weights.items() if a in kept and b in kept]

    return {"nodes": nodes, "links": links, "mode": "artists"}


def build_genre_color_map(log: list[dict], lib: dict) -> dict[str, str]:
    """Return {genre: hex_color} sorted by play frequency, hues assigned via golden angle."""
    genre_counts: dict[str, int] = defaultdict(int)
    for entry in log:
        if not entry.get("artist_names"):
            continue
        primary = entry["artist_names"][0]
        for g in lib.get("artists", {}).get(primary, {}).get("genres", []):
            genre_counts[g] += 1

    if not genre_counts:
        return {}

    sorted_genres = sorted(genre_counts, key=lambda g: -genre_counts[g])
    _GOLDEN = 137.508
    return {g: _hsl_to_hex((i * _GOLDEN) % 360) for i, g in enumerate(sorted_genres)}


def build_genre_network(log: list[dict], lib: dict, days: int = 0) -> dict:
    entries = filter_entries_by_days(log, days) if days else log

    # Build artist art map from log
    artist_art: dict[str, str] = {}
    for entry in log:
        artist = (entry.get("artist_names") or [None])[0]
        art = entry.get("album_art_local_path")
        if artist and art and artist not in artist_art:
            artist_art[artist] = "file://" + os.path.abspath(art)

    genre_counts: dict[str, float] = defaultdict(float)
    artist_genres: dict[str, set[str]] = {}

    for entry in entries:
        if not entry.get("artist_names"):
            continue
        primary = entry["artist_names"][0]
        genres = lib.get("artists", {}).get(primary, {}).get("genres", [])
        if genres:
            weight = 1 / len(genres)
            for g in genres:
                genre_counts[g] += weight
        if genres and primary not in artist_genres:
            artist_genres[primary] = set(genres)

    if not genre_counts:
        return {"nodes": [], "links": []}

    top = set(genre_counts.keys())

    # Edge weight = number of artists sharing both genres
    edge_weights: dict[tuple[str, str], int] = defaultdict(int)
    for genres in artist_genres.values():
        members = [g for g in genres if g in top]
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                key = tuple(sorted([members[i], members[j]]))
                edge_weights[key] += 1

    # Community detection
    top_list = list(top)
    community = _label_propagation(top_list, edge_weights)

    # Assign evenly-spaced hues to communities, starting at 200° (blue-green)
    n_communities = max(community.values()) + 1 if community else 1
    community_hue = {c: (200 + c * 360 / n_communities) % 360 for c in range(n_communities)}

    # Build adjacency for color blending
    adj: dict[str, dict[str, int]] = defaultdict(dict)
    for (a, b), w in edge_weights.items():
        adj[a][b] = w
        adj[b][a] = w

    shared_colors = build_genre_color_map(log, lib)
    node_colors: dict[str, str] = {g: shared_colors.get(g, "#888888") for g in top_list}

    # Degree = number of unique genre connections — drives node size
    degree: dict[str, int] = defaultdict(int)
    for (a, b) in edge_weights:
        degree[a] += 1
        degree[b] += 1

    # Drop weakly-connected nodes (degree < 2) — single-edge nodes add visual noise
    sorted_genres = sorted([g for g in top_list if degree[g] >= 2], key=lambda g: -degree[g])

    # Build genre -> artists map (all artists in lib who have this genre)
    genre_to_artists: dict[str, list[dict]] = defaultdict(list)
    for artist_name, genres in artist_genres.items():
        for g in genres:
            if g in set(sorted_genres):
                genre_to_artists[g].append({
                    "name": artist_name,
                    "art": artist_art.get(artist_name),
                })

    kept = set(sorted_genres)
    nodes = [{"id": g, "count": degree[g], "color": node_colors[g],
              "artists": sorted(genre_to_artists[g], key=lambda a: a["name"])}
             for g in sorted_genres]
    links = [{"source": a, "target": b, "weight": w} for (a, b), w in edge_weights.items() if a in kept and b in kept]

    return {"nodes": nodes, "links": links}
