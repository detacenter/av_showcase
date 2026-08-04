import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { RecentAlbum, RecentAlbumsResponse, AlbumTrackEntry } from "../api/types";

import { API_BASE } from "../api/config";

// ─── helpers ─────────────────────────────────────────────────────────────────

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

function albumArtUrl(album: RecentAlbum): string | null {
  if (album.art_filename) return `${API_BASE}/artwork/${album.art_filename}`;
  if (album.art_local_path) {
    const fn = album.art_local_path.split("/").pop();
    return fn ? `${API_BASE}/artwork/${fn}` : null;
  }
  return album.art_url ?? null;
}

// ─── confirm delete dialog ────────────────────────────────────────────────────

function ConfirmDeleteDialog({
  trackName, onConfirm, onCancel,
}: { trackName: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onConfirm, onCancel]);

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onCancel}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#1e1e1e", border: "1px solid #3a3a3a", borderRadius: 10,
        padding: "20px 24px 16px", minWidth: 300,
      }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 8 }}>Remove play</div>
        <div style={{ color: "#b3b3b3", fontSize: 12, marginBottom: 4 }}>
          Remove <strong style={{ color: "#fff" }}>{trackName}</strong> from your listening log?
        </div>
        <div style={{ color: "#666", fontSize: 11, fontStyle: "italic", marginBottom: 20 }}>
          This cannot be undone.
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{
            height: 28, padding: "0 16px", borderRadius: 6, fontSize: 12,
            background: "#2a2a2a", border: "1px solid #444", color: "#b3b3b3",
          }}>Cancel</button>
          <button onClick={onConfirm} style={{
            height: 28, padding: "0 16px", borderRadius: 6, fontSize: 12,
            background: "#5a1a1a", border: "1px solid #e74c3c", color: "#e74c3c", fontWeight: 600,
          }}
          onMouseEnter={e => { const b = e.currentTarget; b.style.background = "#e74c3c"; b.style.color = "#fff"; }}
          onMouseLeave={e => { const b = e.currentTarget; b.style.background = "#5a1a1a"; b.style.color = "#e74c3c"; }}>
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── detail track row ─────────────────────────────────────────────────────────

interface DetailTrackRowProps {
  idx: number;
  entry: AlbumTrackEntry;
  isFocused: boolean;
  isFavorited: boolean;
  isRevisit: boolean;
  deleteMode: boolean;
  onFav: () => void;
  onRevisit: () => void;
  onDeleteRequest: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}

function DetailTrackRow({
  idx, entry, isFocused, isFavorited, isRevisit,
  deleteMode, onFav, onRevisit, onDeleteRequest, rowRef,
}: DetailTrackRowProps) {
  return (
    <div
      ref={rowRef}
      style={{
        height: 34,
        display: "flex",
        alignItems: "center",
        padding: "0 10px",
        borderRadius: 7,
        background: "#171717",
        gap: 10,
        flexShrink: 0,
        position: "relative",
        border: isFocused ? "2px solid var(--green)" : "2px solid transparent",
        boxSizing: "border-box",
      }}
    >
      {/* Row number */}
      <span style={{
        width: 28, flexShrink: 0, color: "#535353",
        fontSize: 11, fontWeight: 900, userSelect: "none",
      }}>
        {String(idx).padStart(2, "0")}
      </span>

      {/* Track name */}
      <span style={{
        flex: 1, minWidth: 0, color: "#fff", fontSize: 13, fontWeight: 750,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {entry.track_name}
      </span>

      {/* Actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
        {/* Fav */}
        <button onClick={onFav} style={{ width: 26, height: 24, fontSize: 14, color: isFavorited ? "#e8175d" : "#535353" }}
          onMouseEnter={e => { if (!isFavorited) (e.currentTarget as HTMLButtonElement).style.color = "#e8175d"; }}
          onMouseLeave={e => { if (!isFavorited) (e.currentTarget as HTMLButtonElement).style.color = "#535353"; }}>
          ♥
        </button>
        {/* Revisit */}
        <button onClick={onRevisit} style={{
          width: 26, height: 24, fontSize: 14, fontWeight: 850,
          color: isRevisit ? "var(--green)" : "#535353",
        }}
          onMouseEnter={e => { if (!isRevisit) (e.currentTarget as HTMLButtonElement).style.color = "#fff"; }}
          onMouseLeave={e => { if (!isRevisit) (e.currentTarget as HTMLButtonElement).style.color = "#535353"; }}>
          ↻
        </button>
        {/* Play */}
        <a href={`spotify:track:${entry.track_id}`}
          onClick={e => e.stopPropagation()}
          style={{ width: 26, height: 24, display: "flex", alignItems: "center", justifyContent: "center", color: "#535353", textDecoration: "none", fontSize: 14 }}
          onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = "#535353"}>
          ▶
        </a>
        {/* Add to playlist */}
        <button style={{ width: 22, height: 24, fontSize: 15, fontWeight: 700, color: "#535353" }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "var(--green)"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = "#535353"}>
          +
        </button>
      </div>

      {/* Timestamp */}
      <span style={{
        width: 52, flexShrink: 0, color: "#535353",
        fontSize: 11, textAlign: "right", userSelect: "none",
      }}>
        {timeAgo(entry.played_at)}
      </span>

      {/* Delete button */}
      {deleteMode && (
        <button onClick={e => { e.stopPropagation(); onDeleteRequest(); }} style={{
          width: 26, height: 26, borderRadius: 5,
          background: "#3a1010", color: "#e74c3c",
          border: "1px solid #5a2020", fontSize: 12, fontWeight: 700, flexShrink: 0,
        }}
        onMouseEnter={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "#e74c3c"; b.style.color = "#fff"; }}
        onMouseLeave={e => { const b = e.currentTarget as HTMLButtonElement; b.style.background = "#3a1010"; b.style.color = "#e74c3c"; }}>
          ✕
        </button>
      )}
    </div>
  );
}

// ─── album detail ─────────────────────────────────────────────────────────────

interface AlbumDetailProps {
  album: RecentAlbum;
  focusedTrack: number;
  deleteMode: boolean;
  libOverrides: Record<string, { fav?: boolean; revisit?: boolean }>;
  onFav: (entry: AlbumTrackEntry) => void;
  onRevisit: (entry: AlbumTrackEntry) => void;
  onDeleteRequest: (entry: AlbumTrackEntry) => void;
  trackRefs: React.MutableRefObject<(HTMLDivElement | null)[]>;
}

function AlbumDetail({
  album, focusedTrack, deleteMode, libOverrides,
  onFav, onRevisit, onDeleteRequest, trackRefs,
}: AlbumDetailProps) {
  const art = albumArtUrl(album);

  const getEffective = (entry: AlbumTrackEntry) => {
    const ov = libOverrides[entry.track_id];
    return {
      is_favorited: ov?.fav !== undefined ? ov.fav : entry.is_favorited,
      is_revisit: ov?.revisit !== undefined ? ov.revisit : entry.is_revisit,
    };
  };

  const bg = album.dominant_color
    ? `color-mix(in srgb, ${album.dominant_color} 6%, #141414)`
    : "#1a1a1a";

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      background: bg, borderRadius: 12,
      overflow: "hidden", minWidth: 0,
      transition: "background-color 0.3s ease",
    }}>
      {/* Album header */}
      <div style={{
        display: "flex", gap: 16, padding: "18px 18px 12px 18px",
        flexShrink: 0, alignItems: "flex-start",
      }}>
        {art ? (
          <img src={art} alt="" width={158} height={158}
            style={{ borderRadius: 10, objectFit: "cover", flexShrink: 0 }} />
        ) : (
          <div style={{
            width: 158, height: 158, borderRadius: 10, flexShrink: 0,
            background: "#2a2a2a", display: "flex", alignItems: "center",
            justifyContent: "center", color: "#535353", fontSize: 32,
          }}>♪</div>
        )}
        <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
          <div style={{
            fontSize: 23, fontWeight: 900, color: "#fff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            marginBottom: 6,
          }}>
            {album.album_name || "Unknown album"}
          </div>
          <div style={{ fontSize: 15, fontWeight: 820, color: "#b3b3b3", marginBottom: 4,
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {album.artist}
          </div>
          {album.release_year && (
            <div style={{ fontSize: 12, fontWeight: 700, color: "#535353", marginBottom: 2 }}>
              {album.release_year}
            </div>
          )}
          <div style={{ fontSize: 12, fontWeight: 700, color: "#535353" }}>
            {album.source === "vinyl"
              ? (album.vinyl_type || "Vinyl") + " session"
              : `${album.entries.length} recent play${album.entries.length !== 1 ? "s" : ""}`}
          </div>
        </div>
      </div>

      {/* Tracks section */}
      <div style={{ padding: "0 18px 6px 18px", flexShrink: 0 }}>
        <span style={{
          fontSize: 11, fontWeight: 900,
          color: album.source === "vinyl" ? VINYL_GOLD : "#b3b3b3",
          letterSpacing: "1px", textTransform: "uppercase",
        }}>
          {album.source === "vinyl" ? "Tracklist" : "Recent Tracks"}
        </span>
      </div>

      <div style={{
        flex: 1, overflowY: "auto", padding: "0 18px 18px 18px",
        display: "flex", flexDirection: "column", gap: 6,
      }}>
        {album.source === "vinyl" ? (
          (album.tracklist ?? []).map((t, i) => (
            <div key={i} style={{
              height: 30, display: "flex", alignItems: "center",
              padding: "0 10px", borderRadius: 7, background: "#171717",
              gap: 10, flexShrink: 0,
            }}>
              <span style={{ width: 28, flexShrink: 0, color: VINYL_GOLD, fontSize: 11, fontWeight: 700, textAlign: "right" }}>
                {t.position}
              </span>
              <span style={{ flex: 1, minWidth: 0, color: "#fff", fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.title}
              </span>
              {t.duration && (
                <span style={{ color: "#535353", fontSize: 11, flexShrink: 0, fontVariantNumeric: "tabular-nums" }}>
                  {t.duration}
                </span>
              )}
            </div>
          ))
        ) : (
          album.entries.map((entry, i) => {
            const { is_favorited, is_revisit } = getEffective(entry);
            return (
              <DetailTrackRow
                key={entry.played_at}
                idx={i + 1}
                entry={entry}
                isFocused={focusedTrack === i}
                isFavorited={is_favorited}
                isRevisit={is_revisit}
                deleteMode={deleteMode}
                onFav={() => onFav(entry)}
                onRevisit={() => onRevisit(entry)}
                onDeleteRequest={() => onDeleteRequest(entry)}
                rowRef={el => { trackRefs.current[i] = el; }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── album thumbnail ──────────────────────────────────────────────────────────

const VINYL_GOLD = "#c8a84b";

function AlbumThumbnail({
  album, isSelected, onClick, thumbRef,
}: { album: RecentAlbum; isSelected: boolean; onClick: () => void; thumbRef: (el: HTMLDivElement | null) => void }) {
  const art = albumArtUrl(album);
  const isVinyl = album.source === "vinyl";
  return (
    <div
      ref={thumbRef}
      onClick={onClick}
      style={{
        width: 126, height: 126, flexShrink: 0,
        borderRadius: 10, overflow: "hidden", position: "relative",
        border: isSelected ? "2px solid var(--green)" : "2px solid transparent",
        cursor: "pointer", boxSizing: "border-box",
        background: "#1a1a1a", marginBottom: 8,
        transition: "border-color 0.1s",
      }}
    >
      {art ? (
        <img src={art} alt="" width={122} height={122}
          style={{ objectFit: "cover", display: "block", width: "100%", height: "100%" }} />
      ) : (
        <div style={{
          width: "100%", height: "100%", display: "flex",
          alignItems: "center", justifyContent: "center",
          color: "#535353", fontSize: 28,
        }}>♪</div>
      )}
      {isVinyl && (
        <div style={{
          position: "absolute", bottom: 5, right: 5,
          background: "rgba(0,0,0,0.75)", borderRadius: 4,
          padding: "1px 5px", fontSize: 9, fontWeight: 700,
          color: VINYL_GOLD, letterSpacing: 0.5,
        }}>
          {album.vinyl_type || "VINYL"}
        </div>
      )}
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

type LibOverrides = Record<string, { fav?: boolean; revisit?: boolean }>;

export function RecentView() {
  const navigate = useNavigate();
  const [selectedAlbum, setSelectedAlbum] = useState(0);
  const [focusedTrack, setFocusedTrack] = useState(0);
  const [deleteMode, setDeleteMode] = useState(false);
  const [libOverrides, setLibOverrides] = useState<LibOverrides>({});
  const [confirmDelete, setConfirmDelete] = useState<AlbumTrackEntry | null>(null);

  const [searchVisible, setSearchVisible] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [search, setSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);

  const stripRef = useRef<HTMLDivElement>(null);
  const thumbRefs = useRef<(HTMLDivElement | null)[]>([]);
  const trackRefs = useRef<(HTMLDivElement | null)[]>([]);

  const queryClient = useQueryClient();

  const { data } = useQuery<RecentAlbumsResponse>({
    queryKey: ["recent-albums", search],
    queryFn: () => api.get("/api/recent/albums", search ? { q: search } : undefined),
    staleTime: 30_000,
  });

  const albums = data?.albums ?? [];
  const selected = albums[selectedAlbum] ?? null;

  // Reset track focus when album changes
  useEffect(() => {
    setFocusedTrack(0);
    trackRefs.current = [];
  }, [selectedAlbum]);

  // Reset album selection when results reload
  useEffect(() => {
    setSelectedAlbum(0);
    thumbRefs.current = [];
  }, [search]);

  // Scroll album thumb into view
  useEffect(() => {
    thumbRefs.current[selectedAlbum]?.scrollIntoView({ block: "nearest" });
  }, [selectedAlbum]);

  // Scroll track into view
  useEffect(() => {
    trackRefs.current[focusedTrack]?.scrollIntoView({ block: "nearest" });
  }, [focusedTrack]);

  // ── lib toggles ─────────────────────────────────────────────────────────────

  const toggleFav = useCallback((entry: AlbumTrackEntry) => {
    const ov = libOverrides[entry.track_id];
    const effective = ov?.fav !== undefined ? ov.fav : entry.is_favorited;
    const next = !effective;
    setLibOverrides(prev => ({ ...prev, [entry.track_id]: { ...prev[entry.track_id], fav: next } }));
    api.post(`/api/library/track/${entry.track_id}/favorite`).catch(() => {
      setLibOverrides(prev => ({ ...prev, [entry.track_id]: { ...prev[entry.track_id], fav: effective } }));
    });
  }, [libOverrides]);

  const toggleRevisit = useCallback((entry: AlbumTrackEntry) => {
    const ov = libOverrides[entry.track_id];
    const effective = ov?.revisit !== undefined ? ov.revisit : entry.is_revisit;
    const next = !effective;
    setLibOverrides(prev => ({ ...prev, [entry.track_id]: { ...prev[entry.track_id], revisit: next } }));
    api.post(`/api/library/track/${entry.track_id}/revisit`).catch(() => {
      setLibOverrides(prev => ({ ...prev, [entry.track_id]: { ...prev[entry.track_id], revisit: effective } }));
    });
  }, [libOverrides]);

  // ── delete ───────────────────────────────────────────────────────────────────

  const confirmAndDelete = useCallback(async () => {
    if (!confirmDelete) return;
    const entry = confirmDelete;
    setConfirmDelete(null);
    await api.del(`/api/recent/${encodeURIComponent(entry.played_at)}`, { track_id: entry.track_id });
    queryClient.invalidateQueries({ queryKey: ["recent-albums"] });
  }, [confirmDelete, queryClient]);

  // ── search debounce ──────────────────────────────────────────────────────────

  const handleSearchChange = (val: string) => {
    setInputValue(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 120);
  };

  // ── keyboard ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (confirmDelete) return;
      const inInput = (e.target as HTMLElement).tagName === "INPUT";

      if (e.key === "/" && e.ctrlKey) {
        e.preventDefault();
        setSearchVisible(v => !v);
        if (!searchVisible) setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (inInput) return;

      if (e.key === "h" || e.key === "ArrowLeft") {
        e.preventDefault();
        setSelectedAlbum(i => Math.max(0, i - 1));
        return;
      }
      if (e.key === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        setSelectedAlbum(i => Math.min(albums.length - 1, i + 1));
        return;
      }
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedTrack(i => Math.min(i + 1, (selected?.entries.length ?? 1) - 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedTrack(i => Math.max(0, i - 1));
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "d") {
        e.preventDefault();
        setDeleteMode(v => !v);
        return;
      }
      if (e.key === "Escape") {
        if (deleteMode) { setDeleteMode(false); return; }
        if (searchVisible && inputValue) { handleSearchChange(""); return; }
        if (searchVisible) { setSearchVisible(false); return; }
        return;
      }
      if (e.key === "Enter" && selected?.artist) {
        e.preventDefault();
        navigate(`/artists/${encodeURIComponent(selected.artist)}?album=${selected.album_id}`);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const entry = selected?.entries[focusedTrack];
        if (entry) toggleFav(entry);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "o") {
        e.preventDefault();
        const entry = selected?.entries[focusedTrack];
        if (entry?.track_id) window.open(`spotify:track:${entry.track_id}`);
        return;
      }
      if (e.key === "d" && deleteMode) {
        const entry = selected?.entries[focusedTrack];
        if (entry) setConfirmDelete(entry);
        return;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [albums, selected, selectedAlbum, focusedTrack, deleteMode, searchVisible, inputValue, confirmDelete, toggleFav, toggleRevisit, navigate]);

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0a0a0a", boxSizing: "border-box",
    }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "20px 24px 12px 14px", flexShrink: 0,
      }}>
        <span style={{ fontSize: 22, fontWeight: 900, color: "#fff" }}>Recent</span>
        <div style={{ flex: 1 }} />
        {searchVisible && (
          <input
            ref={searchRef}
            value={inputValue}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder="Filter recent plays…"
            autoFocus
            onKeyDown={e => {
              if (e.key === "Escape") {
                if (inputValue) handleSearchChange("");
                else setSearchVisible(false);
                e.stopPropagation();
              }
            }}
            style={{
              background: "#1e1e1e", border: "1px solid #444", borderRadius: 6,
              padding: "4px 10px", color: "#fff", fontSize: 13, outline: "none", width: 200,
            }}
          />
        )}
        {/* Trash / delete mode toggle */}
        <button
          onClick={() => setDeleteMode(v => !v)}
          title="Toggle delete mode (Ctrl+D)"
          style={{
            width: 28, height: 28, borderRadius: 6, fontSize: 14,
            background: deleteMode ? "#3a1010" : "transparent",
            color: deleteMode ? "#e74c3c" : "#535353",
            border: deleteMode ? "1px solid #5a2020" : "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => { if (!deleteMode) (e.currentTarget as HTMLButtonElement).style.color = "#e74c3c"; }}
          onMouseLeave={e => { if (!deleteMode) (e.currentTarget as HTMLButtonElement).style.color = "#535353"; }}
        >
          ⌫
        </button>
      </div>

      {/* Body: strip + detail */}
      <div style={{
        flex: 1, display: "flex", gap: 14,
        padding: "0 24px 16px 14px", overflow: "hidden",
      }}>
        {/* Left album strip */}
        <div
          ref={stripRef}
          style={{
            width: 126, flexShrink: 0,
            overflowY: "auto", overflowX: "hidden",
          }}
        >
          {albums.map((album, i) => (
            <AlbumThumbnail
              key={album.album_id || album.album_name + i}
              album={album}
              isSelected={i === selectedAlbum}
              onClick={() => setSelectedAlbum(i)}
              thumbRef={el => { thumbRefs.current[i] = el; }}
            />
          ))}
        </div>

        {/* Right detail */}
        {selected ? (
          <AlbumDetail
            album={selected}
            focusedTrack={focusedTrack}
            deleteMode={deleteMode}
            libOverrides={libOverrides}
            onFav={toggleFav}
            onRevisit={toggleRevisit}
            onDeleteRequest={entry => setConfirmDelete(entry)}
            trackRefs={trackRefs}
          />
        ) : (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: "#535353", fontSize: 13,
          }}>
            Loading…
          </div>
        )}
      </div>

      {confirmDelete && (
        <ConfirmDeleteDialog
          trackName={confirmDelete.track_name}
          onConfirm={confirmAndDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
