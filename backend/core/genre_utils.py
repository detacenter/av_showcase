from __future__ import annotations

import re
import unicodedata


def apply_genre_aliases(genres: list[str], aliases: dict[str, str]) -> list[str]:
    """Map genres through aliases, deduplicating the result while preserving order."""
    seen: list[str] = []
    seen_set: set[str] = set()
    for g in genres:
        mapped = aliases.get(g, g)
        if mapped not in seen_set:
            seen.append(mapped)
            seen_set.add(mapped)
    return seen


def _normalize(g: str) -> str:
    g = g.lower().strip()
    g = "".join(c for c in unicodedata.normalize("NFD", g) if unicodedata.category(c) != "Mn")
    g = re.sub(r"[-\s_'&]", "", g)
    return g


def _edit_distance(a: str, b: str) -> int:
    if a == b:
        return 0
    la, lb = len(a), len(b)
    if la == 0:
        return lb
    if lb == 0:
        return la
    prev = list(range(lb + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * lb
        for j, cb in enumerate(b, 1):
            curr[j] = min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + (0 if ca == cb else 1))
        prev = curr
    return prev[lb]


def _connected_components(
    items: list[str],
    connected: "callable[[str, str], bool]",
) -> list[list[str]]:
    parent = {x: x for x in items}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, a in enumerate(items):
        for b in items[i + 1:]:
            if connected(a, b):
                pa, pb = find(a), find(b)
                if pa != pb:
                    parent[pa] = pb

    groups: dict[str, list[str]] = {}
    for x in items:
        groups.setdefault(find(x), []).append(x)
    return list(groups.values())


def find_genre_clusters(
    genre_counts: dict[str, int],
    dismissals: "set[frozenset[str]] | None" = None,
) -> list[dict]:
    """
    genre_counts: {genre: artist_count}
    dismissals: pairs of genres that must never be grouped together
    Returns clusters of similar/duplicate genres with merge suggestions.
    """
    dismissed = dismissals or set()

    def is_dismissed(a: str, b: str) -> bool:
        return frozenset({a, b}) in dismissed

    genres = list(genre_counts.keys())

    norm_map: dict[str, list[str]] = {}
    for g in genres:
        norm_map.setdefault(_normalize(g), []).append(g)

    assigned: set[str] = set()
    clusters: list[dict] = []

    # Pass 1: genres that normalize identically, split by dismissed pairs
    for group in norm_map.values():
        if len(group) < 2:
            continue
        components = _connected_components(group, lambda a, b: not is_dismissed(a, b))
        for component in components:
            if len(component) < 2:
                continue
            component_sorted = sorted(component, key=lambda g: -genre_counts.get(g, 0))
            clusters.append({
                "variants": [{"genre": g, "count": genre_counts.get(g, 0)} for g in component_sorted],
                "suggested_canonical": component_sorted[0],
                "confidence": "high",
            })
            assigned.update(component)

    # Pass 2: edit distance / prefix among unassigned genres, skipping dismissed pairs
    unassigned = [g for g in genres if g not in assigned]
    norms = {g: _normalize(g) for g in unassigned}
    merged: set[str] = set()

    def _similar(na: str, nb: str) -> bool:
        # Require minimum length to avoid spurious short-string matches (pop/rap, rb/rap, etc.)
        min_len = min(len(na), len(nb))
        if min_len < 5:
            return False
        dist = _edit_distance(na, nb)
        is_prefix = na.startswith(nb) or nb.startswith(na)
        return dist <= 2 or (is_prefix and abs(len(na) - len(nb)) <= 5)

    # Use union-find so all valid pairs are considered independently (avoids both
    # chaining false-positives and ordering-dependent misses like brasil/brazil/brazilian)
    parent = {g: g for g in unassigned}

    def _find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, g1 in enumerate(unassigned):
        n1 = norms[g1]
        for g2 in unassigned[i + 1:]:
            if is_dismissed(g1, g2):
                continue
            if _similar(n1, norms[g2]):
                p1, p2 = _find(g1), _find(g2)
                if p1 != p2:
                    parent[p1] = p2

    uf_groups: dict[str, list[str]] = {}
    for g in unassigned:
        uf_groups.setdefault(_find(g), []).append(g)

    for group in uf_groups.values():
        if len(group) < 2:
            continue
        group_sorted = sorted(group, key=lambda g: -genre_counts.get(g, 0))
        clusters.append({
            "variants": [{"genre": g, "count": genre_counts.get(g, 0)} for g in group_sorted],
            "suggested_canonical": group_sorted[0],
            "confidence": "medium",
        })

    clusters.sort(key=lambda c: (0 if c["confidence"] == "high" else 1, -sum(v["count"] for v in c["variants"])))
    return clusters
