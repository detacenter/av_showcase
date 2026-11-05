from __future__ import annotations

import json

from core.paths import data_path, ensure_data_dir

_FILE = data_path("vinyl_links.json")

_EMPTY: dict = {"confirmed": [], "dismissed": []}


def load_links() -> dict:
    ensure_data_dir()
    if not _FILE.exists():
        return {"confirmed": [], "dismissed": []}
    with _FILE.open() as f:
        return json.load(f)


def save_links(links: dict) -> None:
    ensure_data_dir()
    with _FILE.open("w") as f:
        json.dump(links, f, indent=2)


_confirmed_album_ids_cache: set[str] | None = None


def _invalidate() -> None:
    global _confirmed_album_ids_cache
    _confirmed_album_ids_cache = None


def confirmed_album_ids() -> set[str]:
    global _confirmed_album_ids_cache
    if _confirmed_album_ids_cache is None:
        _confirmed_album_ids_cache = {p["album_id"] for p in load_links().get("confirmed", [])}
    return _confirmed_album_ids_cache


def add_confirmed(release_id: int, album_id: str) -> None:
    links = load_links()
    pair = {"release_id": release_id, "album_id": album_id}
    if pair not in links["confirmed"]:
        links["confirmed"].append(pair)
    save_links(links)
    _invalidate()


def add_dismissed(release_id: int, album_id: str) -> None:
    links = load_links()
    pair = {"release_id": release_id, "album_id": album_id}
    if pair not in links["dismissed"]:
        links["dismissed"].append(pair)
    save_links(links)
    _invalidate()


def confirmed_pairs() -> set[tuple[int, str]]:
    return {(p["release_id"], p["album_id"]) for p in load_links().get("confirmed", [])}


def dismissed_pairs() -> set[tuple[int, str]]:
    return {(p["release_id"], p["album_id"]) for p in load_links().get("dismissed", [])}


def follow_album_aliases(aliases: dict[str, str]) -> bool:
    """Move links onto the surviving id when albums are merged (edition duplicates, or an
    imported placeholder id replaced by the real one). Without this a linked record kept
    pointing at the merged-away id: the matcher offered it again under the new id and the
    album/artist pages lost its vinyl (9 records on 2026-11-03). Saves only if changed."""
    if not aliases:
        return False
    links = load_links()
    changed = False
    for key in ("confirmed", "dismissed"):
        out: list[dict] = []
        for p in links.get(key, []):
            aid = p["album_id"]
            seen = set()
            while aid in aliases and aid not in seen:   # chains end at the surviving id
                seen.add(aid)
                aid = aliases[aid]
            q = {"release_id": p["release_id"], "album_id": aid}
            changed |= aid != p["album_id"]
            if q not in out:
                out.append(q)
            else:
                changed = True
        links[key] = out
    if changed:
        save_links(links)
        _invalidate()
    return changed


def linked_release_ids() -> set[int]:
    """Records already linked to an album. A record belongs to one album; an album can
    have several records (pressings), so only the record side is ever closed off."""
    return {p["release_id"] for p in load_links().get("confirmed", [])}


def vinyl_ids_for_album(album_id: str) -> list[int]:
    return [p["release_id"] for p in load_links().get("confirmed", []) if p["album_id"] == album_id]


def album_id_for_vinyl(release_id: int) -> str | None:
    for p in load_links().get("confirmed", []):
        if p["release_id"] == release_id:
            return p["album_id"]
    return None
