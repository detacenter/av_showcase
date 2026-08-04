from __future__ import annotations

import os
import time

from integrations import api_metrics
from core.paths import data_path, ensure_data_dir

_BASE = "https://api.discogs.com"
_USERNAME = os.environ.get("DISCOGS_USERNAME", "")
_ART_DIR = data_path("artwork", "vinyl")


def _art_path(release_id: int) -> str:
    ensure_data_dir()
    _ART_DIR.mkdir(parents=True, exist_ok=True)
    return str(_ART_DIR / f"{release_id}.jpg")


def download_vinyl_art(release_id: int, url: str | None) -> str | None:
    if not url:
        return None
    path = _art_path(release_id)
    if os.path.exists(path) and os.path.getsize(path) > 20_000:
        return path
    try:
        resp = api_metrics.get("Discogs", "vinyl_art", url, headers=_headers(), timeout=15)
        resp.raise_for_status()
        with open(path, "wb") as f:
            f.write(resp.content)
        return path
    except Exception as exc:
        print(f"  Vinyl art download failed (release {release_id}): {exc}")
        return None


def _headers() -> dict:
    token = os.environ.get("DISCOGS_TOKEN", "")
    return {
        "Authorization": f"Discogs token={token}",
        "User-Agent": "Audiovault/1.0",
    }


def _get(path: str, params: dict | None = None) -> dict:
    operation = "collection" if "/collection/" in path else path.strip("/").split("/", 1)[0]
    resp = api_metrics.get("Discogs", operation, f"{_BASE}{path}", headers=_headers(), params=params, timeout=15)
    resp.raise_for_status()
    return resp.json()


def fetch_collection(progress_cb=None) -> list[dict]:
    """Fetch all releases from the user's Discogs collection (folder 0 = All)."""
    releases: list[dict] = []
    page = 1
    total_pages = 1

    while page <= total_pages:
        data = _get(
            f"/users/{_USERNAME}/collection/folders/0/releases",
            params={"page": page, "per_page": 100, "sort": "artist", "sort_order": "asc"},
        )
        pagination = data.get("pagination", {})
        total_pages = pagination.get("pages", 1)
        items = data.get("releases", [])
        releases.extend(items)
        if progress_cb:
            progress_cb(len(releases), pagination.get("items", len(releases)))
        page += 1
        if page <= total_pages:
            time.sleep(1.0)

    return releases


def fetch_release_detail(release_id: int) -> dict:
    return _get(f"/releases/{release_id}")


def fetch_master_year(master_id: int) -> int | None:
    try:
        data = _get(f"/masters/{master_id}")
        return data.get("year")
    except Exception as exc:
        print(f"  Master year fetch failed (master {master_id}): {exc}")
        return None


def smart_sync(
    existing_cache: dict[int, dict],
    progress_cb=None,
) -> list[dict]:
    """
    Single smart sync operation:
    1. Fetch full collection list from Discogs
    2. Drop any local records no longer in the collection (removals)
    3. Enrich only records not already complete in the cache (new additions)
    4. Backfill original_year for any record missing it

    A record is considered complete if it has catnos in the cache — meaning
    the full release detail was previously fetched successfully.
    """
    # ── Step 1: fetch collection list ─────────────────────────────────────────
    def _cb(done, total):
        if progress_cb:
            progress_cb(f"Fetching collection… {done}/{total}", done, total, "fetch")

    raw = fetch_collection(progress_cb=_cb)
    discogs_ids = {item["id"] for item in raw if item.get("id")}

    # ── Step 2: drop removals ─────────────────────────────────────────────────
    result: dict[int, dict] = {rid: rec for rid, rec in existing_cache.items() if rid in discogs_ids}

    # ── Step 3: enrich new records ────────────────────────────────────────────
    new_items = [item for item in raw if item.get("id") not in result]
    total_new = len(new_items)

    for i, item in enumerate(new_items):
        release_id = item["id"]
        if progress_cb:
            progress_cb(
                f"Fetching details… {i + 1}/{total_new}", i + 1, total_new, "enrich"
            )
        detail: dict = {}
        try:
            detail = fetch_release_detail(release_id)
        except Exception as exc:
            print(f"  Detail fetch failed (release {release_id}): {exc}")

        images = detail.get("images") or []
        full_url = images[0].get("uri") if images else None
        thumb = item.get("basic_information", {}).get("thumb") or detail.get("thumb")
        art_path = download_vinyl_art(release_id, full_url or thumb)

        from persistence.discogs import normalize_record
        record = normalize_record({**item, "art_path": art_path, "detail": detail})
        result[release_id] = record
        time.sleep(1.0)

    # ── Step 4: backfill original_year for any record missing it ──────────────
    needs_year = [
        rec for rec in result.values()
        if rec.get("master_id") and rec.get("original_year") is None
    ]
    total_year = len(needs_year)

    for i, rec in enumerate(needs_year):
        if progress_cb:
            progress_cb(
                f"Fetching original years… {i + 1}/{total_year}", i + 1, total_year, "years"
            )
        year = fetch_master_year(rec["master_id"])
        if year:
            rec["original_year"] = year
        time.sleep(1.0)

    return list(result.values())


def fetch_wantlist(progress_cb=None) -> list[dict]:
    """Fetch all releases from the user's Discogs wantlist."""
    from persistence.discogs import normalize_record
    wants: list[dict] = []
    page = 1
    total_pages = 1

    while page <= total_pages:
        data = _get(
            f"/users/{_USERNAME}/wants",
            params={"page": page, "per_page": 100, "sort": "artist", "sort_order": "asc"},
        )
        pagination = data.get("pagination", {})
        total_pages = pagination.get("pages", 1)
        items = data.get("wants", [])
        wants.extend(items)
        if progress_cb:
            progress_cb(len(wants), pagination.get("items", len(wants)))
        page += 1
        if page <= total_pages:
            time.sleep(1.0)

    result = []
    for item in wants:
        basic = item.get("basic_information", {})
        release_id = item.get("id") or basic.get("id")
        if not release_id:
            continue
        artists = basic.get("artists") or []
        artist_names = [a["name"].strip().rstrip(",") for a in artists if a.get("name")]
        labels = basic.get("labels") or []
        label_names = [l["name"] for l in labels if l.get("name")]
        formats = basic.get("formats") or []
        format_names = [f["name"] for f in formats]
        format_descs: list[str] = []
        for f in formats:
            format_descs.extend(f.get("descriptions") or [])
        result.append({
            "release_id": release_id,
            "date_added": item.get("date_added"),
            "notes": item.get("notes", ""),
            "rating": item.get("rating", 0),
            "title": basic.get("title", ""),
            "artists": artist_names,
            "year": basic.get("year"),
            "labels": label_names,
            "genres": basic.get("genres") or [],
            "styles": basic.get("styles") or [],
            "formats": format_names,
            "format_descriptions": format_descs,
            "thumb": basic.get("thumb", ""),
            "cover_image": basic.get("cover_image", basic.get("thumb", "")),
        })
    return result
