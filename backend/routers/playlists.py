from __future__ import annotations

import random
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from insights.playlist_insights import evaluate_playlist, get_all_sessions
from persistence.playlists import (
    delete_playlist,
    load_playlists,
    new_playlist,
    save_playlist as _persist_save,
)
from state import get_state

router = APIRouter(prefix="/api/playlists", tags=["playlists"])


def _with_count(p: dict, log: list, lib: dict) -> dict:
    tracks = evaluate_playlist(p, log, lib)
    seen_albums: set[str] = set()
    all_art: list[str] = []
    for t in tracks:
        album_id = t.get("album_id", "")
        if album_id and album_id not in seen_albums:
            seen_albums.add(album_id)
            local = t.get("album_art_local_path")
            if local:
                all_art.append(Path(local).name)
    random.shuffle(all_art)
    return {**p, "track_count": len(tracks), "art_filenames": all_art[:4]}


@router.get("")
def get_playlists():
    state = get_state()
    playlists = load_playlists()
    evaluated = [_with_count(p, state.log, state.lib) for p in playlists]
    all_genres = sorted({
        g for a in state.lib.get("artists", {}).values()
        for g in a.get("genres", []) if g
    })
    return {"playlists": evaluated, "all_genres": all_genres}


@router.get("/sessions")
def get_sessions_route():
    state = get_state()
    return get_all_sessions(state.log)


@router.post("")
def create_playlist(body: dict = Body(default={})):
    playlists = load_playlists()
    p = new_playlist(playlists, body.get("name", "Untitled"))
    state = get_state()
    return _with_count(p, state.log, state.lib)


@router.put("/{playlist_id}")
def update_playlist(playlist_id: str, body: dict = Body(...)):
    playlists = load_playlists()
    for p in playlists:
        if p["id"] == playlist_id:
            p["name"] = body.get("name", p["name"])
            p["rule_groups"] = body.get("rule_groups", p.get("rule_groups", []))
            p["pinned_track_ids"] = body.get("pinned_track_ids", p.get("pinned_track_ids", []))
            p["excluded_track_ids"] = body.get("excluded_track_ids", p.get("excluded_track_ids", []))
            _persist_save(playlists, p)
            state = get_state()
            return _with_count(p, state.log, state.lib)
    raise HTTPException(status_code=404, detail="Playlist not found")


@router.delete("/{playlist_id}")
def delete_playlist_route(playlist_id: str):
    playlists = load_playlists()
    delete_playlist(playlists, playlist_id)
    return {"ok": True}


@router.get("/{playlist_id}/evaluate")
def evaluate_route(playlist_id: str):
    state = get_state()
    playlists = load_playlists()
    for p in playlists:
        if p["id"] == playlist_id:
            tracks = evaluate_playlist(p, state.log, state.lib)
            return {"tracks": tracks}
    raise HTTPException(status_code=404, detail="Playlist not found")
