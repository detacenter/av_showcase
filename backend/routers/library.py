from fastapi import APIRouter
from pydantic import BaseModel
from persistence.library import (
    load_library, save_library,
    toggle_album_favorite, toggle_artist_favorite, toggle_track_favorite,
    toggle_track_revisit, toggle_artist_revisit,
    set_album_rating, set_album_notes,
    set_artist_genres,
)
from state import reload_state

router = APIRouter(prefix="/api/library", tags=["library"])


class RatingBody(BaseModel):
    rating: int


class NotesBody(BaseModel):
    notes: str


class GenresBody(BaseModel):
    genres: list[str]


@router.post("/album/{album_id}/favorite")
def album_favorite(album_id: str):
    lib = load_library()
    toggle_album_favorite(lib, album_id)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/album/{album_id}/rating")
def album_rating(album_id: str, body: RatingBody):
    lib = load_library()
    set_album_rating(lib, album_id, body.rating)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/album/{album_id}/notes")
def album_notes(album_id: str, body: NotesBody):
    lib = load_library()
    set_album_notes(lib, album_id, body.notes)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/artist/{name}/favorite")
def artist_favorite(name: str):
    lib = load_library()
    toggle_artist_favorite(lib, name)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/artist/{name}/revisit")
def artist_revisit(name: str):
    lib = load_library()
    toggle_artist_revisit(lib, name)
    save_library(lib)
    reload_state()
    return {"ok": True}


class HeroArtBody(BaseModel):
    art_filename: str


@router.post("/artist/{name}/hero-art")
def artist_hero_art(name: str, body: HeroArtBody):
    lib = load_library()
    lib.setdefault("artists", {}).setdefault(name, {})["hero_art_filename"] = body.art_filename
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.delete("/artist/{name}/hero-art")
def clear_artist_hero_art(name: str):
    lib = load_library()
    lib.get("artists", {}).get(name, {}).pop("hero_art_filename", None)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/artist/{name}/genres")
def artist_genres(name: str, body: GenresBody):
    lib = load_library()
    set_artist_genres(lib, name, body.genres)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/track/{track_id}/favorite")
def track_favorite(track_id: str):
    lib = load_library()
    toggle_track_favorite(lib, track_id)
    save_library(lib)
    reload_state()
    return {"ok": True}


@router.post("/track/{track_id}/revisit")
def track_revisit(track_id: str):
    lib = load_library()
    toggle_track_revisit(lib, track_id)
    save_library(lib)
    reload_state()
    return {"ok": True}


# ── Track overrides ───────────────────────────────────────────────────────────

from persistence.storage import load_track_overrides, save_track_overrides
from integrations.spotify.auth import get_access_token
from integrations.spotify.client import get_album
from integrations.spotify.artwork import download_artwork


class TrackOverrideIn(BaseModel):
    track_id: str
    album_id: str


@router.post("/track-override")
def set_track_override(body: TrackOverrideIn):
    token = get_access_token()
    album = get_album(token, body.album_id)
    if not album:
        from fastapi import HTTPException
        raise HTTPException(404, "Album not found on Spotify")
    artist = album["artist_names"][0] if album["artist_names"] else "unknown"
    art_path = download_artwork(artist, album["album_name"], album.get("album_art_url"))
    overrides = load_track_overrides()
    overrides[body.track_id] = {
        "album_id":             album["album_id"],
        "album_name":           album["album_name"],
        "artist_names":         album["artist_names"],
        "release_year":         album["release_year"],
        "album_art_local_path": art_path,
    }
    save_track_overrides(overrides)
    reload_state()
    return {"ok": True, "override": overrides[body.track_id]}


@router.delete("/track-override/{track_id}")
def delete_track_override(track_id: str):
    overrides = load_track_overrides()
    if track_id in overrides:
        del overrides[track_id]
        save_track_overrides(overrides)
        reload_state()
    return {"ok": True}


@router.get("/track-overrides")
def list_track_overrides():
    return load_track_overrides()
