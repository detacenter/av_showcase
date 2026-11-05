from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from integrations.spotify.artwork import download_artwork
from integrations.spotify.auth import get_access_token
from integrations.spotify.client import search as spotify_search
from persistence.radar import load_radar, save_radar
from state import get_state

router = APIRouter(prefix="/api/radar", tags=["radar"])


def _similarity(query: str, *fields: str) -> float:
    q = query.lower()
    return max((SequenceMatcher(None, q, f.lower()).ratio() for f in fields if f), default=0.0)


def _norm(s: str | None) -> str:
    return " ".join((s or "").lower().split())


def _parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def _play_index(log: list[dict]) -> dict[tuple, list[dict]]:
    """Plays keyed every way a Radar item can match them, built once per request."""
    index: dict[tuple, list[dict]] = {}
    for play in log:
        if not play.get("played_at"):
            continue
        artists = {_norm(a) for a in play.get("artist_names") or []}
        keys = [("album_id", play.get("album_id")), ("track_id", play.get("track_id"))]
        keys += [("artist", a) for a in artists]
        # Album/track name matches are keyed with each credited artist, so a same-named
        # record by someone else doesn't count (catches other editions with a new id).
        keys += [("album", _norm(play.get("album_name")), a) for a in artists]
        keys += [("track", _norm(play.get("track_name")), a) for a in artists]
        for k in keys:
            index.setdefault(k, []).append(play)
    return index


def _first_play(item: dict, index: dict[tuple, list[dict]], album_aliases: dict) -> dict | None:
    """Earliest play of this item after it was added to Radar, or None."""
    if item["type"] == "artist":
        keys = [("artist", _norm(item["name"]))]
    else:
        item_artists = {_norm(a) for a in item["sub"].split(",")}
        if item["type"] == "album":
            keys = [("album_id", album_aliases.get(item["spotify_id"], item["spotify_id"]))]
        else:
            keys = [("track_id", item["spotify_id"])]
        keys += [(item["type"], _norm(item["name"]), a) for a in item_artists]

    added = _parse_ts(item["added_at"])
    first = None
    for k in keys:
        for play in index.get(k, ()):
            if _parse_ts(play["played_at"]) <= added:
                continue
            if first is None or _parse_ts(play["played_at"]) < _parse_ts(first["played_at"]):
                first = play
    return first


def _serialize(item: dict, first_play: dict | None = None) -> dict:
    art = item.get("art_local_path") or ""
    return {
        "id": item["id"],
        "type": item["type"],
        "name": item["name"],
        "sub": item["sub"],
        "art_path": Path(art).name if art else None,
        "tag": item["tag"],
        "spotify_uri": f"spotify:{item['type']}:{item['spotify_id']}",
        "added_at": item["added_at"],
        "resolved_at": item.get("resolved_at"),
        "listened_at": first_play["played_at"] if first_play else None,
        # Where the in-app album/artist page lives, taken from the matching play
        # (Radar's own name/id can differ from what the library files it under).
        "open_artist": (first_play.get("artist_names") or [None])[0] if first_play else None,
        "open_album_id": first_play.get("album_id") if first_play and item["type"] != "artist" else None,
    }


@router.get("")
def get_radar():
    items = load_radar()
    state = get_state()
    aliases = state.lib.get("album_aliases", {})
    index = _play_index(state.log)
    serialized = [_serialize(i, _first_play(i, index, aliases)) for i in items]

    active = [i for i in serialized if not i["resolved_at"]]
    listened = sorted(
        (i for i in serialized if i["resolved_at"] and i["listened_at"]),
        key=lambda i: i["resolved_at"], reverse=True,
    )
    # Every item ever added counts, including ones cleared without a listen, so the
    # follow-through ratio stays honest.
    waits = sorted(
        (_parse_ts(i["listened_at"]) - _parse_ts(i["added_at"])).days
        for i in serialized if i["listened_at"]
    )
    stats = {
        "added": len(serialized),
        "listened": len(waits),
        "median_days": waits[len(waits) // 2] if waits else None,
    }
    return {"items": active, "listened": listened, "stats": stats}


@router.get("/search")
def search_radar(q: str):
    if not q.strip():
        return {"results": []}
    token = get_access_token()
    data = spotify_search(token, q)

    results = []
    for a in data.get("artists", {}).get("items", []):
        images = sorted(a.get("images", []), key=lambda x: x.get("width", 0), reverse=True)
        results.append({
            "spotify_id": a["id"], "type": "artist",
            "name": a["name"], "sub": "Artist",
            "art_url": images[0]["url"] if images else None,
            "_popularity": a.get("popularity", 0),
        })
    for al in data.get("albums", {}).get("items", []):
        images = sorted(al.get("images", []), key=lambda x: x.get("width", 0), reverse=True)
        results.append({
            "spotify_id": al["id"], "type": "album",
            "name": al["name"], "sub": ", ".join(x["name"] for x in al.get("artists", [])),
            "art_url": images[0]["url"] if images else None,
            "_popularity": 0,
        })
    for t in data.get("tracks", {}).get("items", []):
        images = sorted(t.get("album", {}).get("images", []), key=lambda x: x.get("width", 0), reverse=True)
        results.append({
            "spotify_id": t["id"], "type": "track",
            "name": t["name"], "sub": ", ".join(x["name"] for x in t.get("artists", [])),
            "art_url": images[0]["url"] if images else None,
            "_popularity": t.get("popularity", 0),
        })

    # Text similarity alone can't tell a real artist from a same-named/near-named
    # dupe (cover bands, dead accounts) — blend in Spotify's own popularity so a
    # near-zero-popularity lookalike doesn't outrank the artist you're looking for.
    def _score(r: dict) -> float:
        return _similarity(q, r["name"], r["sub"]) + (r["_popularity"] / 100) * 0.15

    results.sort(key=_score, reverse=True)

    # Collapse same-name dupes within a type (a real artist and a same-named
    # dead/lookalike account, differing only in case/spacing) down to whichever
    # scored higher — already first, since we just sorted.
    seen: set[tuple[str, str]] = set()
    deduped = []
    for r in results:
        key = (r["type"], " ".join(r["name"].strip().lower().split()))
        if key in seen:
            continue
        seen.add(key)
        del r["_popularity"]
        deduped.append(r)
    return {"results": deduped}


class RadarAddIn(BaseModel):
    spotify_id: str
    type: str
    name: str
    sub: str
    art_url: str | None = None
    tag: str = "friend"


@router.post("")
def add_radar(body: RadarAddIn):
    if body.type not in ("artist", "album", "track"):
        raise HTTPException(400, "Invalid type")

    items = load_radar()
    item_id = f"{body.type}:{body.spotify_id}"
    existing = next((i for i in items if i["id"] == item_id), None)
    if existing and not existing.get("resolved_at"):
        raise HTTPException(409, "Already in Radar")
    if existing:
        # Re-adding something already cleared starts it fresh on Radar.
        items.remove(existing)

    art_path = download_artwork(body.name, body.type, body.art_url) if body.art_url else None
    if art_path:
        art_path = f"data/artwork/{Path(art_path).name}"
    item = {
        "id": item_id,
        "spotify_id": body.spotify_id,
        "type": body.type,
        "name": body.name,
        "sub": body.sub,
        "art_local_path": art_path,
        "tag": body.tag,
        "added_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    items.insert(0, item)
    save_radar(items)
    return {"ok": True, "item": _serialize(item)}


class RadarUpdateIn(BaseModel):
    tag: str


@router.put("/{item_id}")
def update_radar(item_id: str, body: RadarUpdateIn):
    items = load_radar()
    for i in items:
        if i["id"] == item_id:
            i["tag"] = body.tag
            save_radar(items)
            return {"ok": True}
    raise HTTPException(404, "Not found")


@router.delete("/{item_id}")
def delete_radar(item_id: str):
    # Soft delete: clearing an item keeps its record (stamped `resolved_at`) so the
    # Listened list and follow-through stats can see it.
    items = load_radar()
    for i in items:
        if i["id"] == item_id and not i.get("resolved_at"):
            i["resolved_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            save_radar(items)
            return {"ok": True}
    raise HTTPException(404, "Not found")
