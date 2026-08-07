import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useFetchSync } from "../hooks/useFetchSync";
import type { RecentAlbum, RecentAlbumsResponse, AlbumTrackEntry, VinylTrack } from "../api/types";

const VINYL_GOLD = "#c8a84b";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function artUrl(album: RecentAlbum): string | null {
  if (album.art_filename) return `/artwork/${album.art_filename}`;
  if (album.art_local_path) return `/artwork/${album.art_local_path.split("/").pop()}`;
  return album.art_url ?? null;
}

// ─── Track action sheet ───────────────────────────────────────────────────────

const TRACK_MENU_W = 230;

function TrackActionSheet({ entry, x, y, onClose, onToggleRevisit }: {
  entry: AlbumTrackEntry;
  x: number; y: number;
  onClose: () => void;
  onToggleRevisit: () => void;
}) {
  const MENU_H = 120;
  const left = Math.max(8, Math.min(x - TRACK_MENU_W / 2, window.innerWidth - TRACK_MENU_W - 8));
  const top  = y - MENU_H - 16 < 8 ? y + 16 : y - MENU_H - 16;
  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 100, WebkitTapHighlightColor: "transparent",
      }} />
      <div style={{
        position: "fixed", left, top, width: TRACK_MENU_W, zIndex: 101,
        background: "#1c1c1e", borderRadius: 14,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 14px 8px", borderBottom: "1px solid #2a2a2a",
          fontSize: 11, color: "#555",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{entry.track_name}</div>
        <div onClick={() => { onToggleRevisit(); onClose(); }} style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
          borderBottom: "1px solid #2a2a2a",
          cursor: "pointer", WebkitTapHighlightColor: "transparent",
        }}>
          <span style={{ fontSize: 16, color: entry.is_revisit ? "var(--green, #1db954)" : "#fff", width: 20, textAlign: "center" }}>↻</span>
          <span style={{ fontSize: 14, color: entry.is_revisit ? "var(--green, #1db954)" : "#fff" }}>
            {entry.is_revisit ? "Remove Revisit" : "Mark as Revisit"}
          </span>
        </div>
        <div style={{
          display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
          cursor: "pointer", WebkitTapHighlightColor: "transparent", opacity: 0.4,
        }}>
          <span style={{ fontSize: 16, color: "#fff", width: 20, textAlign: "center" }}>＋</span>
          <span style={{ fontSize: 14, color: "#fff" }}>Add to Playlist</span>
        </div>
      </div>
    </>
  );
}

// ─── Album context menu ───────────────────────────────────────────────────────

const MENU_W = 220;

function AlbumContextMenu({ album, x, y, onClose, onGoArtist, onGoAlbum }: {
  album: RecentAlbum; x: number; y: number;
  onClose: () => void; onGoArtist: () => void; onGoAlbum: () => void;
}) {
  const MENU_H = 120;
  const left = Math.max(8, Math.min(x - MENU_W / 2, window.innerWidth - MENU_W - 8));
  const top  = y - MENU_H - 16 < 8 ? y + 16 : y - MENU_H - 16;
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, WebkitTapHighlightColor: "transparent" }} />
      <div style={{
        position: "fixed", left, top, width: MENU_W, zIndex: 101,
        background: "#1c1c1e", borderRadius: 14,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 14px 8px", borderBottom: "1px solid #2a2a2a",
          fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{album.album_name}</div>
        {[
          { label: "Go to Album",  icon: "◉", action: onGoAlbum },
          { label: "Go to Artist", icon: "♬", action: onGoArtist },
        ].map(({ label, icon, action }, i, arr) => (
          <div key={label} onClick={() => { action(); onClose(); }} style={{
            display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
            borderBottom: i < arr.length - 1 ? "1px solid #2a2a2a" : "none",
            cursor: "pointer", WebkitTapHighlightColor: "transparent",
          }}>
            <span style={{ fontSize: 16, color: "var(--green, #1db954)", width: 20, textAlign: "center" }}>{icon}</span>
            <span style={{ fontSize: 14, color: "#fff" }}>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Thumbnail strip ──────────────────────────────────────────────────────────

function ThumbStrip({ albums, selectedIdx, onSelect, onLongPress, direction = "horizontal" }: {
  albums: RecentAlbum[];
  selectedIdx: number;
  onSelect: (i: number) => void;
  onLongPress: (i: number, x: number, y: number) => void;
  direction?: "horizontal" | "vertical";
}) {
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressRef = useRef<number | null>(null);

  useEffect(() => {
    thumbRefs.current[selectedIdx]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [selectedIdx]);

  const isVertical = direction === "vertical";
  const size = isVertical ? 62 : 76;

  const containerStyle: React.CSSProperties = isVertical ? {
    width: 80, flexShrink: 0,
    overflowY: "auto", overflowX: "hidden",
    WebkitOverflowScrolling: "touch",
    borderRight: "1px solid #1a1a1a",
    display: "flex", flexDirection: "column", alignItems: "center",
    padding: "8px 0", gap: 8,
  } : {
    display: "flex", flexDirection: "row", gap: 8, padding: "10px 16px",
    overflowX: "auto", overflowY: "hidden", flexShrink: 0,
    borderTop: "1px solid #1a1a1a",
  };

  return (
    <div style={containerStyle}>
      {albums.map((album, i) => {
        const url = artUrl(album);
        const isVinyl = album.source === "vinyl";
        return (
          <div
            key={album.album_id + i}
            ref={el => { thumbRefs.current[i] = el; }}
            onTouchStart={e => {
              e.preventDefault();
              const { clientX: x, clientY: y } = e.touches[0];
              timerRef.current = setTimeout(() => {
                suppressRef.current = i;
                onLongPress(i, x, y);
              }, 500);
            }}
            onTouchEnd={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
            onTouchMove={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
            onClick={() => {
              if (suppressRef.current === i) { suppressRef.current = null; return; }
              onSelect(i);
            }}
            style={{
              width: size, height: size, flexShrink: 0, position: "relative",
              borderRadius: 8, overflow: "hidden",
              border: i === selectedIdx ? "2px solid var(--green, #1db954)" : "2px solid transparent",
              background: "#2a2a2a", boxSizing: "border-box",
              cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}
          >
            {url
              ? <img src={url} alt={album.album_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", WebkitTouchCallout: "none" } as React.CSSProperties} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, opacity: 0.2 }}>♪</div>
            }
            {isVinyl && (
              <div style={{
                position: "absolute", bottom: 3, right: 3,
                background: "rgba(0,0,0,0.8)", borderRadius: 3,
                padding: "1px 4px", fontSize: 7, fontWeight: 700, color: VINYL_GOLD,
              }}>VINYL</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Album detail + tracks ────────────────────────────────────────────────────

function AlbumDetail({ album, onFavEntry }: {
  album: RecentAlbum;
  onFavEntry: (entry: AlbumTrackEntry) => void;
}) {
  const [actionEntry, setActionEntry] = useState<{ entry: AlbumTrackEntry; x: number; y: number } | null>(null);
  const queryClient = useQueryClient();
  const url = artUrl(album);
  const isVinyl = album.source === "vinyl";
  const lastPlayed = isVinyl ? album.played_at : album.entries[0]?.played_at;

  const toggleRevisit = async (entry: AlbumTrackEntry) => {
    try { await api.post(`/api/library/track/${entry.track_id}/revisit`); }
    catch {}
    queryClient.invalidateQueries({ queryKey: ["recent-albums"] });
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Album header — fixed */}
      <div style={{ display: "flex", gap: 14, padding: "14px 16px 10px", alignItems: "flex-start", flexShrink: 0 }}>
        <div style={{ width: 90, height: 90, borderRadius: 8, overflow: "hidden", background: "#2a2a2a", flexShrink: 0 }}>
          {url
            ? <img src={url} alt={album.album_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, opacity: 0.2 }}>♪</div>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
          <div style={{
            fontSize: 17, fontWeight: 800, color: "#fff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4,
          }}>{album.album_name || "Unknown album"}</div>
          <div style={{ fontSize: 13, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>
            {album.artist}
          </div>
          {album.release_year && (
            <div style={{ fontSize: 11, color: "#555", marginBottom: 3 }}>{album.release_year}</div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {isVinyl && (
              <span style={{
                fontSize: 9, fontWeight: 700, color: VINYL_GOLD, background: "#c8a84b18",
                border: `1px solid #c8a84b44`, borderRadius: 3, padding: "1px 5px",
              }}>{album.vinyl_type || "VINYL"}</span>
            )}
            <span style={{ fontSize: 11, color: "#555" }}>
              {isVinyl
                ? lastPlayed ? timeAgo(lastPlayed) : ""
                : `${album.entries.length} play${album.entries.length !== 1 ? "s" : ""}${lastPlayed ? " · " + timeAgo(lastPlayed) : ""}`}
            </span>
          </div>
        </div>
      </div>

      {/* Section label — fixed */}
      <div style={{ padding: "2px 16px 6px", flexShrink: 0 }}>
        <span style={{
          fontSize: 10, fontWeight: 700,
          color: isVinyl ? VINYL_GOLD : "#444",
          letterSpacing: "0.1em", textTransform: "uppercase",
        }}>{isVinyl ? "Tracklist" : "Recent Tracks"}</span>
      </div>

      {/* Tracks — scrollable */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", borderTop: "1px solid #1a1a1a" } as React.CSSProperties}>
        {isVinyl ? (
          (album.tracklist ?? []).map((t: VinylTrack, i: number) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "0 16px", height: 40, borderBottom: "1px solid #1a1a1a",
            }}>
              <span style={{ fontSize: 11, color: VINYL_GOLD, flexShrink: 0, width: 24, textAlign: "right", fontWeight: 700 }}>{t.position}</span>
              <span style={{ flex: 1, fontSize: 13, color: "#ccc", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 4 }}>{t.title}</span>
              {t.duration && <span style={{ fontSize: 11, color: "#444", flexShrink: 0 }}>{t.duration}</span>}
            </div>
          ))
        ) : (
          album.entries.map((entry, i) => (
            <TrackRow
              key={entry.played_at + i}
              idx={i + 1}
              entry={entry}
              onFav={() => onFavEntry(entry)}
              onLongPress={(x, y) => setActionEntry({ entry, x, y })}
            />
          ))
        )}
      </div>

      {actionEntry && (
        <TrackActionSheet
          entry={actionEntry.entry}
          x={actionEntry.x}
          y={actionEntry.y}
          onClose={() => setActionEntry(null)}
          onToggleRevisit={() => toggleRevisit(actionEntry.entry)}
        />
      )}
    </div>
  );
}

// ─── Track row ────────────────────────────────────────────────────────────────

function TrackRow({ idx, entry, onFav, onLongPress }: {
  idx: number;
  entry: AlbumTrackEntry;
  onFav: () => void;
  onLongPress: (x: number, y: number) => void;
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressRef = useRef(false);

  return (
    <div
      onTouchStart={e => {
        e.preventDefault();
        const { clientX: x, clientY: y } = e.touches[0];
        timerRef.current = setTimeout(() => { suppressRef.current = true; onLongPress(x, y); }, 500);
      }}
      onTouchEnd={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
      onTouchMove={() => { if (timerRef.current) clearTimeout(timerRef.current); }}
      style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "0 16px", height: 44, borderBottom: "1px solid #1a1a1a",
        WebkitTapHighlightColor: "transparent", userSelect: "none",
      }}
    >
      <span style={{ fontSize: 11, color: "#444", flexShrink: 0, width: 20, textAlign: "right" }}>
        {String(idx).padStart(2, "0")}
      </span>
      <span style={{
        flex: 1, fontSize: 13, color: "#fff", fontWeight: 600,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginLeft: 4,
      }}>{entry.track_name}</span>
      <span style={{ fontSize: 11, color: "#444", flexShrink: 0 }}>{timeAgo(entry.played_at)}</span>
      <button
        onTouchStart={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); onFav(); }}
        style={{
          flexShrink: 0, width: 28, height: 28, background: "none", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: entry.is_favorited ? "#e8175d" : "#444", fontSize: 15, cursor: "pointer",
        }}
      >♥</button>
      <a
        href={`spotify:track:${entry.track_id}`}
        onTouchStart={e => e.stopPropagation()}
        onClick={e => e.stopPropagation()}
        style={{
          flexShrink: 0, width: 28, height: 28,
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#444", fontSize: 12, textDecoration: "none",
        }}
      >▶</a>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function RecentView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [albumMenu, setAlbumMenu] = useState<{ albumIdx: number; x: number; y: number } | null>(null);
  const [stripDir, setStripDir] = useState<"horizontal" | "vertical">("horizontal");

  const { data, isLoading, isError } = useQuery<RecentAlbumsResponse>({
    queryKey: ["recent-albums"],
    queryFn: () => api.get("/api/recent/albums"),
    staleTime: 30_000,
  });
  const { sync, syncing } = useFetchSync();

  const albums = data?.albums ?? [];
  const safeIdx = Math.min(selectedIdx, Math.max(0, albums.length - 1));
  const selected = albums[safeIdx] ?? null;

  const toggleFav = (entry: AlbumTrackEntry) => {
    queryClient.setQueryData<RecentAlbumsResponse>(["recent-albums"], old => {
      if (!old) return old;
      return {
        ...old,
        albums: old.albums.map(a => ({
          ...a,
          entries: a.entries.map(e =>
            e.track_id === entry.track_id && e.played_at === entry.played_at
              ? { ...e, is_favorited: !e.is_favorited }
              : e
          ),
        })),
      };
    });
    api.post(`/api/library/track/${entry.track_id}/favorite`).catch(() => {
      queryClient.invalidateQueries({ queryKey: ["recent-albums"] });
    });
  };

  const menuAlbum = albumMenu != null ? albums[albumMenu.albumIdx] : null;

  const thumbProps = {
    albums, selectedIdx: safeIdx, onSelect: setSelectedIdx,
    onLongPress: (i: number, x: number, y: number) => setAlbumMenu({ albumIdx: i, x, y }),
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        borderBottom: "1px solid #1e1e1e",
        display: "flex", alignItems: "center", gap: 8,
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Recent</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => setStripDir(d => d === "horizontal" ? "vertical" : "horizontal")}
          style={{
            background: "none", border: "none", cursor: "pointer", fontSize: 18, padding: "4px 6px",
            color: stripDir === "vertical" ? "var(--green, #1db954)" : "#555",
          }}
        >{stripDir === "horizontal" ? "▌" : "▄"}</button>
        <button
          onClick={sync} disabled={syncing}
          style={{ background: "none", border: "none", color: syncing ? "#1db954" : "#555", fontSize: 18, cursor: "pointer", padding: "4px 8px", transition: "color 0.2s" }}
        >↺</button>
      </div>

      {isLoading && <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>}
      {isError && (
        <div style={{ padding: 40, textAlign: "center", color: "#666", fontSize: 13 }}>
          Couldn't load. <span style={{ color: "#888", textDecoration: "underline" }} onClick={sync}>Retry</span>
        </div>
      )}

      {albums.length > 0 && stripDir === "vertical" && (
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <ThumbStrip {...thumbProps} direction="vertical" />
          {selected && (
            <AlbumDetail
              key={selected.album_id + safeIdx}
              album={selected}
              onFavEntry={toggleFav}
            />
          )}
        </div>
      )}

      {albums.length > 0 && stripDir === "horizontal" && (
        <>
          {selected && (
            <AlbumDetail
              key={selected.album_id + safeIdx}
              album={selected}
              onFavEntry={toggleFav}
            />
          )}
          <ThumbStrip {...thumbProps} direction="horizontal" />
        </>
      )}

      {menuAlbum && albumMenu && (
        <AlbumContextMenu
          album={menuAlbum}
          x={albumMenu.x} y={albumMenu.y}
          onClose={() => setAlbumMenu(null)}
          onGoArtist={() => navigate(`/artists/${encodeURIComponent(menuAlbum.artist)}`)}
          onGoAlbum={() => navigate(`/albums/${encodeURIComponent(menuAlbum.album_id)}`)}
        />
      )}
    </div>
  );
}
