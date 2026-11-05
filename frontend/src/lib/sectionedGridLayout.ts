import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

// A windowed tile grid broken into sections that follow the current sort (letters for A→Z,
// years for Year, months for Recent…), plus the pieces that make a long grid navigable: a
// header that sticks while you're inside a section, a scrubber rail on the right whose labels
// sit where their sections start, and an S/M/L tile-size switch. Albums and Artists share it.

export interface Section {
  key: string;
  label: string;          // header text, and the scrubber bubble while dragging
  start: number;          // index of the section's first item in the sorted list
  count: number;
  rail: string | null;    // label on the scrubber rail, or none (e.g. only one per decade)
  header: boolean;        // draw a header row above the section's tiles
}

// Consecutive runs of the same key become sections. The list must already be sorted so that
// equal keys are adjacent; if they aren't, a key just shows up as two sections.
export function buildSections<T>(
  items: T[],
  keyOf: (item: T) => string,
  describe: (key: string, first: T, prevKey: string | null) => { label: string; rail: string | null; header?: boolean },
): Section[] {
  const out: Section[] = [];
  items.forEach((item, i) => {
    const k = keyOf(item);
    const last = out[out.length - 1];
    if (last && last.key === k) { last.count++; return; }
    const d = describe(k, item, last?.key ?? null);
    out.push({ key: k, label: d.label, rail: d.rail, header: d.header ?? true, start: i, count: 1 });
  });
  return out;
}

// A→Z folding shared by the sort and the letter sections, so a title files under the letter
// you'd look for: accents dropped, leading punctuation and brackets ignored.
export const foldName = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^[^\p{L}\p{N}]+/u, "").toLowerCase();
export const compareFolded = (a: string, b: string) => foldName(a).localeCompare(foldName(b)) || a.localeCompare(b);
export function letterOf(name: string): string {
  const c = foldName(name).charAt(0).toUpperCase();
  if (/[A-Z]/.test(c)) return c;
  if (!c || /[0-9]/.test(c)) return "#";   // numbers, and titles that are only punctuation (they sort first)
  return "•";   // other scripts, which sort after Z
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthKey = (iso: string | null | undefined) => (iso ? iso.slice(0, 7) : "");
export const monthLabel = (key: string) => (key ? `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}` : "Never");

// ─── layout + windowing ───────────────────────────────────────────────────────

type Block =
  | { kind: "header"; top: number; si: number }
  | { kind: "row"; top: number; si: number; start: number; end: number };

export const HEADER_H = 46;

export function useSectionedGrid(opts: {
  containerRef: RefObject<HTMLDivElement | null>;
  sections: Section[];
  cols: number;
  rowHeight: number;
  gap: number;
}) {
  const { containerRef, sections, cols, rowHeight, gap } = opts;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onScroll = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewHeight(el.clientHeight));
    el.addEventListener("scroll", onScroll, { passive: true });
    ro.observe(el);
    return () => { el.removeEventListener("scroll", onScroll); ro.disconnect(); };
  }, [containerRef]);

  const layout = useMemo(() => {
    const blocks: Block[] = [];
    const rows: Extract<Block, { kind: "row" }>[] = [];
    const secTop: number[] = [];
    const c = Math.max(1, cols);
    let y = 0;
    sections.forEach((s, si) => {
      secTop.push(y);
      if (s.header) { blocks.push({ kind: "header", top: y, si }); y += HEADER_H; }
      for (let start = s.start; start < s.start + s.count; start += c) {
        const row = { kind: "row" as const, top: y, si, start, end: Math.min(s.start + s.count, start + c) };
        blocks.push(row); rows.push(row);
        y += rowHeight + gap;
      }
    });
    return { blocks, rows, secTop, total: Math.max(0, y - gap) };
  }, [sections, cols, rowHeight, gap]);

  const firstAtOrAfter = (arr: { top: number }[], y: number) => {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid].top < y) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const pad = 2 * (rowHeight + gap);
  // Clamp like the old hook: a filter can shrink the list before the scroll event reaches us.
  const top = Math.min(scrollTop, Math.max(0, layout.total - viewHeight));
  const from = Math.max(0, firstAtOrAfter(layout.blocks, top - pad) - 1);
  const visible: Block[] = [];
  for (let i = from; i < layout.blocks.length && layout.blocks[i].top <= top + viewHeight + pad; i++) visible.push(layout.blocks[i]);

  // The section the top of the viewport is in.
  const current = (() => {
    let lo = 0, hi = layout.secTop.length - 1, ans = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (layout.secTop[mid] <= top + 1) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  })();

  const rowIndexOf = useCallback((idx: number) => {
    const rows = layout.rows;
    let lo = 0, hi = rows.length - 1, ans = 0;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (rows[mid].start <= idx) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
    return ans;
  }, [layout]);

  const hasHeaders = sections.some(s => s.header);
  const scrollToIndex = useCallback((idx: number) => {
    const el = containerRef.current;
    const row = layout.rows[rowIndexOf(idx)];
    if (!el || idx < 0 || !row) return;
    const cover = hasHeaders ? HEADER_H : 0;   // the sticky header hides the top of the viewport
    if (row.top - cover < el.scrollTop) el.scrollTop = Math.max(0, row.top - cover);
    else if (row.top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.top + rowHeight - el.clientHeight;
  }, [containerRef, layout, rowIndexOf, rowHeight, hasHeaders]);

  // Up/down keep the column where the next row has one; rows end early at section breaks.
  const moveVertical = useCallback((idx: number, dir: 1 | -1) => {
    const ri = rowIndexOf(idx), target = layout.rows[ri + dir];
    if (!target) return idx;
    return Math.min(target.start + (idx - layout.rows[ri].start), target.end - 1);
  }, [layout, rowIndexOf]);
  const sameRow = useCallback((a: number, b: number) => rowIndexOf(a) === rowIndexOf(b), [rowIndexOf]);

  return { ...layout, visible, current, scrollTop: top, viewHeight, scrollToIndex, moveVertical, sameRow };
}

export type TileSize = "S" | "M" | "L";

// Per-viewer convenience, so it lives in localStorage (and falls back to M without it).
export function useTileSize(storageKey: string): [TileSize, (s: TileSize) => void] {
  const [size, setSize] = useState<TileSize>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      return v === "S" || v === "L" ? v : "M";
    } catch { return "M"; }
  });
  const set = useCallback((s: TileSize) => {
    setSize(s);
    try { localStorage.setItem(storageKey, s); } catch { /* storage unavailable: keep it for this session */ }
  }, [storageKey]);
  return [size, set];
}

