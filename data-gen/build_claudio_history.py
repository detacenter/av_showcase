"""
One-off script: build Claudio's demo history from the user's REAL
recommendations_history.json rather than hand-writing content. Album,
artist, year, genres, blurb, sounds_like, track_count, and art are all real
Claude-generated output about public albums — same "safe to reuse" tier as
the rest of this repo's real catalog data. Real album art is bundled from
the same local cache the main catalog pipeline already copies from.

Two fields are deliberately NOT copied verbatim (explicit user decision):
- `why_you` in the real data references real favorite/listening patterns
  ("Your X obsession points straight here") — genuine behavioral data, not
  public catalog info. Regenerated here from only genres/sounds_like, which
  are public.
- `feedback` (thumbs up/down) reflects the real user's real reactions —
  reset to null so the demo starts from a blank slate.

Not part of the regular Stage 1/2 pipeline (recommendations_history.json
isn't read anywhere else in this repo); run manually, once.
"""
from __future__ import annotations

import json
import os
import re
import shutil
from pathlib import Path

REAL_DATA_DIR = Path(os.environ.get(
    "AUDIOVAULT_DATA_DIR",
    os.path.expanduser("~/Library/Application Support/Audiovault"),
))
REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_HISTORY_FILE = REPO_ROOT / "frontend" / "public" / "mock-api" / "claudio-history.json"
OUT_ARTWORK_DIR = REPO_ROOT / "data" / "artwork"


_WHY_YOU_TEMPLATES = [
    "Sits close to {artist} in your library.",
    "A natural next step from {artist}.",
    "Overlaps with your {genre} listening.",
    "In the same lane as {artist}, from a different angle.",
    "Draws on the {genre} side of your library.",
]


def _generic_why_you(rec: dict, index: int) -> str:
    genres = rec.get("genres") or []
    sounds_like = rec.get("sounds_like") or []
    template = _WHY_YOU_TEMPLATES[index % len(_WHY_YOU_TEMPLATES)]
    if "{artist}" in template and not sounds_like:
        template = "Draws on the {genre} side of your library."
    if "{genre}" in template and not genres:
        template = "Sits close to {artist} in your library." if sounds_like else "A fit for your listening profile."
    return template.format(
        artist=sounds_like[0] if sounds_like else "",
        genre=genres[0] if genres else "",
    )


def _bundle_art(art_local_path: str) -> str | None:
    if not art_local_path:
        return None
    rel = art_local_path[len("data/"):] if art_local_path.startswith("data/") else art_local_path
    src = REAL_DATA_DIR / rel
    if not src.exists():
        return None
    dst = OUT_ARTWORK_DIR / Path(rel).name
    OUT_ARTWORK_DIR.mkdir(parents=True, exist_ok=True)
    if not dst.exists():
        shutil.copyfile(src, dst)
    return f"data/artwork/{Path(rel).name}"


def _clean_rec(rec: dict, index: int) -> dict:
    return {
        "album": rec["album"],
        "artist": rec["artist"],
        "year": rec["year"],
        "genres": rec.get("genres", []),
        "track_count": rec.get("track_count", 0),
        "why_you": _generic_why_you(rec, index),
        "blurb": rec.get("blurb", ""),
        "sounds_like": rec.get("sounds_like", []),
        "art_local_path": _bundle_art(rec.get("art_local_path", "")),
        "feedback": None,
    }


def main() -> None:
    src = json.loads((REAL_DATA_DIR / "recommendations_history.json").read_text())
    batches = src["batches"]

    counter = 0
    cleaned_batches = []
    for b in batches:
        recs = []
        for r in b["recommendations"]:
            recs.append(_clean_rec(r, counter))
            counter += 1
        cleaned_batches.append({"generated_at": b["generated_at"], "recommendations": recs})

    initial = [cleaned_batches[-1]]
    pool = cleaned_batches[:-1]

    OUT_HISTORY_FILE.write_text(json.dumps({"initial": initial, "pool": pool}, indent=2))

    n_recs = sum(len(b["recommendations"]) for b in cleaned_batches)
    n_art = sum(
        1 for b in cleaned_batches for r in b["recommendations"] if r["art_local_path"]
    )
    print(f"{len(cleaned_batches)} batches, {n_recs} recommendations, {n_art} with real art bundled")
    print(f"Wrote {OUT_HISTORY_FILE}")


if __name__ == "__main__":
    main()
