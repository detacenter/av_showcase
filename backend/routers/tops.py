from __future__ import annotations

from fastapi import APIRouter, Body
from core.paths import data_path
from state import get_state

router = APIRouter(prefix="/api/tops", tags=["tops"])


def _art_url(art_path: str | None) -> str | None:
    if not art_path:
        return None
    from pathlib import Path as _P
    p = _P(art_path)
    try:
        rel = p.relative_to(data_path("artwork"))
        return f"/artwork/{rel}"
    except ValueError:
        pass
    parts = p.parts
    if "artwork" in parts:
        i = parts.index("artwork")
        return "/artwork/" + "/".join(parts[i + 1:])
    return None


def _decade_for_year(year: int | None) -> str:
    if not year:
        return "Unknown"
    return f"{(year // 10) * 10}s"


def _build_album_index():
    from insights.collection_insights import build_album_index
    state = get_state()
    return build_album_index(state.log), state.lib


def _album_info(info: dict) -> dict:
    return {
        "album_id":    info["album_id"],
        "album_name":  info.get("album_name", ""),
        "artist":      info.get("artist", ""),
        "art_url":     _art_url(info.get("art_path")),
        "release_year": info.get("release_year"),
    }


@router.get("")
def get_tops():
    albums, lib = _build_album_index()
    stored = lib.setdefault("album_tops", {}).setdefault("decades", {})

    decades: set[str] = {_decade_for_year(info.get("release_year")) for info in albums.values()}
    decades.update(stored.keys())
    known = sorted([d for d in decades if d != "Unknown"], reverse=True)
    decade_list = known + (["Unknown"] if "Unknown" in decades else [])

    result = []
    for decade in decade_list:
        album_ids = [aid for aid in stored.get(decade, []) if aid in albums][:10]
        result.append({
            "decade":    decade,
            "album_ids": album_ids,
            "albums":    {aid: _album_info(albums[aid]) for aid in album_ids},
        })
    return {"decades": result}


@router.get("/{decade}/eligible")
def get_eligible(decade: str):
    from persistence.library import album_data as _album_data
    albums, lib = _build_album_index()
    stored_set = set(lib.setdefault("album_tops", {}).setdefault("decades", {}).get(decade, []))

    rows = [
        info for info in albums.values()
        if _decade_for_year(info.get("release_year")) == decade
        and _album_data(lib, info["album_id"]).get("favorited")
        and info["album_id"] not in stored_set
    ]
    rows.sort(key=lambda info: (
        -_album_data(lib, info["album_id"]).get("rating", 0),
        -info.get("count", 0),
        info["album_name"].lower(),
    ))
    return {
        "albums": [
            {**_album_info(info), "rating": _album_data(lib, info["album_id"]).get("rating", 0)}
            for info in rows
        ]
    }


@router.post("/{decade}")
def save_tops(decade: str, body: dict = Body(...)):
    from persistence.library import save_library
    _, lib = _build_album_index()
    lib.setdefault("album_tops", {}).setdefault("decades", {})[decade] = [
        str(aid) for aid in body.get("album_ids", [])
    ]
    save_library(lib)
    return {"ok": True}
