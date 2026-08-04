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
};

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

  let m;
  if ((m = path.match(/^\/api\/library\/track\/([^/]+)\/favorite$/)) && method === "POST") {
    return handleTrackFavorite(decodeURIComponent(m[1]));
  }
  if ((m = path.match(/^\/api\/library\/track\/([^/]+)\/revisit$/)) && method === "POST") {
    return handleTrackRevisit(decodeURIComponent(m[1]));
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
