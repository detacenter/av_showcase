from fastapi import APIRouter, Query
from insights.genre_insights import (
    build_artist_network,
    build_artist_bubbles,
    build_genre_network,
    build_genre_color_map,
)
from state import get_state

router = APIRouter(prefix="/api/genre", tags=["genre"])


@router.get("/network")
def get_genre_network(days: int = Query(0)):
    state = get_state()
    return build_genre_network(state.log, state.lib, days)


@router.get("/artist-network")
def get_artist_network():
    state = get_state()
    return build_artist_network(state.lib)


@router.get("/bubbles")
def get_bubbles():
    state = get_state()
    return build_artist_bubbles(state.lib, state.log)


@router.get("/colors")
def get_colors():
    state = get_state()
    return build_genre_color_map(state.log, state.lib)
