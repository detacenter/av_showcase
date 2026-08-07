import { useState, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AlbumDetail, ArtistTrackPlay } from "../api/types";
import { useSwipeBack } from "../hooks/useSwipeBack";

function artUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `/artwork/${filename.split("/").pop()}`;
}

function fmtRating(r: number): string {
  const v = r / 2;
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

function StarRating({ rating, onChange, size = 16 }: { rating: number; onChange?: (r: number) => void; size?: number }) {
  return (
    <div style={{ display: "flex", gap: 2 }}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(star => {
        const half = star * 2 - 1;
        const full = star * 2;
        const leftFilled  = rating >= half;
        const rightFilled = rating >= full;
        return (
          <div key={star} style={{ position: "relative", width: size, height: size + 2, flexShrink: 0 }}>
            <span style={{ position: "absolute", fontSize: size, color: "#2a2a2a", lineHeight: `${size + 2}px`, userSelect: "none" }}>★</span>
            {leftFilled && (
              <span style={{
                position: "absolute", fontSize: size, color: "#FFD700", lineHeight: `${size + 2}px`,
                clipPath: rightFilled ? "none" : "inset(0 50% 0 0)", userSelect: "none",
              }}>★</span>
            )}
            {onChange && (
              <>
                <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%" }}
                  onTouchEnd={e => { e.preventDefault(); onChange(half); }} />
                <div style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%" }}
                  onTouchEnd={e => { e.preventDefault(); onChange(full); }} />
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RatingModal({ rating, onClose, onSave }: {
  rating: number;
  onClose: () => void;
  onSave: (r: number) => void;
}) {
  const [local, setLocal] = useState(rating);
  const display = local === 0 ? "–" : fmtRating(local);

  return (
    <div
      onTouchEnd={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 1000,
        background: "rgba(0,0,0,0.8)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        onTouchEnd={e => e.stopPropagation()}
        style={{
          background: "#1c1c1c", borderRadius: 18, padding: "28px 24px 20px",
          width: "min(340px, calc(100vw - 48px))",
          display: "flex", flexDirection: "column", alignItems: "center", gap: 18,
          boxShadow: "0 8px 40px rgba(0,0,0,0.6)",
        }}
      >
        <div style={{ fontSize: 52, fontWeight: 800, color: local > 0 ? "#FFD700" : "#333", lineHeight: 1, letterSpacing: "-0.02em" }}>
          {display}
        </div>
        <StarRating rating={local} onChange={setLocal} size={26} />
        <div style={{ display: "flex", gap: 10, width: "100%", marginTop: 4 }}>
          <button
            onTouchEnd={e => { e.stopPropagation(); setLocal(0); }}
            style={{
              flex: 1, padding: "11px 0", borderRadius: 10, border: "1px solid #2a2a2a",
              background: "none", color: "#555", fontSize: 14, cursor: "pointer",
            }}
          >Clear</button>
          <button
            onTouchEnd={e => { e.stopPropagation(); onSave(local); onClose(); }}
            style={{
              flex: 2, padding: "11px 0", borderRadius: 10, border: "none",
              background: "var(--green, #1db954)", color: "#000", fontSize: 14,
              fontWeight: 700, cursor: "pointer",
            }}
          >Done</button>
        </div>
      </div>
    </div>
  );
}

export function AlbumDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  useSwipeBack();

  const albumId = decodeURIComponent(id ?? "");

  const { data, isLoading, isError } = useQuery<AlbumDetail>({
    queryKey: ["album", albumId],
    queryFn: () => api.get(`/api/albums/${encodeURIComponent(albumId)}`),
    staleTime: 60_000,
    enabled: !!albumId,
  });

  const [fav, setFav] = useState<boolean | null>(null);
  const [ratingOverride, setRatingOverride] = useState<number | null>(null);
  const [ratingModalOpen, setRatingModalOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleFav = async () => {
    if (!data) return;
    const cur = fav !== null ? fav : data.is_favorited;
    setFav(!cur);
    try { await api.post(`/api/library/album/${encodeURIComponent(albumId)}/favorite`); }
    catch { setFav(cur); }
    queryClient.invalidateQueries({ queryKey: ["album", albumId] });
  };

  const toggleTrackFav = async (track: ArtistTrackPlay) => {
    try { await api.post(`/api/library/track/${encodeURIComponent(track.track_id)}/favorite`); }
    catch {}
    queryClient.invalidateQueries({ queryKey: ["album", albumId] });
  };

  const saveRating = async (r: number) => {
    const prev = ratingOverride !== null ? ratingOverride : (data?.rating ?? 0);
    setRatingOverride(r);
    try { await api.post(`/api/library/album/${encodeURIComponent(albumId)}/rating`, { rating: r }); }
    catch { setRatingOverride(prev); }
    queryClient.invalidateQueries({ queryKey: ["albums"] });
    queryClient.invalidateQueries({ queryKey: ["album", albumId] });
  };

  const isFav = fav !== null ? fav : (data?.is_favorited ?? false);
  const rating = ratingOverride !== null ? ratingOverride : (data?.rating ?? 0);
  const url = artUrl(data?.art_filename);
  const maxPlays = data ? Math.max(1, ...data.track_plays.map(t => t.play_count)) : 1;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {ratingModalOpen && (
        <RatingModal
          rating={rating}
          onClose={() => setRatingModalOpen(false)}
          onSave={saveRating}
        />
      )}

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
            fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{data?.album_name ?? albumId}</div>
          {data && (
            <button
              onClick={() => navigate(`/artists/${encodeURIComponent(data.artist)}`)}
              style={{
                background: "none", border: "none", padding: 0,
                fontSize: 12, color: "#555", cursor: "pointer", marginTop: 1,
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: "100%", display: "block", textAlign: "left",
              }}
            >{data.artist}</button>
          )}
        </div>
        {data && (
          <button
            onClick={toggleFav}
            style={{
              background: "none", border: "none", flexShrink: 0,
              fontSize: 22, color: isFav ? "#e8175d" : "#333",
              cursor: "pointer", padding: "0 4px",
            }}
          >♥</button>
        )}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>
        )}
        {isError && (
          <div style={{ padding: 40, textAlign: "center", color: "#666", fontSize: 13 }}>Couldn't load album.</div>
        )}

        {data && (
          <>
            {/* Art + meta */}
            <div style={{ display: "flex", gap: 16, padding: "16px 16px 12px", alignItems: "flex-start" }}>
              <div style={{
                width: 100, height: 100, borderRadius: 8, overflow: "hidden",
                background: "#2a2a2a", flexShrink: 0,
              }}>
                {url
                  ? <img src={url} alt={data.album_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.2 }}>♪</div>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
                {data.release_year && (
                  <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>{data.release_year}</div>
                )}
                <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>{data.classified_type}</div>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 2 }}>
                  {data.count} {data.count === 1 ? "play" : "plays"}
                </div>
                {/* Long-press to open rating modal */}
                <div
                  onTouchStart={() => { longPressTimer.current = setTimeout(() => setRatingModalOpen(true), 450); }}
                  onTouchEnd={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  onTouchMove={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                  style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <StarRating rating={rating} size={16} />
                  {rating > 0 && (
                    <span style={{ fontSize: 12, color: "#FFD700", fontWeight: 600 }}>{fmtRating(rating)}</span>
                  )}
                </div>
                <a
                  href={`spotify:album:${data.album_id}`}
                  style={{ fontSize: 12, color: "#7db4cc", display: "block", marginTop: 8, textDecoration: "none" }}
                >↗ Open in Spotify</a>
              </div>
            </div>

            {/* Divider */}
            <div style={{ height: 1, background: "#1a1a1a", margin: "0 0 4px" }} />

            {/* Tracks */}
            {data.track_plays.map((t: ArtistTrackPlay) => (
              <div key={t.track_id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "0 16px", height: 48,
                borderBottom: "1px solid #1a1a1a",
              }}>
                <span style={{ fontSize: 11, color: "#333", flexShrink: 0, width: 18, textAlign: "right" }}>
                  {t.track_number > 0 ? t.track_number : "–"}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontSize: 14, color: "#fff",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{t.track_name}</div>
                  <div style={{ width: "100%", height: 2, background: "#1e1e1e", borderRadius: 1, marginTop: 4 }}>
                    <div style={{
                      width: `${(t.play_count / maxPlays) * 100}%`,
                      height: "100%", background: "var(--green, #1db954)", borderRadius: 1,
                    }} />
                  </div>
                </div>
                <span style={{ fontSize: 11, color: "#444", flexShrink: 0 }}>{t.play_count}×</span>
                <button
                  onClick={() => toggleTrackFav(t)}
                  style={{
                    background: "none", border: "none", flexShrink: 0,
                    fontSize: 14, color: t.is_favorited ? "#e8175d" : "#333",
                    cursor: "pointer", padding: "0 2px",
                  }}
                >♥</button>
                <a
                  href={`spotify:track:${t.track_id}`}
                  style={{
                    flexShrink: 0, width: 26, height: 26,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#444", fontSize: 12, textDecoration: "none",
                  }}
                >▶</a>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
