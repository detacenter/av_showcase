import { useState, useEffect, useRef } from "react";
import { API_BASE } from "../api/config";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlbumInfo {
  album_id: string;
  album_name: string;
  artist: string;
  art_url: string | null;
  release_year: number | null;
}

interface DecadeData {
  decade: string;
  album_ids: string[];
  albums: Record<string, AlbumInfo>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const artUrl = (url: string | null) =>
  url ? `${API_BASE}${url}` : null;

// ── Shelves page ──────────────────────────────────────────────────────────────

function ShelfCover({ info, rank }: { info: AlbumInfo | null; rank: number }) {
  const url = info ? artUrl(info.art_url) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <div style={{ aspectRatio: "1", width: "100%", borderRadius: 6, overflow: "hidden", background: "#1a1a1a", flexShrink: 0 }}>
        {info
          ? url
            ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 28 }}>♪</div>
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#3a3a3a", fontSize: 13, fontWeight: 700 }}>#{rank}</div>
        }
      </div>
      <span style={{ fontSize: 10, color: "#666", textAlign: "center", display: "block" }}>{info ? `#${rank}` : ""}</span>
      <span style={{ fontSize: 9, fontWeight: 650, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{info?.album_name ?? ""}</span>
      <span style={{ fontSize: 9, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{info?.artist ?? ""}</span>
    </div>
  );
}

function DecadeShelf({ data, focused, onClick }: {
  data: DecadeData;
  focused: boolean;
  onClick: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} onClick={onClick}>
      <span
        style={{
          color: "#fff", fontSize: 20, fontWeight: 800,
          textAlign: "center", padding: 0, alignSelf: "center",
        }}
      >{data.decade}</span>
      <div style={{
        background: "var(--card)", borderRadius: 10, padding: 10,
        boxShadow: focused ? "inset 0 0 0 2px var(--green)" : undefined,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const albumId = data.album_ids[i] || "";
            const info = albumId ? (data.albums[albumId] ?? null) : null;
            return <ShelfCover key={i} info={info} rank={i + 1} />;
          })}
        </div>
      </div>
    </div>
  );
}

function ShelvesPage({ decades }: { decades: DecadeData[] }) {
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!decades.length) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusIdx(i => i === null ? 0 : Math.min(decades.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusIdx(i => i === null ? decades.length - 1 : Math.max(0, i - 1));
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [decades]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusIdx === null || !containerRef.current) return;
    const shelves = containerRef.current.querySelectorAll("[data-shelf]");
    (shelves[focusIdx] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusIdx]);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: "auto", paddingBottom: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {decades.map((d, i) => (
          <div key={d.decade} data-shelf>
            <DecadeShelf
              data={d}
              focused={focusIdx === i}
              onClick={() => setFocusIdx(i)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function TopsView() {
  const [decades, setDecades] = useState<DecadeData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/tops`);
        const data = await res.json();
        setDecades((data.decades as DecadeData[]).filter(d => d.album_ids.length > 0));
      } catch { /* silent */ }
      finally { setLoading(false); }
    })();
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px 24px 16px", gap: 10 }}>
      {loading ? (
        <span style={{ color: "#444", fontSize: 12 }}>Loading…</span>
      ) : (
        <ShelvesPage decades={decades} />
      )}
    </div>
  );
}
