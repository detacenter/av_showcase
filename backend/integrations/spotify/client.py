from integrations import api_metrics

RECENTLY_PLAYED_URL = "https://api.spotify.com/v1/me/player/recently-played"
PLAYER_URL          = "https://api.spotify.com/v1/me/player"
ARTISTS_URL         = "https://api.spotify.com/v1/artists"
ALBUM_TRACKS_URL    = "https://api.spotify.com/v1/albums/{}/tracks"


def get_recently_played(access_token: str, limit: int = 50) -> list[dict]:
    resp = api_metrics.get(
        "Spotify",
        "recently_played",
        RECENTLY_PLAYED_URL,
        headers={"Authorization": f"Bearer {access_token}"},
        params={"limit": limit},
    )
    resp.raise_for_status()

    plays = []
    for item in resp.json().get("items", []):
        track   = item["track"]
        album   = track["album"]
        context = item.get("context") or {}

        images = sorted(album.get("images", []), key=lambda x: x.get("width", 0), reverse=True)
        album_art_url = images[0]["url"] if images else None
        artist_names = [a["name"] for a in track.get("artists", [])]
        artist_ids   = [a["id"]   for a in track.get("artists", [])]

        plays.append({
            "played_at":    item["played_at"],
            "track_name":   track["name"],
            "artist_names": artist_names,
            "artist_ids":   artist_ids,
            "album_name":   album["name"],
            "track_id":     track["id"],
            "album_id":     album["id"],
            "duration_ms":  track["duration_ms"],
            "explicit":     track.get("explicit", False),
            "isrc":         track.get("external_ids", {}).get("isrc"),
            "album_type":         album.get("album_type"),
            "album_total_tracks": album.get("total_tracks"),
            "album_art_url":        album_art_url,
            "album_art_local_path": None,
            "release_year":  int(album["release_date"][:4]) if album.get("release_date", "")[:4].isdigit() else None,
            "track_number":  track.get("track_number"),
            "context_type":  context.get("type"),   # "album" | "playlist" | "artist" | "collection" | None
            "context_uri":   context.get("uri"),
            # device/shuffle filled in by get_player_state() after the fact
            "device_name":   None,
            "device_type":   None,
            "shuffle_state": None,
        })

    return plays


def get_player_state(access_token: str) -> dict | None:
    """Return current playback state or None if nothing is playing."""
    resp = api_metrics.get(
        "Spotify",
        "player_state",
        PLAYER_URL,
        headers={"Authorization": f"Bearer {access_token}"},
    )
    if resp.status_code == 204:   # no active player
        return None
    resp.raise_for_status()
    data = resp.json()
    if not data:
        return None
    device = data.get("device") or {}
    track  = (data.get("item") or {})
    return {
        "track_id":     track.get("id"),
        "device_name":  device.get("name"),
        "device_type":  device.get("type"),
        "shuffle_state": data.get("shuffle_state"),
    }


def get_album_tracks(access_token: str, album_id: str) -> list[dict]:
    """Fetch the full tracklist for an album, handling pagination.
    Returns a list of dicts with track_id, track_name, track_number,
    disc_number, duration_ms, explicit. ISRC is not available from
    this endpoint (simplified track objects)."""
    headers = {"Authorization": f"Bearer {access_token}"}
    url = ALBUM_TRACKS_URL.format(album_id)
    tracks = []
    while url:
        resp = api_metrics.get("Spotify", "album_tracks", url, headers=headers, params={"limit": 50})
        resp.raise_for_status()
        data = resp.json()
        for t in data.get("items", []):
            if not t or t.get("is_local"):
                continue
            tracks.append({
                "track_id":     t["id"],
                "track_name":   t["name"],
                "track_number": t.get("track_number"),
                "disc_number":  t.get("disc_number", 1),
                "duration_ms":  t.get("duration_ms"),
                "explicit":     t.get("explicit", False),
                "isrc":         None,  # not available in simplified track objects
            })
        url = data.get("next")
    return tracks


def get_artists(access_token: str, artist_ids: list[str]) -> dict[str, list[str]]:
    """Batch-fetch genres for artist IDs (up to 50 per request).
    Returns {artist_id: [genre, ...]}."""
    result: dict[str, list[str]] = {}
    for i in range(0, len(artist_ids), 50):
        batch = [aid for aid in artist_ids[i:i+50] if aid]
        if not batch:
            continue
        resp = api_metrics.get(
            "Spotify",
            "artists",
            ARTISTS_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            params={"ids": ",".join(batch)},
        )
        resp.raise_for_status()
        for a in resp.json().get("artists", []):
            if a:
                result[a["id"]] = a.get("genres", [])
    return result
