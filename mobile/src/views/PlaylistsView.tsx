import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

interface Playlist {
  id: string;
  name: string;
  track_count: number;
  art_filenames: string[];
}

interface PlaylistTrack {
  track_id: string;
  track_name: string;
  artist_names: string[];
  album_name: string;
  album_art_local_path?: string;
  release_year: number | null;
  _play_count: number;
  _pinned: boolean;
}

function artUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `/artwork/${filename.split("/").pop()}`;
}

// ─── Playlist mosaic art ──────────────────────────────────────────────────────

function PlaylistArt({ filenames, size }: { filenames: string[]; size: number }) {
  const imgs = filenames.slice(0, 4);
  if (imgs.length === 0) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 10, background: "#2a2a2a", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15,
      }}>♪</div>
    );
  }
  if (imgs.length < 4) {
    return (
      <div style={{ width: size, height: size, borderRadius: 10, overflow: "hidden", flexShrink: 0, background: "#2a2a2a" }}>
        <img src={artUrl(imgs[0])!} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      </div>
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: 10, overflow: "hidden", flexShrink: 0,
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#1a1a1a",
    }}>
      {imgs.map((f, i) => (
        <img key={i} src={artUrl(f)!} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      ))}
    </div>
  );
}

// ─── Playlist tile ────────────────────────────────────────────────────────────

function PlaylistTile({ playlist, onTap }: { playlist: Playlist; onTap: () => void }) {
  return (
    <div onClick={onTap} style={{ cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <div style={{
        width: "100%", aspectRatio: "1", borderRadius: 10, overflow: "hidden",
        background: "#2a2a2a", position: "relative",
      }}>
        {playlist.art_filenames.length >= 4 ? (
          <div style={{
            position: "absolute", inset: 0,
            display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#1a1a1a",
          }}>
            {playlist.art_filenames.slice(0, 4).map((f, i) => (
              <img key={i} src={artUrl(f)!} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            ))}
          </div>
        ) : playlist.art_filenames[0] ? (
          <img src={artUrl(playlist.art_filenames[0])!} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15 }}>♪</div>
        )}
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{playlist.name}</div>
        <div style={{ fontSize: 11, color: "#555", marginTop: 1 }}>
          {playlist.track_count} {playlist.track_count === 1 ? "track" : "tracks"}
        </div>
      </div>
    </div>
  );
}

// ─── Playlist detail ──────────────────────────────────────────────────────────

function PlaylistDetail({ playlist, onBack }: { playlist: Playlist; onBack: () => void }) {
  const { data, isLoading } = useQuery<{ tracks: PlaylistTrack[] }>({
    queryKey: ["playlist-tracks", playlist.id],
    queryFn: () => api.get(`/api/playlists/${playlist.id}/evaluate`),
    staleTime: 60_000,
  });

  const tracks = data?.tracks ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        borderBottom: "1px solid #1e1e1e",
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} style={{
            background: "none", border: "none", color: "#888",
            fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1,
          }}>‹</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{playlist.name}</div>
            <div style={{ fontSize: 12, color: "#555", marginTop: 1 }}>
              {playlist.track_count} {playlist.track_count === 1 ? "track" : "tracks"}
            </div>
          </div>
        </div>
      </div>

      {/* Track list */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>
        )}
        {!isLoading && tracks.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>No tracks.</div>
        )}
        {tracks.map((t, i) => {
          const thumb = artUrl(t.album_art_local_path);
          return (
            <div key={t.track_id + i} style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "8px 12px 8px 6px", borderBottom: "1px solid #1a1a1a",
            }}>
              <span style={{ fontSize: 11, color: "#333", flexShrink: 0, width: 22, textAlign: "right" }}>
                {i + 1}
              </span>
              <div style={{
                width: 40, height: 40, borderRadius: 4, overflow: "hidden",
                background: "#2a2a2a", flexShrink: 0,
              }}>
                {thumb
                  ? <img src={thumb} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, opacity: 0.2 }}>♪</div>
                }
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontSize: 14, color: "#fff", fontWeight: 500,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{t.track_name}</div>
                <div style={{
                  fontSize: 12, color: "#555", marginTop: 1,
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{t.artist_names.join(", ")} · {t.album_name}</div>
              </div>
              <a
                href={`spotify:track:${t.track_id}`}
                style={{
                  flexShrink: 0, fontSize: 14,
                  color: "var(--green, #1db954)", textDecoration: "none",
                  padding: "0 4px",
                }}
              >▶</a>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Playlists list ───────────────────────────────────────────────────────────

export function PlaylistsView() {
  const [selected, setSelected] = useState<Playlist | null>(null);

  const { data, isLoading } = useQuery<{ playlists: Playlist[] }>({
    queryKey: ["playlists"],
    queryFn: () => api.get("/api/playlists"),
    staleTime: 60_000,
  });

  const playlists = data?.playlists ?? [];

  if (selected) {
    return <PlaylistDetail playlist={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        borderBottom: "1px solid #1e1e1e",
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
          Playlists
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>
        )}
        {!isLoading && playlists.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>No playlists yet.</div>
        )}
        {playlists.length > 0 && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 12, padding: 12,
          }}>
            {playlists.map(p => (
              <PlaylistTile key={p.id} playlist={p} onTap={() => setSelected(p)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
