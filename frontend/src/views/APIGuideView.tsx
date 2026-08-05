import { useState } from "react";
import { Link } from "react-router-dom";

// ── Endpoint catalog ─────────────────────────────────────────────────────────
// Only endpoints this demo's service worker actually implements. GET endpoints
// with no destructive side effects are live-triable; everything that mutates
// the in-memory overlay is documented only, so a stray click here can't leave
// the rest of the demo in a confusing state.

type Endpoint = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;               // may contain {param}
  desc: string;
  live?: boolean;
  paramLabel?: string;
  paramDefault?: string;
  html?: boolean;             // response is text/html, not JSON
};

type Group = { name: string; endpoints: Endpoint[] };

const GROUPS: Group[] = [
  {
    name: "Recent",
    endpoints: [
      { method: "GET", path: "/api/recent/albums", desc: "Session-grouped recent plays, merged with vinyl sessions. Supports ?q= search.", live: true },
      { method: "DELETE", path: "/api/recent/{played_at}", desc: "Remove one play from the recent log (overlay only)." },
    ],
  },
  {
    name: "Artists",
    endpoints: [
      { method: "GET", path: "/api/artists", desc: "All artists with play counts and favorite status.", live: true },
      { method: "GET", path: "/api/artists/{name}", desc: "Full detail for one artist: albums, tracks, genres.", live: true, paramLabel: "artist name", paramDefault: "Pixies" },
      { method: "POST", path: "/api/library/artist/{name}/favorite", desc: "Toggle artist favorite (overlay only)." },
      { method: "POST", path: "/api/library/artist/{name}/genres", desc: "Edit an artist's genre tags (overlay only)." },
      { method: "POST", path: "/api/library/artist/{name}/hero-art", desc: "Pin an album's art as the artist's hero image (overlay only)." },
    ],
  },
  {
    name: "Albums",
    endpoints: [
      { method: "GET", path: "/api/albums", desc: "All albums with completion %, rating, and play data.", live: true },
      { method: "POST", path: "/api/library/album/{id}/favorite", desc: "Toggle album favorite (overlay only)." },
      { method: "POST", path: "/api/library/album/{id}/rating", desc: "Set a 0-20 album rating (overlay only)." },
      { method: "POST", path: "/api/library/album/{id}/notes", desc: "Set free-text album notes (overlay only)." },
    ],
  },
  {
    name: "Playlists",
    endpoints: [
      { method: "GET", path: "/api/playlists", desc: "All playlists with track counts.", live: true },
      { method: "GET", path: "/api/playlists/sessions", desc: "Playlists grouped for the sidebar session view.", live: true },
      { method: "GET", path: "/api/playlists/{id}/evaluate", desc: "A playlist's evaluated tracklist (rule_groups applied once, snapshotted).", live: true, paramLabel: "playlist id", paramDefault: "pl-331421700" },
      { method: "POST", path: "/api/playlists", desc: "Create a playlist (overlay only, empty tracklist)." },
      { method: "PUT", path: "/api/playlists/{id}", desc: "Update a playlist's rules/name (overlay only, does not re-evaluate)." },
      { method: "DELETE", path: "/api/playlists/{id}", desc: "Delete a playlist (overlay only)." },
    ],
  },
  {
    name: "Revisit",
    endpoints: [
      { method: "GET", path: "/api/revisit", desc: "Tracks flagged for revisit.", live: true },
      { method: "POST", path: "/api/library/track/{id}/revisit", desc: "Toggle a track's revisit flag (overlay only)." },
      { method: "POST", path: "/api/library/track/{id}/favorite", desc: "Toggle a track's favorite flag (overlay only)." },
    ],
  },
  {
    name: "Vinyl",
    endpoints: [
      { method: "GET", path: "/api/vinyl", desc: "Full vinyl collection.", live: true },
      { method: "GET", path: "/api/vinyl/wantlist", desc: "Discogs wantlist.", live: true },
      { method: "GET", path: "/api/vinyl/stats", desc: "Vinyl listening stats.", live: true },
      { method: "GET", path: "/api/vinyl/sessions", desc: "Individual vinyl listening sessions.", live: true },
      { method: "GET", path: "/api/vinyl/session/current", desc: "Live turntable session status (always inactive in this demo).", live: true },
      { method: "GET", path: "/api/vinyl/sync/status", desc: "Simulated Discogs collection sync progress.", live: true },
      { method: "GET", path: "/api/vinyl/wantlist/sync/status", desc: "Simulated Discogs wantlist sync progress.", live: true },
      { method: "POST", path: "/api/vinyl/sync", desc: "Start a simulated collection sync (resolves to \"up to date\")." },
      { method: "POST", path: "/api/vinyl/wantlist/sync", desc: "Start a simulated wantlist sync." },
      { method: "DELETE", path: "/api/vinyl/sessions/{id}", desc: "Delete a vinyl session (overlay only)." },
    ],
  },
  {
    name: "Stats",
    endpoints: [
      { method: "GET", path: "/api/stats/overview", desc: "Headline listening stats.", live: true },
      { method: "GET", path: "/api/stats/era-data", desc: "Release-year drift over time (the Eras/Drift tab).", live: true },
      { method: "GET", path: "/api/stats/trends", desc: "Cumulative-plays and volume trend data.", live: true },
      { method: "GET", path: "/api/stats/sessions", desc: "Listening sessions with per-album color fingerprints.", live: true },
      { method: "GET", path: "/api/stats/period", desc: "Week/Month period grid (?mode=Week&offset=0).", live: true },
      { method: "GET", path: "/api/stats/time", desc: "Month/Year/All-time rollups (?mode=Year).", live: true },
      { method: "GET", path: "/api/stats/timeline", desc: "Timeline chart data (?metric=Albums).", live: true },
      { method: "GET", path: "/api/stats/genres-page", desc: "Server-rendered D3 genre force-graph (raw HTML, embedded via iframe).", live: true, html: true },
    ],
  },
  {
    name: "Claudio",
    endpoints: [
      { method: "GET", path: "/api/claudio/history", desc: "All past recommendation batches.", live: true },
      { method: "GET", path: "/api/claudio/status", desc: "Whether a recommendation batch is currently generating.", live: true },
      { method: "POST", path: "/api/claudio/generate", desc: "Start generating a new batch (simulated wait, hand-written picks — see About)." },
      { method: "POST", path: "/api/claudio/feedback", desc: "Thumbs up/down a recommendation (overlay only)." },
    ],
  },
  {
    name: "Settings",
    endpoints: [
      { method: "GET", path: "/api/settings", desc: "App theme/accent settings.", live: true },
    ],
  },
];

// ── UI ────────────────────────────────────────────────────────────────────────

const METHOD_COLOR: Record<Endpoint["method"], string> = {
  GET: "var(--green)",
  POST: "#4b9fff",
  PUT: "#e8c547",
  DELETE: "var(--red)",
};

function MethodBadge({ method }: { method: Endpoint["method"] }) {
  return (
    <span
      style={{
        fontSize: 10, fontWeight: 700, color: METHOD_COLOR[method],
        border: `1px solid ${METHOD_COLOR[method]}`, borderRadius: 4,
        padding: "2px 6px", minWidth: 44, textAlign: "center", flexShrink: 0,
      }}
    >
      {method}
    </span>
  );
}

type Result = { status: number; body: string; error?: boolean };

function EndpointRow({ ep }: { ep: Endpoint }) {
  const hasParam = ep.path.includes("{");
  const [paramValue, setParamValue] = useState(ep.paramDefault ?? "");
  const [result, setResult] = useState<Result | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const resolvedPath = hasParam ? ep.path.replace(/\{[^}]+\}/, encodeURIComponent(paramValue)) : ep.path;

  const tryIt = async () => {
    setLoading(true);
    setExpanded(true);
    try {
      const res = await fetch(resolvedPath);
      const body = ep.html ? (await res.text()).slice(0, 4000) : JSON.stringify(await res.json(), null, 2);
      setResult({ status: res.status, body });
    } catch (e) {
      setResult({ status: 0, body: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "10px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <MethodBadge method={ep.method} />
        <code style={{ fontSize: 12, color: "var(--white)", fontFamily: "monospace" }}>{ep.path}</code>
        <span style={{ fontSize: 11, color: "var(--dim)", flex: 1, minWidth: 200 }}>{ep.desc}</span>

        {ep.live ? (
          <>
            {hasParam && (
              <input
                value={paramValue}
                onChange={(e) => setParamValue(e.target.value)}
                placeholder={ep.paramLabel}
                style={{
                  fontSize: 11, background: "var(--bg)", border: "1px solid var(--border)",
                  borderRadius: 4, color: "var(--white)", padding: "3px 8px", width: 110,
                }}
              />
            )}
            <button
              onClick={tryIt}
              disabled={loading}
              style={{
                fontSize: 11, fontWeight: 600, background: "var(--green)", color: "#000",
                border: "none", borderRadius: 12, padding: "4px 12px", cursor: loading ? "default" : "pointer",
                flexShrink: 0,
              }}
            >
              {loading ? "…" : "Try it"}
            </button>
          </>
        ) : (
          <span style={{ fontSize: 10, color: "var(--dim)", fontStyle: "italic", flexShrink: 0 }}>
            mutates overlay only
          </span>
        )}
      </div>

      {expanded && result && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: result.error ? "var(--red)" : "var(--dim)", marginBottom: 4 }}>
            {result.error ? "Request failed" : `Response ${result.status}`}
          </div>
          <pre
            style={{
              margin: 0, maxHeight: 260, overflow: "auto", fontSize: 11, lineHeight: 1.5,
              background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 6,
              padding: 10, color: "var(--gray)", whiteSpace: "pre-wrap", wordBreak: "break-word",
            }}
          >
            {result.body}
          </pre>
        </div>
      )}
    </div>
  );
}

export function APIGuideView() {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 48px" }}>
      <div style={{ maxWidth: 860 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--white)", marginBottom: 8 }}>
          API guide
        </div>
        <p style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6, marginBottom: 28 }}>
          Every endpoint this demo actually implements, answered by the service worker
          shown on the <Link to="/about" style={{ color: "var(--white)" }}>About page</Link>.
          "Try it" fires a real <code>fetch()</code> from this page — same call the app
          itself makes, same response. GET requests are safe to fire; anything that would
          mutate data only touches an in-memory overlay for this browser tab, so it's
          documented here rather than wired to a button.
        </p>

        {GROUPS.map((g) => (
          <div key={g.name} style={{ marginBottom: 28 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--white)", letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>
              {g.name}
            </div>
            {g.endpoints.map((ep) => (
              <EndpointRow key={ep.method + ep.path} ep={ep} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
