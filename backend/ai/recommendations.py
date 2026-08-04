from __future__ import annotations

import json
import os
import time
from collections import Counter
from datetime import datetime, timezone

import anthropic

from integrations import api_metrics
from integrations.spotify.artwork import download_artwork
from core.paths import data_path, ensure_data_dir

RECS_FILE    = data_path("recommendations.json")
HISTORY_FILE = data_path("recommendations_history.json")
SEARCH_URL   = "https://api.spotify.com/v1/search"


# ── Persistence ───────────────────────────────────────────────────────────────

def load_recommendations() -> dict:
    ensure_data_dir()
    if not RECS_FILE.exists():
        return {}
    with RECS_FILE.open() as f:
        return json.load(f)


def save_recommendations(data: dict) -> None:
    ensure_data_dir()
    with RECS_FILE.open("w") as f:
        json.dump(data, f, indent=2)


def load_history() -> dict:
    ensure_data_dir()
    if not HISTORY_FILE.exists():
        return {"batches": []}
    with HISTORY_FILE.open() as f:
        return json.load(f)


def append_to_history(batch: dict) -> None:
    """Append a generated batch to the growing history log."""
    ensure_data_dir()
    history = load_history()
    history.setdefault("batches", [])
    history["batches"].append(batch)
    with HISTORY_FILE.open("w") as f:
        json.dump(history, f, indent=2)


# ── Engagement cross-reference ────────────────────────────────────────────────

def _engagement_summary(rec: dict, lib: dict, log: list[dict], since_iso: str) -> str:
    """
    Given a past recommendation, return a plain-English summary of what the user
    actually did with it: plays after recommendation, album favorite/rating/notes,
    favorited tracks.
    """
    albums_lib = lib.get("albums", {})
    tracks_lib = lib.get("tracks", {})

    uri      = rec.get("spotify_uri", "")
    album_id = uri.split(":")[-1] if uri.startswith("spotify:album:") else None

    signals: list[str] = []

    # In-app feedback (thumbs)
    feedback = rec.get("feedback")
    if feedback == "up":
        signals.append("thumbs-up")
    elif feedback == "down":
        signals.append("thumbs-down")

    # Plays after recommendation date
    try:
        since_dt = datetime.fromisoformat(since_iso)
    except Exception:
        since_dt = None

    post_plays: list[dict] = []
    if album_id and since_dt:
        for entry in log:
            if entry.get("album_id") != album_id:
                continue
            try:
                played = datetime.fromisoformat(entry["played_at"].replace("Z", "+00:00"))
                if played >= since_dt.astimezone(timezone.utc):
                    post_plays.append(entry)
            except Exception:
                pass

    if post_plays:
        track_names = list({e["track_name"] for e in post_plays})
        signals.append(
            f"played {len(post_plays)}x after rec"
            + (f" ({', '.join(track_names[:3])})" if track_names else "")
        )

    # Library engagement (favorited, rating, notes)
    if album_id and album_id in albums_lib:
        adata = albums_lib[album_id]
        if adata.get("favorited"):
            signals.append("favorited album")
        rating = adata.get("rating", 0)
        if rating > 0:
            signals.append(f"rated {rating}/20")
        notes = (adata.get("notes") or "").strip()
        if notes:
            signals.append(f'notes: "{notes[:120]}"')

    # Favorited tracks from this album
    if album_id:
        fav_track_names: list[str] = []
        seen_tids: set[str] = set()
        for entry in log:
            if entry.get("album_id") != album_id:
                continue
            tid = entry.get("track_id")
            if tid and tid not in seen_tids and tracks_lib.get(tid, {}).get("favorited"):
                fav_track_names.append(entry.get("track_name", tid))
                seen_tids.add(tid)
        if fav_track_names:
            signals.append(f"favorited tracks: {', '.join(fav_track_names[:4])}")

    return ", ".join(signals) if signals else "no engagement recorded"


# ── Prompt building ───────────────────────────────────────────────────────────

def _build_prompt(log: list[dict], lib: dict) -> str:
    artist_counts: Counter = Counter()
    genre_counts:  Counter = Counter()
    decade_counts: Counter = Counter()

    for entry in log:
        artist = (entry.get("artist_names") or [""])[0]
        if artist:
            artist_counts[artist] += 1
        year = entry.get("release_year")
        if year:
            decade_counts[(year // 10) * 10] += 1

    artists_lib = lib.get("artists", {})
    tracks_lib  = lib.get("tracks",  {})
    albums_lib  = lib.get("albums",  {})

    for name, adata in artists_lib.items():
        weight = artist_counts.get(name, 0) + 1
        for genre in adata.get("genres", []):
            genre_counts[genre] += weight

    # Favorites
    fav_artists = [n for n, d in artists_lib.items() if d.get("favorited")]
    fav_tracks: list[str] = []
    track_lookup: dict[str, dict] = {e["track_id"]: e for e in log if e.get("track_id")}
    for tid, tdata in tracks_lib.items():
        if tdata.get("favorited") and tid in track_lookup:
            e = track_lookup[tid]
            fav_tracks.append(f"{e['track_name']} by {', '.join(e.get('artist_names', []))}")

    # Rated albums (0-20 scale; anything rated at all is worth surfacing)
    rated_albums: list[str] = []
    album_lookup: dict[str, dict] = {}
    for e in log:
        aid = e.get("album_id")
        if aid and aid not in album_lookup:
            album_lookup[aid] = e
    for aid, adata in albums_lib.items():
        if adata.get("rating", 0) > 0 and aid in album_lookup:
            e = album_lookup[aid]
            artist = (e.get("artist_names") or [""])[0]
            rated_albums.append(f"{e['album_name']} by {artist} ({adata['rating']}/20)")

    # Recent distinct artists
    recent_artists: list[str] = []
    seen: set[str] = set()
    for e in log[:200]:
        a = (e.get("artist_names") or [""])[0]
        if a and a not in seen:
            recent_artists.append(a)
            seen.add(a)
        if len(recent_artists) >= 25:
            break

    # Every album that has ever appeared in the listening log is off limits.
    library_albums: list[str] = []
    for aid, e in album_lookup.items():
        artist = (e.get("artist_names") or [""])[0]
        library_albums.append(f"{e['album_name']} by {artist}")

    top_artists  = ", ".join(f"{a} ({c})" for a, c in artist_counts.most_common(30))
    top_genres   = ", ".join(f"{g} ({c})" for g, c in genre_counts.most_common(15))
    top_decades  = ", ".join(f"{d}s ({c})" for d, c in sorted(decade_counts.items()))
    user_artists = ", ".join(artist_counts.keys())

    lines = [
        "You are a music recommendation engine with encyclopedic, verified knowledge of recorded music.",
        "",
        "USER LISTENING PROFILE:",
        f"Top artists (play count): {top_artists}",
        f"Favorited artists: {', '.join(fav_artists) or 'none yet'}",
        f"Favorited tracks: {'; '.join(fav_tracks[:20]) or 'none yet'}",
        f"Highly rated albums (0-20 scale): {'; '.join(rated_albums[:10]) or 'none yet'}",
        f"Top genres: {top_genres}",
        f"Active decades: {top_decades}",
        f"Recent listens: {', '.join(recent_artists)}",
        f"All artists in library (use for sounds_like): {user_artists}",
        "",
        "ALBUMS ALREADY IN USER'S LIBRARY — DO NOT RECOMMEND ANY OF THESE:",
        f"{'; '.join(library_albums)}",
    ]

    # ── Full recommendation history with engagement signals ───────────────────
    history = load_history()
    batches = history.get("batches", [])

    if batches:
        lines += [
            "",
            "RECOMMENDATION HISTORY & USER ENGAGEMENT:",
            "⚠ HARD RULE: Do NOT recommend ANY album listed here — not in this batch, not ever.",
            "Every album below is permanently blacklisted, regardless of engagement score.",
            "Use the engagement data only to refine taste understanding, not to resurface past picks.",
        ]
        for batch in batches[-12:]:   # cap at last 12 weeks to keep prompt size reasonable
            generated_at = batch.get("generated_at", "")
            try:
                dt       = datetime.fromisoformat(generated_at)
                days_ago = (datetime.now(timezone.utc) - dt.astimezone(timezone.utc)).days
                label    = f"{dt.strftime('%b %d, %Y')} ({days_ago}d ago)"
            except Exception:
                label = generated_at[:10] if generated_at else "unknown date"

            lines.append(f"\n  [{label}]")
            for rec in batch.get("recommendations", []):
                summary = _engagement_summary(rec, lib, log, generated_at)
                lines.append(f"    • {rec['album']} by {rec['artist']} — {summary}")

    lines += [
        "",
        "Recommend exactly 12 albums the user has NOT heard and does NOT own (extra buffer: some may",
        "fail Spotify verification or be filtered; only the first 5 verified will be shown).",
        "",
        "DIVERSITY REQUIREMENTS — ALL must be satisfied:",
        "  - Span at least 4 different decades (e.g. 1970s, 1990s, 2000s, 2010s — not all 2000s-2010s).",
        "  - Include at least 4 distinct primary genre families (e.g. rock, hip-hop, jazz, electronic —",
        "    not just post-punk / alt-rock / indie rock / dream pop).",
        "  - No more than 1 album per artist across the entire batch of 12.",
        "  - No more than 2 albums sharing the same primary genre.",
        "  - Mix intent: 4-5 clearly in their wheelhouse · 3-4 from niche signals (favorited track,",
        "    barely-explored genre, engagement pattern) · 2-3 genuine wildcards from outside their usual space.",
        "",
        "CRITICAL ACCURACY RULES:",
        "  - Only recommend albums you are 100% certain exist with the exact title and artist.",
        "  - Only recommend albums currently available on Spotify.",
        "  - Album title, artist, year, and track count must be factually correct.",
        "  - Never invent or hallucinate album titles.",
        "  - Never recommend an album from the 'ALBUMS ALREADY IN USER'S LIBRARY' list above.",
        "  - Never recommend any album that appears in the RECOMMENDATION HISTORY above — not ever,",
        "    not even if the user seemed to like it. Those are permanently off the table.",
        "  - Never recommend more than one album by the same artist in a single batch.",
        "",
        "Return ONLY a valid JSON array of 12 objects, each with these exact keys:",
        "  album        — exact album title (string)",
        "  artist       — exact artist name (string)",
        "  year         — release year (integer)",
        "  genres       — 2-3 genre strings (array)",
        "  track_count  — number of tracks (integer)",
        "  why_you      — one SHORT sentence, HARD MAX 80 characters, referencing their specific data",
        "  blurb        — 2-3 sentence description of the album and artist, why it matters",
        "  sounds_like  — 2-3 similar artists, prefer names from the user's library (array)",
        "  spotify_search — search query to find this album on Spotify (string)",
        "",
        "No markdown, no code fences, no commentary. JSON array only.",
    ]

    return "\n".join(lines)


# ── API call ──────────────────────────────────────────────────────────────────

def fetch_recommendations(log: list[dict], lib: dict) -> list[dict]:
    client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
    prompt = _build_prompt(log, lib)

    started = time.perf_counter()
    try:
        message = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=8096,
            messages=[{"role": "user", "content": prompt}],
        )
    except Exception as exc:
        api_metrics.record_call(
            service="Anthropic",
            operation="recommendations",
            method="SDK",
            status=type(exc).__name__,
            duration_ms=int((time.perf_counter() - started) * 1000),
            ok=False,
        )
        raise
    else:
        api_metrics.record_call(
            service="Anthropic",
            operation="recommendations",
            method="SDK",
            status="ok",
            duration_ms=int((time.perf_counter() - started) * 1000),
            ok=True,
        )

    text = message.content[0].text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return json.loads(text.strip())


# ── Spotify enrichment ────────────────────────────────────────────────────────

def _search_spotify_album(token: str, artist: str, album: str) -> dict | None:
    try:
        resp = api_metrics.get(
            "Spotify",
            "recommendation_search",
            SEARCH_URL,
            headers={"Authorization": f"Bearer {token}"},
            params={"q": f"album:{album} artist:{artist}", "type": "album", "limit": 1},
            timeout=10,
        )
        resp.raise_for_status()
        items = resp.json().get("albums", {}).get("items", [])
        if not items:
            return None
        item = items[0]
        images = sorted(item.get("images", []), key=lambda x: x.get("width", 0), reverse=True)
        return {
            "spotify_uri": item["uri"],
            "art_url":     images[0]["url"] if images else None,
        }
    except Exception as e:
        print(f"  Radar: Spotify search failed ({artist} / {album}): {e}")
        return None


def enrich_with_spotify(recs: list[dict], token: str) -> list[dict]:
    """Verify on Spotify and return up to 5 confirmed albums."""
    validated: list[dict] = []
    for rec in recs:
        if len(validated) >= 5:
            break
        result = _search_spotify_album(token, rec["artist"], rec["album"])
        if result:
            rec["spotify_uri"]    = result["spotify_uri"]
            rec["art_local_path"] = download_artwork(rec["artist"], rec["album"], result["art_url"])
            rec.setdefault("feedback", None)
            validated.append(rec)
        else:
            print(f"  Radar: dropping '{rec['album']}' by {rec['artist']} — not found on Spotify")
    return validated
