import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AlbumSummary, AlbumsResponse, TrackPlay } from "../api/types";
import { GenrePalette } from "../components/GenrePalette";

import { API_BASE } from "../api/config";
const CARD_MIN_W = 160;
const GAP = 12;

// inject gold pulse animation once
if (typeof document !== "undefined" && !document.getElementById("album-card-keyframes")) {
  const s = document.createElement("style");
  s.id = "album-card-keyframes";
  s.textContent = `@keyframes goldPulse{0%,100%{box-shadow:0 0 0 2px rgba(255,215,0,0.65),0 0 10px 2px rgba(255,215,0,0.22)}50%{box-shadow:0 0 0 2px rgba(255,215,0,1),0 0 18px 5px rgba(255,215,0,0.45)}}`;
  document.head.appendChild(s);
}

function artUrl(filename: string | null | undefined): string | null {
  return filename ? `${API_BASE}/artwork/${filename}` : null;
}

type SortKey = "recent" | "az" | "za" | "newest" | "oldest" | "rating";
type TypeFilter = null | "Album" | "EP" | "Single" | "Compilation";
const TYPE_CYCLE: TypeFilter[] = [null, "Album", "EP", "Single", "Compilation"];
const TYPE_LABELS: Record<string, string> = { Album: "Albums", EP: "EPs", Single: "Singles", Compilation: "Compilations" };

// ─── year range slider ────────────────────────────────────────────────────────

function YearRangeSlider({
  min, max, lo, hi, onChange, onReset,
}: {
  min: number; max: number; lo: number; hi: number;
  onChange: (lo: number, hi: number) => void;
  onReset: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<"lo" | "hi" | null>(null);
  const loRef = useRef(lo); const hiRef = useRef(hi);
  const minRef = useRef(min); const maxRef = useRef(max);
  const onChangeRef = useRef(onChange);
  useEffect(() => { loRef.current = lo; }, [lo]);
  useEffect(() => { hiRef.current = hi; }, [hi]);
  useEffect(() => { minRef.current = min; }, [min]);
  useEffect(() => { maxRef.current = max; }, [max]);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const fraction = (year: number) => (year - min) / Math.max(1, max - min);

  const yearFromClientX = useCallback((clientX: number) => {
    if (!trackRef.current) return minRef.current;
    const rect = trackRef.current.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return Math.round(minRef.current + frac * (maxRef.current - minRef.current));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current) return;
      const year = yearFromClientX(e.clientX);
      if (drag.current === "lo") onChangeRef.current(Math.min(year, hiRef.current), hiRef.current);
      else onChangeRef.current(loRef.current, Math.max(year, loRef.current));
    };
    const onUp = () => { drag.current = null; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [yearFromClientX]);

  const loFrac = fraction(lo);
  const hiFrac = fraction(hi);
  const firstDecade = Math.ceil(min / 10) * 10;
  const decades: number[] = [];
  for (let d = firstDecade; d <= max; d += 10) decades.push(d);

  const handleStyle = (frac: number, which: "lo" | "hi"): React.CSSProperties => ({
    position: "absolute", top: 2, width: 20, height: 20, borderRadius: 10,
    background: "#101010", border: `2px solid ${drag.current === which ? "var(--green)" : "#fff"}`,
    left: `calc(${frac * 100}% - 10px)`, cursor: "ew-resize", zIndex: 2, boxSizing: "border-box",
  });

  return (
    <div style={{ background: "#151515", borderRadius: 8, padding: "10px 20px 20px", marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#b3b3b3" }}>
          {lo} — {hi === max ? "present" : hi}
        </span>
        <button onClick={onReset} style={{
          background: "transparent", border: "none", color: "#535353",
          fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1,
        }} title="Reset">↺</button>
      </div>

      {/* Track */}
      <div ref={trackRef} style={{ position: "relative", height: 24, marginBottom: 12 }}>
        <div style={{ position: "absolute", top: 10, left: 0, right: 0, height: 4, background: "#2a2a2a", borderRadius: 2 }} />
        <div style={{
          position: "absolute", top: 10, height: 4, background: "var(--green)", borderRadius: 2,
          left: `${loFrac * 100}%`, width: `${(hiFrac - loFrac) * 100}%`,
        }} />
        <div
          style={handleStyle(loFrac, "lo")}
          onMouseDown={e => { e.preventDefault(); drag.current = "lo"; }}
        />
        <div
          style={handleStyle(hiFrac, "hi")}
          onMouseDown={e => { e.preventDefault(); drag.current = "hi"; }}
        />
      </div>

      {/* Decade labels */}
      <div style={{ position: "relative", height: 28 }}>
        {decades.map(decade => {
          const frac = fraction(decade);
          const inRange = lo <= decade && decade <= hi;
          return (
            <div
              key={decade}
              onClick={() => onChange(decade, Math.min(decade + 9, max))}
              style={{
                position: "absolute", left: `${frac * 100}%`, transform: "translateX(-50%)",
                cursor: "pointer", textAlign: "center",
              }}
            >
              <div style={{ width: 1, height: 6, background: inRange ? "#535353" : "#2a2a2a", margin: "0 auto 3px" }} />
              <span style={{ fontSize: 10, color: inRange ? "#b3b3b3" : "#535353", whiteSpace: "nowrap" }}>
                {decade}s
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── star rating ──────────────────────────────────────────────────────────────

function StarRating({ rating, onChange }: { rating: number; onChange: (r: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover !== null ? hover : rating;
  return (
    <div style={{ display: "flex", gap: 1 }} onMouseLeave={() => setHover(null)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(star => {
        const half = star * 2 - 1;
        const full = star * 2;
        const leftFilled = display >= half;
        const rightFilled = display >= full;
        return (
          <div key={star} style={{ position: "relative", width: 16, height: 18, cursor: "pointer", flexShrink: 0 }}>
            <span style={{ position: "absolute", fontSize: 14, color: "#3a3a3a", userSelect: "none", lineHeight: "18px" }}>★</span>
            {leftFilled && (
              <span style={{
                position: "absolute", fontSize: 14, color: "#FFD700", userSelect: "none",
                lineHeight: "18px", clipPath: rightFilled ? "none" : "inset(0 50% 0 0)",
              }}>★</span>
            )}
            <div style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%" }}
              onMouseEnter={() => setHover(half)} onClick={() => onChange(rating === half ? 0 : half)} />
            <div style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%" }}
              onMouseEnter={() => setHover(full)} onClick={() => onChange(rating === full ? 0 : full)} />
          </div>
        );
      })}
    </div>
  );
}

// ─── album card ───────────────────────────────────────────────────────────────

function AlbumCard({
  album, tileWidth, focused, selected, onClick, cardRef,
  favOverride, ratingOverride,
}: {
  album: AlbumSummary; tileWidth: number; focused: boolean; selected: boolean;
  onClick: () => void; cardRef: (el: HTMLDivElement | null) => void;
  favOverride: boolean | undefined; ratingOverride: number | undefined;
}) {
  const artSize = tileWidth - 16;
  const cardHeight = artSize + 95;
  const url = artUrl(album.art_filename);

  const isFav = favOverride !== undefined ? favOverride : album.is_favorited;
  const rating = ratingOverride !== undefined ? ratingOverride : album.rating;
  const isGold = rating === 20;
  const isSilver = rating === 18 || rating === 19;
  const isPoor = rating > 0 && rating <= 10;

  const ratingText = rating > 0
    ? `★ ${(rating / 2).toFixed(1).replace(/\.0$/, "")}`
    : "unrated";

  let borderStyle: React.CSSProperties = {};
  if (focused || selected) {
    borderStyle = { border: "2px solid var(--green)" };
  } else if (isGold) {
    borderStyle = { border: "2px solid rgba(255,215,0,0.8)", animation: "goldPulse 2s ease-in-out infinite" };
  } else if (isSilver) {
    borderStyle = { border: "2px solid rgba(192,200,216,0.85)", boxShadow: "0 0 6px rgba(192,200,216,0.25)" };
  } else {
    borderStyle = { border: "2px solid transparent" };
  }

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        width: tileWidth, height: cardHeight, background: "#1a1a1a", borderRadius: 8,
        padding: "8px 8px 10px", boxSizing: "border-box", cursor: "pointer",
        display: "flex", flexDirection: "column", flexShrink: 0,
        ...borderStyle,
      }}
    >
      {/* Art */}
      <div style={{
        width: artSize, height: artSize, borderRadius: 6, overflow: "hidden",
        background: "#2a2a2a", flexShrink: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {url
          ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ color: "#535353", fontSize: 28 }}>♪</span>
        }
      </div>

      {/* Name */}
      <div style={{
        fontSize: 12, fontWeight: 700, color: "#fff", marginTop: 6,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{album.album_name}</div>

      {/* Artist */}
      <div style={{
        fontSize: 11, color: "#b3b3b3", marginTop: 2,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{album.artist}</div>

      {/* Year */}
      {album.release_year && (
        <div style={{ fontSize: 11, color: "#535353", marginTop: 1 }}>{album.release_year}</div>
      )}

      <div style={{ flex: 1 }} />

      {/* Bottom row */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
        <span style={{ fontSize: 12, color: rating > 0 ? "#FFD700" : "#535353" }}>{ratingText}</span>
        {isFav && <span style={{ fontSize: 13, color: "#e8175d" }}>♥</span>}
        {isPoor && !isGold && !isSilver && <span style={{ fontSize: 11, color: "#c0392b" }}>▼</span>}
        {album.has_vinyl && <span style={{ fontSize: 13, color: "#7db4cc" }}>◎</span>}
        <div style={{ flex: 1 }} />
        {album.album_total_tracks != null && (
          <span style={{
            fontSize: 10, color: album.heard_tracks >= album.album_total_tracks ? "var(--green)" : "#535353",
            fontWeight: 600,
          }}>{album.heard_tracks}/{album.album_total_tracks}</span>
        )}
        <button
          onClick={e => { e.stopPropagation(); window.open(`spotify:album:${album.album_id}`, "_blank"); }}
          style={{
            background: "transparent", border: "none", color: "var(--green)",
            fontSize: 13, fontWeight: 700, cursor: "pointer", padding: 0, lineHeight: 1,
          }}
          title="Open in Spotify"
        >↗</button>
      </div>
    </div>
  );
}

// ─── album detail side panel ──────────────────────────────────────────────────

function AlbumDetailPanel({
  album, favOverride, ratingOverride, trackFavOverrides, notesText,
  onClose, onFav, onRating, onTrackFav, onNotesChange, navigate,
}: {
  album: AlbumSummary;
  favOverride: boolean | undefined;
  ratingOverride: number | undefined;
  trackFavOverrides: Record<string, boolean>;
  notesText: string;
  onClose: () => void;
  onFav: () => void;
  onRating: (r: number) => void;
  onTrackFav: (id: string) => void;
  onNotesChange: (notes: string) => void;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const url = artUrl(album.art_filename);
  const isFav = favOverride !== undefined ? favOverride : album.is_favorited;
  const rating = ratingOverride !== undefined ? ratingOverride : album.rating;
  const maxPlays = Math.max(1, ...album.track_plays.map(t => t.play_count));

  return (
    <div style={{
      width: 340, flexShrink: 0, borderLeft: "1px solid #1a1a1a",
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden",
      background: "#0d0d0d",
    }}>
      {/* Close */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px 4px", flexShrink: 0 }}>
        <button onClick={onClose} style={{
          background: "transparent", border: "none", color: "#535353",
          fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1,
        }}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "0 16px 16px" }}>
        {/* Art + meta */}
        <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
          <div style={{
            width: 120, height: 120, borderRadius: 6, overflow: "hidden",
            background: "#2a2a2a", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {url
              ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ color: "#535353", fontSize: 32 }}>♪</span>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            <div style={{
              fontSize: 15, fontWeight: 700, color: "#fff",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{album.album_name}</div>
            <button
              onClick={() => navigate(`/artists/${encodeURIComponent(album.artist)}`)}
              style={{
                background: "transparent", border: "none", color: "#b3b3b3",
                fontSize: 12, cursor: "pointer", padding: 0, marginTop: 3,
                textAlign: "left", display: "block",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                maxWidth: "100%",
              }}
            >{album.artist}</button>
            <div style={{ fontSize: 11, color: "#535353", marginTop: 2 }}>
              {[album.release_year, album.classified_type].filter(Boolean).join(" · ")}
            </div>
            <div style={{ fontSize: 11, color: "#535353", marginTop: 1 }}>
              {album.count} {album.count === 1 ? "play" : "plays"}
            </div>
            <button
              onClick={() => window.open(`spotify:album:${album.album_id}`, "_blank")}
              style={{
                background: "transparent", border: "none", color: "#7db4cc",
                fontSize: 11, cursor: "pointer", padding: 0, marginTop: 5,
              }}
            >↗ Open in Spotify</button>
          </div>
        </div>

        {/* Rating */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#535353", width: 52, flexShrink: 0 }}>Rating</span>
          <StarRating rating={rating} onChange={onRating} />
        </div>

        {/* Favorite */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 11, color: "#535353", width: 52, flexShrink: 0 }}>Favorite</span>
          <button onClick={onFav} style={{
            background: "transparent", border: "none", cursor: "pointer",
            fontSize: 18, color: isFav ? "#e8175d" : "#535353", padding: 0, lineHeight: 1,
          }}>♥</button>
        </div>

        {/* Notes */}
        <div style={{ marginBottom: 14 }}>
          <span style={{ fontSize: 11, color: "#535353", display: "block", marginBottom: 4 }}>Notes</span>
          <textarea
            value={notesText}
            onChange={e => onNotesChange(e.target.value)}
            placeholder="Your thoughts…"
            rows={3}
            style={{
              width: "100%", boxSizing: "border-box",
              background: "#1a1a1a", border: "1px solid #2a2a2a", borderRadius: 4,
              color: "#b3b3b3", fontSize: 12, padding: "6px 8px", outline: "none",
              resize: "none", fontFamily: "inherit",
            }}
            onFocus={e => { (e.target as HTMLTextAreaElement).style.borderColor = "#535353"; }}
            onBlur={e => { (e.target as HTMLTextAreaElement).style.borderColor = "#2a2a2a"; }}
          />
        </div>

        {/* Track list */}
        {album.track_plays.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#535353", letterSpacing: "1.5px", marginBottom: 6 }}>
              TRACKS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {album.track_plays.map((t: TrackPlay) => {
                const isTFav = trackFavOverrides[t.track_id] !== undefined
                  ? trackFavOverrides[t.track_id] : t.is_favorited;
                const barPct = (t.play_count / maxPlays) * 100;
                return (
                  <div key={t.track_id} style={{
                    display: "flex", alignItems: "center", gap: 6,
                    padding: "3px 4px", borderRadius: 3,
                  }}>
                    <button onClick={() => onTrackFav(t.track_id)} style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      fontSize: 12, color: isTFav ? "#e8175d" : "#535353",
                      padding: 0, flexShrink: 0, lineHeight: 1,
                    }}>♥</button>
                    <span style={{
                      flex: 1, fontSize: 12, color: "#fff",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{t.track_name}</span>
                    <div style={{ width: 60, height: 3, background: "#2a2a2a", borderRadius: 2, flexShrink: 0, overflow: "hidden" }}>
                      <div style={{ width: `${barPct}%`, height: "100%", background: "var(--green)", borderRadius: 2 }} />
                    </div>
                    <span style={{ fontSize: 11, color: "#535353", width: 18, textAlign: "right", flexShrink: 0 }}>{t.play_count}</span>
                    <button
                      onClick={() => window.open(`spotify:track:${t.track_id}`, "_blank")}
                      style={{
                        width: 20, height: 20, borderRadius: 10, background: "var(--green)",
                        border: "none", color: "#000", fontSize: 8, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, fontWeight: 900,
                      }}
                    >▶</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────

export function AlbumsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [sort, setSort] = useState<SortKey>("recent");
  const [favOnly, setFavOnly] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(null);
  const [activeGenres, setActiveGenres] = useState<Set<string>>(new Set());
  const [yearOpen, setYearOpen] = useState(false);
  const [yearLo, setYearLo] = useState<number | null>(null);
  const [yearHi, setYearHi] = useState<number | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumSummary | null>(null);

  const [favOverrides, setFavOverrides] = useState<Record<string, boolean>>({});
  const [ratingOverrides, setRatingOverrides] = useState<Record<string, number>>({});
  const [trackFavOverrides, setTrackFavOverrides] = useState<Record<string, boolean>>({});
  const [notesOverrides, setNotesOverrides] = useState<Record<string, string>>({});
  const notesTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cols, setCols] = useState(4);
  const [tileWidth, setTileWidth] = useState(CARD_MIN_W);

  const { data } = useQuery<AlbumsResponse>({
    queryKey: ["albums"],
    queryFn: () => api.get("/api/albums"),
    staleTime: 60_000,
  });

  const allAlbums = data?.albums ?? [];
  const allGenres = data?.all_genres ?? [];

  // init year range when data loads
  useEffect(() => {
    if (!data?.year_bounds) return;
    if (yearLo === null) { setYearLo(data.year_bounds.min); setYearHi(data.year_bounds.max); }
  }, [data?.year_bounds]);

  // ── responsive grid ───────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const style = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      if (w === 0) return;
      const c = Math.max(1, Math.floor((w + GAP) / (CARD_MIN_W + GAP)));
      const tw = Math.max(CARD_MIN_W, Math.floor((w - (c - 1) * GAP) / c));
      setCols(c);
      setTileWidth(tw);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── filtering + sorting ───────────────────────────────────────────────────

  const filtered = useMemo(() => {
    let items = allAlbums;
    if (search) {
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const q = norm(search);
      items = items.filter(a => norm(a.album_name).includes(q) || norm(a.artist).includes(q));
    }
    if (favOnly) items = items.filter(a => favOverrides[a.album_id] !== undefined ? favOverrides[a.album_id] : a.is_favorited);
    if (typeFilter) items = items.filter(a => a.classified_type === typeFilter);
    if (activeGenres.size > 0) items = items.filter(a => a.genres.some(g => activeGenres.has(g)));
    if (yearLo !== null && yearHi !== null && data?.year_bounds &&
        (yearLo !== data.year_bounds.min || yearHi !== data.year_bounds.max)) {
      items = items.filter(a => a.release_year !== null && a.release_year >= yearLo! && a.release_year <= yearHi!);
    }

    const sorted = [...items];
    if (sort === "rating") {
      sorted.sort((a, b) => {
        const ra = ratingOverrides[a.album_id] ?? a.rating;
        const rb = ratingOverrides[b.album_id] ?? b.rating;
        return rb !== ra ? rb - ra : a.album_name.localeCompare(b.album_name);
      });
    } else if (sort === "az") sorted.sort((a, b) => a.album_name.localeCompare(b.album_name));
    else if (sort === "za") sorted.sort((a, b) => b.album_name.localeCompare(a.album_name));
    else if (sort === "newest") sorted.sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0) || a.album_name.localeCompare(b.album_name));
    else if (sort === "oldest") sorted.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999) || a.album_name.localeCompare(b.album_name));
    else sorted.sort((a, b) => b.latest_played.localeCompare(a.latest_played));
    return sorted;
  }, [allAlbums, search, favOnly, typeFilter, activeGenres, yearLo, yearHi, sort, favOverrides, ratingOverrides, data?.year_bounds]);

  useEffect(() => {
    setFocusedIdx(-1);
    cardRefs.current = [];
  }, [filtered.length, sort, search, favOnly, typeFilter, activeGenres.size, yearLo, yearHi]);

  useEffect(() => {
    if (focusedIdx >= 0) cardRefs.current[focusedIdx]?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  // ── optimistic updates ────────────────────────────────────────────────────

  const toggleFav = useCallback((albumId: string) => {
    const cur = favOverrides[albumId] !== undefined ? favOverrides[albumId] : (allAlbums.find(a => a.album_id === albumId)?.is_favorited ?? false);
    const next = !cur;
    setFavOverrides(p => ({ ...p, [albumId]: next }));
    api.post(`/api/library/album/${encodeURIComponent(albumId)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["albums"] }))
      .catch(() => setFavOverrides(p => ({ ...p, [albumId]: cur })));
  }, [favOverrides, allAlbums, queryClient]);

  const setRating = useCallback((albumId: string, rating: number) => {
    setRatingOverrides(p => ({ ...p, [albumId]: rating }));
    api.post(`/api/library/album/${encodeURIComponent(albumId)}/rating`, { rating })
      .then(() => queryClient.invalidateQueries({ queryKey: ["albums"] }))
      .catch(() => setRatingOverrides(p => { const n = { ...p }; delete n[albumId]; return n; }));
  }, [queryClient]);

  const toggleTrackFav = useCallback((albumId: string, trackId: string) => {
    const album = allAlbums.find(a => a.album_id === albumId);
    const cur = trackFavOverrides[trackId] !== undefined ? trackFavOverrides[trackId]
      : (album?.track_plays.find(t => t.track_id === trackId)?.is_favorited ?? false);
    const next = !cur;
    setTrackFavOverrides(p => ({ ...p, [trackId]: next }));
    api.post(`/api/library/track/${encodeURIComponent(trackId)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["albums"] }))
      .catch(() => setTrackFavOverrides(p => ({ ...p, [trackId]: cur })));
  }, [allAlbums, trackFavOverrides, queryClient]);

  const handleNotesChange = useCallback((albumId: string, notes: string) => {
    setNotesOverrides(p => ({ ...p, [albumId]: notes }));
    clearTimeout(notesTimer.current);
    notesTimer.current = setTimeout(() => {
      api.post(`/api/library/album/${encodeURIComponent(albumId)}/notes`, { notes })
        .then(() => queryClient.invalidateQueries({ queryKey: ["albums"] }))
        .catch(() => {});
    }, 600);
  }, [queryClient]);

  // ── keyboard ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (paletteOpen) return;
      const inInput = ["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName);

      if (e.key === "/" && !inInput) { e.preventDefault(); setSearchVisible(true); setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (e.key === "g" && !inInput) { e.preventDefault(); setPaletteOpen(v => !v); return; }
      if (e.key === "y" && !inInput) { e.preventDefault(); setYearOpen(v => !v); return; }

      if (inInput) return;

      const count = filtered.length;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx(i => i < 0 ? 0 : Math.min(i + cols, count - 1)); return; }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx(i => i < 0 ? 0 : Math.max(i - cols, 0)); return; }
      if (e.key === "h" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedIdx(i => { if (i < 0) return 0; const p = i - 1; return p >= 0 && Math.floor(p / cols) === Math.floor(i / cols) ? p : i; });
        return;
      }
      if (e.key === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedIdx(i => { if (i < 0) return 0; const n = i + 1; return n < count && Math.floor(n / cols) === Math.floor(i / cols) ? n : i; });
        return;
      }
      if (e.ctrlKey && e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx(0); return; }
      if (e.ctrlKey && e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx(count - 1); return; }
      if (e.key === "Enter") {
        e.preventDefault();
        const idx = focusedIdx >= 0 ? focusedIdx : 0;
        const a = filtered[idx];
        if (a) { setFocusedIdx(idx); setSelectedAlbum(prev => prev?.album_id === a.album_id ? null : a); }
        return;
      }
      if (e.key === "f" && !e.ctrlKey) { setFavOnly(v => !v); return; }
      if (e.key === "t" && !e.ctrlKey) {
        setTypeFilter(cur => {
          const idx = TYPE_CYCLE.indexOf(cur);
          return TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length];
        });
        return;
      }
      if (e.ctrlKey && e.key === "o" && focusedIdx >= 0) {
        e.preventDefault();
        const a = filtered[focusedIdx];
        if (a) window.open(`spotify:album:${a.album_id}`, "_blank");
        return;
      }
      if (e.ctrlKey && e.key === "f" && focusedIdx >= 0) {
        e.preventDefault();
        const a = filtered[focusedIdx];
        if (a) toggleFav(a.album_id);
        return;
      }
      if (e.key === "Escape") {
        if (selectedAlbum) { setSelectedAlbum(null); return; }
        if (searchVisible && searchInput) { setSearch(""); setSearchInput(""); return; }
        if (searchVisible) { setSearchVisible(false); return; }
        if (yearOpen) { setYearOpen(false); return; }
        setFocusedIdx(-1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [filtered, focusedIdx, cols, searchVisible, searchInput, paletteOpen, yearOpen, selectedAlbum, toggleFav]);

  // ─────────────────────────────────────────────────────────────────────────

  const handleSearchChange = (val: string) => {
    setSearchInput(val);
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setSearch(val), 120);
  };

  const cycleSort = (group: "recent" | "alpha" | "year" | "rating") => {
    if (group === "recent") setSort("recent");
    else if (group === "alpha") setSort(s => s === "az" ? "za" : "az");
    else if (group === "year") setSort(s => s === "newest" ? "oldest" : "newest");
    else setSort("rating");
  };

  const isActiveYear = yearLo !== null && yearHi !== null && data?.year_bounds &&
    (yearLo !== data.year_bounds.min || yearHi !== data.year_bounds.max);

  const pillBtn = (active: boolean): React.CSSProperties => ({
    height: 30, padding: "0 14px", borderRadius: 15, fontSize: 13, cursor: "pointer",
    background: active ? "#1a2a1a" : "#2a2a2a",
    color: active ? "var(--green)" : "#b3b3b3",
    border: active ? "1px solid var(--green)" : "none",
  });

  const sortBtn = (active: boolean): React.CSSProperties => ({
    height: 28, padding: "0 12px", borderRadius: 14, fontSize: 12, cursor: "pointer",
    background: "transparent", color: active ? "var(--green)" : "#535353",
    border: active ? "1px solid var(--green)" : "1px solid #3a3a3a",
  });

  const yearLabel = isActiveYear && yearLo !== null && yearHi !== null && data?.year_bounds
    ? `Years: ${yearLo}–${yearHi === data.year_bounds.max ? "now" : yearHi}`
    : "Years";

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0a0a0a", padding: "20px 24px 16px 24px",
      boxSizing: "border-box", overflow: "hidden",
    }}>
      {/* Controls row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, marginBottom: 8 }}>
        <button style={pillBtn(favOnly)} onClick={() => setFavOnly(v => !v)}>
          {favOnly ? "♥ Favorites" : "♡ Favorites"}
        </button>
        <button style={pillBtn(paletteOpen || activeGenres.size > 0)} onClick={() => setPaletteOpen(v => !v)}>
          {activeGenres.size > 0 ? `Genre (${activeGenres.size}) ▾` : "Genre ▾"}
        </button>
        <button style={pillBtn(typeFilter !== null)} onClick={() => setTypeFilter(cur => { const i = TYPE_CYCLE.indexOf(cur); return TYPE_CYCLE[(i + 1) % TYPE_CYCLE.length]; })}>
          {typeFilter ? TYPE_LABELS[typeFilter] : "Type"}
        </button>
        <button style={pillBtn(isActiveYear ?? false)} onClick={() => setYearOpen(v => !v)}>
          {yearLabel}
        </button>

        <div style={{ flex: 1 }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#535353", fontSize: 12 }}>Sort:</span>
          <button style={sortBtn(sort === "recent")} onClick={() => cycleSort("recent")}>Recent</button>
          <button style={sortBtn(sort === "az" || sort === "za")} onClick={() => cycleSort("alpha")}>
            {sort === "za" ? "Z→A" : "A→Z"}
          </button>
          <button style={sortBtn(sort === "newest" || sort === "oldest")} onClick={() => cycleSort("year")}>
            {sort === "oldest" ? "Year ↑" : "Year ↓"}
          </button>
          <button style={sortBtn(sort === "rating")} onClick={() => cycleSort("rating")}>Rating</button>
        </div>
      </div>

      {/* Search bar */}
      {searchVisible && (
        <input
          ref={searchRef}
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          placeholder="Filter albums…"
          autoFocus
          onKeyDown={e => {
            if (e.key === "Escape") { if (searchInput) handleSearchChange(""); else setSearchVisible(false); e.stopPropagation(); }
            if (e.key === "Enter") { e.stopPropagation(); if (filtered.length > 0) { setFocusedIdx(0); searchRef.current?.blur(); } }
            if (e.key === "ArrowDown" && filtered.length > 0) { e.preventDefault(); e.stopPropagation(); setFocusedIdx(0); searchRef.current?.blur(); }
          }}
          style={{
            width: "100%", boxSizing: "border-box", flexShrink: 0,
            background: "transparent", border: "1px solid var(--green)", borderRadius: 6,
            padding: "8px 14px", color: "#fff", fontSize: 14, outline: "none", marginBottom: 8,
          }}
        />
      )}

      {/* Genre palette */}
      {paletteOpen && (
        <GenrePalette
          genres={allGenres}
          active={activeGenres}
          items={allAlbums}
          onActiveChange={setActiveGenres}
          onClose={() => setPaletteOpen(false)}
        />
      )}

      {/* Year range slider */}
      {yearOpen && yearLo !== null && yearHi !== null && data?.year_bounds && (
        <YearRangeSlider
          min={data.year_bounds.min} max={data.year_bounds.max}
          lo={yearLo} hi={yearHi}
          onChange={(lo, hi) => { setYearLo(lo); setYearHi(hi); }}
          onReset={() => { if (data.year_bounds) { setYearLo(data.year_bounds.min); setYearHi(data.year_bounds.max); } }}
        />
      )}

      {/* Main: grid + side panel */}
      <div style={{ flex: 1, display: "flex", flexDirection: "row", overflow: "hidden", gap: 0 }}>
        {/* Grid */}
        <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", paddingRight: 2 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: GAP, alignContent: "flex-start" }}>
            {filtered.map((album, idx) => (
              <AlbumCard
                key={album.album_id}
                album={album}
                tileWidth={tileWidth}
                focused={focusedIdx === idx}
                selected={selectedAlbum?.album_id === album.album_id}
                onClick={() => { setFocusedIdx(idx); setSelectedAlbum(prev => prev?.album_id === album.album_id ? null : album); }}
                cardRef={el => { cardRefs.current[idx] = el; }}
                favOverride={favOverrides[album.album_id]}
                ratingOverride={ratingOverrides[album.album_id]}
              />
            ))}
            {filtered.length === 0 && data && (
              <div style={{ color: "#535353", padding: 24, width: "100%", textAlign: "center" }}>No albums found.</div>
            )}
          </div>
        </div>

        {/* Side panel */}
        {selectedAlbum && (() => {
          const album = allAlbums.find(a => a.album_id === selectedAlbum.album_id) ?? selectedAlbum;
          return (
            <AlbumDetailPanel
              album={album}
              favOverride={favOverrides[album.album_id]}
              ratingOverride={ratingOverrides[album.album_id]}
              trackFavOverrides={trackFavOverrides}
              notesText={notesOverrides[album.album_id] ?? album.notes}
              onClose={() => setSelectedAlbum(null)}
              onFav={() => toggleFav(album.album_id)}
              onRating={r => setRating(album.album_id, r)}
              onTrackFav={trackId => toggleTrackFav(album.album_id, trackId)}
              onNotesChange={notes => handleNotesChange(album.album_id, notes)}
              navigate={navigate}
            />
          );
        })()}
      </div>
    </div>
  );
}
