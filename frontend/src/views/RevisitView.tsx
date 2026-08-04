import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { API_BASE } from "../api/config";

interface RevisitTrack {
  track_id: string;
  track_name: string;
  artist: string;
  album_name: string;
  album_id: string;
  release_year: number | null;
  art_path: string | null;
  last_played: string;
  spotify_uri: string;
  favorited: boolean;
}

function staleness(iso: string): { days: number; label: string; color: string } {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const label =
    days === 0 ? "today" :
    days === 1 ? "yesterday" :
    days < 7  ? `${days}d` :
    days < 30 ? `${Math.floor(days / 7)}w` :
    days < 365 ? `${Math.floor(days / 30)}mo` :
    `${Math.floor(days / 365)}y`;
  const color =
    days < 7   ? "#4a9" :
    days < 30  ? "#a94" :
    days < 90  ? "#a64" :
    "#a44";
  return { days, label, color };
}

function RevisitCard({ track, onRemove }: { track: RevisitTrack; onRemove: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [imgErr, setImgErr] = useState(false);
  const { label, color } = staleness(track.last_played);
  const src = track.art_path && !imgErr ? `${API_BASE}/artwork/${track.art_path}` : null;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ display: "flex", flexDirection: "column", gap: 6 }}
    >
      {/* Art */}
      <div style={{ position: "relative", borderRadius: 8, overflow: "hidden", background: "#1a1a1a", aspectRatio: "1" }}>
        {src
          ? <img src={src} onError={() => setImgErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 28 }}>♪</div>
        }

        {/* Staleness badge */}
        <div style={{
          position: "absolute", top: 6, right: 6,
          background: "rgba(0,0,0,0.72)", borderRadius: 4,
          padding: "2px 6px", fontSize: 10, fontWeight: 700,
          color, backdropFilter: "blur(4px)",
        }}>
          {label}
        </div>

        {/* Hover overlay */}
        <div style={{
          position: "absolute", inset: 0,
          background: "rgba(0,0,0,0.6)",
          opacity: hovered ? 1 : 0,
          transition: "opacity 0.15s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}>
          <a
            href={track.spotify_uri}
            onClick={e => e.stopPropagation()}
            title="Open in Spotify"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center",
              color: "#000", fontSize: 14, fontWeight: 700, textDecoration: "none",
            }}
          >▶</a>
          <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            title="Remove from revisit"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
              color: "#aaa", fontSize: 16, cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(231,76,60,0.4)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#aaa"; }}
          >×</button>
        </div>
      </div>

      {/* Info */}
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 12, fontWeight: 600, color: "var(--white)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          lineHeight: 1.3,
        }}>
          {track.track_name}
        </div>
        <div style={{
          fontSize: 11, color: "var(--dim)", marginTop: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>
          {track.artist}
        </div>
      </div>
    </div>
  );
}

export function RevisitView() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ tracks: RevisitTrack[] }>({
    queryKey: ["revisit"],
    queryFn: () => api.get("/api/revisit"),
    staleTime: 30_000,
  });

  const removeMutation = useMutation({
    mutationFn: (trackId: string) => api.post(`/api/library/track/${trackId}/revisit`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["revisit"] }),
  });

  const tracks = (data?.tracks ?? []).slice().sort(
    (a, b) => new Date(a.last_played).getTime() - new Date(b.last_played).getTime()
  );

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 24px 14px", flexShrink: 0, borderBottom: "1px solid var(--border)", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 20, fontWeight: 700, color: "var(--white)" }}>Revisit</span>
        {tracks.length > 0 && (
          <span style={{ fontSize: 12, color: "var(--dim)" }}>{tracks.length} track{tracks.length !== 1 ? "s" : ""}</span>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 32px" }}>
        {isLoading ? (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>Loading…</div>
        ) : tracks.length === 0 ? (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>
            No tracks marked for revisit. Flag tracks from the Recent view.
          </div>
        ) : (
          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))",
            gap: 20,
          }}>
            {tracks.map(track => (
              <RevisitCard
                key={track.track_id}
                track={track}
                onRemove={() => removeMutation.mutate(track.track_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
