import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ArtistsResponse, ArtistListItem } from "../api/types";
import { useFetchSync } from "../hooks/useFetchSync";
import { FilterDialog, emptyFilters, activeFilterCount } from "../components/FilterDialog";
import type { FilterState } from "../components/FilterDialog";

function artUrl(filename: string | null): string | null {
  if (!filename) return null;
  return `/artwork/${filename.split("/").pop()}`;
}

// ─── List row ─────────────────────────────────────────────────────────────────

function ArtistRow({ artist, onTap }: { artist: ArtistListItem; onTap: () => void }) {
  const [fav, setFav] = useState(artist.is_favorited);
  const thumb = artUrl(artist.albums[0]?.art_filename ?? null);
  const genre = artist.genres[0] ?? "";

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setFav(v => !v);
    try { await api.post(`/api/library/artist/${encodeURIComponent(artist.name)}/favorite`); }
    catch { setFav(v => !v); }
  };

  return (
    <div
      onClick={onTap}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", borderBottom: "1px solid #1a1a1a",
        WebkitTapHighlightColor: "transparent", cursor: "pointer",
      }}
    >
      <div style={{ width: 52, height: 52, flexShrink: 0, borderRadius: "50%", overflow: "hidden", background: "#2a2a2a" }}>
        {thumb
          ? <img src={thumb} alt={artist.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, opacity: 0.2 }}>♪</div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
        }}>{artist.name}</div>
        <div style={{ fontSize: 12, color: "#555" }}>
          {genre && <span style={{ color: "#666" }}>{genre} · </span>}
          {artist.play_count} {artist.play_count === 1 ? "play" : "plays"}
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
      <div style={{ color: "#333", fontSize: 12, flexShrink: 0 }}>›</div>
    </div>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

function ArtistTile({ artist, onTap }: { artist: ArtistListItem; onTap: () => void }) {
  const albums = artist.albums;
  const pick = albums.length ? albums[Math.floor(Math.random() * albums.length)] : null;
  const thumb = artUrl(pick?.art_filename ?? null);

  return (
    <div
      onClick={onTap}
      style={{ cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <div style={{ width: "100%", aspectRatio: "1", position: "relative", borderRadius: 10, overflow: "hidden", background: "#2a2a2a" }}>
        {thumb
          ? <img src={thumb} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15 }}>♪</div>
        }
      </div>
      <div style={{ marginTop: 6 }}>
        <div style={{
          fontSize: 12, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{artist.name}</div>
        {artist.is_favorited && <div style={{ fontSize: 9, color: "#e8175d", marginTop: 2 }}>♥</div>}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function ArtistsView() {
  const navigate = useNavigate();
  const [tiles, setTiles] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters());
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError } = useQuery<ArtistsResponse>({
    queryKey: ["artists"],
    queryFn: () => api.get("/api/artists"),
    staleTime: 60_000,
  });
  const { sync, syncing } = useFetchSync();

  const artists = data?.artists ?? [];
  const allGenres = data?.all_genres ?? [];

  const filtered = artists.filter(a => {
    const q = filters.search.trim().toLowerCase();
    if (q && !a.name.toLowerCase().includes(q)) return false;
    if (filters.genres.length && !filters.genres.some(g => a.genres.includes(g))) return false;
    return true;
  });

  const filterCount = activeFilterCount(filters);

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
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em" }}>Artists</span>
        <div style={{ flex: 1 }} />

        {/* Filter button */}
        <button
          onClick={() => setDialogOpen(true)}
          style={{
            position: "relative", background: "none", border: "none",
            color: filterCount > 0 ? "var(--green, #1db954)" : "#555",
            fontSize: 17, cursor: "pointer", padding: "4px 6px",
          }}
        >
          ⊟
          {filterCount > 0 && (
            <span style={{
              position: "absolute", top: 0, right: 0,
              background: "var(--green, #1db954)", color: "#000",
              borderRadius: "50%", width: 14, height: 14,
              fontSize: 9, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>{filterCount}</span>
          )}
        </button>

        <button
          onClick={() => setTiles(v => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: tiles ? "var(--green, #1db954)" : "#555", padding: "4px 6px" }}
        >{tiles ? "≡" : "⊞"}</button>
        <button
          onClick={sync} disabled={syncing}
          style={{ background: "none", border: "none", color: syncing ? "#1db954" : "#555", fontSize: 18, cursor: "pointer", padding: "4px 8px", transition: "color 0.2s" }}
        >↺</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>}
        {isError && (
          <div style={{ padding: 40, textAlign: "center", color: "#666", fontSize: 13 }}>
            Couldn't load. <span style={{ color: "#888", textDecoration: "underline" }} onClick={sync}>Retry</span>
          </div>
        )}

        {tiles ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: 10 }}>
            {filtered.map(artist => (
              <ArtistTile
                key={artist.name}
                artist={artist}
                onTap={() => navigate(`/artists/${encodeURIComponent(artist.name)}`)}
              />
            ))}
          </div>
        ) : (
          filtered.map(artist => (
            <ArtistRow
              key={artist.name}
              artist={artist}
              onTap={() => navigate(`/artists/${encodeURIComponent(artist.name)}`)}
            />
          ))
        )}

        {!isLoading && filtered.length === 0 && filterCount > 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>No artists match your filters</div>
        )}
      </div>

      <FilterDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        filters={filters}
        onChange={setFilters}
        availableGenres={allGenres}
        searchPlaceholder="Artist name…"
      />
    </div>
  );
}
