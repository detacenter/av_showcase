import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Artist, ArtistsResponse } from "../api/types";
import { GenrePalette } from "../components/GenrePalette";
import { useHistoryInfo } from "../api/useHistoryInfo";
import { GridScrubber, SectionHeader, SizeSwitch } from "../lib/sectionedGrid";
import {
  buildSections, compareFolded, HEADER_H, letterOf, monthKey, monthLabel, useSectionedGrid, useTileSize, type TileSize,
} from "../lib/sectionedGridLayout";

import { API_BASE } from "../api/config";
const CARD_MIN_W: Record<TileSize, number> = { S: 150, M: 220, L: 300 };
const CARD_H = 318;
const GAP = 12;
// ArtistCard: 10px padding, a 52px header, 6px, then a (tileWidth - 20) square of art;
// CARD_H is the floor for narrow tiles at the default size (S is meant to be small).
const cardHeightFor = (tileWidth: number, size: TileSize) => (size === "S" ? tileWidth + 68 : Math.max(CARD_H, tileWidth + 68));
// Plays has no headers (a band label would read as a stat); the rail still marks the bands.
const PLAY_BANDS = [1000, 500, 250, 100, 50, 25, 10, 5, 1];

// ─── helpers ─────────────────────────────────────────────────────────────────

function artUrl(filename: string | null | undefined): string | null {
  return filename ? `${API_BASE}/artwork/${filename}` : null;
}

// ─── artist card ──────────────────────────────────────────────────────────────

function ArtistCard({
  artist, isFocused, isFavorited, tileWidth, size, onClick, onFav,
}: {
  artist: Artist; isFocused: boolean; isFavorited: boolean; tileWidth: number; size: TileSize;
  onClick: () => void; onFav: (e: React.MouseEvent) => void;
}) {
  const heroArt = artUrl(artist.hero_art_filename ?? artist.albums[0]?.art_filename ?? null);
  const heroSize = tileWidth - 20;
  const genreLabel = artist.genres.slice(0, 4).join(", ");
  return (
    <div onClick={onClick} style={{
      width: tileWidth, height: cardHeightFor(tileWidth, size), background: "#1a1a1a", borderRadius: 8,
      padding: 10, boxSizing: "border-box", cursor: "pointer", flexShrink: 0,
      display: "flex", flexDirection: "column",
      border: isFocused ? "2px solid var(--green)" : "2px solid transparent",
      transition: "border-color 0.1s",
    }}>
      <div style={{ height: 52, display: "flex", alignItems: "flex-start", gap: 6, minWidth: 0 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 14, fontWeight: 700, color: "#fff", lineHeight: "1.3",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{artist.name}</div>
          {genreLabel && (
            <div style={{
              fontSize: 11, color: "#b3b3b3", marginTop: 3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{genreLabel}</div>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 3, flexShrink: 0 }}>
          <button onClick={onFav} style={{
            width: 28, height: 28, fontSize: 16, borderRadius: 4,
            color: isFavorited ? "#e8175d" : "#535353",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
          onMouseEnter={e => { if (!isFavorited) (e.currentTarget as HTMLButtonElement).style.color = "#e8175d"; }}
          onMouseLeave={e => { if (!isFavorited) (e.currentTarget as HTMLButtonElement).style.color = "#535353"; }}>
            ♥
          </button>
          <span style={{ fontSize: 11, color: "#b3b3b3" }}>{artist.play_count} plays</span>
        </div>
      </div>
      <div style={{ height: 6 }} />
      <div style={{
        width: heroSize, height: heroSize, borderRadius: 6, overflow: "hidden",
        background: "#2a2a2a", display: "flex", alignItems: "center",
        justifyContent: "center", flexShrink: 0,
      }}>
        {heroArt
          ? <img src={heroArt} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ color: "#535353", fontSize: 40 }}>♪</span>
        }
      </div>
    </div>
  );
}

type SortKey = "recent" | "az" | "za" | "plays";

// ─── where you were ───────────────────────────────────────────────────────────
// Opening an artist unmounts this view, so "← Artists" used to land at the top with the
// sort and filters reset. Kept at module level: it lasts as long as the app is open.

interface SavedView {
  sort: SortKey; favOnly: boolean; sinceAV: boolean; activeGenres: string[];
  search: string; searchVisible: boolean; focusedIdx: number; scrollTop: number;
}
let savedView: SavedView | null = null;

// ─── main view ────────────────────────────────────────────────────────────────

export function ArtistsView() {
  const navigate = useNavigate();
  const [restore] = useState(() => savedView);
  const [sort, setSort] = useState<SortKey>(restore?.sort ?? "recent");
  const [favOnly, setFavOnly] = useState(restore?.favOnly ?? false);
  const [sinceAV, setSinceAV] = useState(restore?.sinceAV ?? false);   // only artists played since AV's own log began
  const [activeGenres, setActiveGenres] = useState<Set<string>>(() => new Set(restore?.activeGenres ?? []));
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(restore?.searchVisible ?? false);
  const [searchInput, setSearchInput] = useState(restore?.search ?? "");
  const [search, setSearch] = useState(restore?.search ?? "");
  const [focusedIdx, setFocusedIdx] = useState(restore?.focusedIdx ?? -1);
  const [favOverrides, setFavOverrides] = useState<Record<string, boolean>>({});
  const [size, setSize] = useTileSize("av.artists.tileSize");

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cols, setCols] = useState(3);
  const [tileWidth, setTileWidth] = useState(CARD_MIN_W.M);
  const [measured, setMeasured] = useState(false);
  const pendingScroll = useRef<number | null>(restore?.scrollTop ?? null);

  const queryClient = useQueryClient();

  const { data } = useQuery<ArtistsResponse>({
    queryKey: ["artists"],
    queryFn: () => api.get("/api/artists"),
    staleTime: 60_000,
  });
  const { data: historyInfo } = useHistoryInfo();
  const avBeganMs = historyInfo?.av_began ? new Date(historyInfo.av_began).getTime() : null;

  const allArtists = useMemo(() => data?.artists ?? [], [data]);
  const allGenres = data?.all_genres ?? [];

  // ── responsive grid ───────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w === 0) return;
      const minW = CARD_MIN_W[size];
      const c = Math.max(1, Math.floor((w + GAP) / (minW + GAP)));
      const tw = Math.max(minW, Math.floor((w - (c - 1) * GAP) / c));
      setCols(c);
      setTileWidth(tw);
      setMeasured(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  // ── filter + sort ─────────────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let items = allArtists;
    if (search) {
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const q = norm(search);
      items = items.filter(a => norm(a.name).includes(q));
    }
    if (favOnly) {
      items = items.filter(a => favOverrides[a.name] !== undefined ? favOverrides[a.name] : a.is_favorited);
    }
    if (sinceAV && avBeganMs !== null) {
      items = items.filter(a => new Date(a.latest_played).getTime() >= avBeganMs);
    }
    if (activeGenres.size > 0) {
      items = items.filter(a => a.genres.some(g => activeGenres.has(g)));
    }
    const sorted = [...items];
    if (sort === "plays") sorted.sort((a, b) => b.play_count - a.play_count);
    else if (sort === "az") sorted.sort((a, b) => compareFolded(a.name, b.name));
    else if (sort === "za") sorted.sort((a, b) => compareFolded(b.name, a.name));
    else sorted.sort((a, b) => b.latest_played > a.latest_played ? 1 : -1);
    return sorted;
  }, [allArtists, search, favOnly, sinceAV, avBeganMs, activeGenres, sort, favOverrides]);

  // Sections follow the sort: letters for A→Z, months played for Recent, play bands (rail only) for Plays.
  const sections = useMemo(() => {
    if (sort === "az" || sort === "za")
      return buildSections(filtered, a => letterOf(a.name), k => ({ label: k === "•" ? "Other" : k, rail: k }));
    if (sort === "plays")
      return buildSections(filtered, a => String(PLAY_BANDS.find(b => a.play_count >= b) ?? 0), k => {
        const n = Number(k);
        return { label: n >= 1000 ? "1,000+ plays" : `${n}+ plays`, rail: n >= 1000 ? "1k+" : String(n), header: false };
      });
    return buildSections(filtered, a => monthKey(a.latest_played), (k, _f, prev) => ({
      label: monthLabel(k), rail: !prev || prev.slice(0, 4) !== k.slice(0, 4) ? k.slice(0, 4) : null,
    }));
  }, [filtered, sort]);

  const grid = useSectionedGrid({ containerRef, sections, cols, rowHeight: cardHeightFor(tileWidth, size), gap: GAP });
  const { scrollToIndex, moveVertical, sameRow } = grid;

  useEffect(() => {
    if (pendingScroll.current !== null) return;   // coming back: put the list where it was instead
    setFocusedIdx(-1);
    containerRef.current?.scrollTo({ top: 0 });   // a new list starts at its top
  }, [filtered.length, sort, search, favOnly, sinceAV, activeGenres.size]);

  // Restore the scroll once the artists are in and the grid knows its column count.
  useEffect(() => {
    if (pendingScroll.current === null || !measured || filtered.length === 0) return;
    const top = pendingScroll.current;
    pendingScroll.current = null;
    containerRef.current?.scrollTo({ top });
  }, [measured, filtered.length]);

  useEffect(() => {
    if (focusedIdx >= 0 && pendingScroll.current === null) scrollToIndex(focusedIdx);
  }, [focusedIdx, scrollToIndex]);

  // Remember all of it on the way out.
  const latest = useRef<Omit<SavedView, "scrollTop">>({ sort, favOnly, sinceAV, activeGenres: [...activeGenres], search, searchVisible, focusedIdx });
  useEffect(() => {
    latest.current = { sort, favOnly, sinceAV, activeGenres: [...activeGenres], search, searchVisible, focusedIdx };
  }, [sort, favOnly, sinceAV, activeGenres, search, searchVisible, focusedIdx]);
  useEffect(() => {
    const el = containerRef.current;
    return () => { savedView = { ...latest.current, scrollTop: el?.scrollTop ?? 0 }; };
  }, []);

  // ── fav toggle ────────────────────────────────────────────────────────────

  const toggleFav = useCallback((name: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const cur = favOverrides[name] !== undefined ? favOverrides[name] : (allArtists.find(a => a.name === name)?.is_favorited ?? false);
    const next = !cur;
    setFavOverrides(prev => ({ ...prev, [name]: next }));
    api.post(`/api/library/artist/${encodeURIComponent(name)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["artists"] }))
      .catch(() => setFavOverrides(prev => ({ ...prev, [name]: cur })));
  }, [favOverrides, allArtists, queryClient]);

  // ── search debounce ───────────────────────────────────────────────────────

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 120);
  };

  // ── sort click ────────────────────────────────────────────────────────────

  const handleSortClick = (id: "recent" | "alpha" | "plays") => {
    if (id === "alpha") setSort(prev => prev === "az" ? "za" : "az");
    else setSort(id);
  };

  const isAlpha = sort === "az" || sort === "za";

  // ── keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Palette handles its own keyboard while open
      if (paletteOpen) return;

      const inInput = (e.target as HTMLElement).tagName === "INPUT";

      // / = show search (not Ctrl+/)
      if (e.key === "/" && !inInput) {
        e.preventDefault();
        setSearchVisible(true);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      // g = toggle genre palette
      if (e.key === "g" && !inInput) {
        e.preventDefault();
        setPaletteOpen(v => !v);
        return;
      }

      if (inInput) return;

      const count = filtered.length;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx(i => i < 0 ? 0 : moveVertical(i, 1));
        return;
      }
      if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx(i => i < 0 ? 0 : moveVertical(i, -1));
        return;
      }
      if (e.key === "h" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedIdx(i => { if (i < 0) return 0; const p = i - 1; return p >= 0 && sameRow(p, i) ? p : i; });
        return;
      }
      if (e.key === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedIdx(i => { if (i < 0) return 0; const n = i + 1; return n < count && sameRow(n, i) ? n : i; });
        return;
      }
      if (e.ctrlKey && e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx(0); return; }
      if (e.ctrlKey && e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx(count - 1); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = focusedIdx >= 0 ? focusedIdx : 0;
        const a = filtered[idx];
        if (a) { setFocusedIdx(idx); navigate(`/artists/${encodeURIComponent(a.name)}`); }
        return;
      }
      if (e.key === "f" && !e.ctrlKey && !e.metaKey) { setFavOnly(v => !v); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && focusedIdx >= 0) {
        e.preventDefault();
        const a = filtered[focusedIdx];
        if (a) toggleFav(a.name);
        return;
      }
      if (e.key === "Escape") {
        if (searchVisible && searchInput) { handleSearchChange(""); return; }
        if (searchVisible) { setSearchVisible(false); return; }
        setFocusedIdx(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, focusedIdx, moveVertical, sameRow, searchVisible, searchInput, paletteOpen, toggleFav, navigate]);

  // ─────────────────────────────────────────────────────────────────────────

  const getIsFav = (a: Artist) => favOverrides[a.name] !== undefined ? favOverrides[a.name] : a.is_favorited;

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0a0a0a", padding: "20px 24px 16px 24px",
      boxSizing: "border-box", overflow: "hidden",
    }}>
      {/* Controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginBottom: 8 }}>
        <button
          onClick={() => setFavOnly(v => !v)}
          style={{
            height: 30, padding: "0 14px", borderRadius: 15, fontSize: 13,
            background: favOnly ? "#1a2a1a" : "#2a2a2a",
            color: favOnly ? "var(--green)" : "#b3b3b3",
            border: favOnly ? "1px solid var(--green)" : "none",
            transition: "all 0.15s",
          }}
        >
          {favOnly ? "♥ Favorites" : "♡ Favorites"}
        </button>

        <button
          onClick={() => setPaletteOpen(v => !v)}
          style={{
            height: 30, padding: "0 14px", borderRadius: 15, fontSize: 13,
            background: activeGenres.size > 0 ? "#1a2a1a" : "#2a2a2a",
            color: activeGenres.size > 0 ? "var(--green)" : "#b3b3b3",
            border: activeGenres.size > 0 ? "1px solid var(--green)" : "none",
            transition: "all 0.15s",
          }}
        >
          {activeGenres.size > 0 ? `Genre (${activeGenres.size}) ▾` : "Genre ▾"}
        </button>

        {avBeganMs !== null && (
          <button
            onClick={() => setSinceAV(v => !v)}
            title="Only artists played since AV's own log began"
            style={{
              height: 30, padding: "0 14px", borderRadius: 15, fontSize: 13,
              background: sinceAV ? "#1a2a1a" : "#2a2a2a",
              color: sinceAV ? "var(--green)" : "#b3b3b3",
              border: sinceAV ? "1px solid var(--green)" : "none",
              transition: "all 0.15s",
            }}
          >
            {sinceAV ? "Since AV" : "All time"}
          </button>
        )}

        <div style={{ flex: 1 }} />

        <SizeSwitch size={size} onChange={setSize} />
        {/* Sort: Recent | A→Z | Plays */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
          <span style={{ color: "#535353", fontSize: 12 }}>Sort:</span>
          {(["recent", "alpha", "plays"] as const).map(id => {
            const isActive = id === "recent" ? sort === "recent" : id === "alpha" ? isAlpha : sort === "plays";
            const label = id === "recent" ? "Recent" : id === "alpha" ? (sort === "za" ? "Z→A" : "A→Z") : "Plays";
            return (
              <button key={id} onClick={() => handleSortClick(id)} style={{
                height: 28, padding: "0 12px", borderRadius: 14, fontSize: 12,
                background: isActive ? "transparent" : "transparent",
                color: isActive ? "var(--green)" : "#535353",
                border: isActive ? "1px solid var(--green)" : "1px solid #3a3a3a",
                transition: "all 0.15s",
              }}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Full-width search bar */}
      {searchVisible && (
        <input
          ref={searchRef}
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="Filter artists…"
          autoFocus
          onKeyDown={e => {
            if (e.key === "Escape") {
              if (searchInput) handleSearchChange("");
              else setSearchVisible(false);
              e.stopPropagation();
            }
            if (e.key === "Enter") {
              e.stopPropagation();
              if (filtered.length > 0) { setFocusedIdx(0); searchRef.current?.blur(); }
            }
            if (e.key === "ArrowDown" && filtered.length > 0) {
              e.preventDefault(); e.stopPropagation();
              setFocusedIdx(0); searchRef.current?.blur();
            }
          }}
          style={{
            width: "100%", boxSizing: "border-box", flexShrink: 0,
            background: "transparent", border: "1px solid var(--green)", borderRadius: 6,
            padding: "8px 14px", color: "#fff", fontSize: 14, outline: "none",
            marginBottom: 8,
          }}
        />
      )}

      {/* Genre palette (inline, full-width) */}
      {paletteOpen && (
        <GenrePalette
          genres={allGenres}
          active={activeGenres}
          items={allArtists}
          onActiveChange={setActiveGenres}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* Grid + scrubber */}
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>
        {grid.current >= 0 && sections[grid.current]?.header && grid.scrollTop > grid.secTop[grid.current] && (
          <div style={{ position: "sticky", top: 0, height: 0, zIndex: 3 }}>
            <SectionHeader label={sections[grid.current].label} count={sections[grid.current].count} noun="artist" solid />
          </div>
        )}
        <div style={{ position: "relative", height: grid.total }}>
          {grid.visible.map(b => b.kind === "header" ? (
            <div key={`h${b.si}`} style={{ position: "absolute", top: b.top, left: 0, right: 0, height: HEADER_H }}>
              <SectionHeader label={sections[b.si].label} count={sections[b.si].count} noun="artist" />
            </div>
          ) : (
            <div key={`r${b.start}`} style={{ position: "absolute", top: b.top, left: 0, display: "flex", gap: GAP }}>
              {filtered.slice(b.start, b.end).map((artist, i) => {
                const idx = b.start + i;
                return (
                  <ArtistCard
                    key={artist.name}
                    artist={artist}
                    isFocused={focusedIdx === idx}
                    isFavorited={getIsFav(artist)}
                    tileWidth={tileWidth}
                    size={size}
                    onClick={() => { setFocusedIdx(idx); navigate(`/artists/${encodeURIComponent(artist.name)}`); }}
                    onFav={e => toggleFav(artist.name, e)}
                  />
                );
              })}
            </div>
          ))}
        </div>
        {filtered.length === 0 && data && (
          <div style={{ color: "#535353", padding: 24, width: "100%", textAlign: "center" }}>
            No artists found.
          </div>
        )}
      </div>
      <GridScrubber sections={sections} secTop={grid.secTop} total={grid.total} scrollTop={grid.scrollTop} viewHeight={grid.viewHeight}
        onScrollTo={t => containerRef.current?.scrollTo({ top: t })} noun="artist" />
      </div>
    </div>
  );
}
