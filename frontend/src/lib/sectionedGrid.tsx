import { useCallback, useRef, useState, type CSSProperties } from "react";
import { HEADER_H, type Section, type TileSize } from "./sectionedGridLayout";

// The visible pieces of the sectioned grid (see sectionedGridLayout.ts for the layout).

// ─── pieces ───────────────────────────────────────────────────────────────────

export function SectionHeader({ label, count, noun, solid }: { label: string; count: number; noun: string; solid?: boolean }) {
  return (
    <div style={{
      height: HEADER_H, display: "flex", alignItems: "center", gap: 10, boxSizing: "border-box", paddingRight: 8,
      background: solid ? "linear-gradient(#0a0a0a 78%, rgba(10,10,10,0))" : "transparent",
    }}>
      <span style={{ fontSize: label.length <= 2 ? 24 : 19, fontWeight: 900, color: "#fff", lineHeight: 1 }}>{label}</span>
      <span style={{ color: "#8a8a8a", fontSize: 12 }}>{count.toLocaleString("en-US")} {noun}{count === 1 ? "" : "s"}</span>
      <span style={{ flex: 1, height: 1, background: "#222" }} />
    </div>
  );
}

// The rail maps straight onto the scroll range, so a label sits where its section starts and
// big sections get long stretches. Drag (or click) to jump; a bubble names where you'd land.
export function GridScrubber({ sections, secTop, total, scrollTop, viewHeight, onScrollTo, noun }: {
  sections: Section[]; secTop: number[]; total: number; scrollTop: number; viewHeight: number;
  onScrollTo: (top: number) => void; noun: string;
}) {
  const railEl = useRef<HTMLDivElement | null>(null);
  const [railH, setRailH] = useState(0);
  const [drag, setDrag] = useState<number | null>(null);   // scroll position under the pointer while dragging
  // A callback ref: the rail only mounts once the list is long enough, so measure it whenever it does.
  const observer = useRef<ResizeObserver | null>(null);
  const railRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    railEl.current = el;
    if (!el) return;
    const ro = new ResizeObserver(() => setRailH(el.clientHeight));
    ro.observe(el);
    observer.current = ro;
  }, []);
  const maxScroll = Math.max(1, total - viewHeight);
  if (total <= viewHeight * 1.5 || sections.length < 2) return null;

  const yOf = (t: number) => Math.min(1, Math.max(0, t / maxScroll)) * railH;
  const sectionAt = (t: number) => {
    let ans = 0;
    for (let i = 0; i < secTop.length && secTop[i] <= t + 1; i++) ans = i;
    return ans;
  };
  const at = sectionAt(drag ?? scrollTop);
  const pick = (clientY: number) => {
    const r = railEl.current?.getBoundingClientRect();
    if (!r) return;
    const t = Math.min(1, Math.max(0, (clientY - r.top) / r.height)) * maxScroll;
    setDrag(t);
    onScrollTo(t);
  };

  // Rail labels: skip any that would crowd the one above, but always show the current one.
  const labels: { si: number; y: number }[] = [];
  let lastY = -99;
  sections.forEach((s, si) => {
    if (!s.rail) return;
    const y = yOf(secTop[si]);
    if (y - lastY >= 13) { labels.push({ si, y }); lastY = y; }
  });
  const atRailSection = (() => { for (let i = at; i >= 0; i--) if (sections[i].rail) return i; return -1; })();

  return (
    <div
      ref={railRef}
      onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); pick(e.clientY); }}
      onPointerMove={e => { if (drag !== null) pick(e.clientY); }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      style={{ position: "relative", width: 34, flexShrink: 0, margin: "6px 0", cursor: "pointer", userSelect: "none", touchAction: "none" }}
    >
      <span style={{ position: "absolute", right: 2, top: 0, bottom: 0, width: 3, borderRadius: 2, background: "#1f1f1f" }} />
      {labels.map(({ si, y }) => (
        <span key={sections[si].key} style={{
          position: "absolute", right: 9, top: y - 6, fontSize: si === atRailSection ? 10.5 : 9.5, lineHeight: "12px", whiteSpace: "nowrap",
          fontWeight: si === atRailSection ? 900 : 600, color: si === atRailSection ? "#fff" : "#666",
        }}>{sections[si].rail}</span>
      ))}
      <span style={{ position: "absolute", right: 1, top: yOf(drag ?? scrollTop) - 12, width: 5, height: 24, borderRadius: 3, background: "var(--green)" }} />
      {drag !== null && (
        <div style={{
          position: "absolute", right: 40, top: yOf(drag) - 30, zIndex: 5, pointerEvents: "none",
          background: "#262626", border: "1px solid #3a3a3a", borderRadius: 14, padding: "8px 14px", minWidth: 70,
          boxShadow: "0 8px 24px rgba(0,0,0,.6)", display: "flex", flexDirection: "column", alignItems: "center",
        }}>
          <span style={{ fontSize: sections[at].label.length <= 3 ? 28 : 17, fontWeight: 900, color: "#fff", whiteSpace: "nowrap", lineHeight: 1.15 }}>{sections[at].label}</span>
          <span style={{ color: "#8a8a8a", fontSize: 10.5, whiteSpace: "nowrap" }}>{sections[at].count.toLocaleString("en-US")} {noun}{sections[at].count === 1 ? "" : "s"}</span>
        </div>
      )}
    </div>
  );
}

export function SizeSwitch({ size, onChange }: { size: TileSize; onChange: (s: TileSize) => void }) {
  const btn = (k: TileSize): CSSProperties => ({
    padding: "3px 9px", borderRadius: 12, border: "none", fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
    background: k === size ? "#2a2a2a" : "transparent", color: k === size ? "#fff" : "#535353",
  });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }} title="Tile size">
      <span style={{ color: "#535353", fontSize: 12 }}>Size</span>
      <div style={{ display: "flex", gap: 2, border: "1px solid #2a2a2a", borderRadius: 14, padding: 2 }}>
        {(["S", "M", "L"] as TileSize[]).map(k => <button key={k} onClick={() => onChange(k)} style={btn(k)}>{k}</button>)}
      </div>
    </div>
  );
}
