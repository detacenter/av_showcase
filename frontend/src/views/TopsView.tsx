import { useState, useCallback, useEffect, useRef } from "react";
import { API_BASE } from "../api/config";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AlbumInfo {
  album_id: string;
  album_name: string;
  artist: string;
  art_url: string | null;
  release_year: number | null;
}

interface EligibleInfo extends AlbumInfo { rating: number; }

interface DecadeData {
  decade: string;
  album_ids: string[];
  albums: Record<string, AlbumInfo>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const artUrl = (url: string | null) =>
  url ? `${API_BASE}${url}` : null;

// ── Shelves page ──────────────────────────────────────────────────────────────

function ShelfCover({ info, rank }: { info: AlbumInfo | null; rank: number }) {
  const url = info ? artUrl(info.art_url) : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
      <div style={{ aspectRatio: "1", width: "100%", borderRadius: 6, overflow: "hidden", background: "#1a1a1a", flexShrink: 0 }}>
        {info
          ? url
            ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 28 }}>♪</div>
          : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#3a3a3a", fontSize: 13, fontWeight: 700 }}>#{rank}</div>
        }
      </div>
      <span style={{ fontSize: 10, color: "#666", textAlign: "center", display: "block" }}>{info ? `#${rank}` : ""}</span>
      <span style={{ fontSize: 9, fontWeight: 650, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{info?.album_name ?? ""}</span>
      <span style={{ fontSize: 9, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "block" }}>{info?.artist ?? ""}</span>
    </div>
  );
}

function DecadeShelf({ data, onEdit, focused, onClick }: {
  data: DecadeData;
  onEdit: (decade: string) => void;
  focused: boolean;
  onClick: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }} onClick={onClick}>
      <button
        onClick={e => { e.stopPropagation(); onEdit(data.decade); }}
        style={{
          background: "transparent", border: "none",
          color: "#fff", fontSize: 20, fontWeight: 800,
          cursor: "pointer", textAlign: "center", padding: 0, alignSelf: "center",
        }}
        onMouseEnter={e => (e.currentTarget.style.color = "#aaa")}
        onMouseLeave={e => (e.currentTarget.style.color = "#fff")}
      >{data.decade}</button>
      <div style={{
        background: "var(--card)", borderRadius: 10, padding: 10,
        boxShadow: focused ? "inset 0 0 0 2px var(--green)" : undefined,
      }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
          {Array.from({ length: 10 }, (_, i) => {
            const albumId = data.album_ids[i] || "";
            const info = albumId ? (data.albums[albumId] ?? null) : null;
            return <ShelfCover key={i} info={info} rank={i + 1} />;
          })}
        </div>
      </div>
    </div>
  );
}

function ShelvesPage({ decades, onEdit }: { decades: DecadeData[]; onEdit: (decade: string) => void }) {
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!decades.length) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        setFocusIdx(i => i === null ? 0 : Math.min(decades.length - 1, i + 1));
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        setFocusIdx(i => i === null ? decades.length - 1 : Math.max(0, i - 1));
      } else if (e.key === "Enter" && focusIdx !== null) {
        onEdit(decades[focusIdx].decade);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [decades, focusIdx, onEdit]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusIdx === null || !containerRef.current) return;
    const shelves = containerRef.current.querySelectorAll("[data-shelf]");
    (shelves[focusIdx] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusIdx]);

  return (
    <div ref={containerRef} style={{ flex: 1, overflow: "auto", paddingBottom: 10 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {decades.map((d, i) => (
          <div key={d.decade} data-shelf>
            <DecadeShelf
              data={d}
              onEdit={onEdit}
              focused={focusIdx === i}
              onClick={() => setFocusIdx(i)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Editor page ───────────────────────────────────────────────────────────────

function EligibleCard({ info, placed, onAdd, focused }: { info: EligibleInfo; placed: boolean; onAdd: (id: string) => void; focused?: boolean }) {
  const url = artUrl(info.art_url);
  return (
    <div
      data-eligible-card
      onClick={() => !placed && onAdd(info.album_id)}
      style={{
        width: 118, height: 130, flexShrink: 0,
        display: "flex", flexDirection: "column",
        padding: 6, gap: 4, cursor: placed ? "default" : "pointer",
        borderRadius: 6, boxSizing: "border-box",
        outline: focused ? "2px solid var(--green)" : "none",
      }}
    >
      <div style={{ width: 82, height: 82, borderRadius: 7, overflow: "hidden", background: "#1a1a1a", margin: "0 auto", flexShrink: 0 }}>
        {url
          ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" />
          : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 24 }}>♪</div>
        }
      </div>
      <span style={{ fontSize: 9, fontWeight: 750, color: placed ? "#555" : "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {info.album_name}
      </span>
      <span style={{ fontSize: 9, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {info.artist} · {info.release_year ?? "?"}
      </span>
    </div>
  );
}

function TopTenSlot({ info, rank, onRemove, dragOver, focused, onDragStart, onDragOver, onDragEnd, onDrop }: {
  info: AlbumInfo | null;
  rank: number;
  onRemove: () => void;
  dragOver: boolean;
  focused?: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
}) {
  const url = info ? artUrl(info.art_url) : null;
  return (
    <div
      draggable={!!info}
      onDragStart={info ? onDragStart : undefined}
      onDragOver={info ? e => { e.preventDefault(); onDragOver(e); } : undefined}
      onDragEnd={info ? onDragEnd : undefined}
      onDrop={info ? e => { e.preventDefault(); onDrop(e); } : undefined}
      onDoubleClick={() => info && onRemove()}
      onContextMenu={e => { e.preventDefault(); info && onRemove(); }}
      style={{
        display: "flex", flexDirection: "column", gap: 2, borderRadius: 6, padding: 2,
        cursor: info ? "grab" : "default",
        background: dragOver ? "#1a2a1a" : "transparent",
        outline: focused ? "2px solid var(--green)" : dragOver ? "2px solid var(--green)" : undefined,
        userSelect: "none",
        minWidth: 0, overflow: "hidden",
      }}
    >
      <div style={{ aspectRatio: "1", width: "100%", overflow: "hidden", borderRadius: 6, background: "#1a1a1a" }}>
        {info
          ? url
            ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} alt="" draggable={false} />
            : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 28 }}>♪</div>
          : <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#3a3a3a", fontSize: 13, fontWeight: 700 }}>#{rank}</div>
        }
      </div>
      <span style={{ fontSize: 10, color: "#666", textAlign: "center" }}>{info ? `#${rank}` : ""}</span>
      <span style={{ fontSize: 9, fontWeight: 650, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info?.album_name ?? ""}</span>
      <span style={{ fontSize: 9, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{info?.artist ?? ""}</span>
    </div>
  );
}

function EditorPage({ decade, topIds, allAlbums, eligibleAlbums, onBack, onSave }: {
  decade: string;
  topIds: string[];
  allAlbums: Record<string, AlbumInfo>;
  eligibleAlbums: EligibleInfo[];
  onBack: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [ids, setIds] = useState<string[]>(topIds);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const dragFromIdx = useRef<number | null>(null);

  const [eligible, setEligible] = useState<EligibleInfo[]>(eligibleAlbums);
  useEffect(() => { setEligible(eligibleAlbums); }, [eligibleAlbums]);

  // Keyboard nav
  const [focusSection, setFocusSection] = useState<"top" | "eligible">("eligible");
  const [focusIdx, setFocusIdx] = useState<number>(0);
  const eligibleScrollRef = useRef<HTMLDivElement>(null);
  const eligibleWrapRef = useRef<HTMLDivElement>(null);
  const TOP_COLS = 5;

  const placed = new Set(ids);

  const save = useCallback(async (newIds: string[]) => {
    setIds(newIds);
    await onSave(newIds);
  }, [onSave]);

  // Drag handlers
  const handleDragStart = (i: number) => { dragFromIdx.current = i; };

  const handleDragOver = (_e: React.DragEvent, targetI: number) => {
    const from = dragFromIdx.current;
    if (from === null || from === targetI || !ids[targetI]) return;
    setDragOverIdx(targetI);
    dragFromIdx.current = targetI;
    setIds(prev => {
      const arr = [...prev];
      const [item] = arr.splice(from, 1);
      arr.splice(targetI, 0, item);
      return arr;
    });
  };

  const handleDragEnd = () => {
    dragFromIdx.current = null;
    setDragOverIdx(null);
    onSave(ids);
  };

  const handleDrop = (_e: React.DragEvent) => {
    dragFromIdx.current = null;
    setDragOverIdx(null);
  };

  const remove = async (i: number) => {
    const removedId = ids[i];
    const newIds = ids.filter((_, idx) => idx !== i);
    await save(newIds);
    // restore removed album to eligible if it's in the full eligible list
    const restoredInfo = allAlbums[removedId] as EligibleInfo | undefined;
    if (restoredInfo && !eligible.find(e => e.album_id === removedId)) {
      // Re-fetch eligible to get accurate rating info
      try {
        const res = await fetch(`${API_BASE}/api/tops/${encodeURIComponent(decade)}/eligible`);
        const data = await res.json();
        setEligible(data.albums);
      } catch { /* silent */ }
    }
  };

  const addEligible = async (albumId: string) => {
    if (ids.length >= 10 || ids.includes(albumId)) return;
    const newIds = [...ids, albumId];
    await save(newIds);
    setEligible(prev => prev.filter(a => a.album_id !== albumId));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!["j", "k", "h", "l", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
             "Enter", "Delete", "Backspace", "Tab", "Escape"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();

      if (e.key === "Escape") { onBack(); return; }

      const eligCount = eligible.length;

      if (e.key === "Tab") {
        if (focusSection === "top") { setFocusSection("eligible"); setFocusIdx(0); }
        else { setFocusSection("top"); setFocusIdx(0); }
        return;
      }

      if (focusSection === "top") {
        const col = focusIdx % TOP_COLS;
        const row = Math.floor(focusIdx / TOP_COLS);

        if (e.key === "ArrowLeft" || e.key === "h") {
          setFocusIdx(Math.max(row * TOP_COLS, focusIdx - 1));
        } else if (e.key === "ArrowRight" || e.key === "l") {
          setFocusIdx(Math.min(row * TOP_COLS + TOP_COLS - 1, focusIdx + 1));
        } else if (e.key === "k" || e.key === "ArrowUp") {
          setFocusIdx(Math.max(0, focusIdx - TOP_COLS));
        } else if (e.key === "j" || e.key === "ArrowDown") {
          const next = focusIdx + TOP_COLS;
          if (next < 10) { setFocusIdx(next); }
          else if (eligCount > 0) { setFocusSection("eligible"); setFocusIdx(Math.min(col, eligCount - 1)); }
        } else if (e.key === "Delete" || e.key === "Backspace") {
          if (ids[focusIdx]) remove(focusIdx);
        }
      } else {
        const cols = Math.max(1, Math.floor((eligibleWrapRef.current?.offsetWidth ?? 600) / 118));

        if (e.key === "ArrowLeft" || e.key === "h") {
          setFocusIdx(Math.max(0, focusIdx - 1));
        } else if (e.key === "ArrowRight" || e.key === "l") {
          setFocusIdx(Math.min(eligCount - 1, focusIdx + 1));
        } else if (e.key === "j" || e.key === "ArrowDown") {
          setFocusIdx(Math.min(eligCount - 1, focusIdx + cols));
        } else if (e.key === "k" || e.key === "ArrowUp") {
          const next = focusIdx - cols;
          if (next >= 0) { setFocusIdx(next); }
          else { setFocusSection("top"); setFocusIdx(TOP_COLS + Math.min(focusIdx % cols, TOP_COLS - 1)); }
        } else if (e.key === "Enter") {
          const item = eligible[focusIdx];
          if (item && !ids.includes(item.album_id)) addEligible(item.album_id);
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [focusSection, focusIdx, ids, eligible, remove, addEligible, onBack]);

  // Scroll focused eligible card into view
  useEffect(() => {
    if (focusSection !== "eligible" || !eligibleScrollRef.current) return;
    const cards = eligibleScrollRef.current.querySelectorAll("[data-eligible-card]");
    (cards[focusIdx] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focusSection, focusIdx]);

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", gap: 8 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button
          onClick={onBack}
          style={{
            width: 30, height: 28, background: "transparent", color: "#888",
            border: "1px solid #303030", borderRadius: 7,
            fontSize: 22, fontWeight: 650, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >‹</button>
        <span style={{ fontSize: 20, fontWeight: 850, color: "#fff" }}>{decade} Top 10</span>
      </div>

      {/* Top 10 */}
      <div style={{ flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#888" }}>TOP 10</span>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: "#444" }}>drag to reorder · double-click or del to remove · j/k navigate · enter to add</span>
        </div>
        <div style={{ background: "var(--surface)", borderRadius: 8, padding: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 4 }}>
            {Array.from({ length: 10 }, (_, i) => {
              const albumId = ids[i];
              const info = albumId ? (allAlbums[albumId] ?? null) : null;
              return (
                <TopTenSlot
                  key={i}
                  info={info}
                  rank={i + 1}
                  onRemove={() => remove(i)}
                  dragOver={dragOverIdx === i}
                  focused={focusSection === "top" && focusIdx === i}
                  onDragStart={() => handleDragStart(i)}
                  onDragOver={e => handleDragOver(e, i)}
                  onDragEnd={handleDragEnd}
                  onDrop={handleDrop}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Eligible favorites */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1, color: "#888", flexShrink: 0 }}>ELIGIBLE FAVORITES</span>
        <div ref={eligibleScrollRef} style={{ flex: 1, overflow: "auto", background: "var(--surface)", borderRadius: 8 }}>
          <div ref={eligibleWrapRef} style={{ display: "flex", flexWrap: "wrap", padding: 4 }}>
            {eligible.map((info, i) => (
              <EligibleCard
                key={info.album_id}
                info={info}
                placed={placed.has(info.album_id)}
                onAdd={addEligible}
                focused={focusSection === "eligible" && focusIdx === i}
              />
            ))}
            {eligible.length === 0 && (
              <span style={{ padding: "16px 12px", color: "#444", fontSize: 12, fontFamily: "monospace" }}>
                No favorited albums in this decade yet.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function TopsView() {
  const [decades, setDecades]           = useState<DecadeData[]>([]);
  const [allAlbums, setAllAlbums]       = useState<Record<string, AlbumInfo>>({});
  const [loading, setLoading]           = useState(true);
  const [editDecade, setEditDecade]     = useState<string | null>(null);
  const [eligibleAlbums, setEligible]   = useState<EligibleInfo[]>([]);

  const loadTops = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tops`);
      const data = await res.json();
      setDecades(data.decades);
      const map: Record<string, AlbumInfo> = {};
      for (const d of data.decades as DecadeData[]) {
        for (const [id, info] of Object.entries(d.albums)) {
          map[id] = info;
        }
      }
      setAllAlbums(map);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadTops(); }, [loadTops]);

  const openEditor = useCallback(async (decade: string) => {
    setEditDecade(decade);
    try {
      const res = await fetch(`${API_BASE}/api/tops/${encodeURIComponent(decade)}/eligible`);
      const data = await res.json();
      const eligible: EligibleInfo[] = data.albums;
      setEligible(eligible);
      setAllAlbums(prev => {
        const updated = { ...prev };
        for (const info of eligible) updated[info.album_id] = info;
        return updated;
      });
    } catch { setEligible([]); }
  }, []);

  const saveDecade = useCallback(async (decade: string, albumIds: string[]) => {
    await fetch(`${API_BASE}/api/tops/${encodeURIComponent(decade)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ album_ids: albumIds }),
    });
    setDecades(prev => prev.map(d =>
      d.decade !== decade ? d : { ...d, album_ids: albumIds }
    ));
  }, []);

  const handleBack = useCallback(() => {
    setEditDecade(null);
    loadTops();
  }, [loadTops]);

  const currentDecade = editDecade ? decades.find(d => d.decade === editDecade) : null;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px 24px 16px", gap: 10 }}>
      {loading ? (
        <span style={{ color: "#444", fontSize: 12 }}>Loading…</span>
      ) : editDecade && currentDecade ? (
        <EditorPage
          decade={editDecade}
          topIds={currentDecade.album_ids}
          allAlbums={allAlbums}
          eligibleAlbums={eligibleAlbums}
          onBack={handleBack}
          onSave={ids => saveDecade(editDecade, ids)}
        />
      ) : (
        <ShelvesPage decades={decades} onEdit={openEditor} />
      )}
    </div>
  );
}
