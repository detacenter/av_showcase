import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { useTapDismiss } from "../../../hooks/useTapDismiss";
import { HoverTooltip } from "../../../components/HoverTooltip";
import { type DayEntry, type TapHover, RAINBOW_HUES, MONTH_NAMES, monthHeatColor, minutesLabel, daysInMonth } from "./helpers";

// Continuous day-of-year mosaic (no per-month blocks). Hue steps around the color
// wheel per month; brightness within that hue carries the day's minutes. Days
// after today render as near-invisible instead of looking like a logged zero.

const YM_PAD = 6;

// Outline path around a contiguous run of cells [start..end] in a `cols`-wide grid — a
// single "staircase" border (like a multi-line text-selection highlight) instead of
// stroking every cell, since a month's days can wrap across rows. Built in two passes:
// first the polygon that hugs the selected cells exactly (flush, no gap anywhere), then
// every edge of that polygon — including the interior step corners, not just the outer
// top/bottom/left/right — is pushed outward by the same margin so the border keeps a
// uniform gap off the day-blocks at every position, not just some of them.
function monthOutlinePath(start: number, end: number, cols: number, step: number, cell: number, x0: number, y0: number): string {
  const sr = Math.floor(start / cols), sc = start % cols;
  const er = Math.floor(end / cols), ec = end % cols;
  const raw: [number, number][] = sr === er
    ? [
        [sc * step, sr * step],
        [ec * step + cell, sr * step],
        [ec * step + cell, sr * step + cell],
        [sc * step, sr * step + cell],
      ]
    : [
        [sc * step, sr * step],
        [(cols - 1) * step + cell, sr * step],
        [(cols - 1) * step + cell, er * step],
        [ec * step + cell, er * step],
        [ec * step + cell, er * step + cell],
        [0, er * step + cell],
        [0, (sr + 1) * step],
        [sc * step, (sr + 1) * step],
      ];
  const margin = step - cell;
  const n = raw.length;
  const pts = raw.map((p, i) => {
    const prev = raw[(i - 1 + n) % n], next = raw[(i + 1) % n];
    const inLen = Math.abs(p[0] - prev[0]) + Math.abs(p[1] - prev[1]) || 1;
    const outLen = Math.abs(next[0] - p[0]) + Math.abs(next[1] - p[1]) || 1;
    // outward normal of an axis-aligned edge (dx,dy) on this clockwise polygon is (dy,-dx)
    const nx = (p[1] - prev[1]) / inLen + (next[1] - p[1]) / outLen;
    const ny = -(p[0] - prev[0]) / inLen - (next[0] - p[0]) / outLen;
    return [x0 + p[0] + margin * nx, y0 + p[1] + margin * ny];
  });
  return `M${pts.map(p => p.join(",")).join(" L")} Z`;
}

export function YearGrid({ days, year }: { days: DayEntry[]; year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [hover, setHover] = useState<TapHover | null>(null);
  useTapDismiss(ref, () => setHover(null));

  const yearDays = days.filter(d => new Date(d.date + "T00:00:00").getFullYear() === year);
  const byDay = new Map(yearDays.map(d => {
    const dt = new Date(d.date + "T00:00:00");
    return [`${dt.getMonth() + 1}-${dt.getDate()}`, d.minutes];
  }));
  const maxMin = Math.max(...yearDays.map(d => d.minutes), 1);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cells: { mo: number; day: number; date: Date }[] = [];
  const monthRange: Record<number, { start: number; end: number }> = {};
  for (let mo = 1; mo <= 12; mo++) {
    const last = daysInMonth(year, mo);
    const start = cells.length;
    for (let day = 1; day <= last; day++) cells.push({ mo, day, date: new Date(year, mo - 1, day) });
    monthRange[mo] = { start, end: cells.length - 1 };
  }
  const totalDays = cells.length;

  const availW = w - 2 * YM_PAD;
  const availH = h - 2 * YM_PAD;
  let cols = 30, step = 14;
  if (availW > 0 && availH > 0) {
    let bestStep = 0, bestCols = cols;
    for (let c = 10; c <= 53; c++) {
      const rows = Math.ceil(totalDays / c);
      const s = Math.min(availW / c, availH / rows);
      if (s > bestStep) { bestStep = s; bestCols = c; }
    }
    cols = bestCols;
    step = Math.max(6, Math.floor(bestStep));
  }
  const cell = Math.max(1, step - 2);
  const rx = Math.min(4, Math.max(1, Math.floor(cell / 6)));
  const rows = Math.ceil(totalDays / cols);
  const totalW = cols * step, totalH = rows * step;
  const startX = YM_PAD + Math.max(0, Math.floor((availW - totalW) / 2));
  const startY = YM_PAD + Math.max(0, Math.floor((availH - totalH) / 2));
  const fontSize = Math.max(6, Math.min(9, Math.floor(cell * 0.4)));

  // Two passes: decorative cells+labels first, then invisible hit-target rects on
  // top, each sized to the full `step` pitch (not just the visible `cell`) so the
  // tappable area swallows the gap around it instead of leaving a dead strip that's
  // hard to land a finger on. Has to be a separate top layer, not baked into the
  // visible rect's own size, since siblings can't "catch" a click for an element
  // painted over them -- whichever element is topmost at a point is what receives it.
  const els: JSX.Element[] = [];
  const hitEls: JSX.Element[] = [];
  cells.forEach((c, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols);
    const x = startX + col * step, y = startY + row * step;
    const isFuture = c.date > today;
    const mins = byDay.get(`${c.mo}-${c.day}`) ?? 0;
    const fill = isFuture ? "rgba(255,255,255,0.035)" : monthHeatColor(RAINBOW_HUES[c.mo - 1], mins / maxMin);
    const dimmed = selectedMonth !== null && selectedMonth !== c.mo;
    const dateLabel = c.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const sub = isFuture ? "Hasn't happened yet" : minutesLabel(mins);
    const key = `${c.mo}-${c.day}`;
    els.push(
      <rect key={key} x={x} y={y} width={cell} height={cell} rx={rx} ry={rx} fill={fill}
        opacity={dimmed ? 0.16 : 1} />
    );
    hitEls.push(
      <rect key={`hit-${key}`} x={x} y={y} width={step} height={step} fill="transparent"
        onClick={e => { e.stopPropagation(); setHover(hv => hv?.key === key ? null : { x: e.clientX, y: e.clientY, label: dateLabel, sub, key }); }} />
    );
    if (c.day === 1) {
      const moLabel = new Date(year, c.mo - 1, 1).toLocaleString("en-US", { month: "short" });
      els.push(
        <text key={`lbl-${c.mo}`} x={x + cell / 2} y={y + cell / 2 + fontSize * 0.35}
          fill="rgba(255,255,255,0.92)" stroke="rgba(0,0,0,0.55)" strokeWidth={1.5}
          fontSize={fontSize} fontWeight={600} textAnchor="middle" style={{ paintOrder: "stroke" }}
          opacity={dimmed ? 0.35 : 1}>
          {moLabel}
        </text>
      );
    }
  });

  if (selectedMonth !== null) {
    const { start, end } = monthRange[selectedMonth];
    els.push(
      <path key="month-outline" d={monthOutlinePath(start, end, cols, step, cell, startX, startY)}
        fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={1.5} strokeLinejoin="round" />
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
        {w > 0 && h > 0 && (
          <svg width={w} height={h} style={{ display: "block" }} onClick={() => setHover(null)}>
            {els}
            {hitEls}
          </svg>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: "6px 4px 0", flexShrink: 0 }}>
        {MONTH_NAMES.map((name, idx) => {
          const mo = idx + 1;
          const active = selectedMonth === mo;
          return (
            <button key={name} onClick={() => setSelectedMonth(active ? null : mo)}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "2px 4px", borderRadius: 6,
                opacity: selectedMonth !== null && !active ? 0.4 : 1,
                background: "none", border: "none",
              }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: monthHeatColor(RAINBOW_HUES[idx], 0.65), flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: active ? "#fff" : "#888", fontWeight: active ? 700 : 400 }}>{name}</span>
            </button>
          );
        })}
      </div>
      <HoverTooltip hover={hover} />
    </div>
  );
}
