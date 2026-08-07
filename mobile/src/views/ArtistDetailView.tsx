import { useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ArtistDetail, ArtistDetailAlbum } from "../api/types";
import { useSwipeBack } from "../hooks/useSwipeBack";

function artUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `/artwork/${filename.split("/").pop()}`;
}

function AlbumRow({ album, onNavigate, onLongPress }: {
  album: ArtistDetailAlbum;
  onNavigate: () => void;
  onLongPress: () => void;
}) {
  const [fav, setFav] = useState(album.is_favorited);
  const src = artUrl(album.art_filename);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longFired = useRef(false);

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setFav(v => !v);
    try { await api.post(`/api/library/album/${album.album_id}/favorite`); }
    catch { setFav(v => !v); }
  };

  const startPress = () => {
    longFired.current = false;
    timerRef.current = setTimeout(() => {
      longFired.current = true;
      onLongPress();
    }, 500);
  };

  const cancelPress = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const handleClick = () => {
    if (!longFired.current) onNavigate();
  };

  return (
    <div
      onClick={handleClick}
      onTouchStart={startPress}
      onTouchMove={cancelPress}
      onTouchEnd={cancelPress}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", minHeight: 72,
        borderBottom: "1px solid #1a1a1a",
        WebkitTapHighlightColor: "transparent", cursor: "pointer",
        userSelect: "none",
      } as React.CSSProperties}
    >
      <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: "#2a2a2a" }}>
        {src
          ? <img src={src} alt={album.album_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, opacity: 0.2 }}>♪</div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
        }}>{album.album_name}</div>
        <div style={{ fontSize: 12, color: "#555" }}>
          {album.release_year ? `${album.release_year} · ` : ""}
          {album.count} {album.count === 1 ? "play" : "plays"}
        </div>
      </div>
      <button
        onTouchStart={e => e.stopPropagation()}
        onClick={toggleFav}
        style={{
          flexShrink: 0, width: 32, height: 32, background: "none", border: "none",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: fav ? "#e8175d" : "#333", fontSize: 16, cursor: "pointer",
        }}
      >♥</button>
      <div style={{ color: "#333", fontSize: 14, flexShrink: 0 }}>›</div>
    </div>
  );
}

export function ArtistDetailView() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const artistName = decodeURIComponent(name ?? "");
  useSwipeBack();

  const [popup, setPopup] = useState<ArtistDetailAlbum | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery<ArtistDetail>({
    queryKey: ["artist", artistName],
    queryFn: () => api.get(`/api/artists/${encodeURIComponent(artistName)}`),
    staleTime: 60_000,
    enabled: !!artistName,
  });

  const setHeroArt = useCallback(async (album: ArtistDetailAlbum) => {
    setPopup(null);
    if (!album.art_filename) return;
    await api.post(`/api/library/artist/${encodeURIComponent(artistName)}/hero-art`, { art_filename: album.art_filename });
    queryClient.invalidateQueries({ queryKey: ["artists"] });
    setConfirmMsg(`Artist artwork set to "${album.album_name}"`);
    setTimeout(() => setConfirmMsg(null), 2500);
  }, [artistName, queryClient]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        borderBottom: "1px solid #1e1e1e",
        display: "flex", alignItems: "center", gap: 12,
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <button
          onClick={() => navigate(-1)}
          style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}
        >‹</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{artistName}</div>
          {data && (
            <div style={{ fontSize: 12, color: "#555", marginTop: 1 }}>
              {data.play_count} plays
              {data.genres.length > 0 && ` · ${data.genres.slice(0, 2).join(", ")}`}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>
        )}
        {isError && (
          <div style={{ padding: 40, textAlign: "center", color: "#666", fontSize: 13 }}>Couldn't load artist.</div>
        )}
        {data && data.albums.map(album => (
          <AlbumRow
            key={album.album_id}
            album={album}
            onNavigate={() => navigate(`/albums/${encodeURIComponent(album.album_id)}`)}
            onLongPress={() => setPopup(album)}
          />
        ))}
      </div>

      {/* Long-press popup */}
      {popup && (
        <div
          onClick={() => setPopup(null)}
          style={{
            position: "fixed", inset: 0, zIndex: 100,
            background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "flex-end",
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: "100%", background: "#1e1e1e", borderRadius: "16px 16px 0 0",
              padding: "16px 20px", paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
              display: "flex", flexDirection: "column", gap: 4,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff", marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {popup.album_name}
            </div>
            <button
              onClick={() => setHeroArt(popup)}
              style={{
                background: "none", border: "none", textAlign: "left",
                padding: "12px 0", fontSize: 15, color: "#e0e0e0", cursor: "pointer",
                borderTop: "1px solid #2a2a2a",
              }}
            >
              Set as artist artwork
            </button>
            <button
              onClick={() => setPopup(null)}
              style={{
                background: "none", border: "none", textAlign: "left",
                padding: "12px 0", fontSize: 15, color: "#555", cursor: "pointer",
                borderTop: "1px solid #2a2a2a",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Confirmation toast */}
      {confirmMsg && (
        <div style={{
          position: "fixed", bottom: "calc(80px + env(safe-area-inset-bottom))",
          left: "50%", transform: "translateX(-50%)",
          background: "#1db954", color: "#000", fontSize: 13, fontWeight: 600,
          padding: "8px 16px", borderRadius: 20, zIndex: 200,
          whiteSpace: "nowrap",
        }}>
          {confirmMsg}
        </div>
      )}
    </div>
  );
}
