from dotenv import load_dotenv
load_dotenv()

import asyncio
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from core.paths import data_path
from state import get_state
from routers import recent, artists, albums, playlists, stats, genre, settings, library, fetch, vinyl, dev, tops, claudio, revisit, auth

MOBILE_DIST = Path(__file__).parent.parent / "mobile-dist"

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
app.include_router(auth.router)


@app.on_event("startup")
async def startup():
    get_state()
    asyncio.create_task(_auto_poll_loop())


async def _auto_poll_loop():
    while True:
        await asyncio.sleep(10)  # check every 10s, fire when 60s have elapsed
        await asyncio.get_event_loop().run_in_executor(None, fetch.run_if_due)


@app.get("/api/health")
def health():
    return {"status": "ok"}


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
