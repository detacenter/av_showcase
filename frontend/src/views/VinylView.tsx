import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { api } from "../api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GenrePalette } from "../components/GenrePalette";
import type { VinylRecord, VinylResponse } from "../api/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const VINYL_COLOR = "#c8a84b";
import { API_BASE } from "../api/config";
const TYPE_CYCLE = [null, "LP", "EP", '7"', '12"', "Compilation"] as const;
type VinylType = typeof TYPE_CYCLE[number];

const TYPE_LABELS: Record<string, string> = {
  LP: "LPs", EP: "EPs", '7"': '7"', '12"': '12"', Compilation: "Compilations",
};

function artUrl(filename: string | null | undefined): string | null {
  return filename ? `${API_BASE}/artwork/${filename}` : null;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  try {
    const dt = new Date(value);
    return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return value.slice(0, 10);
  }
}

function joinValues(values: string[] | undefined, sep = "  ·  "): string {
  return (values || []).filter(Boolean).join(sep);
}

// ── VinylCard ─────────────────────────────────────────────────────────────────

function VinylCard({ record, tileWidth, focused, cardRef, onClick }: {
  record: VinylRecord;
  tileWidth: number;
  focused: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  onClick: () => void;
}) {
  const artSize = tileWidth - 16;
  const url = artUrl(record.art_filename);

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      style={{
        width: tileWidth, background: "#1a1a1a", borderRadius: 8,
        padding: "8px 8px 10px", boxSizing: "border-box", cursor: "pointer",
        border: focused ? `2px solid ${VINYL_COLOR}` : "2px solid transparent",
      }}
    >
      <div style={{
        width: artSize, height: artSize, borderRadius: 6, overflow: "hidden",
        background: "#111", marginBottom: 8, flexShrink: 0,
      }}>
        {url ? (
          <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        ) : (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 28 }}>♪</div>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#fff", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {record.title}
      </div>
      <div style={{ fontSize: 11, color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {record.artists.join(", ")}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 11, color: "#555" }}>{record.year || ""}</span>
        <span style={{ fontSize: 11, color: VINYL_COLOR, fontWeight: 600 }}>{record.vinyl_type}</span>
      </div>
    </div>
  );
}

// ── MetaRow ───────────────────────────────────────────────────────────────────

function MetaRow({ label, value, color }: { label: string; value: string; color?: string }) {
  if (!value) return null;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 4, fontSize: 12 }}>
      <span style={{ color: "#444", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", width: 72, flexShrink: 0, paddingTop: 1, textAlign: "right" }}>{label}</span>
      <span style={{ color: color || "#bbb", flex: 1, lineHeight: 1.4 }}>{value}</span>
    </div>
  );
}

// ── VinylDetailPanel ──────────────────────────────────────────────────────────

function VinylDetailPanel({ record, onClose }: { record: VinylRecord; onClose: () => void }) {
  const url = artUrl(record.art_filename);

  // Build year label
  const origYear = record.original_year;
  const pressYear = record.year;
  const released = record.released;
  let yearLabel = String(origYear || released || "");
  if (released && origYear && String(released) !== String(origYear)) yearLabel = `${origYear}  ·  ${released}`;
  const pressingLabel = pressYear && String(pressYear) !== String(origYear || "") ? String(pressYear) : "";

  const fmtStr = joinValues([...(record.formats || []), ...(record.format_descriptions || [])]);

  // Group tracklist by side
  const sides: Map<string, typeof record.tracklist> = new Map();
  for (const t of record.tracklist) {
    const pos = t.position || "";
    const firstChar = pos[0]?.toUpperCase() || "";
    const side = firstChar && /[A-Z]/.test(firstChar) && isNaN(Number(firstChar)) ? firstChar : "";
    if (!sides.has(side)) sides.set(side, []);
    sides.get(side)!.push(t);
  }

  const have = record.community_have ?? 0;
  const want = record.community_want ?? 0;
  const avg = record.community_rating_avg ?? 0;
  const count = record.community_rating_count ?? 0;

  const profileRows: [string, string][] = [];
  const added = formatDate(record.date_added);
  if (added) profileRows.push(["Added", added]);
  if (record.user_rating) profileRows.push(["Your rating", String(record.user_rating)]);
  if (record.barcode) profileRows.push(["Barcode", record.barcode]);
  if (record.matrix) profileRows.push(["Matrix", record.matrix]);
  if (record.release_id) profileRows.push(["Release ID", String(record.release_id)]);

  const dim: React.CSSProperties = { color: "#444", fontSize: 10, fontWeight: 700, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6, marginTop: 12 };

  return (
    <div style={{
      width: 340, flexShrink: 0, background: "#111", borderLeft: "1px solid #1e1e1e",
      overflowY: "auto", display: "flex", flexDirection: "column",
    }}>
      {/* Close */}
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px 0", flexShrink: 0 }}>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ padding: "4px 16px 24px", flex: 1 }}>
        {/* Art */}
        <div style={{ borderRadius: 8, overflow: "hidden", background: "#0a0a0a", marginBottom: 14, aspectRatio: "1" }}>
          {url ? (
            <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          ) : (
            <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 48 }}>♪</div>
          )}
        </div>

        {/* Title + Artist */}
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4, lineHeight: 1.3 }}>{record.title}</div>
        <div style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>{record.artists.join(", ")}</div>

        {/* Meta */}
        <MetaRow label="Released" value={yearLabel} />
        {pressingLabel && <MetaRow label="Pressing" value={pressingLabel} />}
        <MetaRow label="Label" value={joinValues(record.labels)} />
        <MetaRow label="Cat #" value={joinValues(record.catnos)} />
        <MetaRow label="Country" value={record.country || ""} />
        <MetaRow label="Format" value={fmtStr} />
        {(record.genres?.length ?? 0) > 0 && <MetaRow label="Genres" value={joinValues(record.genres)} color={VINYL_COLOR} />}
        {(record.styles?.length ?? 0) > 0 && <MetaRow label="Styles" value={joinValues(record.styles)} color="#a08030" />}

        {/* Community */}
        {(have > 0 || want > 0) && (
          <div style={{ marginTop: 10, marginBottom: 4, fontSize: 12 }}>
            <span style={{ color: VINYL_COLOR, fontWeight: 700 }}>{have.toLocaleString()}</span>
            <span style={{ color: "#444" }}> have  </span>
            <span style={{ color: VINYL_COLOR, fontWeight: 700 }}>{want.toLocaleString()}</span>
            <span style={{ color: "#444" }}> want</span>
            {avg > 0 && (
              <>
                <span style={{ color: "#666" }}>  ·  </span>
                <span style={{ color: "#FFD700", fontWeight: 700 }}>★ {avg.toFixed(2)}</span>
                <span style={{ color: "#444" }}> ({count.toLocaleString()})</span>
              </>
            )}
          </div>
        )}

        {/* Discogs link */}
        {record.release_id && (
          <a
            href={`https://www.discogs.com/release/${record.release_id}`}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-block", marginTop: 8, marginBottom: 4,
              border: `1px solid ${VINYL_COLOR}`, borderRadius: 14,
              padding: "3px 12px", fontSize: 11, fontWeight: 700,
              color: VINYL_COLOR, textDecoration: "none",
            }}
          >Open on Discogs ↗</a>
        )}

        {/* Release profile */}
        {profileRows.length > 0 && (
          <>
            <div style={{ ...dim }}>Release Profile</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
              {profileRows.map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 9, color: "#444", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{k}</div>
                  <div style={{ fontSize: 11, color: "#888" }}>{v}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Notes */}
        {record.notes && (
          <>
            <div style={{ ...dim }}>Notes</div>
            <div style={{ fontSize: 11, color: "#777", lineHeight: 1.5, background: "#0d0d0d", borderRadius: 6, padding: "8px 10px" }}>
              {record.notes.slice(0, 300)}{record.notes.length > 300 ? "…" : ""}
            </div>
          </>
        )}

        {/* Tracklist */}
        {record.tracklist.length > 0 && (
          <>
            <div style={{ ...dim }}>Tracklist  ·  {record.tracklist.length} track{record.tracklist.length !== 1 ? "s" : ""}</div>
            {[...sides.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([side, tracks]) => (
              <div key={side}>
                {side && (
                  <div style={{ fontSize: 10, color: VINYL_COLOR, fontWeight: 700, letterSpacing: 1, marginTop: 8, marginBottom: 4 }}>
                    Side {side}
                  </div>
                )}
                {tracks.map((t, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: "#444", width: 22, textAlign: "right", flexShrink: 0 }}>{t.position}</span>
                    <span style={{ fontSize: 11, color: "#aaa", flex: 1 }}>{t.title}</span>
                    <span style={{ fontSize: 10, color: "#555", flexShrink: 0 }}>{t.duration}</span>
                  </div>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── VinylView ─────────────────────────────────────────────────────────────────

// ─── WantlistPanel ────────────────────────────────────────────────────────────

interface WantItem {
  release_id: number;
  title: string;
  artists: string[];
  year: number | null;
  labels: string[];
  genres: string[];
  styles: string[];
  formats: string[];
  format_descriptions: string[];
  thumb: string;
  cover_image: string;
  date_added: string | null;
  notes: string;
}

function WantDetailPanel({ item, onClose }: { item: WantItem; onClose: () => void }) {
  const fmtParts = [...(item.formats ?? []), ...(item.format_descriptions ?? [])].filter(Boolean);
  const discogsUrl = `https://www.discogs.com/release/${item.release_id}`;

  const row = (label: string, value: string) => value ? (
    <div style={{ display: "flex", gap: 8, marginBottom: 5, fontSize: 12 }}>
      <span style={{ color: "#444", fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", width: 72, flexShrink: 0, paddingTop: 1, textAlign: "right" }}>{label}</span>
      <span style={{ color: "#bbb", flex: 1, lineHeight: 1.4 }}>{value}</span>
    </div>
  ) : null;

  return (
    <div style={{ width: 300, flexShrink: 0, background: "#111", borderLeft: "1px solid #1e1e1e", overflowY: "auto", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", justifyContent: "flex-end", padding: "10px 12px 0" }}>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ padding: "4px 16px 24px" }}>
        <div style={{ borderRadius: 8, overflow: "hidden", background: "#0a0a0a", marginBottom: 14, aspectRatio: "1" }}>
          {(item.cover_image || item.thumb)
            ? <img src={item.cover_image || item.thumb} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 48 }}>♪</div>
          }
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4, lineHeight: 1.3 }}>{item.title}</div>
        <div style={{ fontSize: 13, color: "#999", marginBottom: 12 }}>{item.artists.join(", ")}</div>
        {row("Year", String(item.year ?? ""))}
        {row("Label", item.labels.join("  ·  "))}
        {row("Format", fmtParts.join("  ·  "))}
        {row("Genres", item.genres.join(", "))}
        {row("Styles", (item.styles ?? []).join(", "))}
        {item.notes && (
          <div style={{ marginTop: 10, padding: "8px 10px", background: "#1a1a1a", borderRadius: 6, fontSize: 12, color: "#888", lineHeight: 1.5, fontStyle: "italic" }}>
            {item.notes}
          </div>
        )}
        <a href={discogsUrl} target="_blank" rel="noreferrer" style={{ display: "block", marginTop: 14, fontSize: 11, color: VINYL_COLOR, textDecoration: "none", opacity: 0.8 }}>
          View on Discogs ↗
        </a>
      </div>
    </div>
  );
}

function WantlistPanel() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [selected, setSelected] = useState<WantItem | null>(null);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data } = useQuery<{ wants: WantItem[]; count: number; all_genres: string[] }>({
    queryKey: ["wantlist"],
    queryFn: () => api.get("/api/vinyl/wantlist"),
    staleTime: 60_000,
  });

  const wants = data?.wants ?? [];
  const q = search.toLowerCase().trim();
  const filtered = q
    ? wants.filter(r => r.title.toLowerCase().includes(q) || r.artists.join(" ").toLowerCase().includes(q))
    : wants;

  const startPoll = useCallback(() => {
    if (syncPollRef.current) clearInterval(syncPollRef.current);
    syncPollRef.current = setInterval(async () => {
      const s = await api.get<{ running: boolean; message: string }>("/api/vinyl/wantlist/sync/status");
      setSyncMsg(s.message);
      if (!s.running) {
        clearInterval(syncPollRef.current!);
        setSyncing(false);
        queryClient.invalidateQueries({ queryKey: ["wantlist"] });
      }
    }, 1500);
  }, [queryClient]);

  const startSync = async () => {
    setSyncing(true); setSyncMsg("Fetching…");
    await api.post("/api/vinyl/wantlist/sync", {});
    startPoll();
  };

  // On mount: resume tracking if a sync is already running on the backend
  useEffect(() => {
    api.get<{ running: boolean; message: string }>("/api/vinyl/wantlist/sync/status").then(s => {
      if (s.running) { setSyncing(true); setSyncMsg(s.message); startPoll(); }
    }).catch(() => {});
    return () => { if (syncPollRef.current) clearInterval(syncPollRef.current); };
  }, [startPoll]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, padding: "10px 24px 8px", borderBottom: "1px solid #1a1a1a" }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: VINYL_COLOR }}>WANTLIST</span>
        <span style={{ fontSize: 12, color: "#444", letterSpacing: 1 }}>
          {syncing ? `·  ${syncMsg}` : `·  ${filtered.length}${filtered.length !== wants.length ? `/${wants.length}` : ""} records`}
        </span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            style={{ height: 28, borderRadius: 14, background: "#1e1e1e", border: "1px solid #2a2a2a", color: "#ccc", fontSize: 12, padding: "0 12px", outline: "none", width: 160 }}
          />
          <button
            onClick={startSync}
            disabled={syncing}
            style={{ background: syncing ? "#1e1e1e" : VINYL_COLOR, color: syncing ? "#555" : "#1a1000", border: "none", borderRadius: 16, padding: "0 18px", height: 32, fontSize: 12, fontWeight: 700, cursor: syncing ? "default" : "pointer" }}
          >{syncing ? "Syncing…" : "Sync"}</button>
        </div>
      </div>

      {/* Grid + detail */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        <div style={{ flex: 1, overflow: "auto", padding: "16px 24px 24px" }}>
          {wants.length === 0 && !syncing && (
            <div style={{ color: "#444", fontSize: 13, padding: "40px 0" }}>No wantlist data — click Sync to fetch from Discogs.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12 }}>
            {filtered.map(r => (
              <div key={r.release_id} onClick={() => setSelected(r)} style={{ display: "flex", flexDirection: "column", gap: 6, cursor: "pointer" }}>
                <div style={{
                  aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#1a1a1a",
                  outline: selected?.release_id === r.release_id ? `2px solid ${VINYL_COLOR}` : "2px solid transparent",
                }}>
                  {(r.cover_image || r.thumb)
                    ? <img src={r.cover_image || r.thumb} alt={r.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 28 }}>♪</div>
                  }
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.artists[0] ?? ""}{r.year ? ` · ${r.year}` : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
        {selected && <WantDetailPanel item={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

// ─── VinylView ────────────────────────────────────────────────────────────────

export function VinylView() {
  const [view, setView] = useState<"collection" | "wantlist">("collection");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [activeGenres, setActiveGenres] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState<VinylType>(null);
  const [genreOpen, setGenreOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [cols, setCols] = useState(4);
  const [tileWidth, setTileWidth] = useState(160);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const [syncProgress, setSyncProgress] = useState(0);
  const [syncTotal, setSyncTotal] = useState(0);
  const syncPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["vinyl"],
    queryFn: () => api.get<VinylResponse>("/api/vinyl"),
    staleTime: 60_000,
  });

  const startSync = useCallback(() => {
    if (syncRunning) return;
    // Update UI immediately before any network call, same as original
    setSyncRunning(true);
    setSyncMsg("Connecting to Discogs…");
    setSyncProgress(0);
    setSyncTotal(0);

    api.post<{ status: string }>("/api/vinyl/sync", {}).then(() => {
      syncPollRef.current = setInterval(async () => {
        try {
          const s = await api.get<{ running: boolean; message: string; progress: number; total: number }>("/api/vinyl/sync/status");
          setSyncMsg(s.message);
          setSyncProgress(s.progress);
          setSyncTotal(s.total);
          if (!s.running) {
            clearInterval(syncPollRef.current!);
            syncPollRef.current = null;
            setSyncRunning(false);
            queryClient.invalidateQueries({ queryKey: ["vinyl"] });
          }
        } catch { /* network hiccup during poll — keep trying */ }
      }, 2000);
    }).catch(err => {
      setSyncRunning(false);
      setSyncMsg(`Sync failed: ${err}`);
    });
  }, [syncRunning, queryClient]);

  useEffect(() => () => { if (syncPollRef.current) clearInterval(syncPollRef.current); }, []);

  const records = useMemo(() => data?.records ?? [], [data]);
  const allGenres = data?.all_genres ?? [];

  const filtered = useMemo(() => records.filter(r => {
    if (searchOpen && search) {
      const q = search.toLowerCase();
      if (!r.title.toLowerCase().includes(q) && !r.artists.join(", ").toLowerCase().includes(q)) return false;
    }
    if (activeGenres.size > 0 && !(r.genres || []).some(g => activeGenres.has(g))) return false;
    if (typeFilter && r.vinyl_type !== typeFilter) return false;
    return true;
  }), [records, search, searchOpen, activeGenres, typeFilter]);

  const selectedRecord = selectedId != null ? records.find(r => r.release_id === selectedId) ?? null : null;

  // Grid ResizeObserver
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const calc = (w: number) => {
      if (w === 0) return;
      const gap = 12, minTile = 150;
      const c = Math.max(1, Math.floor((w + gap) / (minTile + gap)));
      setCols(c);
      setTileWidth(Math.max(150, Math.floor((w - (c - 1) * gap) / c)));
    };
    const obs = new ResizeObserver(entries => calc(entries[0].contentRect.width));
    obs.observe(el);
    // Fallback: recalc after layout settles in case ResizeObserver fired too early
    const t = setTimeout(() => calc(el.clientWidth), 50);
    return () => { obs.disconnect(); clearTimeout(t); };
  }, [isLoading]);

  // Scroll focused card into view
  useEffect(() => {
    cardRefs.current[focusedIdx]?.scrollIntoView({ block: "nearest" });
  }, [focusedIdx]);

  const cycleType = () => {
    const idx = TYPE_CYCLE.indexOf(typeFilter);
    setTypeFilter(TYPE_CYCLE[(idx + 1) % TYPE_CYCLE.length]);
  };

  // Refs for keyboard handler
  const filteredRef = useRef(filtered);
  const focusedRef = useRef(focusedIdx);
  const colsRef = useRef(cols);
  const genreOpenRef = useRef(genreOpen);
  const searchOpenRef = useRef(searchOpen);
  filteredRef.current = filtered;
  focusedRef.current = focusedIdx;
  colsRef.current = cols;
  genreOpenRef.current = genreOpen;
  searchOpenRef.current = searchOpen;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (genreOpenRef.current) return;

      const list = filteredRef.current;
      const idx = focusedRef.current;
      const c = colsRef.current;

      if (e.key === "/") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.key === "Escape") {
        if (searchOpenRef.current) { setSearchOpen(false); setSearch(""); return; }
        setSelectedId(null);
        return;
      }
      if (e.key === "g") { e.preventDefault(); setGenreOpen(o => !o); return; }
      if (e.key === "t") { e.preventDefault(); cycleType(); return; }

      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIdx(i => {
          const next = i < 0 ? 0 : Math.min(i + c, list.length - 1);
          return next;
        });
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIdx(i => i <= 0 ? 0 : Math.max(0, i - c));
      } else if (e.key === "h" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocusedIdx(i => {
          if (i <= 0) return i < 0 ? 0 : i;
          return i % c === 0 ? i : i - 1;
        });
      } else if (e.key === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocusedIdx(i => {
          const next = i < 0 ? 0 : i + 1;
          if (next >= list.length) return i;
          return next % c === 0 ? i : next;
        });
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = idx < 0 ? 0 : idx;
        const r = list[target];
        if (r) { setFocusedIdx(target); setSelectedId(r.release_id); }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? "#2a1e00" : "#1e1e1e",
    border: active ? `1px solid ${VINYL_COLOR}` : "1px solid #2a2a2a",
    borderRadius: 15, color: active ? VINYL_COLOR : "#777",
    cursor: "pointer", fontSize: 12, padding: "4px 14px", flexShrink: 0,
  });

  if (isLoading) return <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", gap: 6, padding: "10px 24px 8px", flexShrink: 0, borderBottom: "1px solid #1a1a1a" }}>
        {(["collection", "wantlist"] as const).map(v => (
          <button key={v} onClick={() => setView(v)} style={{
            height: 28, padding: "0 16px", borderRadius: 14, fontSize: 12, cursor: "pointer",
            border: view === v ? `1px solid ${VINYL_COLOR}` : "1px solid #2a2a2a",
            background: "transparent", display: "flex", alignItems: "center",
            color: view === v ? VINYL_COLOR : "#666",
            fontWeight: view === v ? 700 : 400,
            textTransform: "capitalize",
          }}>{v}</button>
        ))}
      </div>

      {view === "wantlist" && <WantlistPanel />}
      {view === "collection" && (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        padding: "10px 24px 8px", borderBottom: "1px solid #1a1a1a",
      }}>
        <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 2, color: VINYL_COLOR }}>
          VINYL COLLECTION
        </span>
        <span style={{ fontSize: 12, color: syncRunning ? "#888" : syncMsg.startsWith("Sync failed") ? "#e05555" : "#444", letterSpacing: 1 }}>
          {(syncRunning || syncMsg.startsWith("Sync failed")) ? `·  ${syncMsg}` : `·  ${filtered.length}${filtered.length !== records.length ? `/${records.length}` : ""} records`}
        </span>
        <div style={{ marginLeft: "auto" }}>
          <button
            onClick={startSync}
            disabled={syncRunning}
            style={{
              background: syncRunning ? "#1e1e1e" : VINYL_COLOR,
              color: syncRunning ? "#555" : "#1a1000",
              border: "none", borderRadius: 16, padding: "0 18px", height: 32,
              fontSize: 12, fontWeight: 700, cursor: syncRunning ? "default" : "pointer",
            }}
          >
            {syncRunning ? "Syncing…" : "Sync Collection"}
          </button>
        </div>
      </div>

      {/* Sync progress bar */}
      {syncRunning && (
        <div style={{ height: 3, background: "#1a1a1a", flexShrink: 0 }}>
          <div style={{
            height: "100%",
            background: VINYL_COLOR,
            borderRadius: 2,
            width: syncTotal > 0 ? `${Math.round((syncProgress / syncTotal) * 100)}%` : "100%",
            transition: syncTotal > 0 ? "width 0.4s ease" : "none",
            animation: syncTotal === 0 ? "none" : undefined,
            opacity: syncTotal === 0 ? 0.5 : 1,
          }} />
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 24px", flexShrink: 0 }}>
        <button
          onClick={() => setGenreOpen(o => !o)}
          style={filterBtnStyle(activeGenres.size > 0)}
        >
          Genre{activeGenres.size > 0 ? ` (${activeGenres.size})` : ""} ▾
        </button>
        <button onClick={cycleType} style={filterBtnStyle(typeFilter !== null)}>
          {typeFilter ? TYPE_LABELS[typeFilter] ?? typeFilter : "Format"}
        </button>
        {searchOpen ? (
          <input
            ref={searchRef}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === "Escape") { setSearchOpen(false); setSearch(""); } }}
            placeholder="Filter vinyl…"
            autoFocus
            style={{
              background: "#1e1e1e", border: "1px solid #333", borderRadius: 4,
              color: "#fff", fontSize: 12, padding: "4px 10px", outline: "none", width: 180,
            }}
          />
        ) : (
          <button
            onClick={() => { setSearchOpen(true); setTimeout(() => searchRef.current?.focus(), 0); }}
            style={{ background: "none", border: "none", color: "#444", cursor: "pointer", fontSize: 12, padding: "4px 6px" }}
          >/ search</button>
        )}
        <div style={{ marginLeft: "auto", fontSize: 11, color: "#333" }}>
          g genre  t type  j/k/h/l nav  Enter open
        </div>
      </div>

      {/* Genre palette */}
      {genreOpen && (
        <div style={{ padding: "0 24px 4px", flexShrink: 0 }}>
          <GenrePalette
            genres={allGenres}
            active={activeGenres}
            items={records.map(r => ({ genres: r.genres || [] }))}
            onActiveChange={setActiveGenres}
            onClose={() => setGenreOpen(false)}
          />
        </div>
      )}

      {/* Main: grid + panel */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Grid */}
        <div ref={gridRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 24px 24px" }}>
          {filtered.length === 0 ? (
            <div style={{ color: "#444", fontSize: 13, marginTop: 40, textAlign: "center" }}>No records match the current filters.</div>
          ) : (
            <div style={{
              display: "grid",
              gridTemplateColumns: `repeat(${cols}, ${tileWidth}px)`,
              gap: 12,
              alignContent: "start",
            }}>
              {filtered.map((r, i) => (
                <VinylCard
                  key={r.release_id}
                  record={r}
                  tileWidth={tileWidth}
                  focused={i === focusedIdx}
                  cardRef={el => { cardRefs.current[i] = el; }}
                  onClick={() => { setFocusedIdx(i); setSelectedId(r.release_id); }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selectedRecord && (
          <VinylDetailPanel
            record={selectedRecord}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
      </div>
      )}
    </div>
  );
}
