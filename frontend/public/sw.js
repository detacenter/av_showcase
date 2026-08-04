// Mock API layer for the av_showcase demo. Intercepts fetch() calls to /api/*
// made by the (unmodified) real frontend and answers them from static JSON
// snapshots — see ~/.engram/PRJ/PRJ-0005/notes.md "Phase 3 scoping" for the
// full architecture rationale. Never makes a real network request for /api/*.
//
// Mutations (favorite/revisit/delete) are held in an in-memory overlay only —
// intentionally NOT persisted to localStorage/IndexedDB, so a reload always
// returns to a clean demo state. This is a deliberate choice, not a limitation
// (see "Mutation persistence" decision in notes.md).

const SNAPSHOT_BASE = "/mock-api";

// In-memory overlay — lives only as long as this service worker instance does.
const overlay = {
  trackFavorites: {},   // track_id -> bool (only stores overrides, not full state)
  trackRevisits: {},    // track_id -> bool
  deletedPlays: new Set(), // played_at strings
  artistFavorites: {},  // artist name -> bool
  artistGenres: {},     // artist name -> string[]
  artistHeroArt: {},    // artist name -> art_filename
  albumFavorites: {},   // album_id -> bool
  albumRatings: {},     // album_id -> int (0-20)
  albumNotes: {},       // album_id -> string
  playlistOverrides: {}, // playlist_id -> {name, rule_groups, pinned_track_ids, excluded_track_ids}
  deletedPlaylists: new Set(), // playlist ids
  createdPlaylists: [],  // playlist objects created client-side this session
};

let _playlistCounter = 0;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function normalizeSearch(s) {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function loadSnapshot(name) {
  const res = await fetch(`${SNAPSHOT_BASE}/${name}`);
  return res.json();
}

function applyOverlayToEntries(entries) {
  return entries
    .filter((e) => !overlay.deletedPlays.has(e.played_at))
    .map((e) => ({
      ...e,
      is_favorited: overlay.trackFavorites[e.track_id] ?? e.is_favorited,
      is_revisit: overlay.trackRevisits[e.track_id] ?? e.is_revisit,
    }));
}

async function handleRecentAlbums(url) {
  const data = await loadSnapshot("recent-albums.json");
  const q = url.searchParams.get("q") || "";
  const query = q ? normalizeSearch(q) : "";

  let albums = data.albums.map((album) => ({
    ...album,
    entries: applyOverlayToEntries(album.entries || []),
  }));

  // Drop albums that lost all their entries to the delete overlay.
  albums = albums.filter((a) => a.source === "vinyl" || a.entries.length > 0);

  if (query) {
    albums = albums
      .map((album) => {
        if (album.source === "vinyl") {
          const matches =
            query.length === 0 ||
            normalizeSearch(album.album_name || "").includes(query) ||
            normalizeSearch(album.artist || "").includes(query);
          return matches ? album : null;
        }
        const matchedEntries = album.entries.filter((e) => {
          const fields = [album.album_name, album.artist, e.track_name];
          return fields.some((f) => f && normalizeSearch(f).includes(query));
        });
        return matchedEntries.length ? { ...album, entries: matchedEntries } : null;
      })
      .filter(Boolean);
  }

  return jsonResponse({ albums });
}

function handleTrackFavorite(trackId) {
  const current = overlay.trackFavorites[trackId] ?? false;
  overlay.trackFavorites[trackId] = !current;
  return jsonResponse({ favorited: overlay.trackFavorites[trackId] });
}

function handleTrackRevisit(trackId) {
  const current = overlay.trackRevisits[trackId] ?? false;
  overlay.trackRevisits[trackId] = !current;
  return jsonResponse({ revisit: overlay.trackRevisits[trackId] });
}

function handleDeletePlay(playedAt) {
  overlay.deletedPlays.add(decodeURIComponent(playedAt));
  return jsonResponse({ ok: true });
}

async function handleAlbums() {
  const data = await loadSnapshot("albums.json");
  const albums = data.albums.map((album) => ({
    ...album,
    is_favorited: overlay.albumFavorites[album.album_id] ?? album.is_favorited,
    rating: overlay.albumRatings[album.album_id] ?? album.rating,
    notes: overlay.albumNotes[album.album_id] ?? album.notes,
    track_plays: album.track_plays.map((t) => ({
      ...t,
      is_favorited: overlay.trackFavorites[t.track_id] ?? t.is_favorited,
    })),
  }));
  return jsonResponse({ albums, all_genres: data.all_genres, year_bounds: data.year_bounds });
}

function applyPlaylistOverride(p) {
  const o = overlay.playlistOverrides[p.id];
  return o ? { ...p, ...o } : p;
}

async function handlePlaylists() {
  const data = await loadSnapshot("playlists.json");
  const base = data.playlists
    .filter((p) => !overlay.deletedPlaylists.has(p.id))
    .map(applyPlaylistOverride);
  const created = overlay.createdPlaylists
    .filter((p) => !overlay.deletedPlaylists.has(p.id))
    .map(applyPlaylistOverride);
  return jsonResponse({ playlists: [...base, ...created], all_genres: data.all_genres });
}

async function handlePlaylistSessions() {
  return jsonResponse(await loadSnapshot("playlist-sessions.json"));
}

async function handlePlaylistEvaluate(id) {
  const evaluated = await loadSnapshot("playlists-evaluate.json");
  // Client-created playlists and rule-group edits to existing ones have no
  // live backend to re-run evaluation against — always serves the original
  // canned tracklist (empty for newly created playlists). Matches this
  // demo's "no live logic behind mutations" approach everywhere else.
  return jsonResponse({ tracks: evaluated[id] ?? [] });
}

function handleCreatePlaylist(body) {
  const id = `pl-demo-${Date.now()}-${_playlistCounter++}`;
  const playlist = {
    id,
    name: (body && body.name) || "Untitled",
    rule_groups: [],
    pinned_track_ids: [],
    excluded_track_ids: [],
    track_count: 0,
    art_filenames: [],
  };
  overlay.createdPlaylists.push(playlist);
  return jsonResponse(playlist);
}

async function handleUpdatePlaylist(id, body) {
  const fields = ["name", "rule_groups", "pinned_track_ids", "excluded_track_ids"];
  const patch = {};
  for (const f of fields) if (body && body[f] !== undefined) patch[f] = body[f];
  overlay.playlistOverrides[id] = { ...overlay.playlistOverrides[id], ...patch };

  const created = overlay.createdPlaylists.find((p) => p.id === id);
  if (created) return jsonResponse(applyPlaylistOverride(created));

  const data = await loadSnapshot("playlists.json");
  const base = data.playlists.find((p) => p.id === id);
  if (!base) return jsonResponse({ error: "not found" }, 404);
  return jsonResponse(applyPlaylistOverride(base));
}

function handleDeletePlaylist(id) {
  overlay.deletedPlaylists.add(id);
  return jsonResponse({ ok: true });
}

async function handleRevisit() {
  const data = await loadSnapshot("revisit.json");
  // Un-revisiting from this view works fully (filters the track out below).
  // A track newly flagged for revisit from RecentView won't retroactively
  // appear here — building a full revisit-card entry (name/artist/art/etc.)
  // for an arbitrary track_id would need a full track-metadata index this
  // demo doesn't otherwise need; same "no live logic behind mutations"
  // simplification as playlist rule edits.
  const tracks = data.tracks.filter((t) => (overlay.trackRevisits[t.track_id] ?? true) !== false);
  return jsonResponse({ tracks });
}

async function handleArtists() {
  const data = await loadSnapshot("artists.json");
  const artists = data.artists.map((a) => ({
    ...a,
    is_favorited: overlay.artistFavorites[a.name] ?? a.is_favorited,
    hero_art_filename: overlay.artistHeroArt[a.name] ?? a.hero_art_filename,
  }));
  return jsonResponse({ artists, all_genres: data.all_genres });
}

async function handleArtistDetail(name) {
  const details = await loadSnapshot("artists-detail.json");
  const detail = details[name];
  if (!detail) return jsonResponse({ error: "not found" }, 404);

  const albums = detail.albums.map((album) => ({
    ...album,
    is_favorited: overlay.albumFavorites[album.album_id] ?? album.is_favorited,
    rating: overlay.albumRatings[album.album_id] ?? album.rating,
    notes: overlay.albumNotes[album.album_id] ?? album.notes,
    track_plays: album.track_plays.map((t) => ({
      ...t,
      is_favorited: overlay.trackFavorites[t.track_id] ?? t.is_favorited,
    })),
  }));

  return jsonResponse({
    ...detail,
    is_favorited: overlay.artistFavorites[name] ?? detail.is_favorited,
    genres: overlay.artistGenres[name] ?? detail.genres,
    albums,
  });
}

function handleArtistFavorite(name) {
  const current = overlay.artistFavorites[name] ?? false;
  overlay.artistFavorites[name] = !current;
  return jsonResponse({ ok: true });
}

function handleArtistHeroArt(name, body) {
  overlay.artistHeroArt[name] = body.art_filename;
  return jsonResponse({ ok: true });
}

function handleArtistGenres(name, body) {
  overlay.artistGenres[name] = body.genres;
  return jsonResponse({ ok: true });
}

function handleAlbumFavorite(albumId) {
  const current = overlay.albumFavorites[albumId] ?? false;
  overlay.albumFavorites[albumId] = !current;
  return jsonResponse({ ok: true });
}

function handleAlbumRating(albumId, body) {
  overlay.albumRatings[albumId] = body.rating;
  return jsonResponse({ ok: true });
}

function handleAlbumNotes(albumId, body) {
  overlay.albumNotes[albumId] = body.notes;
  return jsonResponse({ ok: true });
}

async function handleApiRequest(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (path === "/api/recent/albums" && method === "GET") {
    return handleRecentAlbums(url);
  }

  if (path === "/api/settings" && method === "GET") {
    return jsonResponse(await loadSnapshot("settings.json"));
  }

  if (path === "/api/artists" && method === "GET") {
    return handleArtists();
  }

  if (path === "/api/albums" && method === "GET") {
    return handleAlbums();
  }

  if (path === "/api/playlists" && method === "GET") {
    return handlePlaylists();
  }
  if (path === "/api/playlists" && method === "POST") {
    return handleCreatePlaylist(await request.json().catch(() => ({})));
  }
  if (path === "/api/playlists/sessions" && method === "GET") {
    return handlePlaylistSessions();
  }

  if (path === "/api/revisit" && method === "GET") {
    return handleRevisit();
  }

  let m;
  if ((m = path.match(/^\/api\/playlists\/([^/]+)\/evaluate$/)) && method === "GET") {
    return handlePlaylistEvaluate(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/playlists\/([^/]+)$/)) && method === "PUT") {
    return handleUpdatePlaylist(decodeURIComponent(m[1]), await request.json());
  }
  if ((m = path.match(/^\/api\/playlists\/([^/]+)$/)) && method === "DELETE") {
    return handleDeletePlaylist(decodeURIComponent(m[1]));
  }

  if ((m = path.match(/^\/api\/artists\/(.+)$/)) && method === "GET") {
    return handleArtistDetail(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/library\/track\/([^/]+)\/favorite$/)) && method === "POST") {
    return handleTrackFavorite(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/library\/track\/([^/]+)\/revisit$/)) && method === "POST") {
    return handleTrackRevisit(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/library\/artist\/([^/]+)\/favorite$/)) && method === "POST") {
    return handleArtistFavorite(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/library\/artist\/([^/]+)\/hero-art$/)) && method === "POST") {
    return handleArtistHeroArt(decodeURIComponent(m[1]), await request.json());
  }
  if ((m = path.match(/^\/api\/library\/artist\/([^/]+)\/genres$/)) && method === "POST") {
    return handleArtistGenres(decodeURIComponent(m[1]), await request.json());
  }
  if ((m = path.match(/^\/api\/library\/album\/([^/]+)\/favorite$/)) && method === "POST") {
    return handleAlbumFavorite(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/library\/album\/([^/]+)\/rating$/)) && method === "POST") {
    return handleAlbumRating(decodeURIComponent(m[1]), await request.json());
  }
  if ((m = path.match(/^\/api\/library\/album\/([^/]+)\/notes$/)) && method === "POST") {
    return handleAlbumNotes(decodeURIComponent(m[1]), await request.json());
  }
  if ((m = path.match(/^\/api\/recent\/([^/]+)$/)) && method === "DELETE") {
    return handleDeletePlay(m[1]);
  }

  // Not-yet-implemented endpoint — fail loud in the console instead of a
  // silent network error, since there's never a real backend to fall back to.
  console.warn(`[mock-api] no handler for ${method} ${path}`);
  return jsonResponse({ error: "not implemented in demo" }, 501);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(handleApiRequest(event.request));
  }
  // Everything else (JS, CSS, artwork, mock-api/*.json itself) passes through
  // to the network/static-file server untouched.
});
