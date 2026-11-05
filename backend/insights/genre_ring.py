"""Stats › Genres › Ring: the most-played genres on a ring, grouped into families, with
shared-artist links between them. Sizes come from hours listened (an artist's time is split
evenly across its tags), not from how many other tags a genre touches."""
from __future__ import annotations

import os
import re
from collections import Counter, defaultdict

FAMILIES: list[tuple[str, int, re.Pattern]] = [
    ("emo, punk & hardcore", 345, re.compile(r"emo|punk|hardcore|screamo|metal|beardcore|sludge|grunge")),
    ("hip-hop", 275, re.compile(r"hip-hop|hip hop|rap|trap|grime|ofwgkta|kanye")),
    ("electronic", 185, re.compile(r"electronic|experimental|ambient|idm|house|dance|techno|lo-fi|dubstep|chillout|drone|electronica|glitch|synth")),
    ("folk & voices", 110, re.compile(r"folk|singer|acoustic|country|americana|female vocalists")),
    ("pop, soul & jazz", 215, re.compile(r"^pop$|soul|jazz|funk|rnb|r&b|art pop|new wave|indie pop|dream pop|synthpop")),
    ("latin & world", 60, re.compile(r"latin|reggaeton|brazil|brasil|mpb|puerto|afro|bossa|mangue|tropical|world|afric")),
    ("indie & rock", 30, re.compile(r"indie|rock|alternative|shoegaze|post-punk|psychedelic|britpop|garage")),
]
DEFAULT_FAMILY = 6  # indie & rock, for anything no keyword or neighbour can place
MAX_TOP_ARTISTS = 24


def _family_by_keyword(genre: str) -> int:
    for i, (_, _, rx) in enumerate(FAMILIES):
        if rx.search(genre):
            return i
    return -1


def build_genre_ring(history: list[dict], lib: dict, top_n: int = 128) -> dict:
    artist_genres = {a: d.get("genres") or [] for a, d in lib.get("artists", {}).items() if d.get("genres")}

    hours: dict[str, float] = defaultdict(float)
    plays: dict[str, float] = defaultdict(float)
    by_year: dict[str, Counter] = defaultdict(Counter)
    artists: dict[str, set[str]] = defaultdict(set)
    artist_plays: dict[str, Counter] = defaultdict(Counter)
    artist_art: dict[str, str] = {}
    all_artists: set[str] = set()
    artist_total: Counter = Counter()

    for e in history:
        artist = (e.get("artist_names") or [None])[0]
        if not artist:
            continue
        all_artists.add(artist)
        artist_total[artist] += 1
        if artist not in artist_art and e.get("album_art_local_path"):
            # the frontend only needs the file name (artUrl serves /artwork/<name>)
            artist_art[artist] = os.path.basename(e["album_art_local_path"])
        genres = artist_genres.get(artist)
        if not genres:
            continue
        w = 1 / len(genres)
        h = (e.get("duration_ms") or 0) / 3_600_000 * w
        year = (e.get("played_at") or "")[:4]
        for g in genres:
            hours[g] += h
            plays[g] += w
            if year:
                by_year[g][year] += w
            artists[g].add(artist)
            artist_plays[g][artist] += 1

    if not hours:
        return {"nodes": [], "links": [], "families": [{"name": n, "hue": h} for n, h, _ in FAMILIES],
                "total_genres": 0, "tagged_artists": 0, "total_artists": len(all_artists)}

    ranked = sorted(hours, key=lambda g: (-hours[g], g))
    top = ranked[:top_n]
    top_set = set(top)

    # Shared-artist counts between every pair of played genres; the ring's links are the top-N subset.
    weights: dict[tuple[str, str], int] = defaultdict(int)
    for genres in artist_genres.values():
        members = sorted(g for g in set(genres) if g in hours)
        for i in range(len(members)):
            for j in range(i + 1, len(members)):
                weights[(members[i], members[j])] += 1

    # Families, for every played genre (the focus view places off-ring genres too): keywords
    # first; the rest take the family their neighbours mostly belong to, weighted by shared artists.
    fam = {g: _family_by_keyword(g) for g in hours}
    score: dict[str, Counter] = defaultdict(Counter)
    for (a, b), w in weights.items():
        if fam[a] < 0 and fam[b] >= 0:
            score[a][fam[b]] += w
        elif fam[b] < 0 and fam[a] >= 0:
            score[b][fam[a]] += w
    for g in hours:
        if fam[g] < 0:
            fam[g] = score[g].most_common(1)[0][0] if score[g] else DEFAULT_FAMILY

    years = sorted({y for g in top for y in by_year[g]})
    nodes = []
    for g in top:
        nodes.append({
            "g": g,
            "hours": round(hours[g], 1),
            "plays": round(plays[g]),
            "artists": len(artists[g]),
            "fam": fam[g],
            "by_year": [round(by_year[g].get(y, 0)) for y in years],
            "top_artists": [{"name": a, "plays": n, "art_path": artist_art.get(a)} for a, n in artist_plays[g].most_common(MAX_TOP_ARTISTS)],
        })
    links = [[a, b, w] for (a, b), w in weights.items() if w >= 2 and a in top_set and b in top_set]
    links.sort(key=lambda l: -l[2])

    # Every tagged artist you've played, for "find an artist": the ring lights up their genres.
    artist_rows = sorted(
        ({"name": a, "plays": artist_total[a], "art_path": artist_art.get(a), "genres": [g for g in artist_genres[a] if g in hours]}
         for a in all_artists if a in artist_genres),
        key=lambda r: (-r["plays"], r["name"]),
    )

    return {
        "nodes": nodes,
        "artists": artist_rows,
        "links": links,
        "families": [{"name": n, "hue": h} for n, h, _ in FAMILIES],
        "genre_fams": fam,
        "years": years,
        "total_genres": len(hours),
        "tagged_artists": len({a for g in hours for a in artists[g]}),
        "total_artists": len(all_artists),
    }
