import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { API_BASE } from "../api/config";

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
  { id: "friend", label: "Recco", color: "var(--green)" },
  { id: "wild",   label: "Spotted", color: "var(--pink)" },
];
const TYPES: { id: RadarItem["type"]; label: string }[] = [
  { id: "artist", label: "Artist" },
  { id: "album",  label: "Album" },
  { id: "track",  label: "Song" },
];

function tagMeta(id: string) {
  return TAGS.find(t => t.id === id) ?? { id, label: id, color: "var(--dim)" };
}
function typeLabel(id: string) {
  return TYPES.find(t => t.id === id)?.label ?? id;
}
function artUrl(path: string | null | undefined): string | null {
  return path ? `${API_BASE}/artwork/${path}` : null;
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

function Chip({ active, onClick, color, children }: {
  active: boolean; onClick: () => void; color?: string; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 12px", borderRadius: 999, fontSize: 12, fontWeight: 600,
        border: `1px solid ${active ? "var(--white)" : "var(--border)"}`,
        background: active ? "var(--white)" : "var(--surface)",
        color: active ? "#000" : "var(--gray)",
        whiteSpace: "nowrap",
      }}
    >
      {color && <span style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />}
      {children}
    </button>
  );
}

function TagBadgeColors(color: string) {
  return color === "var(--green)" ? "rgba(30,215,96,0.2)" : color === "var(--pink)" ? "rgba(232,23,93,0.22)" : "rgba(83,83,83,0.3)";
}

function RadarCard({ item, picked, menuOpen, onToggleMenu, onPickTag, onPlay, onRemove, onOpen }: {
  item: RadarItem; picked: boolean; menuOpen: boolean;
  onToggleMenu: () => void; onPickTag: (tag: string) => void;
  onPlay: () => void; onRemove?: () => void; onOpen?: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const src = artUrl(item.art_path);
  const t = tagMeta(item.tag);

  return (
    <div
      onClick={onOpen}
      style={{ display: "flex", flexDirection: "column", gap: 7, position: "relative", cursor: onOpen ? "pointer" : undefined }}
    >
      <div style={{
        position: "relative", borderRadius: 8, overflow: "hidden", background: "#1a1a1a",
        aspectRatio: "1",
        boxShadow: picked ? "0 0 0 3px var(--green), 0 0 24px 4px rgba(30,215,96,0.5)" : "none",
        transition: "box-shadow 0.2s",
      }}>
        {src && !imgErr
          ? <img src={src} onError={() => setImgErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" />
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 28 }}>♪</div>
        }

        <button
          className="radar-tag-badge"
          onClick={e => { e.stopPropagation(); onToggleMenu(); }}
          title="Change tag"
          style={{
            position: "absolute", top: 6, left: 6,
            background: TagBadgeColors(t.color),
            borderRadius: 4, padding: "2px 6px", fontSize: 9, fontWeight: 700,
            color: t.color, backdropFilter: "blur(4px)",
            display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
          }}
        >
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: t.color }} />
          {t.label}
        </button>
        <div style={{
          position: "absolute", top: 6, right: 6,
          background: "rgba(0,0,0,0.72)", borderRadius: 4,
          padding: "2px 6px", fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3,
          color: "var(--gray)", backdropFilter: "blur(4px)",
        }}>
          {typeLabel(item.type)}
        </div>
        {item.listened_at && !item.resolved_at && (
          <div
            title={`First played ${fmtDay(item.listened_at)}`}
            style={{
              position: "absolute", bottom: 6, left: 6,
              background: "rgba(0,0,0,0.72)", borderRadius: 4,
              padding: "2px 6px", fontSize: 9, fontWeight: 700,
              color: "var(--green)", backdropFilter: "blur(4px)",
            }}
          >✓ Listened</div>
        )}

        <div style={{
          position: "absolute", inset: 0, background: "rgba(0,0,0,0.6)",
          opacity: 0, transition: "opacity 0.15s",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
        }}
          onMouseEnter={e => { e.currentTarget.style.opacity = "1"; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = "0"; }}
        >
          <button
            onClick={e => { e.stopPropagation(); onPlay(); }}
            title="Play in Spotify"
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center",
              color: "#000", fontSize: 14, fontWeight: 700,
            }}
          >▶</button>
          {onRemove && <button
            onClick={e => { e.stopPropagation(); onRemove(); }}
            title={item.listened_at ? "Clear (moves to Listened)" : "Remove"}
            style={{
              width: 32, height: 32, borderRadius: "50%",
              background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.2)",
              color: "#aaa", fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(231,76,60,0.4)"; e.currentTarget.style.color = "#fff"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,0.12)"; e.currentTarget.style.color = "#aaa"; }}
          >{item.listened_at ? "✓" : "×"}</button>}
        </div>
      </div>

      {menuOpen && (
        <div className="radar-tag-badge" style={{
          position: "absolute", top: 30, left: 6, zIndex: 10, minWidth: 140,
          background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: 8,
          boxShadow: "0 4px 16px rgba(0,0,0,0.4)", overflow: "hidden",
        }}>
          {TAGS.map(tg => (
            <button
              key={tg.id}
              onClick={e => { e.stopPropagation(); onPickTag(tg.id); }}
              style={{
                display: "flex", alignItems: "center", gap: 7, width: "100%",
                padding: "7px 10px", fontSize: 11.5, fontWeight: 600,
                color: item.tag === tg.id ? "var(--white)" : "var(--gray)",
                background: item.tag === tg.id ? "var(--card)" : "transparent",
                textAlign: "left",
              }}
            >
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: tg.color, flexShrink: 0 }} />
              {tg.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--white)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", lineHeight: 1.3 }}>
          {item.name}
        </div>
        <div style={{ fontSize: 11, color: "var(--dim)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {item.sub}
        </div>
        {item.resolved_at && item.listened_at && (
          <div style={{ fontSize: 10.5, color: "var(--green)", marginTop: 3, whiteSpace: "nowrap" }}>
            Listened {fmtDay(item.listened_at)} · {waitLabel(daysBetween(item.added_at, item.listened_at))}
          </div>
        )}
      </div>
    </div>
  );
}

function AddPanel({ onClose, onAdded }: { onClose: () => void; onAdded: (name: string, tag: string) => void }) {
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

  return (
    <div style={{
      position: "absolute", top: "calc(100% + 10px)", right: 0, width: 380, zIndex: 30,
      background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: 8,
      boxShadow: "0 4px 16px rgba(0,0,0,0.4)", overflow: "hidden",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--dim)" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
        <input
          ref={inputRef}
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === "Escape") onClose(); }}
          placeholder="Search artist, album, or track…"
          style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--white)", fontSize: 13.5 }}
        />
        <span style={{ fontSize: 10, color: "var(--dim)", border: "1px solid var(--border)", borderRadius: 4, padding: "1px 5px" }}>esc</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontSize: 10.5, color: "var(--dim)", fontWeight: 600 }}>Adding as</span>
        {TAGS.map(tg => (
          <button
            key={tg.id}
            onClick={() => setAddTag(tg.id)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "3px 9px", borderRadius: 999, fontSize: 11, fontWeight: 600,
              border: `1px solid ${addTag === tg.id ? tg.color : "var(--border)"}`,
              background: addTag === tg.id ? TagBadgeColors(tg.color) : "transparent",
              color: addTag === tg.id ? tg.color : "var(--gray)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: tg.color }} />
            {tg.label}
          </button>
        ))}
      </div>
      <div style={{ maxHeight: 340, overflowY: "auto" }}>
        {!query.trim() && (
          <div style={{ padding: "8px 12px", fontSize: 10.5, color: "var(--dim)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>
            Type an artist, album, or track
          </div>
        )}
        {query.trim() && loading && (
          <div style={{ padding: "22px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12.5 }}>Searching…</div>
        )}
        {query.trim() && !loading && results && results.length === 0 && (
          <div style={{ padding: "22px 16px", textAlign: "center", color: "var(--dim)", fontSize: 12.5, lineHeight: 1.6 }}>
            No matches for "{query}".<br /><b style={{ color: "var(--gray)" }}>Check the spelling</b> — try just the last name, or drop "The".
          </div>
        )}
        {query.trim() && !loading && results && results.length > 0 && (
          <>
            {TYPES.map(({ id: typeId, label: typeLabelPlural }) => {
              const group = results.filter(r => r.type === typeId);
              if (!group.length) return null;
              return (
                <div key={typeId}>
                  <div style={{ padding: "8px 12px 4px", fontSize: 10.5, color: "var(--dim)", textTransform: "uppercase", letterSpacing: 0.4, fontWeight: 700 }}>
                    {typeLabelPlural}s
                  </div>
                  {group.map(r => {
                    const key = r.spotify_id + r.type;
                    const isAdded = added.has(key);
                    return (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 12px" }}>
                        <div style={{ width: 36, height: 36, borderRadius: 4, flexShrink: 0, background: "var(--card)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                          {r.art_url
                            ? <img src={r.art_url} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" />
                            : <span style={{ color: "var(--dim)", fontSize: 15 }}>♪</span>}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                          {r.type !== "artist" && (
                            <div style={{ fontSize: 11, color: "var(--dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{r.sub}</div>
                          )}
                        </div>
                        <button
                          onClick={() => !isAdded && addMutation.mutate(r)}
                          style={{
                            flexShrink: 0, width: 26, height: 26, borderRadius: "50%",
                            background: isAdded ? "var(--green)" : "var(--card)",
                            border: `1px solid ${isAdded ? "var(--green)" : "var(--border)"}`,
                            color: isAdded ? "#000" : "var(--gray)", fontSize: 14,
                          }}
                        >{isAdded ? "✓" : "+"}</button>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

export function RadarView() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"radar" | "listened">("radar");
  const [activeTag, setActiveTag] = useState<string>("all");
  const [activeType, setActiveType] = useState<string>("all");
  const [searchOpen, setSearchOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [tagMenuFor, setTagMenuFor] = useState<string | null>(null);
  const toastRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const wrapRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery<{ items: RadarItem[]; listened: RadarItem[]; stats: RadarStats }>({
    queryKey: ["radar"],
    queryFn: () => api.get("/api/radar"),
    staleTime: 30_000,
  });
  const items = (mode === "radar" ? data?.items : data?.listened) ?? [];
  const stats = data?.stats;

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.del(`/api/radar/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar"] }),
  });

  const tagMutation = useMutation({
    mutationFn: ({ id, tag }: { id: string; tag: string }) => api.put(`/api/radar/${id}`, { tag }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["radar"] }),
  });

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchOpen && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setSearchOpen(false);
      if (tagMenuFor && !(e.target as HTMLElement).closest(".radar-tag-badge")) setTagMenuFor(null);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, [searchOpen, tagMenuFor]);

  const showToast = (msg: string) => {
    setToast(msg);
    clearTimeout(toastRef.current);
    toastRef.current = setTimeout(() => setToast(null), 2200);
  };

  const filtered = items.filter(i =>
    (activeTag === "all" || i.tag === activeTag) &&
    (activeType === "all" || i.type === activeType)
  );

  const openItem = (item: RadarItem) => {
    if (!item.open_artist) return;
    const album = item.open_album_id ? `?album=${item.open_album_id}` : "";
    navigate(`/artists/${encodeURIComponent(item.open_artist)}${album}`);
  };

  const playItem = (item: RadarItem) => {
    window.location.href = item.spotify_uri;
  };

  const shuffle = () => {
    if (!filtered.length) { showToast("Nothing to play in this filter"); return; }
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    setPicked(pick.id);
    showToast(`🎲 Opening "${pick.name}" in Spotify…`);
    playItem(pick);
    setTimeout(() => setPicked(null), 2200);
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 24px 14px", flexShrink: 0, borderBottom: "1px solid var(--border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 999, background: "var(--surface)", border: "1px solid var(--border)" }}>
            {(["radar", "listened"] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                style={{
                  padding: "4px 12px", borderRadius: 999, fontSize: 12, fontWeight: 700,
                  background: mode === m ? "var(--card)" : "transparent",
                  color: mode === m ? "var(--white)" : "var(--dim)",
                }}
              >{m === "radar" ? "On Radar" : "Listened"}</button>
            ))}
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip active={activeTag === "all"} onClick={() => setActiveTag("all")}>All</Chip>
            {TAGS.map(t => (
              <Chip key={t.id} active={activeTag === t.id} color={t.color} onClick={() => setActiveTag(t.id)}>{t.label}</Chip>
            ))}
          </div>
          <div style={{ width: 1, alignSelf: "stretch", background: "var(--border)" }} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <Chip active={activeType === "all"} onClick={() => setActiveType("all")}>All</Chip>
            {TYPES.map(t => (
              <Chip key={t.id} active={activeType === t.id} onClick={() => setActiveType(t.id)}>{t.label}</Chip>
            ))}
          </div>
          <div style={{ flex: 1 }} />
          {mode === "radar" && <button
            onClick={shuffle}
            style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "var(--green)", color: "#000" }}
          >🎲 Play something</button>}
          <div ref={wrapRef} style={{ position: "relative" }}>
            <button
              onClick={() => setSearchOpen(o => !o)}
              style={{ display: "flex", alignItems: "center", gap: 7, padding: "7px 14px", borderRadius: 999, fontSize: 12.5, fontWeight: 700, background: "var(--card)", color: "var(--white)", border: "1px solid var(--border)" }}
            >+ Add</button>
            {searchOpen && (
              <AddPanel
                onClose={() => setSearchOpen(false)}
                onAdded={(name, tag) => showToast(`Added "${name}" — tagged "${tagMeta(tag).label}"`)}
              />
            )}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px 32px" }}>
        {mode === "listened" && stats && stats.added > 0 && (
          <div style={{ fontSize: 12.5, color: "var(--gray)", marginBottom: 16 }}>
            <b style={{ color: "var(--white)" }}>{stats.listened} of {stats.added}</b> followed through
            {stats.median_days !== null && <> · {stats.median_days <= 0 ? "usually the same day" : `usually within ${waitLabel(stats.median_days)}`}</>}
          </div>
        )}
        {isLoading ? (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: "var(--dim)", fontSize: 13 }}>
            {items.length === 0
              ? mode === "listened"
                ? "Nothing here yet. Things you've played show a ✓ on Radar; clear them to file them here."
                : "Nothing on Radar yet. Hit + Add to search for an artist, album, or track."
              : "Nothing matches this filter."}
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 18 }}>
            {filtered.map(item => (
              <RadarCard
                key={item.id}
                item={item}
                picked={item.id === picked}
                menuOpen={tagMenuFor === item.id}
                onToggleMenu={() => setTagMenuFor(prev => (prev === item.id ? null : item.id))}
                onPickTag={tag => { tagMutation.mutate({ id: item.id, tag }); setTagMenuFor(null); }}
                onPlay={() => playItem(item)}
                onRemove={mode === "radar" ? () => removeMutation.mutate(item.id) : undefined}
                onOpen={mode === "listened" ? () => openItem(item) : undefined}
              />
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)",
          background: "var(--card)", border: "1px solid var(--border)", padding: "9px 16px", borderRadius: 8,
          fontSize: 12.5, boxShadow: "0 8px 24px rgba(0,0,0,0.4)", zIndex: 100,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}
