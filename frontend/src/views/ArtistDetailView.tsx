import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { ArtistDetail, ArtistAlbumDetail, VinylRecord } from "../api/types";

import { API_BASE } from "../api/config";
const VINYL_BLUE = "#7db4cc";

function artUrl(filename: string | null | undefined): string | null {
  return filename ? `${API_BASE}/artwork/${filename}` : null;
}

// ─── album type labels ─────────────────────────────────────────────────────────

const ALBUM_TYPE_LABELS: Record<string, string> = {
  Album: "Albums", EP: "EPs", Single: "Singles", Compilation: "Compilations",
};

// ─── album list row ────────────────────────────────────────────────────────────

function AlbumListRow({
  album, selected, onClick, onContextMenu,
}: {
  album: ArtistAlbumDetail; selected: boolean; onClick: () => void;
  onContextMenu: (e: React.MouseEvent, album: ArtistAlbumDetail) => void;
}) {
  const url = artUrl(album.art_filename);
  const selfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) selfRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div ref={selfRef} onClick={onClick} onContextMenu={e => onContextMenu(e, album)}
      data-album-id={album.album_id}
      style={{
        display: "flex", alignItems: "center", gap: 10, padding: "6px 16px",
        cursor: "pointer", background: selected ? "#1a2a1a" : "transparent",
        borderLeft: selected ? "2px solid var(--green)" : "2px solid transparent",
      }}>
      <div style={{ width: 48, height: 48, borderRadius: 4, overflow: "hidden", background: "#222", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {url
          ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ color: "#535353", fontSize: 16 }}>♪</span>
        }
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: selected ? 700 : 500, color: selected ? "#fff" : "#b3b3b3",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{album.album_name}</div>
        <div style={{ fontSize: 11, color: "#555" }}>{album.release_year ?? ""}</div>
      </div>
    </div>
  );
}

// ─── vinyl list row ─────────────────────────────────────────────────────────────

function VinylListRow({
  record, selected, onClick,
}: {
  record: VinylRecord; selected: boolean; onClick: () => void;
}) {
  const url = artUrl(record.art_filename);
  const selfRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) selfRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div ref={selfRef} onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "6px 16px",
      cursor: "pointer", background: selected ? "#0f2030" : "transparent",
      borderLeft: selected ? `2px solid ${VINYL_BLUE}` : "2px solid transparent",
    }}>
      <div style={{ width: 48, height: 48, borderRadius: 4, overflow: "hidden", background: "#222", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        {url
          ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ color: "#535353", fontSize: 16 }}>◎</span>
        }
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 13, fontWeight: selected ? 700 : 500, color: selected ? "#fff" : "#b3b3b3",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{record.title}</div>
        <div style={{ fontSize: 11, color: VINYL_BLUE }}>{record.year ?? record.vinyl_type}</div>
      </div>
    </div>
  );
}

// ─── star rating ─────────────────────────────────────────────────────────────

// Rating scale: 0-20 (WAV) = 0-10 stored in OGAV. Display: 10 stars with half-step.
// Left half of star N → 2N-1 (e.g. star 10 left = 19 = 9.5), right half → 2N (star 10 right = 20 = 10.0)
function StarRating({
  rating, onChange,
}: {
  rating: number; onChange: (r: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover !== null ? hover : rating;

  return (
    <div style={{ display: "flex", gap: 1 }} onMouseLeave={() => setHover(null)}>
      {Array.from({ length: 10 }, (_, i) => i + 1).map(star => {
        const half = star * 2 - 1;  // left half value (e.g. star 10 → 19)
        const full = star * 2;      // right half value (e.g. star 10 → 20)
        const leftFilled = display >= half;
        const rightFilled = display >= full;
        return (
          <div key={star} style={{ position: "relative", width: 16, height: 18, cursor: "pointer", flexShrink: 0 }}>
            {/* empty star background */}
            <span style={{ position: "absolute", fontSize: 14, color: "#3a3a3a", userSelect: "none", lineHeight: "18px" }}>★</span>
            {/* gold fill — full or left-half clip */}
            {leftFilled && (
              <span style={{
                position: "absolute", fontSize: 14, color: "#FFD700", userSelect: "none",
                lineHeight: "18px", clipPath: rightFilled ? "none" : "inset(0 50% 0 0)",
              }}>★</span>
            )}
            {/* left half click zone */}
            <div
              style={{ position: "absolute", left: 0, top: 0, width: "50%", height: "100%" }}
              onMouseEnter={() => setHover(half)}
              onClick={() => onChange(rating === half ? 0 : half)}
            />
            {/* right half click zone */}
            <div
              style={{ position: "absolute", right: 0, top: 0, width: "50%", height: "100%" }}
              onMouseEnter={() => setHover(full)}
              onClick={() => onChange(rating === full ? 0 : full)}
            />
          </div>
        );
      })}
    </div>
  );
}

// ─── album detail panel ───────────────────────────────────────────────────────

function AlbumDetailPanel({
  album, albumFav, albumRating, notesText, trackFavOverrides, onClose,
  onAlbumFav, onAlbumRating, onNotesChange, onTrackFav,
}: {
  album: ArtistAlbumDetail;
  albumFav: boolean;
  albumRating: number;
  notesText: string;
  trackFavOverrides: Record<string, boolean>;
  onClose?: () => void;
  onAlbumFav: () => void;
  onAlbumRating: (r: number) => void;
  onNotesChange: (notes: string) => void;
  onTrackFav: (track_id: string) => void;
}) {
  const url = artUrl(album.art_filename);
  const typeLabel = ALBUM_TYPE_LABELS[album.classified_type] ?? album.classified_type;
  const maxPlays = Math.max(1, ...album.track_plays.map(t => t.play_count));

  const [editingNotes, setEditingNotes] = useState(false);
  const [draftNotes, setDraftNotes] = useState("");
  const notesRef = useRef<HTMLTextAreaElement>(null);

  // Reset notes editing when album changes
  useEffect(() => {
    setEditingNotes(false);
    setDraftNotes("");
  }, [album.album_id]);

  // 'n' opens notes editing
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (editingNotes) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "n") {
        e.preventDefault();
        setDraftNotes(notesText);
        setEditingNotes(true);
        setTimeout(() => notesRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingNotes, notesText]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Close bar */}
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 2, flexShrink: 0 }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "#535353",
            fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1,
          }}>✕</button>
        </div>
      )}

      {/* Content */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {/* Top row: art + meta */}
        <div style={{ display: "flex", gap: 24, marginBottom: 14 }}>
          <div style={{
            width: 260, height: 260, borderRadius: 10, overflow: "hidden",
            background: "#2a2a2a", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {url
              ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              : <span style={{ color: "#535353", fontSize: 56 }}>♪</span>
            }
          </div>
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "flex-start", minWidth: 0, paddingTop: 4 }}>
            <div style={{
              fontSize: 18, fontWeight: 700, color: "#fff",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{album.album_name}</div>
            <div style={{ fontSize: 13, color: "#b3b3b3", marginTop: 3 }}>{album.artist}</div>
            <div style={{ fontSize: 12, color: "#535353", marginTop: 2 }}>
              {[album.release_year, typeLabel].filter(Boolean).join(" · ")}
            </div>
            <div style={{ fontSize: 12, color: "#535353", marginTop: 1 }}>
              {album.count} {album.count === 1 ? "play" : "plays"}
            </div>
            <button
              onClick={() => window.open(`spotify:album:${album.album_id}`, "_blank")}
              style={{
                background: "transparent", border: "none", color: "#7db4cc",
                fontSize: 12, cursor: "pointer", padding: 0, marginTop: 6,
                textAlign: "left", display: "flex", alignItems: "center", gap: 3,
              }}
            >↗ Open in Spotify</button>

            {/* Rating */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: 11, color: "#535353", width: 52 }}>Rating</span>
              <StarRating rating={albumRating} onChange={onAlbumRating} />
            </div>

            {/* Favorite */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
              <span style={{ fontSize: 11, color: "#535353", width: 52 }}>Favorite</span>
              <button onClick={onAlbumFav} style={{
                background: "transparent", border: "none", cursor: "pointer",
                fontSize: 18, color: albumFav ? "#e8175d" : "#535353", padding: 0,
                lineHeight: 1,
              }}>♥</button>
            </div>
          </div>
        </div>

        {/* Notes */}
        {editingNotes && (
          <div style={{ marginBottom: 12 }}>
            <textarea
              ref={notesRef}
              value={draftNotes}
              onChange={e => setDraftNotes(e.target.value)}
              onKeyDown={e => {
                e.stopPropagation();
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onNotesChange(draftNotes);
                  setEditingNotes(false);
                } else if (e.key === "Escape") {
                  setEditingNotes(false);
                }
              }}
              placeholder="add notes…"
              rows={3}
              style={{
                width: "100%", boxSizing: "border-box",
                background: "#1e1e1e", border: "1px solid #333",
                borderRadius: 4, color: "#b3b3b3", fontSize: 12,
                padding: "6px 8px", resize: "vertical", outline: "none",
                fontFamily: "inherit",
              }}
            />
            <div style={{ fontSize: 10, color: "#535353", marginTop: 3 }}>
              Enter to save · Esc to cancel
            </div>
          </div>
        )}
        {!editingNotes && notesText && (
          <div
            style={{
              fontSize: 12, color: "#666", fontStyle: "italic",
              marginBottom: 12, cursor: "text", lineHeight: 1.5,
            }}
            title="Press n to edit"
            onClick={() => { setDraftNotes(notesText); setEditingNotes(true); setTimeout(() => notesRef.current?.focus(), 0); }}
          >{notesText}</div>
        )}

        {/* Track list */}
        {album.track_plays.length > 0 && (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: "#535353", letterSpacing: "1.5px" }}>TRACKS</div>
              {album.album_total_tracks != null && (
                <div style={{
                  fontSize: 11, fontWeight: 700,
                  color: album.heard_tracks >= album.album_total_tracks ? "var(--green)" : "#666",
                }}>{album.heard_tracks}/{album.album_total_tracks}</div>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {album.track_plays.map(t => {
                const isFav = trackFavOverrides[t.track_id] !== undefined
                  ? trackFavOverrides[t.track_id] : t.is_favorited;
                const barPct = (t.play_count / maxPlays) * 100;
                return (
                  <div key={t.track_id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "4px 6px", borderRadius: 4,
                  }}>
                    {/* Fav */}
                    <button onClick={() => onTrackFav(t.track_id)} style={{
                      background: "transparent", border: "none", cursor: "pointer",
                      fontSize: 13, color: isFav ? "#e8175d" : "#535353",
                      padding: 0, flexShrink: 0, lineHeight: 1,
                    }}>♥</button>
                    {/* Track name */}
                    <span style={{
                      flex: 1, fontSize: 13, color: "#fff",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>{t.track_name}</span>
                    {/* Progress bar */}
                    <div style={{
                      width: 80, height: 3, background: "#2a2a2a",
                      borderRadius: 2, flexShrink: 0, overflow: "hidden",
                    }}>
                      <div style={{
                        width: `${barPct}%`, height: "100%",
                        background: "var(--green)", borderRadius: 2,
                      }} />
                    </div>
                    {/* Play count */}
                    <span style={{
                      fontSize: 11, color: "#535353", width: 20,
                      textAlign: "right", flexShrink: 0,
                    }}>{t.play_count}</span>
                    {/* Play in Spotify */}
                    <button
                      onClick={() => window.open(`spotify:track:${t.track_id}`, "_blank")}
                      style={{
                        width: 22, height: 22, borderRadius: 11, background: "var(--green)",
                        border: "none", color: "#000", fontSize: 9, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        flexShrink: 0, fontWeight: 900,
                      }}
                      title="Play in Spotify"
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

// ─── vinyl detail panel ───────────────────────────────────────────────────────

function VinylDetailPanel({
  record, onClose,
}: {
  record: VinylRecord; onClose?: () => void;
}) {
  const url = artUrl(record.art_filename);

  const fmtParts = [...(record.formats ?? []), ...(record.format_descriptions ?? [])
    .filter(d => !record.formats.includes(d))];
  const fmtStr = fmtParts.join(", ") || "—";

  let yearStr = "—";
  if (record.original_year && record.original_year !== record.year) {
    yearStr = `${record.year}  (orig. ${record.original_year})`;
  } else if (record.original_year) {
    yearStr = String(record.original_year);
  } else if (record.year) {
    yearStr = String(record.year);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {onClose && (
        <div style={{ display: "flex", justifyContent: "flex-end", paddingBottom: 4, flexShrink: 0 }}>
          <button onClick={onClose} style={{
            background: "transparent", border: "none", color: "#535353",
            fontSize: 18, cursor: "pointer", padding: "0 2px", lineHeight: 1,
          }}>✕</button>
        </div>
      )}
      <div style={{ flex: 1, display: "flex", gap: 28, overflow: "hidden" }}>
        {/* Art */}
        <div style={{
          width: 220, height: 220, borderRadius: 4, overflow: "hidden",
          background: "#3e3e3e", flexShrink: 0,
          display: "flex", alignItems: "center", justifyContent: "center",
          alignSelf: "flex-start",
        }}>
          {url
            ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <span style={{ color: "#535353", fontSize: 48 }}>◎</span>
          }
        </div>

        {/* Meta + tracklist */}
        <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>
            {record.title}
          </div>
          <div style={{ fontSize: 13, color: "#b3b3b3", marginBottom: 14 }}>
            {record.artists.join(" / ")}
          </div>

          <div style={{ height: 1, background: "#535353", marginBottom: 10 }} />

          {[
            ["FORMAT", fmtStr],
            ["LABEL", record.labels.slice(0, 2).join(", ") || "—"],
            ["CAT#", record.catnos.join(", ") || "—"],
            ["YEAR", yearStr],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", gap: 10, marginBottom: 4, alignItems: "baseline" }}>
              <span style={{
                width: 52, fontSize: 10, fontWeight: 700, color: "#535353",
                letterSpacing: "1px", flexShrink: 0,
              }}>{k}</span>
              <span style={{ fontSize: 11, color: "#b3b3b3" }}>{v}</span>
            </div>
          ))}

          {record.tracklist.length > 0 && (
            <>
              <div style={{
                marginTop: 16, marginBottom: 6,
                fontSize: 10, fontWeight: 700, color: VINYL_BLUE, letterSpacing: "2px",
              }}>TRACKLIST</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {record.tracklist.map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    <span style={{ width: 28, fontSize: 11, color: VINYL_BLUE, flexShrink: 0 }}>
                      {t.position}
                    </span>
                    <span style={{ flex: 1, fontSize: 11, color: "#fff" }}>{t.title}</span>
                    <span style={{ fontSize: 11, color: "#535353" }}>{t.duration}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── main view ────────────────────────────────────────────────────────────────
// Split layout: album/vinyl list on the left, detail always shown on the right.

export function ArtistDetailView() {
  const params = useParams<{ "*": string }>();
  const name = params["*"];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const artistName = decodeURIComponent(name ?? "");

  const { data, isLoading } = useQuery<ArtistDetail>({
    queryKey: ["artist-detail", artistName],
    queryFn: () => api.get(`/api/artists/${encodeURIComponent(artistName)}`),
    enabled: !!artistName,
    staleTime: 30_000,
  });

  // ── source: "spotify" | "vinyl" ───────────────────────────────────────────
  const [source, setSource] = useState<"spotify" | "vinyl">("spotify");

  // ── selection (drives both list highlight and the right-hand detail panel) ─
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [selectedVinylId, setSelectedVinylId] = useState<number | null>(null);

  // ── inline genre edit ─────────────────────────────────────────────────────
  const [genreEditing, setGenreEditing] = useState(false);
  const [genreText, setGenreText] = useState("");
  const genreRef = useRef<HTMLInputElement>(null);

  // ── fav / rating overrides ────────────────────────────────────────────────
  const [favOverride, setFavOverride] = useState<boolean | null>(null);
  const [albumFavOverrides, setAlbumFavOverrides] = useState<Record<string, boolean>>({});
  const [albumRatingOverrides, setAlbumRatingOverrides] = useState<Record<string, number>>({});
  const [albumNotesOverrides, setAlbumNotesOverrides] = useState<Record<string, string>>({});
  const [trackFavOverrides, setTrackFavOverrides] = useState<Record<string, boolean>>({});
  const notesDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; album: ArtistAlbumDetail } | null>(null);

  // Keep genre text in sync when data loads
  useEffect(() => {
    if (data && !genreEditing) setGenreText(data.genres.join(", "));
  }, [data, genreEditing]);

  // Reset state when artist changes
  useEffect(() => {
    setSource("spotify");
    setSelectedAlbumId(null);
    setSelectedVinylId(null);
    setFavOverride(null);
    setAlbumFavOverrides({});
    setAlbumRatingOverrides({});
    setAlbumNotesOverrides({});
    setTrackFavOverrides({});
    setGenreEditing(false);
  }, [artistName]);

  // Default selection to the first album/vinyl once data arrives
  useEffect(() => {
    if (!data) return;
    setSelectedAlbumId(prev => prev ?? data.albums[0]?.album_id ?? null);
    setSelectedVinylId(prev => prev ?? data.vinyl[0]?.release_id ?? null);
  }, [data]);

  const hasVinyl = (data?.vinyl?.length ?? 0) > 0;
  const isFav = favOverride !== null ? favOverride : (data?.is_favorited ?? false);

  const selectedAlbum = data?.albums.find(a => a.album_id === selectedAlbumId) ?? null;
  const selectedVinyl = data?.vinyl.find(r => r.release_id === selectedVinylId) ?? null;

  // ── fav toggle ────────────────────────────────────────────────────────────
  const toggleFav = useCallback(() => {
    const next = !isFav;
    setFavOverride(next);
    return api.post(`/api/library/artist/${encodeURIComponent(artistName)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["artist-detail", artistName] }))
      .catch(() => setFavOverride(isFav));
  }, [isFav, artistName, queryClient]);

  // ── album fav/rating/track fav ────────────────────────────────────────────
  const toggleAlbumFav = useCallback((albumId: string, current: boolean) => {
    const next = !current;
    setAlbumFavOverrides(p => ({ ...p, [albumId]: next }));
    api.post(`/api/library/album/${encodeURIComponent(albumId)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["artist-detail", artistName] }))
      .catch(() => setAlbumFavOverrides(p => ({ ...p, [albumId]: current })));
  }, [artistName, queryClient]);

  const setAlbumRating = useCallback((albumId: string, rating: number) => {
    setAlbumRatingOverrides(p => ({ ...p, [albumId]: rating }));
    api.post(`/api/library/album/${encodeURIComponent(albumId)}/rating`, { rating })
      .then(() => queryClient.invalidateQueries({ queryKey: ["artist-detail", artistName] }))
      .catch(() => setAlbumRatingOverrides(p => { const n = { ...p }; delete n[albumId]; return n; }));
  }, [artistName, queryClient]);

  const setAlbumNotes = useCallback((albumId: string, notes: string) => {
    setAlbumNotesOverrides(p => ({ ...p, [albumId]: notes }));
    if (notesDebounce.current) clearTimeout(notesDebounce.current);
    notesDebounce.current = setTimeout(() => {
      api.post(`/api/library/album/${encodeURIComponent(albumId)}/notes`, { notes })
        .then(() => queryClient.invalidateQueries({ queryKey: ["artist-detail", artistName] }))
        .catch(() => {});
    }, 600);
  }, [artistName, queryClient]);

  const setHeroArt = useCallback((album: ArtistAlbumDetail) => {
    if (!album.art_filename) return;
    api.post(`/api/library/artist/${encodeURIComponent(artistName)}/hero-art`, { art_filename: album.art_filename })
      .then(() => queryClient.invalidateQueries({ queryKey: ["artists"] }))
      .catch(() => {});
  }, [artistName, queryClient]);

  const handleAlbumContextMenu = useCallback((e: React.MouseEvent, album: ArtistAlbumDetail) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY, album });
  }, []);

  const toggleTrackFav = useCallback((trackId: string, current: boolean) => {
    const next = !current;
    setTrackFavOverrides(p => ({ ...p, [trackId]: next }));
    api.post(`/api/library/track/${encodeURIComponent(trackId)}/favorite`)
      .then(() => queryClient.invalidateQueries({ queryKey: ["artist-detail", artistName] }))
      .catch(() => setTrackFavOverrides(p => ({ ...p, [trackId]: current })));
  }, [artistName, queryClient]);

  // ── genre save ────────────────────────────────────────────────────────────
  const saveGenres = useCallback(() => {
    setGenreEditing(false);
    const genres = genreText.split(",").map(g => g.trim()).filter(Boolean);
    api.post(`/api/library/artist/${encodeURIComponent(artistName)}/genres`, { genres })
      .then(() => queryClient.invalidateQueries({ queryKey: ["artist-detail", artistName] }))
      .catch(() => {});
  }, [genreText, artistName, queryClient]);

  // Select album passed via ?album=<id> (e.g. navigating from Recent view)
  useEffect(() => {
    const albumId = searchParams.get("album");
    if (!albumId || !data) return;
    const match = data.albums.find(a => a.album_id === albumId);
    if (match) { setSource("spotify"); setSelectedAlbumId(albumId); }
  }, [data, searchParams]);

  // ── keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (genreEditing) return;
      const inInput = (e.target as HTMLElement).tagName === "INPUT";
      if (inInput) return;

      // Source switching
      if (e.key === "s") { setSource("spotify"); return; }
      if (e.key === "v" && hasVinyl) { setSource("vinyl"); return; }
      if (e.key === "Escape") { navigate("/artists"); return; }
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        const next = !isFav;
        const artistFavDone = toggleFav();
        if (source === "spotify" && selectedAlbum) {
          const albumCurrent = albumFavOverrides[selectedAlbum.album_id] !== undefined
            ? albumFavOverrides[selectedAlbum.album_id] : selectedAlbum.is_favorited;
          // Sequenced, not concurrent: the backend's read-modify-write of
          // library.json has no lock, so firing both favorite POSTs at once
          // races and both come back 500 (see ticket notes).
          if (albumCurrent !== next) {
            artistFavDone.finally(() => toggleAlbumFav(selectedAlbum.album_id, albumCurrent));
          }
        }
        return;
      }

      const PREV = ["k", "ArrowUp", "h", "ArrowLeft"];
      const NEXT = ["j", "ArrowDown", "l", "ArrowRight"];
      if (![...PREV, ...NEXT].includes(e.key)) return;
      e.preventDefault();

      if (source === "spotify") {
        const list = data?.albums ?? [];
        if (!list.length) return;
        const idx = list.findIndex(a => a.album_id === selectedAlbumId);
        if (idx === -1) { setSelectedAlbumId(list[0].album_id); return; }
        if (PREV.includes(e.key) && idx > 0) setSelectedAlbumId(list[idx - 1].album_id);
        if (NEXT.includes(e.key) && idx < list.length - 1) setSelectedAlbumId(list[idx + 1].album_id);
      } else {
        const list = data?.vinyl ?? [];
        if (!list.length) return;
        const idx = list.findIndex(r => r.release_id === selectedVinylId);
        if (idx === -1) { setSelectedVinylId(list[0].release_id); return; }
        if (PREV.includes(e.key) && idx > 0) setSelectedVinylId(list[idx - 1].release_id);
        if (NEXT.includes(e.key) && idx < list.length - 1) setSelectedVinylId(list[idx + 1].release_id);
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    genreEditing, hasVinyl, source, data, selectedAlbumId, selectedVinylId, navigate,
    isFav, toggleFav, selectedAlbum, albumFavOverrides, toggleAlbumFav,
  ]);

  const pillStyle = (active: boolean, isVinyl = false): React.CSSProperties => ({
    height: 24, padding: "0 12px", borderRadius: 12, fontSize: 11, cursor: "pointer",
    background: active ? (isVinyl ? "#0f2030" : "#1a2a1a") : "#2a2a2a",
    color: active ? (isVinyl ? VINYL_BLUE : "var(--green)") : "#b3b3b3",
    border: active ? `1px solid ${isVinyl ? VINYL_BLUE : "var(--green)"}` : "none",
    fontWeight: active ? 700 : 400, textTransform: "capitalize",
  });

  if (isLoading || !data) {
    return (
      <div style={{ padding: 24, color: "#535353", fontSize: 13 }}>
        {isLoading ? "Loading…" : "Artist not found."}
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      background: "#0a0a0a", boxSizing: "border-box", overflow: "hidden", position: "relative",
    }}>
      {/* Header */}
      <div style={{ flexShrink: 0, padding: "8px 24px 12px", borderBottom: "1px solid #1a1a1a" }}>
        <button onClick={() => navigate("/artists")} style={{
          background: "transparent", border: "none", color: "var(--green)",
          fontSize: 13, fontWeight: 600, cursor: "pointer",
          padding: 0, marginBottom: 4, display: "block",
        }}>← Artists</button>

        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{data.name}</span>
          <span style={{ fontSize: 12, color: "#555" }}>{data.play_count} plays</span>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
            {data.artist_id && (
              <button
                onClick={() => window.open(`spotify:artist:${data.artist_id}`, "_blank")}
                style={{ background: "transparent", border: "none", color: "#7db4cc", fontSize: 12, cursor: "pointer", padding: 0 }}
              >↗ Open in Spotify</button>
            )}
            <button onClick={toggleFav} style={{
              fontSize: 12, fontWeight: 600, padding: "3px 12px", borderRadius: 13, cursor: "pointer",
              background: isFav ? "#2a1a1a" : "#2a2a2a",
              border: isFav ? "1px solid #e05050" : "none",
              color: isFav ? "#e05050" : "#b3b3b3",
            }}>
              {isFav ? "♥ Favorited" : "♡ Favorite"}
            </button>
          </div>
        </div>

        {/* Genres inline edit */}
        {genreEditing ? (
          <input
            ref={genreRef}
            value={genreText}
            onChange={e => setGenreText(e.target.value)}
            onBlur={saveGenres}
            onKeyDown={e => {
              if (e.key === "Enter") saveGenres();
              if (e.key === "Escape") { setGenreEditing(false); setGenreText(data.genres.join(", ")); }
              e.stopPropagation();
            }}
            style={{
              background: "#2a2a2a", border: "1px solid var(--green)", borderRadius: 4,
              color: "#fff", fontSize: 12, padding: "2px 8px", outline: "none",
              marginTop: 6, width: 400,
            }}
            autoFocus
          />
        ) : (
          <div
            onDoubleClick={() => { setGenreEditing(true); setGenreText(data.genres.join(", ")); setTimeout(() => genreRef.current?.select(), 0); }}
            style={{
              fontSize: 11, fontStyle: genreText ? "normal" : "italic",
              color: genreText ? "#666" : "#3a3a3a",
              marginTop: 6, cursor: "text",
            }}
            title="Double-click to edit genres"
          >
            {genreText || "double-click to add genres…"}
          </div>
        )}

        {/* Source pills */}
        {hasVinyl && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <button style={pillStyle(source === "spotify")} onClick={() => setSource("spotify")}>Spotify</button>
            <button style={pillStyle(source === "vinyl", true)} onClick={() => setSource("vinyl")}>Vinyl</button>
          </div>
        )}
      </div>

      {/* Body: list left, detail right — both starting at the same y */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Left: album/vinyl list */}
        <div style={{ width: 260, flexShrink: 0, borderRight: "1px solid #1a1a1a", overflowY: "auto", padding: "8px 0" }}>
          {source === "spotify" ? (
            data.albums.length === 0
              ? <div style={{ padding: "12px 16px", fontSize: 12, color: "#535353" }}>No albums</div>
              : data.albums.map(a => (
                <AlbumListRow
                  key={a.album_id}
                  album={a}
                  selected={a.album_id === selectedAlbumId}
                  onClick={() => setSelectedAlbumId(a.album_id)}
                  onContextMenu={handleAlbumContextMenu}
                />
              ))
          ) : (
            data.vinyl.length === 0
              ? <div style={{ padding: "12px 16px", fontSize: 12, color: "#535353" }}>No vinyl</div>
              : data.vinyl.map(r => (
                <VinylListRow
                  key={r.release_id}
                  record={r}
                  selected={r.release_id === selectedVinylId}
                  onClick={() => setSelectedVinylId(r.release_id)}
                />
              ))
          )}
        </div>

        {/* Right: detail */}
        <div style={{ flex: 1, overflow: "hidden", padding: "12px 24px 12px 20px" }}>
          {source === "spotify" ? (
            selectedAlbum && (
              <AlbumDetailPanel
                album={selectedAlbum}
                albumFav={albumFavOverrides[selectedAlbum.album_id] !== undefined
                  ? albumFavOverrides[selectedAlbum.album_id] : selectedAlbum.is_favorited}
                albumRating={albumRatingOverrides[selectedAlbum.album_id] !== undefined
                  ? albumRatingOverrides[selectedAlbum.album_id] : selectedAlbum.rating}
                notesText={albumNotesOverrides[selectedAlbum.album_id] !== undefined
                  ? albumNotesOverrides[selectedAlbum.album_id] : (selectedAlbum.notes ?? "")}
                trackFavOverrides={trackFavOverrides}
                onAlbumFav={() => {
                  const cur = albumFavOverrides[selectedAlbum.album_id] !== undefined
                    ? albumFavOverrides[selectedAlbum.album_id] : selectedAlbum.is_favorited;
                  toggleAlbumFav(selectedAlbum.album_id, cur);
                }}
                onAlbumRating={r => setAlbumRating(selectedAlbum.album_id, r)}
                onNotesChange={notes => setAlbumNotes(selectedAlbum.album_id, notes)}
                onTrackFav={trackId => {
                  const cur = trackFavOverrides[trackId] !== undefined
                    ? trackFavOverrides[trackId]
                    : (selectedAlbum.track_plays.find(t => t.track_id === trackId)?.is_favorited ?? false);
                  toggleTrackFav(trackId, cur);
                }}
              />
            )
          ) : (
            selectedVinyl && <VinylDetailPanel record={selectedVinyl} />
          )}
        </div>
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 1000 }}
          onClick={() => setCtxMenu(null)}
          onContextMenu={e => { e.preventDefault(); setCtxMenu(null); }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed", left: ctxMenu.x, top: ctxMenu.y,
              background: "#1e1e1e", border: "1px solid #333", borderRadius: 8,
              padding: "4px 0", minWidth: 180, boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
              zIndex: 1001,
            }}
          >
            <div
              onClick={() => { setHeroArt(ctxMenu.album); setCtxMenu(null); }}
              style={{ padding: "8px 14px", fontSize: 13, color: "#e0e0e0", cursor: "pointer" }}
              onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              Set as artist artwork
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
