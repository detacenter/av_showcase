import { useState, useRef, useEffect, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

import { API_BASE as ART_BASE } from "../../api/config";

function artUrl(path: string): string | null {
  const fn = path?.split("/").pop();
  return fn ? `${ART_BASE}/artwork/${fn}` : null;
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type PeriodMode = "Week" | "Month";

interface AlbumTile {
  title: string;
  subtitle: string;
  meta: string;
  art_path: string;
  art_key: string;
}

interface PeriodPayload {
  label: string;
  album_header: string;
  offset: number;
  minutes: string;
  plays_label: string;
  album_tiles: AlbumTile[];
  top_new_artist: { name: string; count: number } | null;
  has_older: boolean;
}

// ─── TileGrid ─────────────────────────────────────────────────────────────────

const COLS = 4;
const GRID_PAD = 16;
const TILE_SPACING = 8;
const HEADER_H = 44; // accent bar row + margin

function ArtTile({ tile, size }: { tile: AlbumTile; size: number }) {
  const [hov, setHov] = useState(false);
  const url = artUrl(tile.art_path);
  return (
    <div
      style={{ width: size, height: size, background: "#222", overflow: "hidden", position: "relative", cursor: "default" }}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
    >
      {url
        ? <img src={url} alt={tile.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <span style={{ color: "#444", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>♪</span>
      }
      {hov && (
        <div style={{
          position: "absolute", inset: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.3) 50%, transparent 100%)",
          display: "flex", flexDirection: "column", justifyContent: "flex-end",
          padding: "10px 10px 10px 10px",
          pointerEvents: "none",
        }}>
          <div style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.title}</div>
          <div style={{ color: "#bbb", fontSize: 11, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.subtitle}</div>
        </div>
      )}
    </div>
  );
}

function TileGrid({ tiles }: { tiles: AlbumTile[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);

  const rows = Math.ceil(Math.min(tiles.length, COLS * COLS) / COLS);

  const tileFromW = w > 0
    ? Math.floor((w - GRID_PAD * 2 - TILE_SPACING * (COLS - 1)) / COLS)
    : 0;
  const tileFromH = h > 0 && rows > 0
    ? Math.floor((h - HEADER_H - GRID_PAD - TILE_SPACING * (rows - 1)) / rows)
    : 0;
  const tileSize = Math.max(40, Math.min(tileFromW, tileFromH));

  const gridW = COLS * tileSize + (COLS - 1) * TILE_SPACING;
  const xOffset = Math.max(0, Math.floor((w - GRID_PAD * 2 - gridW) / 2));

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {tileSize > 0 && tiles.slice(0, COLS * COLS).map((tile, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        const x = GRID_PAD + xOffset + col * (tileSize + TILE_SPACING);
        const y = row * (tileSize + TILE_SPACING);
        return (
          <div key={tile.art_key || idx} style={{ position: "absolute", left: x, top: y }}>
            <ArtTile tile={tile} size={tileSize} />
          </div>
        );
      })}
    </div>
  );
}

// ─── PeriodsTab ───────────────────────────────────────────────────────────────

export function PeriodsTab() {
  const [mode, setMode] = useState<PeriodMode>("Week");
  const [offset, setOffset] = useState(0);

  const { data, isLoading } = useQuery<PeriodPayload>({
    queryKey: ["stats-period", mode, offset],
    queryFn: () => api.get(`/api/stats/period?mode=${mode}&offset=${offset}`),
    staleTime: 60_000,
  });

  function handleModeChange(m: PeriodMode) {
    setMode(m);
    setOffset(0);
  }

  const pillStyle = (active: boolean): CSSProperties => ({
    padding: "5px 14px",
    borderRadius: 20,
    border: active ? "1px solid var(--green)" : "1px solid #2a2a2a",
    background: "transparent",
    color: active ? "var(--green)" : "#666",
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    cursor: "pointer",
  });

  const navStyle = (disabled: boolean): CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 14,
    border: "1px solid #2a2a2a",
    background: "#202020",
    color: disabled ? "#333" : "#aaa",
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
  });

  if (isLoading || !data) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "16px 24px", gap: 12 }}>

      {/* Mode pills */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {(["Week", "Month"] as PeriodMode[]).map(m => (
          <button key={m} onClick={() => handleModeChange(m)} style={pillStyle(mode === m)}>{m}</button>
        ))}
      </div>

      {/* Card */}
      <div style={{
        flex: 1,
        minHeight: 0,
        background: "#141414",
        border: "1px solid rgba(255,255,255,0.06)",
        borderRadius: 18,
        padding: `14px ${GRID_PAD}px ${GRID_PAD}px`,
        display: "flex",
        flexDirection: "column",
      }}>
        {/* Card header */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexShrink: 0 }}>
          <div style={{ width: 4, height: 18, background: "#20a7ff", borderRadius: 2, flexShrink: 0 }} />
          <span style={{ color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>
            {data.album_header.toUpperCase()}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setOffset(o => o + 1)} disabled={!data.has_older} style={navStyle(!data.has_older)}>
            ← Older
          </button>
          <button onClick={() => setOffset(o => o - 1)} disabled={data.offset === 0} style={navStyle(data.offset === 0)}>
            Newer →
          </button>
        </div>

        {data.album_tiles.length === 0
          ? <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>No plays this period</div>
          : <TileGrid tiles={data.album_tiles} />
        }
      </div>
    </div>
  );
}
