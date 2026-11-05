import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface RadarItem {
  id: string;
  type: "artist" | "album" | "track";
  name: string;
  sub: string;
  art_path: string | null;
  tag: string;
  spotify_uri: string;
  added_at: string;
  resolved_at: string | null;
  listened_at: string | null;
  open_artist: string | null;
  open_album_id: string | null;
}

interface RadarStats {
  added: number;
  listened: number;
  median_days: number | null;
}

interface RadarResult {
  spotify_id: string;
  type: "artist" | "album" | "track";
  name: string;
  sub: string;
  art_url: string | null;
}

const TAGS: { id: string; label: string; color: string }[] = [
  { id: "friend", label: "Recco", color: "var(--green, #1db954)" },
  { id: "wild",   label: "Spotted", color: "#e8175d" },
];
const TYPES: { id: RadarItem["type"]; label: string }[] = [
  { id: "artist", label: "Artist" },
  { id: "album",  label: "Album" },
  { id: "track",  label: "Song" },
];

function tagMeta(id: string) {
  return TAGS.find(t => t.id === id) ?? { id, label: id, color: "#555" };
}
function typeLabel(id: string) {
  return TYPES.find(t => t.id === id)?.label ?? id;
}
function artUrl(path: string | null | undefined): string | null {
  return path ? `/artwork/${path}` : null;
}
function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function daysBetween(fromIso: string, toIso: string): number {
  return Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
function waitLabel(days: number): string {
  return days <= 0 ? "same day" : days === 1 ? "1 day" : `${days} days`;
}

// ─── Filter chip row ────────────────────────────────────────────────────────

function ChipRow({ options, active, onPick }: {
  options: { id: string; label: string; color?: string }[];
  active: string;
  onPick: (id: string) => void;
}) {
  const chip = (id: string, label: string, color?: string) => (
    <button
      key={id}
      onClick={() => onPick(id)}
      style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0,
        padding: "6px 12px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
        border: `1px solid ${active === id ? "#fff" : "#2a2a2a"}`,
        background: active === id ? "#fff" : "#1a1a1a",
        color: active === id ? "#000" : "#999",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />}
      {label}
    </button>
  );
  return (
    <div style={{ display: "flex", gap: 6, overflowX: "auto", WebkitOverflowScrolling: "touch", paddingBottom: 2 }}>
      {chip("all", "All")}
      {options.map(o => chip(o.id, o.label, o.color))}
    </div>
  );
}

// ─── Card ───────────────────────────────────────────────────────────────────

function RadarTile({ item, onTap }: { item: RadarItem; onTap: (e: React.TouchEvent | React.MouseEvent) => void }) {
  const [imgErr, setImgErr] = useState(false);
  const src = artUrl(item.art_path);
  const t = tagMeta(item.tag);

  return (
    <div onClick={onTap} style={{ cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
      <div style={{ position: "relative", width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#2a2a2a" }}>
        {src && !imgErr
          ? <img src={src} onError={() => setImgErr(true)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15 }}>♪</div>
        }
        <div style={{
          position: "absolute", top: 5, left: 5,
          width: 8, height: 8, borderRadius: "50%", background: t.color,
          boxShadow: "0 0 0 2px rgba(0,0,0,0.5)",
        }} />
        <div style={{
          position: "absolute", top: 5, right: 5,
          background: "rgba(0,0,0,0.72)", borderRadius: 4,
          padding: "1px 5px", fontSize: 8.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
          color: "#aaa",
        }}>
          {typeLabel(item.type)}
        </div>
        {item.listened_at && !item.resolved_at && (
          <div style={{
            position: "absolute", bottom: 5, left: 5,
            background: "rgba(0,0,0,0.72)", borderRadius: 4,
            padding: "1px 5px", fontSize: 8.5, fontWeight: 700,
            color: "var(--green, #1db954)",
          }}>✓ Listened</div>
        )}
      </div>
      <div style={{ marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.name}
        </div>
        <div style={{ fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
          {item.sub}
        </div>
        {item.resolved_at && item.listened_at && (
          <div style={{ fontSize: 9.5, color: "var(--green, #1db954)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {fmtDay(item.listened_at)} · {waitLabel(daysBetween(item.added_at, item.listened_at))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Tile action sheet ──────────────────────────────────────────────────────

const MENU_W = 220;

function TileActionSheet({ item, x, y, onClose, onPlay, onPickTag, onRemove }: {
  item: RadarItem; x: number; y: number;
  onClose: () => void; onPlay: () => void; onPickTag: (tag: string) => void; onRemove: () => void;
}) {
  const MENU_H = 190;
  const left = Math.max(8, Math.min(x - MENU_W / 2, window.innerWidth - MENU_W - 8));
  const top = Math.max(8, Math.min(y - MENU_H / 2, window.innerHeight - MENU_H - 90));

  const row = (icon: string, label: string, onClick: () => void, color = "#fff") => (
    <div
      onClick={() => { onClick(); onClose(); }}
      style={{
        display: "flex", alignItems: "center", gap: 12, padding: "12px 14px",
        borderBottom: "1px solid #2a2a2a",
        cursor: "pointer", WebkitTapHighlightColor: "transparent",
      }}
    >
      <span style={{ fontSize: 16, color, width: 20, textAlign: "center" }}>{icon}</span>
      <span style={{ fontSize: 14, color }}>{label}</span>
    </div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 300, WebkitTapHighlightColor: "transparent" }} />
      <div style={{
        position: "fixed", left, top, width: MENU_W, zIndex: 301,
        background: "#1c1c1e", borderRadius: 14,
        boxShadow: "0 8px 40px rgba(0,0,0,0.7)", overflow: "hidden",
      }}>
        <div style={{
          padding: "10px 14px 8px", borderBottom: "1px solid #2a2a2a",
          fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{item.name}</div>
        {row("▶", "Play in Spotify", onPlay, "var(--green, #1db954)")}
        {TAGS.map(tg => row(
          item.tag === tg.id ? "●" : "○",
          `Tag: ${tg.label}`,
          () => onPickTag(tg.id),
          item.tag === tg.id ? tg.color : "#fff",
        ))}
        <div
          onClick={() => { onRemove(); onClose(); }}
          style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
        >
          {item.listened_at ? <>
            <span style={{ fontSize: 16, color: "var(--green, #1db954)", width: 20, textAlign: "center" }}>✓</span>
            <span style={{ fontSize: 14, color: "var(--green, #1db954)" }}>Clear to Listened</span>
          </> : <>
            <span style={{ fontSize: 16, color: "#e74c3c", width: 20, textAlign: "center" }}>✕</span>
            <span style={{ fontSize: 14, color: "#e74c3c" }}>Remove</span>
          </>}
        </div>
      </div>
    </>
  );
}

// ─── Add sheet ──────────────────────────────────────────────────────────────

function AddSheet({ onClose, onAdded }: { onClose: () => void; onAdded: (name: string, tag: string) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RadarResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [addTag, setAddTag] = useState<string>(TAGS[0].id);
  const inputRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (!query.trim()) return;
    const handle = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.get<{ results: RadarResult[] }>("/api/radar/search", { q: query });
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [query]);

  const addMutation = useMutation({
    mutationFn: (r: RadarResult) => api.post("/api/radar", {
      spotify_id: r.spotify_id, type: r.type, name: r.name, sub: r.sub, art_url: r.art_url, tag: addTag,
    }),
    onSuccess: (_data, r) => {
      setAdded(prev => new Set(prev).add(r.spotify_id + r.type));
      qc.invalidateQueries({ queryKey: ["radar"] });
      onAdded(r.name, addTag);
    },
  });

  const sectionLabel = (label: string) => (
    <div style={{ padding: "10px 0 4px", fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>{label}</div>
  );

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 300 }} />
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        background: "#141414", borderRadius: "16px 16px 0 0",
        padding: "0 16px",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        zIndex: 301, maxHeight: "82vh",
        overflowY: "auto", WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}>
        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14, gap: 16 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Add to Radar</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--green, #1db954)", fontSize: 15, fontWeight: 700, cursor: "pointer", padding: "4px 0" }}
          >Done</button>
        </div>

        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search artist, album, or track…"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          style={{
            width: "100%", boxSizing: "border-box", background: "#1e1e1e", border: "1px solid #333",
            borderRadius: 10, color: "#fff", fontSize: 16, padding: "10px 12px", outline: "none",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
          <span style={{ fontSize: 11.5, color: "#555", fontWeight: 600 }}>Adding as</span>
          {TAGS.map(tg => (
            <button
              key={tg.id}
              onClick={() => setAddTag(tg.id)}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                border: `1px solid ${addTag === tg.id ? tg.color : "#2a2a2a"}`,
                background: addTag === tg.id ? "rgba(255,255,255,0.06)" : "transparent",
                color: addTag === tg.id ? tg.color : "#999",
                WebkitTapHighlightColor: "transparent",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tg.color }} />
              {tg.label}
            </button>
          ))}
        </div>

        {!query.trim() && (
          <div style={{ padding: "24px 0", textAlign: "center", color: "#444", fontSize: 13 }}>Type an artist, album, or track</div>
        )}
        {query.trim() && loading && (
          <div style={{ padding: "24px 0", textAlign: "center", color: "#444", fontSize: 13 }}>Searching…</div>
        )}
        {query.trim() && !loading && results?.length === 0 && (
          <div style={{ padding: "24px 0", textAlign: "center", color: "#444", fontSize: 13, lineHeight: 1.6 }}>
            No matches for "{query}".<br />Check the spelling — try just the last name, or drop "The".
          </div>
        )}
        {query.trim() && !loading && results && results.length > 0 && TYPES.map(({ id: typeId, label: typeLabelPlural }) => {
          const group = results.filter(r => r.type === typeId);
          if (!group.length) return null;
          return (
            <div key={typeId}>
              {sectionLabel(`${typeLabelPlural}s`)}
              {group.map(r => {
                const key = r.spotify_id + r.type;
                const isAdded = added.has(key);
                return (
                  <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
                    <div style={{ width: 40, height: 40, borderRadius: 6, flexShrink: 0, background: "#2a2a2a", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {r.art_url
                        ? <img src={r.art_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                        : <span style={{ color: "#555", fontSize: 16 }}>♪</span>}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                      {r.type !== "artist" && (
                        <div style={{ fontSize: 11.5, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{r.sub}</div>
                      )}
                    </div>
                    <button
                      onClick={() => !isAdded && addMutation.mutate(r)}
                      style={{
                        flexShrink: 0, width: 30, height: 30, borderRadius: "50%",
                        background: isAdded ? "var(--green, #1db954)" : "#2a2a2a",
                        border: `1px solid ${isAdded ? "var(--green, #1db954)" : "#333"}`,
                        color: isAdded ? "#000" : "#999", fontSize: 15,
                        WebkitTapHighlightColor: "transparent",
                      }}
                    >{isAdded ? "✓" : "+"}</button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Main view ──────────────────────────────────────────────────────────────

export function RadarView() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"radar" | "listened">("radar");
  const [activeTag, setActiveTag] = useState("all");
  const [activeType, setActiveType] = useState("all");
  const [addOpen, setAddOpen] = useState(false);
  const [menu, setMenu] = useState<{ item: RadarItem; x: number; y: number } | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);
  const confirmRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { data, isLoading } = useQuery<{ items: RadarItem[]; listened: RadarItem[]; stats: RadarStats }>({
    queryKey: ["radar"],
    queryFn: () => api.get("/api/radar"),
    staleTime: 30_000,
  });
  const items = (mode === "radar" ? data?.items : data?.listened) ?? [];
  const stats = data?.stats;

  const openItem = (item: RadarItem) => {
    if (item.open_album_id) navigate(`/albums/${encodeURIComponent(item.open_album_id)}`);
    else if (item.open_artist) navigate(`/artists/${encodeURIComponent(item.open_artist)}`);
  };

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/radar/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar"] }),
  });
  const tagMutation = useMutation({
    mutationFn: ({ id, tag }: { id: string; tag: string }) => api.put(`/api/radar/${id}`, { tag }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar"] }),
  });

  const showConfirm = (msg: string) => {
    setConfirmMsg(msg);
    clearTimeout(confirmRef.current);
    confirmRef.current = setTimeout(() => setConfirmMsg(null), 2000);
  };

  const filtered = items.filter(i =>
    (activeTag === "all" || i.tag === activeTag) &&
    (activeType === "all" || i.type === activeType)
  );

  const playItem = (item: RadarItem) => { window.location.href = item.spotify_uri; };

  const shuffle = () => {
    if (!filtered.length) { showConfirm("Nothing to play in this filter"); return; }
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    showConfirm(`🎲 Opening "${pick.name}"…`);
    playItem(pick);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        padding: "14px 16px 10px",
        paddingTop: "calc(14px + env(safe-area-inset-top))" as string,
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
            Radar
            {items.length > 0 && <span style={{ fontSize: 13, fontWeight: 400, color: "#444", marginLeft: 8 }}>{items.length}</span>}
          </span>
          <div style={{ flex: 1 }} />
          {mode === "radar" && <button
            onClick={shuffle}
            style={{ background: "none", border: "none", color: "#999", fontSize: 19, cursor: "pointer", padding: "4px 6px", WebkitTapHighlightColor: "transparent" }}
          >🎲</button>}
          <button
            onClick={() => setAddOpen(true)}
            style={{ background: "none", border: "none", color: "var(--green, #1db954)", fontSize: 22, fontWeight: 700, cursor: "pointer", padding: "4px 6px", WebkitTapHighlightColor: "transparent" }}
          >+</button>
        </div>

        <div style={{ display: "flex", gap: 4, borderBottom: "1px solid #1a1a1a", marginBottom: 10 }}>
          {(["radar", "listened"] as const).map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                background: "none", border: "none",
                borderBottom: `2px solid ${mode === m ? "var(--green, #1db954)" : "transparent"}`,
                padding: "6px 14px", marginBottom: -1,
                fontSize: 13, fontWeight: mode === m ? 600 : 400,
                cursor: "pointer", color: mode === m ? "var(--green, #1db954)" : "#555",
                WebkitTapHighlightColor: "transparent",
              }}
            >{m === "radar" ? "On Radar" : "Listened"}</button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ChipRow options={TAGS} active={activeTag} onPick={setActiveTag} />
          <ChipRow options={TYPES} active={activeType} onPick={setActiveType} />
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {mode === "listened" && stats && stats.added > 0 && (
          <div style={{ padding: "12px 14px 0", fontSize: 12.5, color: "#888" }}>
            <b style={{ color: "#fff" }}>{stats.listened} of {stats.added}</b> followed through
            {stats.median_days !== null && <> · {stats.median_days <= 0 ? "usually the same day" : `usually within ${waitLabel(stats.median_days)}`}</>}
          </div>
        )}
        {isLoading && <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>
            {items.length === 0
              ? mode === "listened"
                ? "Nothing here yet. Things you've played show a ✓ on Radar; clear them to file them here."
                : "Nothing on Radar yet. Tap + to search for an artist, album, or track."
              : "Nothing matches this filter."}
          </div>
        )}
        {filtered.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: 10 }}>
            {filtered.map(item => (
              <RadarTile
                key={item.id}
                item={item}
                onTap={e => {
                  if (mode === "listened") { openItem(item); return; }
                  const point = "touches" in e && e.touches.length ? e.touches[0] : (e as React.MouseEvent);
                  setMenu({ item, x: point.clientX, y: point.clientY });
                }}
              />
            ))}
          </div>
        )}
      </div>

      {menu && (
        <TileActionSheet
          item={menu.item} x={menu.x} y={menu.y}
          onClose={() => setMenu(null)}
          onPlay={() => playItem(menu.item)}
          onPickTag={tag => tagMutation.mutate({ id: menu.item.id, tag })}
          onRemove={() => removeMutation.mutate(menu.item.id)}
        />
      )}

      {addOpen && (
        <AddSheet
          onClose={() => setAddOpen(false)}
          onAdded={(name, tag) => showConfirm(`Added "${name}" — tagged "${tagMeta(tag).label}"`)}
        />
      )}

      {confirmMsg && (
        <div style={{
          position: "fixed", bottom: "calc(80px + env(safe-area-inset-bottom))",
          left: "50%", transform: "translateX(-50%)",
          background: "var(--green, #1db954)", color: "#000", fontSize: 13, fontWeight: 600,
          padding: "8px 16px", borderRadius: 20, zIndex: 210,
          whiteSpace: "nowrap", maxWidth: "80vw", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {confirmMsg}
        </div>
      )}
    </div>
  );
}
