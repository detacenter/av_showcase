import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AlbumsResponse, AlbumListItem } from "../api/types";
import { FilterDialog, emptyFilters, activeFilterCount } from "../components/FilterDialog";
import type { FilterState } from "../components/FilterDialog";

function artUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `/artwork/${filename.split("/").pop()}`;
}

function fmtRating(r: number): string {
  const v = r / 2;
  return v % 1 === 0 ? String(v) : v.toFixed(1);
}

type SortKey = "recent" | "az" | "plays";

// ─── List row ─────────────────────────────────────────────────────────────────

function AlbumListRow({ album, onNavigate }: {
  album: AlbumListItem;
  onNavigate: () => void;
}) {
  const url = artUrl(album.art_filename);
  return (
    <div
      onClick={onNavigate}
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "10px 16px", minHeight: 68,
        borderBottom: "1px solid #1a1a1a",
        WebkitTapHighlightColor: "transparent", cursor: "pointer",
      }}
    >
      <div style={{ width: 48, height: 48, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: "#2a2a2a" }}>
        {url
          ? <img src={url} alt={album.album_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, opacity: 0.2 }}>♪</div>
        }
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 14, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2,
        }}>{album.album_name}</div>
        <div style={{ fontSize: 12, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {album.artist}{album.release_year ? ` · ${album.release_year}` : ""}
        </div>
      </div>
      <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
        {album.rating > 0 && <div style={{ fontSize: 12, color: "#FFD700", fontWeight: 600 }}>{fmtRating(album.rating)}</div>}
        <div style={{ fontSize: 12, color: "#444" }}>{album.count}×</div>
        {album.is_favorited && <div style={{ fontSize: 11, color: "#e8175d" }}>♥</div>}
      </div>
      <div style={{ color: "#333", fontSize: 14, flexShrink: 0 }}>›</div>
    </div>
  );
}

// ─── Tile ─────────────────────────────────────────────────────────────────────

function AlbumTile({ album, onNavigate }: { album: AlbumListItem; onNavigate: () => void }) {
  const url = artUrl(album.art_filename);
  return (
    <div
      onClick={onNavigate}
      style={{ cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
    >
      <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#2a2a2a" }}>
        {url
          ? <img src={url} alt={album.album_name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15 }}>♪</div>
        }
      </div>
      <div style={{ marginTop: 4 }}>
        <div style={{
          fontSize: 11, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{album.album_name}</div>
        <div style={{ fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
          {album.artist}
        </div>
        {(album.is_favorited || album.rating > 0) && (
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
            {album.is_favorited && <span style={{ fontSize: 9, color: "#e8175d" }}>♥</span>}
            {album.rating > 0 && <span style={{ fontSize: 10, color: "#FFD700", fontWeight: 600 }}>{fmtRating(album.rating)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function AlbumsView() {
  const navigate = useNavigate();
  const [sort, setSort] = useState<SortKey>("recent");
  const [tiles, setTiles] = useState(true);
  const [filters, setFilters] = useState<FilterState>(emptyFilters());
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading } = useQuery<AlbumsResponse>({
    queryKey: ["albums"],
    queryFn: () => api.get("/api/albums"),
    staleTime: 60_000,
  });

  const allGenres = data?.all_genres ?? [];
  const yearBounds = data?.year_bounds ?? null;

  const availableTypes = useMemo(() => {
    const types = [...new Set((data?.albums ?? []).map(a => a.classified_type))];
    const order = ["Album", "EP", "Single", "Compilation"];
    return types.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [data]);

  const albums = useMemo(() => {
    let list = data?.albums ?? [];

    const q = filters.search.trim().toLowerCase();
    if (q) list = list.filter(a =>
      a.album_name.toLowerCase().includes(q) || a.artist.toLowerCase().includes(q)
    );
    if (filters.genres.length) list = list.filter(a =>
      filters.genres.some(g => a.genres.includes(g))
    );
    if (filters.albumTypes.length) list = list.filter(a =>
      filters.albumTypes.includes(a.classified_type)
    );
    if (filters.yearFrom) list = list.filter(a =>
      a.release_year !== null && a.release_year >= Number(filters.yearFrom)
    );
    if (filters.yearTo) list = list.filter(a =>
      a.release_year !== null && a.release_year <= Number(filters.yearTo)
    );

    if (sort === "recent") list = [...list].sort((a, b) => b.latest_played.localeCompare(a.latest_played));
    if (sort === "az")     list = [...list].sort((a, b) => a.album_name.localeCompare(b.album_name));
    if (sort === "plays")  list = [...list].sort((a, b) => b.count - a.count);
    return list;
  }, [data, sort, filters]);

  const filterCount = activeFilterCount(filters);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    background: "none", border: "none", borderBottom: `2px solid ${active ? "var(--green, #1db954)" : "transparent"}`,
    padding: "6px 14px", marginBottom: -1,
    fontSize: 13, fontWeight: active ? 600 : 400,
    cursor: "pointer", color: active ? "var(--green, #1db954)" : "#555",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px 0",
        paddingTop: "calc(14px + env(safe-area-inset-top))" as string,
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
            Albums
            {data && <span style={{ fontSize: 13, fontWeight: 400, color: "#444", marginLeft: 8 }}>{albums.length}{filterCount > 0 ? ` / ${data.albums.length}` : ""}</span>}
          </span>
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
        </div>

        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #1a1a1a" }}>
          <button style={pillStyle(sort === "recent")} onClick={() => setSort("recent")}>Recent</button>
          <button style={pillStyle(sort === "plays")}  onClick={() => setSort("plays")}>Most Played</button>
          <button style={pillStyle(sort === "az")}     onClick={() => setSort("az")}>A–Z</button>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>}
        {!isLoading && albums.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>
            {filterCount > 0 ? "No albums match your filters" : "No albums found."}
          </div>
        )}

        {tiles ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: 10 }}>
            {albums.map(album => (
              <AlbumTile
                key={album.album_id}
                album={album}
                onNavigate={() => navigate(`/albums/${encodeURIComponent(album.album_id)}`)}
              />
            ))}
          </div>
        ) : (
          albums.map(album => (
            <AlbumListRow
              key={album.album_id}
              album={album}
              onNavigate={() => navigate(`/albums/${encodeURIComponent(album.album_id)}`)}
            />
          ))
        )}
      </div>

      <FilterDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        filters={filters}
        onChange={setFilters}
        availableGenres={allGenres}
        availableTypes={availableTypes}
        yearBounds={yearBounds}
        searchPlaceholder="Album or artist…"
      />
    </div>
  );
}
