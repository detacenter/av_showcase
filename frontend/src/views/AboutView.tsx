import { useState } from "react";
import { Link } from "react-router-dom";

// ── Node content ─────────────────────────────────────────────────────────────

const NODE_INFO: Record<string, { title: string; body: string }> = {
  "electron-desktop": {
    title: "Electron Desktop (Mac)",
    body: "The primary client: a React app wrapped in Electron, talking to the Pi backend over Tailscale. Handles Spotify re-auth via an IPC bridge to the OS browser.",
  },
  "react-pwa": {
    title: "React PWA (mobile)",
    body: "A separate mobile-optimized React app hitting the same API. Fully built and working, not yet deployed to the Pi.",
  },
  "fastapi-backend": {
    title: "FastAPI backend",
    body: "The core service: syncs Spotify listening history, serves ~80 REST endpoints, and runs the statistical analysis layer (stats, trends, genre clustering) every view is built on.",
  },
  "vinyl-monitor": {
    title: "vinyl_monitor.service",
    body: "A separate systemd service watching the audio input's RMS level to detect when a record is playing, then automatically opens and closes vinyl listening sessions, no manual logging.",
  },
  "json-store": {
    title: "Local JSON data store",
    body: "No database. Listening history, catalog, library (ratings/favorites/notes), playlists, and vinyl data all live as plain JSON files on the Pi's disk.",
  },
  "usb-audio": {
    title: "USB audio interface",
    body: "A Behringer UFO202, bridging the turntable's phono-preamp output into the Pi over USB so vinyl_monitor.service has a signal to read.",
  },
  "turntable": {
    title: "Turntable",
    body: "The actual record player. Just a line-level audio connection to the USB interface, no digital/smart integration on the turntable itself.",
  },
  "api-spotify": {
    title: "Spotify",
    body: "OAuth + polling \"recently played\" to build the listening log in near-real-time.",
  },
  "api-discogs": {
    title: "Discogs",
    body: "Syncs the vinyl collection and wantlist; fuzzy-matched against Spotify albums to link a digital play to a physical record you own.",
  },
  "api-lastfm": {
    title: "Last.fm",
    body: "Supplemental genre tagging for artists Spotify's own genre data classifies poorly or not at all.",
  },
  "api-anthropic": {
    title: "Anthropic (Claude)",
    body: "Powers Claudio: generates album recommendations from the listening profile, hard-filtered against everything already owned or ever recommended before.",
  },
  "browser": {
    title: "Your browser",
    body: "Running the actual real-app React frontend, same components, same styling. There's no separate \"demo mode\" UI.",
  },
  "service-worker": {
    title: "Service worker",
    body: "Registered on page load, intercepts every /api/* fetch and answers from static snapshots instead of a live server: the same offline-support mechanism the real app already had, repurposed here to remove the backend entirely.",
  },
  "snapshots": {
    title: "Static JSON snapshots",
    body: "Captured by running the real backend once, locally, against a synthetic dataset, then saving each endpoint's actual response to a file. What you're browsing is real analysis-engine output, not a reimplementation of it.",
  },
  "vercel": {
    title: "Vercel",
    body: "Serves the static build. No compute, no database, no live third-party API calls at runtime, just files.",
  },
};

// ── Diagram primitives ──────────────────────────────────────────────────────

function Box({
  id, x, y, w, h, title, subtitle, dashed, selected, onSelect,
}: {
  id: string; x: number; y: number; w: number; h: number;
  title: string; subtitle?: string; dashed?: boolean;
  selected: string | null; onSelect: (id: string) => void;
}) {
  const active = selected === id;
  return (
    <g onClick={() => onSelect(id)} style={{ cursor: "pointer" }}>
      <rect
        x={x} y={y} width={w} height={h} rx={8}
        style={{
          fill: active ? "var(--surface)" : "var(--card)",
          stroke: active ? "var(--green)" : "var(--border)",
          strokeWidth: active ? 2 : 1.5,
          transition: "stroke 0.15s, fill 0.15s",
        }}
        strokeDasharray={dashed ? "4 3" : undefined}
      />
      <text
        x={x + w / 2} y={subtitle ? y + h / 2 - 6 : y + h / 2 + 4}
        textAnchor="middle"
        style={{ fill: "var(--white)", fontSize: 12, fontWeight: 700, pointerEvents: "none" }}
      >
        {title}
      </text>
      {subtitle && (
        <text
          x={x + w / 2} y={y + h / 2 + 12}
          textAnchor="middle"
          style={{ fill: "var(--dim)", fontSize: 10, pointerEvents: "none" }}
        >
          {subtitle}
        </text>
      )}
    </g>
  );
}

function GroupLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <text x={x} y={y} style={{ fill: "var(--dim)", fontSize: 10, fontWeight: 700, letterSpacing: 1 }}>
      {text.toUpperCase()}
    </text>
  );
}

// y2 is always given as the destination box's top edge, not the visual line
// end — boxes render after (on top of) lines in SVG paint order, so a line
// drawn all the way to y2 gets its arrowhead clipped by the box beneath it.
// Pulling back by ARROW_GAP leaves the arrowhead fully visible in the gap.
const ARROW_GAP = 6;

function VLine({
  x, y1, y2, markerId, label,
}: { x: number; y1: number; y2: number; markerId: string; label?: string }) {
  return (
    <g>
      <line x1={x} y1={y1} x2={x} y2={y2 - ARROW_GAP} stroke="var(--dim)" strokeWidth={1.5} markerEnd={`url(#${markerId})`} />
      {label && (
        <text x={x + 6} y={(y1 + y2) / 2} style={{ fill: "var(--dim)", fontSize: 9, fontStyle: "italic" }}>
          {label}
        </text>
      )}
    </g>
  );
}

function Arrowhead({ id }: { id: string }) {
  return (
    <defs>
      <marker id={id} markerWidth={8} markerHeight={8} refX={4} refY={4} orient="auto">
        <path d="M0,0 L8,4 L0,8 Z" style={{ fill: "var(--dim)" }} />
      </marker>
    </defs>
  );
}

type DiagramProps = { selected: string | null; onSelect: (id: string) => void };

// ── The real app diagram ─────────────────────────────────────────────────────

function RealAppDiagram({ selected, onSelect }: DiagramProps) {
  return (
    <svg viewBox="0 0 480 620" style={{ width: "100%", maxWidth: 480, height: "auto" }}>
      <Arrowhead id="arrow-real" />

      <GroupLabel x={20} y={16} text="Clients (over Tailscale)" />
      <Box id="electron-desktop" x={20} y={26} w={200} h={50} title="Electron Desktop" subtitle="Mac" selected={selected} onSelect={onSelect} />
      <Box id="react-pwa" x={260} y={26} w={200} h={50} title="React PWA" subtitle="mobile, not yet deployed" selected={selected} onSelect={onSelect} />
      <VLine x={120} y1={76} y2={160} markerId="arrow-real" />
      <VLine x={360} y1={76} y2={160} markerId="arrow-real" />
      <line x1={120} y1={160} x2={360} y2={160} stroke="var(--dim)" strokeWidth={1.5} />

      <GroupLabel x={20} y={195} text="Raspberry Pi 5 (home server)" />
      <rect x={20} y={205} width={440} height={175} rx={10} style={{ fill: "none", stroke: "var(--border)", strokeWidth: 1.5 }} strokeDasharray="4 3" />
      <Box id="fastapi-backend" x={40} y={222} w={400} h={40} title="FastAPI backend" subtitle="audiovault.service (systemd)" selected={selected} onSelect={onSelect} />
      <Box id="vinyl-monitor" x={40} y={272} w={400} h={40} title="vinyl_monitor.service" subtitle="listens for turntable audio" selected={selected} onSelect={onSelect} />
      <Box id="json-store" x={40} y={322} w={400} h={40} title="Local JSON data store" subtitle="listening log, catalog, library, vinyl…" selected={selected} onSelect={onSelect} />

      <VLine x={120} y1={380} y2={430} markerId="arrow-real" />
      <VLine x={360} y1={380} y2={430} markerId="arrow-real" />

      <GroupLabel x={20} y={420} text="Vinyl detection hardware" />
      <Box id="usb-audio" x={20} y={430} w={200} h={44} title="USB audio interface" subtitle="Behringer UFO202" selected={selected} onSelect={onSelect} />
      <VLine x={120} y1={474} y2={514} markerId="arrow-real" />
      <Box id="turntable" x={20} y={514} w={200} h={44} title="Turntable" subtitle="phono out → RMS threshold" selected={selected} onSelect={onSelect} />

      <GroupLabel x={260} y={420} text="External APIs" />
      <Box id="api-spotify" x={260} y={430} w={200} h={30} title="Spotify" selected={selected} onSelect={onSelect} />
      <Box id="api-discogs" x={260} y={468} w={200} h={30} title="Discogs" selected={selected} onSelect={onSelect} />
      <Box id="api-lastfm" x={260} y={506} w={200} h={30} title="Last.fm" selected={selected} onSelect={onSelect} />
      <Box id="api-anthropic" x={260} y={544} w={200} h={30} title="Anthropic (Claude)" selected={selected} onSelect={onSelect} />
    </svg>
  );
}

// ── This demo's diagram ──────────────────────────────────────────────────────

function DemoDiagram({ selected, onSelect }: DiagramProps) {
  return (
    <svg viewBox="0 0 300 440" style={{ width: "100%", maxWidth: 300, height: "auto" }}>
      <Arrowhead id="arrow-demo" />

      <Box id="browser" x={20} y={20} w={260} h={50} title="Your browser" subtitle="this page, right now" selected={selected} onSelect={onSelect} />
      <VLine x={150} y1={70} y2={110} markerId="arrow-demo" label="fetch('/api/…')" />

      <Box id="service-worker" x={20} y={110} w={260} h={50} title="Service worker" subtitle="intercepts /api/* client-side" selected={selected} onSelect={onSelect} />
      <VLine x={150} y1={160} y2={200} markerId="arrow-demo" />

      <Box id="snapshots" x={20} y={200} w={260} h={60} title="Static JSON snapshots" subtitle="real catalog + synthetic behavior" selected={selected} onSelect={onSelect} />
      <VLine x={150} y1={260} y2={300} markerId="arrow-demo" />

      <Box id="vercel" x={20} y={300} w={260} h={50} title="Vercel" subtitle="static hosting only" selected={selected} onSelect={onSelect} />

      <rect x={20} y={370} width={260} height={54} rx={8} style={{ fill: "none", stroke: "var(--dim)", strokeWidth: 1 }} strokeDasharray="4 3" />
      <text x={150} y={392} textAnchor="middle" style={{ fill: "var(--dim)", fontSize: 10, fontWeight: 700 }}>
        No server. No hardware.
      </text>
      <text x={150} y={408} textAnchor="middle" style={{ fill: "var(--dim)", fontSize: 10, fontWeight: 700 }}>
        No live third-party calls.
      </text>
    </svg>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({ selected }: { selected: string | null }) {
  const info = selected ? NODE_INFO[selected] : null;
  return (
    <div
      style={{
        minHeight: 90,
        marginTop: 20,
        padding: "14px 18px",
        borderRadius: 10,
        background: "var(--card)",
        border: "1px solid var(--border)",
      }}
    >
      {info ? (
        <>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 6 }}>
            {info.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6 }}>
            {info.body}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: "var(--dim)" }}>
          Click any box in the diagram for detail on what it does.
        </div>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

const STACK = ["Python", "FastAPI", "React", "TypeScript", "Electron", "Vite"];

const SCALE_STATS = [
  { value: "85", label: "REST endpoints" },
  { value: "2,000+", label: "lines of analysis logic (insights/)" },
  { value: "8,100+", label: "lines of backend Python" },
  { value: "14,000+", label: "lines of frontend TypeScript/React" },
];

function StackAndScale() {
  return (
    <div style={{ display: "flex", gap: 40, flexWrap: "wrap", marginBottom: 36 }}>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--dim)", letterSpacing: 1, marginBottom: 8 }}>
          STACK
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {STACK.map((s) => (
            <span
              key={s}
              style={{
                fontSize: 11, fontWeight: 600, color: "var(--gray)",
                background: "var(--card)", border: "1px solid var(--border)",
                borderRadius: 12, padding: "4px 10px",
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 10, fontWeight: 700, color: "var(--dim)", letterSpacing: 1, marginBottom: 8 }}>
          SCALE (REAL APP)
        </div>
        <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          {SCALE_STATS.map((s) => (
            <div key={s.label}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--white)" }}>{s.value}</div>
              <div style={{ fontSize: 10, color: "var(--dim)", maxWidth: 130 }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 40 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "var(--white)", letterSpacing: 0.5, marginBottom: 12, textTransform: "uppercase" }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export function AboutView() {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 48px" }}>
      <div style={{ maxWidth: 900 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--white)", marginBottom: 8 }}>
          About this demo
        </div>
        <p style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6, marginBottom: 32 }}>
          AudioVault is a personal Spotify listening-history logger and analyzer that runs
          on a Raspberry Pi at home, with an Electron desktop app and a mobile PWA as
          clients. This site is a public, static demo of that app's frontend: real album
          artwork, artist names, and genre data, paired with a synthetic listening history
          generated to look plausible without exposing anything personal. There's no server
          behind this page: everything you see is served from static files, with a service
          worker standing in for the real API. See the{" "}
          <Link to="/api-guide" style={{ color: "var(--white)" }}>API guide ↗</Link> to try the
          actual endpoints behind every view on this site, or the{" "}
          <Link to="/shortcuts" style={{ color: "var(--white)" }}>keyboard shortcuts ↗</Link>{" "}
          reference for how it's meant to be driven.
        </p>

        <StackAndScale />

        <Section title="System architecture">
          <div style={{ display: "flex", gap: 32, flexWrap: "wrap", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--green)", marginBottom: 10 }}>
                THE REAL APP
              </div>
              <RealAppDiagram selected={selected} onSelect={setSelected} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--gray)", marginBottom: 10 }}>
                THIS DEMO
              </div>
              <DemoDiagram selected={selected} onSelect={setSelected} />
            </div>
          </div>
          <DetailPanel selected={selected} />
        </Section>

        <Section title="What's real vs. synthetic here">
          <p style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.7 }}>
            Artist names, album metadata, genres, and artwork are all real public catalog
            data. Listening history (play timestamps, session patterns) is fully
            synthetic, generated from a statistical model rather than derived from any
            real listening data. Two deliberate exceptions: album star ratings and the
            vinyl record collection are real, since neither reveals anything about
            listening behavior or timing.
          </p>
        </Section>
      </div>
    </div>
  );
}
