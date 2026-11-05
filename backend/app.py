from dotenv import load_dotenv

load_dotenv()

import asyncio
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from core.paths import data_path
from routers import (
    albums,
    artists,
    auth,
    claudio,
    dev,
    fetch,
    genre,
    library,
    playlists,
    radar,
    recent,
    revisit,
    settings,
    stats,
    tops,
    vinyl,
)
from state import get_state

MOBILE_DIST = Path(__file__).parent.parent / "mobile-dist"
DESKTOP_DIST = Path(__file__).parent.parent / "desktop-dist"

app = FastAPI(title="Audiovault API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.middleware("http")
async def private_network_access(request, call_next):
    response = await call_next(request)
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response

artwork_dir = data_path("artwork")
if artwork_dir.exists():
    app.mount("/artwork", StaticFiles(directory=str(artwork_dir)), name="artwork")

vendor_dir = Path(__file__).parent / "static" / "vendor"
if vendor_dir.exists():
    app.mount("/vendor", StaticFiles(directory=str(vendor_dir)), name="vendor")

app.include_router(recent.router)
app.include_router(artists.router)
app.include_router(albums.router)
app.include_router(playlists.router)
app.include_router(stats.router)
app.include_router(genre.router)
app.include_router(settings.router)
app.include_router(library.router)
app.include_router(fetch.router)
app.include_router(vinyl.router)
app.include_router(dev.router)
app.include_router(tops.router)
app.include_router(claudio.router)
app.include_router(revisit.router)
app.include_router(radar.router)
app.include_router(auth.router)


@app.on_event("startup")
async def startup():
    get_state()
    asyncio.create_task(_auto_poll_loop())
    _resume_history_enrichment()


def _resume_history_enrichment():
    """Pick up any unfinished fill-in of the imported Spotify history, a minute after
    boot so startup stays fast. Progress is on disk, so this is always safe."""
    import os

    from services import history_enrich

    if os.environ.get("AUDIOVAULT_NO_ENRICH"):
        return
    try:
        rem = history_enrich.remaining() if history_enrich.sh.TRACKS_FILE.exists() else None
    except Exception:
        return
    if rem and (rem["albums"] or rem["spotify_albums"]):
        history_enrich.start(delay_s=60)


async def _auto_poll_loop():
    while True:
        await asyncio.sleep(10)  # check every 10s, fire when the next poll is due
        await asyncio.get_event_loop().run_in_executor(None, fetch.run_if_due)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# Desktop frontend for browsers (the Windows PC), built with `npm run build:pi`.
# Registered before the mobile catch-all below, which would otherwise claim /desktop.
if DESKTOP_DIST.exists():
    app.mount("/desktop/assets", StaticFiles(directory=str(DESKTOP_DIST / "assets")), name="desktop-assets")

    @app.get("/desktop")
    def desktop_root():
        return RedirectResponse("/desktop/")

    @app.get("/desktop/{full_path:path}")
    def serve_desktop(full_path: str):
        file = (DESKTOP_DIST / full_path).resolve()
        if full_path and file.is_file() and file.is_relative_to(DESKTOP_DIST.resolve()):
            return FileResponse(file)
        return FileResponse(
            DESKTOP_DIST / "index.html",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )


if MOBILE_DIST.exists():
    app.mount("/assets", StaticFiles(directory=str(MOBILE_DIST / "assets")), name="mobile-assets")

    @app.get("/{full_path:path}")
    def serve_mobile(full_path: str):
        file = MOBILE_DIST / full_path
        if file.is_file():
            return FileResponse(file)
        # index.html: no-cache so browser always revalidates and picks up new deploys
        return FileResponse(
            MOBILE_DIST / "index.html",
            headers={"Cache-Control": "no-cache, must-revalidate"},
        )
