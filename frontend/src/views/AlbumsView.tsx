import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AlbumDetail, AlbumSummary, AlbumsResponse, TrackPlay } from "../api/types";
import { GenrePalette } from "../components/GenrePalette";
import { OpenInDiscogs } from "../components/OpenInDiscogs";
import { useHistoryInfo } from "../api/useHistoryInfo";
import { GridScrubber, SectionHeader, SizeSwitch } from "../lib/sectionedGrid";
import {
  buildSections, compareFolded, HEADER_H, letterOf, monthKey, monthLabel, useSectionedGrid, useTileSize, type TileSize,
} from "../lib/sectionedGridLayout";
import type { RingPayload } from "./stats/GenresRing";

import { API_BASE } from "../api/config";
const CARD_MIN_W: Record<TileSize, number> = { S: 112, M: 160, L: 220 };
const GAP = 12;
// AlbumCard: art is tileWidth - 16 square, plus 95px of text and padding below it; the compact
// card (size S) keeps only the title under the cover.
const cardHeightFor = (tileWidth: number, compact = false) => tileWidth - 16 + (compact ? 44 : 95);

function sinceLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

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
  album, tileWidth, compact, focused, selected, onClick,
  favOverride, ratingOverride,
}: {
  album: AlbumSummary; tileWidth: number; compact: boolean; focused: boolean; selected: boolean;
  onClick: () => void;
  favOverride: boolean | undefined; ratingOverride: number | undefined;
}) {
  const artSize = tileWidth - 16;
  const cardHeight = cardHeightFor(tileWidth, compact);
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

      {!compact && <>
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
      </>}
    </div>
  );
}

// ─── crates strip ─────────────────────────────────────────────────────────────
// The Genres Ring's families as record-shop crates, plus the vinyl shelf: a filter above the
// grid, not a page of its own. Counts follow the other filters; the covers are each crate's
// most played.

function CratesStrip({ albums, ring, albumFam, crate, onPick }: {
  albums: AlbumSummary[]; ring: RingPayload; albumFam: Map<string, number>; crate: Crate; onPick: (c: Crate) => void;
}) {
  const crates = useMemo(() => {
    const by = new Map<Crate, AlbumSummary[]>();
    for (const a of albums) {
      const f = albumFam.get(a.album_id);
      if (f !== undefined) { if (!by.has(f)) by.set(f, []); by.get(f)!.push(a); }
      if (a.has_vinyl) { if (!by.has("vinyl")) by.set("vinyl", []); by.get("vinyl")!.push(a); }
    }
    const top = (list: AlbumSummary[]) => [...list].sort((x, y) => y.count - x.count).slice(0, 3);
    const fams = ring.families.map((f, i) => ({ key: i as Crate, name: f.name, hue: f.hue as number | null, list: by.get(i) ?? [] }))
      .filter(c => c.list.length).sort((x, y) => y.list.length - x.list.length);
    const vinyl = { key: "vinyl" as Crate, name: "on vinyl", hue: null, list: by.get("vinyl") ?? [] };
    return [...fams, vinyl].map(c => ({ ...c, top: top(c.list) }));
  }, [albums, ring, albumFam]);

  const chip = (key: Crate, name: string, n: number, accent: string, top: AlbumSummary[]) => {
    const on = crate === key;
    return (
      <button key={String(key)} onClick={() => onPick(on && key !== null ? null : key)}
        style={{
          display: "flex", alignItems: "center", gap: 8, padding: top.length ? "5px 12px 5px 8px" : "5px 12px", borderRadius: 10, flexShrink: 0,
          background: on ? "#1e1e1e" : "transparent", border: `1px solid ${on ? accent : "#222"}`, cursor: "pointer", fontFamily: "inherit",
        }}>
        {top.length > 0 && (
          <span style={{ display: "flex" }}>
            {top.map((a, i) => (
              <span key={a.album_id} style={{ width: 24, height: 24, borderRadius: 3, overflow: "hidden", background: "#2a2a2a", marginLeft: i ? -12 : 0, transform: `rotate(${[-6, 0, 6][i]}deg)`, boxShadow: "0 2px 6px rgba(0,0,0,.6)" }}>
                {artUrl(a.art_filename) && <img src={artUrl(a.art_filename)!} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              </span>
            ))}
          </span>
        )}
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.2 }}>
          <span style={{ fontSize: 11.5, fontWeight: 800, color: on ? accent : "#b3b3b3", whiteSpace: "nowrap" }}>{name}</span>
          <span style={{ fontSize: 10, color: "#8a8a8a" }}>{n.toLocaleString("en-US")}</span>
        </span>
      </button>
    );
  };
  return (
    <div style={{ display: "flex", gap: 8, overflowX: "auto", flexShrink: 0, marginBottom: 10, scrollbarWidth: "none" }}>
      {chip(null, "All albums", albums.length, "var(--green)", [])}
      {crates.map(c => chip(c.key, c.name, c.list.length, c.hue === null ? "#7db4cc" : `hsl(${c.hue} 70% 66%)`, c.top))}
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
  // Per-track plays are not in the list payload (8k albums); fetch them for the open album.
  const { data: detail } = useQuery<AlbumDetail>({
    queryKey: ["album", album.album_id],
    queryFn: () => api.get(`/api/albums/${encodeURIComponent(album.album_id)}`),
    staleTime: 60_000,
  });
  const trackPlays = detail?.track_plays ?? [];
  const maxPlays = Math.max(1, ...trackPlays.map(t => t.play_count));
  const since = sinceLabel(album.first_played);

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
              onClick={() => navigate(`/artists/${encodeURIComponent(album.artist)}?album=${encodeURIComponent(album.album_id)}`, { state: { from: "/albums", fromLabel: "Albums" } })}
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
              {album.count} {album.count === 1 ? "play" : "plays"}{since ? ` · since ${since}` : ""}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", columnGap: 14, rowGap: 4, marginTop: 5 }}>
              <button
                onClick={() => window.open(`spotify:album:${album.album_id}`, "_blank")}
                style={{
                  background: "transparent", border: "none", color: "#7db4cc",
                  fontSize: 11, cursor: "pointer", padding: 0, whiteSpace: "nowrap",
                }}
              >↗ Open in Spotify</button>
              <OpenInDiscogs
                artist={album.artist}
                title={album.album_name}
                albumId={album.album_id}
                style={{ background: "transparent", border: "none", color: "#7db4cc", fontSize: 11, padding: 0 }}
              />
            </div>
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
        {trackPlays.length > 0 && (
          <>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#535353", letterSpacing: "1.5px", marginBottom: 6 }}>
              TRACKS
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {trackPlays.map((t: TrackPlay) => {
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

// ─── where you were ───────────────────────────────────────────────────────────
// Opening an album's artist unmounts this view; coming back (Esc or "← Albums" on the
// artist page) restores the list, its filters, the open album and the scroll. Module
// level, so it lasts as long as the app is open.

interface SavedView {
  sort: SortKey; favOnly: boolean; sinceAV: boolean; typeFilter: TypeFilter; activeGenres: string[];
  yearLo: number | null; yearHi: number | null; search: string; searchVisible: boolean;
  focusedIdx: number; selectedAlbum: AlbumSummary | null; crate: Crate; scrollTop: number;
}
// A crate is a genre family (index into the ring's families) or the vinyl shelf.
type Crate = number | "vinyl" | null;
let savedView: SavedView | null = null;

export function AlbumsView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [restore] = useState(() => savedView);
  const [sort, setSort] = useState<SortKey>(restore?.sort ?? "recent");
  const [favOnly, setFavOnly] = useState(restore?.favOnly ?? false);
  const [sinceAV, setSinceAV] = useState(restore?.sinceAV ?? false);   // only albums played since AV's own log began
  const [typeFilter, setTypeFilter] = useState<TypeFilter>(restore?.typeFilter ?? null);
  const [activeGenres, setActiveGenres] = useState<Set<string>>(() => new Set(restore?.activeGenres ?? []));
  const [yearOpen, setYearOpen] = useState(false);
  const [yearLo, setYearLo] = useState<number | null>(restore?.yearLo ?? null);
  const [yearHi, setYearHi] = useState<number | null>(restore?.yearHi ?? null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [searchVisible, setSearchVisible] = useState(restore?.searchVisible ?? false);
  const [searchInput, setSearchInput] = useState(restore?.search ?? "");
  const [search, setSearch] = useState(restore?.search ?? "");
  const [focusedIdx, setFocusedIdx] = useState(restore?.focusedIdx ?? -1);
  const [selectedAlbum, setSelectedAlbum] = useState<AlbumSummary | null>(restore?.selectedAlbum ?? null);
  const [crate, setCrate] = useState<Crate>(restore?.crate ?? null);
  const [size, setSize] = useTileSize("av.albums.tileSize");

  const [favOverrides, setFavOverrides] = useState<Record<string, boolean>>({});
  const [ratingOverrides, setRatingOverrides] = useState<Record<string, number>>({});
  const [trackFavOverrides, setTrackFavOverrides] = useState<Record<string, boolean>>({});
  const [notesOverrides, setNotesOverrides] = useState<Record<string, string>>({});
  const notesTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [cols, setCols] = useState(4);
  const [tileWidth, setTileWidth] = useState(CARD_MIN_W.M);
  const [measured, setMeasured] = useState(false);
  const pendingScroll = useRef<number | null>(restore?.scrollTop ?? null);

  const { data } = useQuery<AlbumsResponse>({
    queryKey: ["albums"],
    queryFn: () => api.get("/api/albums"),
    staleTime: 60_000,
  });
  const { data: historyInfo } = useHistoryInfo();
  const avBeganMs = historyInfo?.av_began ? new Date(historyInfo.av_began).getTime() : null;

  const allAlbums = useMemo(() => data?.albums ?? [], [data]);
  const allGenres = data?.all_genres ?? [];

  // Crates: the Genres Ring's families. An album files under the family most of its first
  // three genres belong to. Same query key as the Ring, so the payload is shared.
  const { data: ring } = useQuery<RingPayload>({
    queryKey: ["stats-genres-ring"],
    queryFn: () => api.get<RingPayload>("/api/stats/genres-ring"),
    staleTime: 5 * 60 * 1000,
  });
  const albumFam = useMemo(() => {
    const fams = ring?.genre_fams;
    const m = new Map<string, number>();
    if (!fams) return m;
    for (const a of allAlbums) {
      const c = new Map<number, number>();
      for (const g of a.genres.slice(0, 3)) if (fams[g] !== undefined) c.set(fams[g], (c.get(fams[g]) ?? 0) + 1);
      let best = -1, bestN = 0;
      c.forEach((n, f) => { if (n > bestN) { best = f; bestN = n; } });
      if (best >= 0) m.set(a.album_id, best);
    }
    return m;
  }, [ring, allAlbums]);
  const inCrate = useCallback((a: AlbumSummary, c: Crate) => (c === "vinyl" ? a.has_vinyl : c === null || albumFam.get(a.album_id) === c), [albumFam]);

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

  // ── filtering + sorting ───────────────────────────────────────────────────

  // Everything but the crate, so the crate strip can count what each crate would show.
  const baseFiltered = useMemo(() => {
    let items = allAlbums;
    if (search) {
      const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const q = norm(search);
      items = items.filter(a => norm(a.album_name).includes(q) || norm(a.artist).includes(q));
    }
    if (favOnly) items = items.filter(a => favOverrides[a.album_id] !== undefined ? favOverrides[a.album_id] : a.is_favorited);
    if (sinceAV && avBeganMs !== null) items = items.filter(a => new Date(a.latest_played).getTime() >= avBeganMs);
    if (typeFilter) items = items.filter(a => a.classified_type === typeFilter);
    if (activeGenres.size > 0) items = items.filter(a => a.genres.some(g => activeGenres.has(g)));
    if (yearLo !== null && yearHi !== null && data?.year_bounds &&
        (yearLo !== data.year_bounds.min || yearHi !== data.year_bounds.max)) {
      items = items.filter(a => a.release_year !== null && a.release_year >= yearLo! && a.release_year <= yearHi!);
    }
    return items;
  }, [allAlbums, search, favOnly, sinceAV, avBeganMs, typeFilter, activeGenres, yearLo, yearHi, favOverrides, data?.year_bounds]);

  const filtered = useMemo(() => {
    const sorted = baseFiltered.filter(a => inCrate(a, crate));
    if (sort === "rating") {
      sorted.sort((a, b) => {
        const ra = ratingOverrides[a.album_id] ?? a.rating;
        const rb = ratingOverrides[b.album_id] ?? b.rating;
        return rb !== ra ? rb - ra : a.album_name.localeCompare(b.album_name);
      });
    } else if (sort === "az") sorted.sort((a, b) => compareFolded(a.album_name, b.album_name));
    else if (sort === "za") sorted.sort((a, b) => compareFolded(b.album_name, a.album_name));
    else if (sort === "newest") sorted.sort((a, b) => (b.release_year ?? 0) - (a.release_year ?? 0) || a.album_name.localeCompare(b.album_name));
    else if (sort === "oldest") sorted.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999) || a.album_name.localeCompare(b.album_name));
    else sorted.sort((a, b) => b.latest_played.localeCompare(a.latest_played));
    return sorted;
  }, [baseFiltered, inCrate, crate, sort, ratingOverrides]);

  // Sections follow the sort: letters, years (rail marks decades), ★ ratings, or months played.
  const sections = useMemo(() => {
    const ratingOf = (a: AlbumSummary) => ratingOverrides[a.album_id] ?? a.rating;
    if (sort === "az" || sort === "za")
      return buildSections(filtered, a => letterOf(a.album_name), k => ({ label: k === "•" ? "Other" : k, rail: k }));
    if (sort === "newest" || sort === "oldest")
      return buildSections(filtered, a => String(a.release_year ?? "—"), (k, _f, prev) => {
        if (k === "—") return { label: "No year", rail: "—" };
        const dec = k.slice(0, 3), prevDec = prev && prev !== "—" ? prev.slice(0, 3) : null;
        return { label: k, rail: dec !== prevDec ? `${dec}0s` : null };
      });
    if (sort === "rating")
      return buildSections(filtered, a => String(ratingOf(a)), k => {
        const r = Number(k);
        const label = r > 0 ? `★ ${(r / 2).toFixed(1).replace(/\.0$/, "")}` : "Unrated";
        return { label, rail: r > 0 ? (r % 2 === 0 ? String(r / 2) : null) : "–" };
      });
    return buildSections(filtered, a => monthKey(a.latest_played), (k, _f, prev) => ({
      label: monthLabel(k), rail: !prev || prev.slice(0, 4) !== k.slice(0, 4) ? k.slice(0, 4) : null,
    }));
  }, [filtered, sort, ratingOverrides]);

  const compact = size === "S";
  const grid = useSectionedGrid({ containerRef, sections, cols, rowHeight: cardHeightFor(tileWidth, compact), gap: GAP });
  const { scrollToIndex, moveVertical, sameRow } = grid;

  useEffect(() => {
    if (pendingScroll.current !== null) return;   // coming back: put the list where it was instead
    setFocusedIdx(-1);
    containerRef.current?.scrollTo({ top: 0 });   // a new list starts at its top
  }, [filtered.length, sort, search, favOnly, sinceAV, typeFilter, activeGenres.size, yearLo, yearHi, crate]);

  // Restore the scroll once the albums are in and the grid knows its column count.
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
  const latest = useRef<Omit<SavedView, "scrollTop"> | null>(null);
  useEffect(() => {
    latest.current = { sort, favOnly, sinceAV, typeFilter, activeGenres: [...activeGenres], yearLo, yearHi, search, searchVisible, focusedIdx, selectedAlbum, crate };
  }, [sort, favOnly, sinceAV, typeFilter, activeGenres, yearLo, yearHi, search, searchVisible, focusedIdx, selectedAlbum, crate]);
  useEffect(() => {
    const el = containerRef.current;
    return () => { if (latest.current) savedView = { ...latest.current, scrollTop: el?.scrollTop ?? 0 }; };
  }, []);

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
    const detail = queryClient.getQueryData<AlbumDetail>(["album", albumId]);
    const cur = trackFavOverrides[trackId] !== undefined ? trackFavOverrides[trackId]
      : (detail?.track_plays.find(t => t.track_id === trackId)?.is_favorited ?? false);
    const next = !cur;
    setTrackFavOverrides(p => ({ ...p, [trackId]: next }));
    api.post(`/api/library/track/${encodeURIComponent(trackId)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["album", albumId] }))
      .catch(() => setTrackFavOverrides(p => ({ ...p, [trackId]: cur })));
  }, [trackFavOverrides, queryClient]);

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
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocusedIdx(i => i < 0 ? 0 : moveVertical(i, 1)); return; }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocusedIdx(i => i < 0 ? 0 : moveVertical(i, -1)); return; }
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
        if (a) { setFocusedIdx(idx); setSelectedAlbum(prev => prev?.album_id === a.album_id ? null : a); }
        return;
      }
      if (e.key === "f" && !e.ctrlKey && !e.metaKey) { setFavOnly(v => !v); return; }
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
      if ((e.ctrlKey || e.metaKey) && e.key === "f" && focusedIdx >= 0) {
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
  }, [filtered, focusedIdx, moveVertical, sameRow, searchVisible, searchInput, paletteOpen, yearOpen, selectedAlbum, toggleFav]);

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
        {avBeganMs !== null && (
          <button style={pillBtn(sinceAV)} onClick={() => setSinceAV(v => !v)} title="Only albums played since AV's own log began">
            {sinceAV ? "Since AV" : "All time"}
          </button>
        )}

        <div style={{ flex: 1 }} />

        <SizeSwitch size={size} onChange={setSize} />
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
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
      {ring?.genre_fams && (
        <CratesStrip albums={baseFiltered} ring={ring} albumFam={albumFam} crate={crate} onPick={setCrate} />
      )}

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
          {/* The current section's header, pinned while you scroll through it. Zero height, so
              it overlays the grid instead of pushing it down. */}
          {grid.current >= 0 && sections[grid.current]?.header && grid.scrollTop > grid.secTop[grid.current] && (
            <div style={{ position: "sticky", top: 0, height: 0, zIndex: 3 }}>
              <SectionHeader label={sections[grid.current].label} count={sections[grid.current].count} noun="album" solid />
            </div>
          )}
          <div style={{ position: "relative", height: grid.total }}>
            {grid.visible.map(b => b.kind === "header" ? (
              <div key={`h${b.si}`} style={{ position: "absolute", top: b.top, left: 0, right: 0, height: HEADER_H }}>
                <SectionHeader label={sections[b.si].label} count={sections[b.si].count} noun="album" />
              </div>
            ) : (
              <div key={`r${b.start}`} style={{ position: "absolute", top: b.top, left: 0, display: "flex", gap: GAP }}>
                {filtered.slice(b.start, b.end).map((album, i) => {
                  const idx = b.start + i;
                  return (
                    <AlbumCard
                      key={album.album_id}
                      album={album}
                      tileWidth={tileWidth}
                      compact={compact}
                      focused={focusedIdx === idx}
                      selected={selectedAlbum?.album_id === album.album_id}
                      onClick={() => { setFocusedIdx(idx); setSelectedAlbum(prev => prev?.album_id === album.album_id ? null : album); }}
                      favOverride={favOverrides[album.album_id]}
                      ratingOverride={ratingOverrides[album.album_id]}
                    />
                  );
                })}
              </div>
            ))}
          </div>
          {filtered.length === 0 && data && (
            <div style={{ color: "#535353", padding: 24, width: "100%", textAlign: "center" }}>No albums found.</div>
          )}
        </div>
        <GridScrubber sections={sections} secTop={grid.secTop} total={grid.total} scrollTop={grid.scrollTop} viewHeight={grid.viewHeight}
          onScrollTo={t => containerRef.current?.scrollTo({ top: t })} noun="album" />

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
