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
