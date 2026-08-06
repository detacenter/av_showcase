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
  vinylSync: { running: false, startedAt: 0 },
  wantlistSync: { running: false, startedAt: 0 },
  deletedVinylSessions: new Set(), // session ids
  claudioGenerate: { running: false, startedAt: 0, poolIndex: 0 },
  claudioAddedBatches: [],       // batches appended by "Generate" clicks this session
  claudioFeedback: {},           // "batchIdx:recIdx" -> "up" | "down" | null
  topsDecades: {},       // decade -> album_ids[] (only stores overrides, not full state)
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

async function loadTextSnapshot(name) {
  const res = await fetch(`${SNAPSHOT_BASE}/${name}`);
  return res.text();
}

function htmlResponse(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html" } });
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

async function handleStatsOverview() {
  return jsonResponse(await loadSnapshot("stats-overview.json"));
}

async function handleStatsEraData() {
  return jsonResponse(await loadSnapshot("stats-era-data.json"));
}

async function handleStatsTrends() {
  return jsonResponse(await loadSnapshot("stats-trends.json"));
}

async function handleStatsSessions() {
  return jsonResponse(await loadSnapshot("stats-sessions.json"));
}

async function handleVinylStats() {
  return jsonResponse(await loadSnapshot("vinyl-stats.json"));
}

async function handleTops() {
  const data = await loadSnapshot("tops.json");
  const eligible = await loadSnapshot("tops-eligible.json");
  const decades = data.decades.map((d) => {
    const ids = (overlay.topsDecades[d.decade] ?? d.album_ids).slice(0, 10);
    const albums = { ...d.albums };
    for (const info of eligible[d.decade]?.albums ?? []) {
      if (!albums[info.album_id]) albums[info.album_id] = info;
    }
    return { decade: d.decade, album_ids: ids, albums };
  });
  return jsonResponse({ decades });
}

async function handleTopsEligible(decade) {
  const data = await loadSnapshot("tops.json");
  const eligible = await loadSnapshot("tops-eligible.json");
  const decadeData = data.decades.find((d) => d.decade === decade);
  const placedIds = new Set(overlay.topsDecades[decade] ?? decadeData?.album_ids ?? []);
  const albums = (eligible[decade]?.albums ?? []).filter((info) => !placedIds.has(info.album_id));
  return jsonResponse({ albums });
}

function handleSaveTops(decade, body) {
  overlay.topsDecades[decade] = (body.album_ids || []).map(String);
  return jsonResponse({ ok: true });
}

async function handleVinylSessions() {
  const sessions = await loadSnapshot("vinyl-sessions.json");
  const filtered = sessions.filter((s) => !overlay.deletedVinylSessions.has(s.id));
  return jsonResponse(filtered);
}

function handleDeleteVinylSession(id) {
  overlay.deletedVinylSessions.add(id);
  return jsonResponse({ status: "deleted" });
}

async function handleStatsPeriod(url) {
  const mode = url.searchParams.get("mode") || "Week";
  const offset = url.searchParams.get("offset") || "0";
  const data = await loadSnapshot("stats-period.json");
  const key = `${mode}|${offset}`;
  if (data[key]) return jsonResponse(data[key]);
  // Beyond the snapshotted (real) date range — same "no more history" state
  // as the real backend's oldest reachable period.
  const fallbackKey = `${mode}|0`;
  return jsonResponse({ ...data[fallbackKey], has_older: false, offset: Number(offset) });
}

async function handleStatsTime(url) {
  const mode = url.searchParams.get("mode") || "Year";
  const monthOffset = url.searchParams.get("month_offset") || "0";
  const data = await loadSnapshot("stats-time.json");
  const key = `${mode}|${monthOffset}`;
  if (data[key]) return jsonResponse(data[key]);
  const fallbackKey = `${mode}|0`;
  return jsonResponse({ ...data[fallbackKey], has_older: false });
}

async function handleStatsTimeline(url) {
  const metric = url.searchParams.get("metric") || "Albums";
  const year = url.searchParams.get("year") || "";
  const data = await loadSnapshot("stats-timeline.json");
  const key = `${metric}|${year}`;
  // Real backend falls back to the aggregate (no-year) view for any
  // unrecognized year rather than erroring — sw.js mirrors that.
  return jsonResponse(data[key] ?? data[`${metric}|`]);
}

async function handleStatsGenresPage() {
  return htmlResponse(await loadTextSnapshot("stats-genres-page.html"));
}

async function handleVinylCollection() {
  return jsonResponse(await loadSnapshot("vinyl.json"));
}

async function handleVinylWantlist() {
  return jsonResponse(await loadSnapshot("vinyl-wantlist.json"));
}

// Sync buttons hit the real Discogs API in the real app — never live in this
// demo (no live account dependency, same principle as art sourcing). Instead
// simulate a brief "syncing" state that resolves to "already up to date"
// without touching any data, so the button doesn't look broken.
const SYNC_DURATION_MS = 2200;

function startFakeSync(state) {
  state.running = true;
  state.startedAt = Date.now();
}

function fakeSyncStatus(state, doneMessage) {
  if (!state.running) return { running: false, message: "", progress: 0, total: 0 };
  if (Date.now() - state.startedAt > SYNC_DURATION_MS) {
    state.running = false;
    return { running: false, message: doneMessage, progress: 0, total: 0 };
  }
  return { running: true, message: "Connecting to Discogs…", progress: 0, total: 0 };
}

function handleVinylSyncStart() {
  startFakeSync(overlay.vinylSync);
  return jsonResponse({ status: "started" });
}

async function handleVinylSyncStatus() {
  const snap = await loadSnapshot("vinyl.json");
  return jsonResponse(fakeSyncStatus(overlay.vinylSync, `Done — ${snap.records.length} records`));
}

function handleWantlistSyncStart() {
  startFakeSync(overlay.wantlistSync);
  return jsonResponse({ status: "started" });
}

async function handleWantlistSyncStatus() {
  const snap = await loadSnapshot("vinyl-wantlist.json");
  return jsonResponse(fakeSyncStatus(overlay.wantlistSync, `Done — ${snap.wants.length} wants`));
}

// Claudio recommendations are hand-written, not generated live (no Anthropic/
// Spotify calls in the demo). "Generate" simulates the real app's few-second
// wait, then reveals the next batch from a small canned pool — cycling once
// the pool is exhausted rather than repeating "already up to date" forever,
// so repeated clicks stay interesting for a curious visitor.
const CLAUDIO_GENERATE_DURATION_MS = 6000;

async function handleClaudioHistory() {
  const snap = await loadSnapshot("claudio-history.json");
  const batches = [...snap.initial, ...overlay.claudioAddedBatches];
  const withFeedback = batches.map((batch, bi) => ({
    ...batch,
    recommendations: batch.recommendations.map((rec, ri) => {
      const key = `${bi}:${ri}`;
      return key in overlay.claudioFeedback
        ? { ...rec, feedback: overlay.claudioFeedback[key] }
        : rec;
    }),
  }));
  return jsonResponse({ batches: withFeedback });
}

function handleClaudioStatus() {
  const state = overlay.claudioGenerate;
  if (!state.running) return jsonResponse({ generating: false, error: null });
  if (Date.now() - state.startedAt < CLAUDIO_GENERATE_DURATION_MS) {
    return jsonResponse({ generating: true, error: null });
  }
  state.running = false;
  return jsonResponse({ generating: false, error: null });
}

async function handleClaudioGenerate() {
  const state = overlay.claudioGenerate;
  if (state.running) return jsonResponse({ started: false, reason: "already running" });
  const snap = await loadSnapshot("claudio-history.json");
  const nextBatch = snap.pool[state.poolIndex % snap.pool.length];
  state.poolIndex += 1;
  state.running = true;
  state.startedAt = Date.now();
  overlay.claudioAddedBatches.push({
    ...nextBatch,
    generated_at: new Date().toISOString(),
  });
  return jsonResponse({ started: true });
}

function handleClaudioFeedback(body) {
  const key = `${body.batch_idx}:${body.rec_idx}`;
  overlay.claudioFeedback[key] = body.feedback ?? null;
  return jsonResponse({ ok: true });
}

function handleVinylSessionCurrent() {
  // No physical turntable in this demo — always report no active session.
  // Polled continuously (every 4s) from a globally-mounted component, so
  // this needs a real handler even though the Vinyl view is what surfaced it.
  return jsonResponse({ active: false });
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

  if (path === "/api/vinyl" && method === "GET") {
    return handleVinylCollection();
  }
  if (path === "/api/vinyl/wantlist" && method === "GET") {
    return handleVinylWantlist();
  }
  if (path === "/api/vinyl/sync" && method === "POST") {
    return handleVinylSyncStart();
  }
  if (path === "/api/vinyl/sync/status" && method === "GET") {
    return handleVinylSyncStatus();
  }
  if (path === "/api/vinyl/wantlist/sync" && method === "POST") {
    return handleWantlistSyncStart();
  }
  if (path === "/api/vinyl/wantlist/sync/status" && method === "GET") {
    return handleWantlistSyncStatus();
  }
  if (path === "/api/vinyl/session/current" && method === "GET") {
    return handleVinylSessionCurrent();
  }
  if (path === "/api/vinyl/stats" && method === "GET") {
    return handleVinylStats();
  }
  if (path === "/api/tops" && method === "GET") {
    return handleTops();
  }
  if (path === "/api/vinyl/sessions" && method === "GET") {
    return handleVinylSessions();
  }

  if (path === "/api/stats/overview" && method === "GET") {
    return handleStatsOverview();
  }
  if (path === "/api/stats/era-data" && method === "GET") {
    return handleStatsEraData();
  }
  if (path === "/api/stats/trends" && method === "GET") {
    return handleStatsTrends();
  }
  if (path === "/api/stats/sessions" && method === "GET") {
    return handleStatsSessions();
  }
  if (path === "/api/stats/period" && method === "GET") {
    return handleStatsPeriod(url);
  }
  if (path === "/api/stats/time" && method === "GET") {
    return handleStatsTime(url);
  }
  if (path === "/api/stats/timeline" && method === "GET") {
    return handleStatsTimeline(url);
  }
  if (path === "/api/stats/genres-page" && method === "GET") {
    return handleStatsGenresPage();
  }

  if (path === "/api/claudio/history" && method === "GET") {
    return handleClaudioHistory();
  }
  if (path === "/api/claudio/status" && method === "GET") {
    return handleClaudioStatus();
  }
  if (path === "/api/claudio/generate" && method === "POST") {
    return handleClaudioGenerate();
  }
  if (path === "/api/claudio/feedback" && method === "POST") {
    return handleClaudioFeedback(await request.json());
  }

  let m;
  if ((m = path.match(/^\/api\/vinyl\/sessions\/([^/]+)$/)) && method === "DELETE") {
    return handleDeleteVinylSession(decodeURIComponent(m[1]));
  }
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
  if ((m = path.match(/^\/api\/tops\/([^/]+)\/eligible$/)) && method === "GET") {
    return handleTopsEligible(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/tops\/([^/]+)$/)) && method === "POST") {
    return handleSaveTops(decodeURIComponent(m[1]), await request.json());
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
