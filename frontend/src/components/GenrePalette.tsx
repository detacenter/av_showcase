import { useState, useEffect, useRef, useCallback, useMemo } from "react";

export function computeAdjacent(source: Set<string>, items: { genres: string[] }[]): string[] {
  if (source.size === 0) return [];
  const counts = new Map<string, number>();
  for (const item of items) {
    const ag = new Set(item.genres);
    if (![...source].some(g => ag.has(g))) continue;
    for (const g of ag) {
      if (!source.has(g)) counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
}

type PaneId = "search" | "left" | "right";

export function GenrePalette({
  genres, active, items, onActiveChange, onClose,
}: {
  genres: string[];
  active: Set<string>;
  items: { genres: string[] }[];
  onActiveChange: (g: Set<string>) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [pane, setPane] = useState<PaneId>("search");
  const [lCursor, setLCursor] = useState(0);
  const [rCursor, setRCursor] = useState(0);

  const searchRef = useRef<HTMLInputElement>(null);
  const lItemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rItemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const leftItems = useMemo(() => {
    const result: { id: string; label: string; active: boolean; clear: boolean }[] = [];
    if (active.size > 0) {
      result.push({ id: "__clear__", label: "× clear all", active: false, clear: true });
      for (const g of [...active].sort()) result.push({ id: g, label: `● ${g}`, active: true, clear: false });
    }
    const rest = genres.filter(g => !active.has(g) && (!q || g.toLowerCase().includes(q.toLowerCase())));
    for (const g of rest) result.push({ id: g, label: g, active: false, clear: false });
    return result;
  }, [genres, active, q]);

  const previewGenre = useMemo(() => {
    const it = leftItems[lCursor];
    return it && !it.clear ? it.id : null;
  }, [leftItems, lCursor]);

  const adjacent = useMemo(() => {
    const src = previewGenre ? new Set([previewGenre]) : active;
    return computeAdjacent(src, items);
  }, [previewGenre, active, items]);

  const showRight = adjacent.length >= 2;

  useEffect(() => { setLCursor(0); lItemRefs.current = []; }, [q, active.size]);
  useEffect(() => { setRCursor(0); rItemRefs.current = []; }, [adjacent.length]);
  useEffect(() => { lItemRefs.current[lCursor]?.scrollIntoView({ block: "nearest" }); }, [lCursor]);
  useEffect(() => { rItemRefs.current[rCursor]?.scrollIntoView({ block: "nearest" }); }, [rCursor]);
  useEffect(() => { searchRef.current?.focus(); }, []);

  const toggleItem = useCallback((id: string) => {
    if (id === "__clear__") { onActiveChange(new Set()); return; }
    const next = new Set(active);
    next.has(id) ? next.delete(id) : next.add(id);
    onActiveChange(next);
  }, [active, onActiveChange]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (pane !== "search") { setPane("search"); searchRef.current?.focus(); }
        else onClose();
        e.stopPropagation();
        return;
      }
      if (pane === "search") {
        if (e.key === "ArrowDown" || e.key === "j") { e.preventDefault(); setPane("left"); return; }
        if ((e.key === "ArrowRight" || e.key === "l") && showRight) { e.preventDefault(); setPane("right"); return; }
        if (e.key === "Enter") { e.preventDefault(); if (leftItems[0]) toggleItem(leftItems[0].id); return; }
        return;
      }
      if (pane === "left") {
        if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setLCursor(i => Math.min(i + 1, leftItems.length - 1)); return; }
        if (e.key === "k" || e.key === "ArrowUp") {
          e.preventDefault();
          if (lCursor === 0) { setPane("search"); searchRef.current?.focus(); }
          else setLCursor(i => i - 1);
          return;
        }
        if ((e.key === "l" || e.key === "ArrowRight") && showRight) { e.preventDefault(); setPane("right"); return; }
        if (e.key === "h" || e.key === "ArrowLeft") { e.preventDefault(); setPane("search"); searchRef.current?.focus(); return; }
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (leftItems[lCursor]) toggleItem(leftItems[lCursor].id); return; }
        e.preventDefault();
      }
      if (pane === "right") {
        if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setRCursor(i => Math.min(i + 1, Math.min(adjacent.length, 12) - 1)); return; }
        if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setRCursor(i => Math.max(0, i - 1)); return; }
        if (e.key === "h" || e.key === "ArrowLeft") { e.preventDefault(); setPane("left"); return; }
        if (e.key === "l" || e.key === "ArrowRight") { e.preventDefault(); setPane("left"); return; }
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (adjacent[rCursor]) { toggleItem(adjacent[rCursor]); setPane("left"); }
          return;
        }
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [pane, lCursor, rCursor, leftItems, adjacent, showRight, toggleItem, onClose]);

  const rowStyle = (isActive: boolean, isFocused: boolean, isClear: boolean): React.CSSProperties => ({
    padding: "3px 10px", fontSize: 12, cursor: "pointer",
    color: isClear ? "#535353" : isActive ? "#1ed760" : "#fff",
    background: isFocused && pane === "left" ? "#1e3a1e" : isFocused ? "#1a2a1a" : "transparent",
    whiteSpace: "nowrap",
  });

  const rRowStyle = (isActive: boolean, isFocused: boolean): React.CSSProperties => ({
    padding: "3px 10px", fontSize: 12, cursor: "pointer",
    color: isActive ? "#1ed760" : "#fff",
    background: isFocused && pane === "right" ? "#1e3a1e" : isFocused ? "#1a2a1a" : "transparent",
    whiteSpace: "nowrap",
  });

  return (
    <div style={{ background: "#1a1a1a", border: "1px solid #333", borderRadius: 8, marginBottom: 8 }}>
      {active.size > 0 && (
        <div style={{ padding: "6px 12px 2px", color: "#535353", fontSize: 11 }}>
          {[...active].sort().join("  ·  ")}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 12px 6px" }}>
        <span style={{ color: "#1ed760", fontSize: 13, flexShrink: 0 }}>❯</span>
        <input
          ref={searchRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          onFocus={() => setPane("search")}
          placeholder="filter genres…"
          style={{ flex: 1, background: "transparent", border: "none", color: "#fff", fontSize: 13, outline: "none" }}
        />
      </div>
      <div style={{ height: 1, background: "#333" }} />
      <div style={{ display: "flex", maxHeight: 280 }}>
        <div style={{ flex: 1, overflowY: "auto", minWidth: 0 }}>
          {leftItems.map((item, i) => (
            <div
              key={item.id}
              ref={el => { lItemRefs.current[i] = el; }}
              onClick={() => { toggleItem(item.id); setLCursor(i); }}
              onMouseEnter={() => { setPane("left"); setLCursor(i); }}
              style={rowStyle(item.active, i === lCursor, item.clear)}
            >{item.label}</div>
          ))}
        </div>
        {showRight && (
          <>
            <div style={{ width: 1, background: "#333", flexShrink: 0 }} />
            <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ padding: "5px 10px 2px", color: "#535353", fontSize: 10, flexShrink: 0 }}>adjacent</div>
              <div style={{ flex: 1, overflowY: "auto" }}>
                {adjacent.slice(0, 12).map((g, i) => (
                  <div
                    key={g}
                    ref={el => { rItemRefs.current[i] = el; }}
                    onClick={() => { toggleItem(g); setPane("left"); }}
                    onMouseEnter={() => { setPane("right"); setRCursor(i); }}
                    style={rRowStyle(active.has(g), i === rCursor)}
                  >{active.has(g) ? `● ${g}` : g}</div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
