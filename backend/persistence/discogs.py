from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

_FILE = data_path("discogs_collection.json")
_WANTLIST_FILE = data_path("discogs_wantlist.json")


def load_collection() -> list[dict]:
    ensure_data_dir()
    if not _FILE.exists():
        return []
    with _FILE.open() as f:
        return json.load(f)


def save_collection(records: list[dict]) -> None:
    ensure_data_dir()
    with _FILE.open("w") as f:
        json.dump(records, f, indent=2)


def normalize_record(item: dict) -> dict:
    """Flatten a raw Discogs collection item into a clean local record."""
    basic = item.get("basic_information", {})
    detail = item.get("detail", {})

    artists = basic.get("artists") or detail.get("artists") or []
    artist_names = [a["name"].strip().rstrip(",") for a in artists if a.get("name")]

    labels = basic.get("labels") or detail.get("labels") or []
    label_names = [l["name"] for l in labels if l.get("name")]
    catnos = [l["catno"] for l in labels if l.get("catno") and l["catno"] != "none"]

    formats = basic.get("formats") or detail.get("formats") or []
    format_names = [f["name"] for f in formats]
    format_descs: list[str] = []
    for f in formats:
        format_descs.extend(f.get("descriptions") or [])
        if f.get("text"):
            format_descs.append(f["text"])

    tracklist = []
    for t in detail.get("tracklist") or []:
        if t.get("type") == "track" or t.get("position"):
            tracklist.append({
                "position": t.get("position", ""),
                "title": t.get("title", ""),
                "duration": t.get("duration", ""),
            })

    community = detail.get("community", {})
    community_rating = community.get("rating", {})

    identifiers = detail.get("identifiers") or []
    barcode = next((i["value"] for i in identifiers if i.get("type") == "Barcode"), None)
    matrix = next((i["value"] for i in identifiers if "Matrix" in i.get("type", "")), None)

    return {
        "instance_id": item.get("instance_id"),
        "release_id": item.get("id") or basic.get("id"),
        "master_id": detail.get("master_id") or basic.get("master_id"),
        "date_added": item.get("date_added"),
        "user_rating": item.get("rating", 0),
        "folder_id": item.get("folder_id", 0),
        "title": basic.get("title") or detail.get("title", ""),
        "artists": artist_names,
        "year": basic.get("year") or detail.get("year"),
        "released": detail.get("released"),
        "country": detail.get("country"),
        "labels": label_names,
        "catnos": catnos,
        "genres": basic.get("genres") or detail.get("genres") or [],
        "styles": basic.get("styles") or detail.get("styles") or [],
        "formats": format_names,
        "format_descriptions": format_descs,
        "thumb": basic.get("thumb") or detail.get("thumb", ""),
        "art_path": item.get("art_path"),
        "cover_image": (detail.get("images") or [{}])[0].get("uri", basic.get("thumb", "")),
        "tracklist": tracklist,
        "community_have": community.get("have", 0),
        "community_want": community.get("want", 0),
        "community_rating_avg": community_rating.get("average", 0.0),
        "community_rating_count": community_rating.get("count", 0),
        "barcode": barcode,
        "matrix": matrix,
        "notes": detail.get("notes", ""),
        "original_year": None,
    }


def load_wantlist() -> list[dict]:
    ensure_data_dir()
    if not _WANTLIST_FILE.exists():
        return []
    with _WANTLIST_FILE.open() as f:
        return json.load(f)


def save_wantlist(records: list[dict]) -> None:
    ensure_data_dir()
    with _WANTLIST_FILE.open("w") as f:
        json.dump(records, f, indent=2)


def classify_vinyl_type(record: dict) -> str:
    descs = set(record.get("format_descriptions") or [])
    if "Compilation" in descs:
        return "Compilation"
    if '7"' in descs:
        return '7"'
    if '12"' in descs and "LP" not in descs:
        return '12"'
    if "EP" in descs:
        return "EP"
    return "LP"
