import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { HoverTooltip } from "../HoverTooltip";
import { type DayEntry, type DayPart, DOW_LABELS, MONTH_NAMES, hexToRgb, minutesLabel } from "./helpers";

const DAY_COLORS: [string, string][] = [
  ["#f87171", "#450a0a"],
  ["#fb923c", "#431407"],
  ["#facc15", "#422006"],
  ["#4ade80", "#052e16"],
  ["#60a5fa", "#0c1a3a"],
  ["#818cf8", "#1e1b4b"],
  ["#c084fc", "#2e1065"],
];

function hexToHue(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(v => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

const DAY_HUES = DAY_COLORS.map(([bright]) => hexToHue(bright));


// ─── DayOfWeekAllTimeGrid ──────────────────────────────────────────────────────
// All Time's version of the box-grid grammar used by DayOfWeekHourGrid (Year) and
// DayOfWeekPartGrid (Month) — same 7-lane, bottom-up-fill, rounded-box look, chosen
// over a from-scratch redesign since the scaling risk that forced Daypart Flow to
// change shape doesn't apply here: this grid's x-axis is always exactly 7 weekday
// lanes, so only the per-lane box COUNT could grow unboundedly with more history —
// and that's already solved by deriving the per-box time unit dynamically (same
// trick DayOfWeekPartGrid borrows from Year) instead of fixing it at 1 hour, so the
// busiest weekday always lands around the same target row count regardless of
// whether history is 4 months or 10 years. Color-recency axis becomes year-of-origin
// instead of month-of-origin.

const ATDW_TARGET_ROWS = 26;

function allTimeDowBreakdown(days: DayEntry[]): { filledMinutesByDow: number[]; minutesByDowYear: Map<string, number>; years: number[] } {
  const filledMinutesByDow = Array(7).fill(0);
  const minutesByDowYear = new Map<string, number>();
  const yearSet = new Set<number>();
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00");
    const dow = dt.getDay(), year = dt.getFullYear();
    filledMinutesByDow[dow] += d.minutes;
    yearSet.add(year);
    const key = `${dow}-${year}`;
    minutesByDowYear.set(key, (minutesByDowYear.get(key) ?? 0) + d.minutes);
  }
  return { filledMinutesByDow, minutesByDowYear, years: [...yearSet].sort((a, b) => a - b) };
}

// Shared by dwgScheme and atdwScheme: both derive saturation/lightness/hue
// from a normalized recency `t`, differing only in the tuned l/h ranges and
// in how each caller computes `t` (month-ratio vs year-index-with-single-
// year-guard) -- kept as separate named callers rather than inlined so
// those two distinct t-computations stay legible at each call site.
function dowRecencyColor(dow: number, t: number, lBase: number, lRange: number, hRange: number): string {
  const s = 55 + t * 30;
  const l = lBase + t * lRange;
  const h = DAY_HUES[dow] + (t - 0.5) * hRange;
  return `hsl(${h} ${s}% ${l}%)`;
}

function atdwScheme(dow: number, yearIdx: number, yearCount: number): string {
  const t = yearCount > 1 ? yearIdx / (yearCount - 1) : 1;
  return dowRecencyColor(dow, t, 26, 46, 28);
}

export function DayOfWeekAllTimeGrid({ days }: { days: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

  const { filledMinutesByDow, minutesByDowYear, years } = allTimeDowBreakdown(days);
  const hoursByDow = filledMinutesByDow.map(m => Math.floor(m / 60));
  const maxHours = Math.max(...hoursByDow, 1);
  // A fixed number of boxes per lane, the busiest weekday filling it; columns per lane
  // are then chosen for the biggest squares this panel allows.
  const capacity = ATDW_TARGET_ROWS * DWG_COLS;
  const unitHours = maxHours / capacity;
  const boxesByDow = hoursByDow.map(h => Math.round(h / unitHours));
  const { cols, rows, step } = W > 0 && H > 0 ? dwgBestLayout(W, H, capacity) : { cols: DWG_COLS, rows: ATDW_TARGET_ROWS, step: 10 };
  const gap = step * 0.2, box = step - gap;
  const laneGap = step * 2.2;
  const rx = Math.max(1, box / 4);
  const { labelFontSize, countFontSize, labelY, countY, padT } = dwgHeaderMetrics(step);
  const padB = Math.max(4, Math.round(step * 0.4));
  const laneW = cols * step - gap;
  const totalW = 7 * laneW + 6 * laneGap;
  const totalH = padT + rows * step - gap + padB;
  const startX = Math.max(0, (W - totalW) / 2);
  const startY = Math.max(0, (H - totalH) / 2);
  const gridBottomY = padT + rows * step - gap;

  const avgBoxes = boxesByDow.reduce((a, b) => a + b, 0) / 7;
  const avgY = gridBottomY - (avgBoxes / cols) * step;

  const els: JSX.Element[] = [
    <line key="avg-line" x1={0} y1={avgY} x2={totalW} y2={avgY} stroke="#3a3a3a" strokeWidth={1} strokeDasharray="4 4" />,
    <text key="avg-lbl" x={totalW} y={avgY - 4} fill="#555" fontSize={Math.max(9, labelFontSize * 0.8)} textAnchor="end">avg</text>,
  ];
  for (let dow = 0; dow < 7; dow++) {
    const lx = dow * (laneW + laneGap);
    const filled = boxesByDow[dow];
    const coreColor = DAY_COLORS[dow][0];
    els.push(
      <text key={`lbl-${dow}`} x={lx + laneW / 2} y={labelY} fill={coreColor} fontSize={labelFontSize} fontWeight={700} textAnchor="middle">{DOW_LABELS[dow]}</text>
    );
    els.push(
      <text key={`n-${dow}`} x={lx + laneW / 2} y={countY} fill={coreColor} fontSize={countFontSize} fontWeight={700} textAnchor="middle">
        {hoursByDow[dow]}<tspan fontSize={countFontSize * 0.5} fontWeight={600} fillOpacity={0.75}> hrs</tspan>
      </text>
    );
    // Cumulative box thresholds per year (oldest first) so each box in the bottom-up
    // fill can be attributed to the year its minutes actually came from.
    let acc = 0;
    const yearRanges = years.map(yr => {
      const yrBoxes = Math.round(((minutesByDowYear.get(`${dow}-${yr}`) ?? 0) / 60) / unitHours);
      const from = acc;
      acc += yrBoxes;
      return { yr, from, to: acc };
    });
    function yearOf(n: number): number {
      for (const r of yearRanges) if (n < r.to) return r.yr;
      return years[years.length - 1] ?? new Date().getFullYear();
    }
    for (let n = 0; n < rows * cols; n++) {
      const row = rows - 1 - Math.floor(n / cols), col = n % cols;
      const x = lx + col * step, y = padT + row * step;
      const isFilled = n < filled;
      const yr = isFilled ? yearOf(n) : -1;
      const yearIdx = years.indexOf(yr);
      const fill = isFilled ? atdwScheme(dow, yearIdx, years.length) : "rgba(255,255,255,0.05)";
      els.push(
        <rect key={`${dow}-${n}`} x={x} y={y} width={box} height={box} rx={rx} fill={fill}
          onMouseEnter={isFilled ? (e => setHover({ x: e.clientX, y: e.clientY, label: `${yr}`, sub: `${DOW_LABELS[dow]} · box ${n + 1} of ${filled} (~${unitHours.toFixed(1)}h/box)` })) : undefined}
          onMouseMove={isFilled ? (e => setHover(hv => hv && { ...hv, x: e.clientX, y: e.clientY })) : undefined}
          onMouseLeave={isFilled ? (() => setHover(null)) : undefined} />
      );
    }
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          <g transform={`translate(${startX},${startY})`}>{els}</g>
        </svg>
      )}
      <HoverTooltip hover={hover} />
    </div>
  );
}

// ─── DayOfWeekHourGrid ────────────────────────────────────────────────────────
// Real-data version of the dropped hour-block demo's Scheme B: 1 box = 1 hour,
// bottom-up fill per weekday, box color drifts in lightness + hue through the
// calendar year by month (no outline/border — that part of the demo was dropped).
// Year-scoped only: a month-of-year color axis doesn't mean anything mixed across
// multiple years, so this only renders for Year mode, using the same currentYear
// scope as YearGrid and the same heatmap_all daily source it reads from.

const DWG_COLS = 7;

// Header text metrics derived from the box step, shared by the fit-solver and the
// render so the reserved header space always matches what's actually drawn there —
// otherwise the grid can grow into (overlap) the day label / hour count above it.
function dwgHeaderMetrics(step: number) {
  const labelFontSize = Math.max(11, Math.round(step * 1.1));
  const countFontSize = Math.max(13, Math.round(step * 1.5));
  const labelY = labelFontSize;
  const countY = labelY + countFontSize + 4;
  const padT = countY + 14;
  return { labelFontSize, countFontSize, labelY, countY, padT };
}

// Solve for the largest per-box "step" (box + gap) that still fits the 7 lanes
// (with proportional gap/lane-gap/label-header) inside the available W×H, so the
// grid grows to fill its card instead of sitting fixed-size with dead space around it.
function dwgBestStep(W: number, H: number, rows: number, cols: number = DWG_COLS): number {
  let best = 6;
  for (let s = 6; s <= 60; s++) {
    const gap = s * 0.2, laneGap = s * 2.2;
    const laneW = cols * s - gap;
    const totalW = 7 * laneW + 6 * laneGap;
    const { padT } = dwgHeaderMetrics(s);
    const padB = Math.max(4, Math.round(s * 0.4));
    const totalH = padT + rows * s - gap + padB;
    if (totalW <= W && totalH <= H) best = s;
  }
  return best;
}

// Columns per lane for a fixed number of boxes: the count that gives the biggest squares
// in this panel, so a wide, short panel gets wide lanes instead of thin towers with empty
// margins on both sides.
function dwgBestLayout(W: number, H: number, boxes: number): { cols: number; rows: number; step: number } {
  let best = { cols: DWG_COLS, rows: Math.ceil(boxes / DWG_COLS), step: 0 };
  for (let cols = 4; cols <= 30; cols++) {
    const rows = Math.ceil(boxes / cols);
    const step = dwgBestStep(W, H, rows, cols);
    if (step > best.step) best = { cols, rows, step };
  }
  return best;
}

function dwgScheme(dow: number, mi: number, lastActiveMonth: number): string {
  const t = Math.min(1, mi / Math.max(1, lastActiveMonth));
  return dowRecencyColor(dow, t, 28, 48, 32);
}

// Shared by DayOfWeekHourGrid and (to borrow its row count as a sizing target)
// DayOfWeekPartGrid — the pace-projected, round-to-50-then-flush-to-7 ceiling.
function yearHourCeiling(days: DayEntry[], year: number): { CEILING: number; filledByDow: number[]; hoursByDowMonth: number[][]; lastActiveMonth: number } {
  const yearDays = days.filter(d => new Date(d.date + "T00:00:00").getFullYear() === year);

  const minutesByDowMonth: number[][] = Array.from({ length: 7 }, () => Array(12).fill(0));
  for (const d of yearDays) {
    const dt = new Date(d.date + "T00:00:00");
    minutesByDowMonth[dt.getDay()][dt.getMonth()] += d.minutes;
  }
  // Whole hours per month that add up to the weekday's rounded total: round the running
  // total, not each month (flooring each month dropped up to an hour per cell, ~35 h a year).
  const hoursByDowMonth = minutesByDowMonth.map(row => {
    let cum = 0, prev = 0;
    return row.map(m => { cum += m; const r = Math.round(cum / 60); const h = r - prev; prev = r; return h; });
  });
  const filledByDow = hoursByDowMonth.map(row => row.reduce((a, b) => a + b, 0));
  let lastActiveMonth = 0;
  hoursByDowMonth.forEach(row => row.forEach((h, mi) => { if (h > 0 && mi > lastActiveMonth) lastActiveMonth = mi; }));

  // One scale for every year: the ceiling is the busiest weekday of any year in the
  // history, so square size never changes between years and bar heights compare across
  // them (flip 2021 to 2024 and the jump is visible).
  const minutesByYearDow = new Map<number, number[]>();
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00");
    const row = minutesByYearDow.get(dt.getFullYear()) ?? Array(7).fill(0);
    row[dt.getDay()] += d.minutes;
    minutesByYearDow.set(dt.getFullYear(), row);
  }
  let busiestEver = Math.max(...filledByDow, 1);
  for (const row of minutesByYearDow.values()) busiestEver = Math.max(busiestEver, ...row.map(m => Math.round(m / 60)));
  // Round up to a full row (multiple of DWG_COLS), so the grey capacity area above the
  // filled bars is itself a complete rectangle, not cut short on its own top row.
  const CEILING = Math.ceil(busiestEver / DWG_COLS) * DWG_COLS;
  return { CEILING, filledByDow, hoursByDowMonth, lastActiveMonth };
}

export function DayOfWeekHourGrid({ days, year }: { days: DayEntry[]; year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

  const { CEILING, filledByDow, hoursByDowMonth, lastActiveMonth } = yearHourCeiling(days, year);

  function monthOf(hoursArr: number[], n: number): number {
    let acc = 0;
    for (let mi = 0; mi < 12; mi++) {
      const h = hoursArr[mi];
      if (n < acc + h) return mi;
      acc += h;
    }
    return lastActiveMonth;
  }

  const { cols, rows, step } = W > 0 && H > 0 ? dwgBestLayout(W, H, CEILING) : { cols: DWG_COLS, rows: Math.ceil(CEILING / DWG_COLS), step: 10 };
  const gap = step * 0.2, box = step - gap;
  const laneGap = step * 2.2;
  const rx = Math.max(1, box / 4);
  const { labelFontSize, countFontSize, labelY, countY, padT } = dwgHeaderMetrics(step);
  const padB = Math.max(4, Math.round(step * 0.4));
  const laneW = cols * step - gap;
  const totalW = 7 * laneW + 6 * laneGap;
  const totalH = padT + rows * step - gap + padB;
  const startX = Math.max(0, (W - totalW) / 2);
  const startY = Math.max(0, (H - totalH) / 2);
  const gridBottomY = padT + rows * step - gap;

  const avgFilled = filledByDow.reduce((a, b) => a + b, 0) / 7;
  const avgY = gridBottomY - (avgFilled / cols) * step;

  const els: JSX.Element[] = [
    <line key="avg-line" x1={0} y1={avgY} x2={totalW} y2={avgY} stroke="#3a3a3a" strokeWidth={1} strokeDasharray="4 4" />,
    <text key="avg-lbl" x={totalW} y={avgY - 4} fill="#555" fontSize={Math.max(9, labelFontSize * 0.8)} textAnchor="end">avg</text>,
  ];
  for (let dow = 0; dow < 7; dow++) {
    const lx = dow * (laneW + laneGap);
    const filled = filledByDow[dow];
    const coreColor = DAY_COLORS[dow][0];
    els.push(
      <text key={`lbl-${dow}`} x={lx + laneW / 2} y={labelY} fill={coreColor} fontSize={labelFontSize} fontWeight={700} textAnchor="middle">{DOW_LABELS[dow]}</text>
    );
    els.push(
      <text key={`n-${dow}`} x={lx + laneW / 2} y={countY} fill={coreColor} fontSize={countFontSize} fontWeight={700} textAnchor="middle">
        {filled}<tspan fontSize={countFontSize * 0.5} fontWeight={600} fillOpacity={0.75}> hrs</tspan>
      </text>
    );
    for (let n = 0; n < rows * cols; n++) {
      const row = rows - 1 - Math.floor(n / cols), col = n % cols;
      const x = lx + col * step, y = padT + row * step;
      const isFilled = n < filled;
      const mi = isFilled ? monthOf(hoursByDowMonth[dow], n) : -1;
      const fill = isFilled ? dwgScheme(dow, mi, lastActiveMonth) : "rgba(255,255,255,0.05)";
      els.push(
        <rect key={`${dow}-${n}`} x={x} y={y} width={box} height={box} rx={rx} fill={fill}
          onMouseEnter={isFilled ? (e => setHover({ x: e.clientX, y: e.clientY, label: `${MONTH_NAMES[mi]} ${year}`, sub: `${DOW_LABELS[dow]} · box ${n + 1} of ${filled}` })) : undefined}
          onMouseMove={isFilled ? (e => setHover(hv => hv && { ...hv, x: e.clientX, y: e.clientY })) : undefined}
          onMouseLeave={isFilled ? (() => setHover(null)) : undefined} />
      );
    }
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          <g transform={`translate(${startX},${startY})`}>{els}</g>
        </svg>
      )}
      <HoverTooltip hover={hover} />
    </div>
  );
}

// ─── DayOfWeekPartGrid ────────────────────────────────────────────────────────
// Same visual grammar as DayOfWeekHourGrid — 7-col grid, bottom-up fill, rounded
// boxes, gradient by chunk-recency, flush grey ceiling, real jagged fill tops — with
// two differences: (a) each box is a slice of time smaller than Year's fixed 1hr,
// sized per-render so the busiest column lands at the SAME row count Year's own grid
// currently has (borrowed via yearHourCeiling, same real data) — not a guessed
// constant, so the two grids render at matching scale even as Year's own ceiling
// drifts day to day; and (b) the color-recency axis is which week of the month a
// box's minutes came from (parts[dow], one entry per real date that weekday
// occurred on) instead of which calendar month.

export function DayOfWeekPartGrid({ minutes, parts, heatmapAll, year }: { minutes: number[]; parts: DayPart[][]; heatmapAll: DayEntry[]; year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

  const targetRows = Math.ceil(yearHourCeiling(heatmapAll, year).CEILING / DWG_COLS);
  const maxMinutes = Math.max(...minutes, 1);
  const partMinutesUnit = Math.max(1, Math.ceil(maxMinutes / (targetRows * DWG_COLS)));

  // parts[dow] is one entry per date that weekday actually occurred on this month
  // (e.g. Monday → "Apr 6", "Apr 13", "Apr 20", "Apr 27"), already in chronological
  // order — the month-mode analog of Year's "which month did this hour come from,"
  // just at weekly granularity. Color drifts by occurrence index (earliest dimmest,
  // most recent brightest), shared across all seven weekdays same as lastActiveMonth.
  const unitsByDowPart = Array.from({ length: 7 }, (_, dow) =>
    (parts[dow] || []).map(p => Math.floor(p.minutes / partMinutesUnit))
  );
  const filledByDow = unitsByDowPart.map(row => row.reduce((a, b) => a + b, 0));
  let lastActivePart = 0;
  unitsByDowPart.forEach(row => row.forEach((u, pi) => { if (u > 0 && pi > lastActivePart) lastActivePart = pi; }));
  // A month has at most ~5 occurrences of a given weekday. Early in the month, only 1-2
  // are real yet — coloring against just those (lastActivePart) stretches the FULL
  // light↔dark range across 2 steps, a harsh jump. Floor the denominator at 3 so early
  // weeks land close together near the dark end, leaving room for later weeks to fill
  // in brighter, instead of maxing out the contrast immediately.
  const colorDenom = Math.max(lastActivePart, 3);

  const currentMax = Math.max(...filledByDow, 1);
  const CEILING = Math.ceil(currentMax / DWG_COLS) * DWG_COLS;

  function partOf(unitsArr: number[], n: number): number {
    let acc = 0;
    for (let pi = 0; pi < unitsArr.length; pi++) {
      const u = unitsArr[pi];
      if (n < acc + u) return pi;
      acc += u;
    }
    return lastActivePart;
  }

  const { cols, rows, step } = W > 0 && H > 0 ? dwgBestLayout(W, H, CEILING) : { cols: DWG_COLS, rows: Math.ceil(CEILING / DWG_COLS), step: 10 };
  const gap = step * 0.2, box = step - gap;
  const laneGap = step * 2.2;
  const rx = Math.max(1, box / 4);
  const { labelFontSize, countFontSize, labelY, countY, padT } = dwgHeaderMetrics(step);
  const padB = Math.max(4, Math.round(step * 0.4));
  const laneW = cols * step - gap;
  const totalW = 7 * laneW + 6 * laneGap;
  const totalH = padT + rows * step - gap + padB;
  const startX = Math.max(0, (W - totalW) / 2);
  const startY = Math.max(0, (H - totalH) / 2);
  const gridBottomY = padT + rows * step - gap;

  const avgFilled = filledByDow.reduce((a, b) => a + b, 0) / 7;
  const avgY = gridBottomY - (avgFilled / cols) * step;

  const els: JSX.Element[] = [
    <line key="avg-line" x1={0} y1={avgY} x2={totalW} y2={avgY} stroke="#3a3a3a" strokeWidth={1} strokeDasharray="4 4" />,
    <text key="avg-lbl" x={totalW} y={avgY - 4} fill="#555" fontSize={Math.max(9, labelFontSize * 0.8)} textAnchor="end">avg</text>,
  ];
  for (let dow = 0; dow < 7; dow++) {
    const lx = dow * (laneW + laneGap);
    const filled = filledByDow[dow];
    const coreColor = DAY_COLORS[dow][0];
    els.push(
      <text key={`lbl-${dow}`} x={lx + laneW / 2} y={labelY} fill={coreColor} fontSize={labelFontSize} fontWeight={700} textAnchor="middle">{DOW_LABELS[dow]}</text>
    );
    els.push(
      <text key={`n-${dow}`} x={lx + laneW / 2} y={countY} fill={coreColor} fontSize={countFontSize} fontWeight={700} textAnchor="middle">
        {minutesLabel(minutes[dow])}
      </text>
    );
    for (let n = 0; n < rows * cols; n++) {
      const row = rows - 1 - Math.floor(n / cols), col = n % cols;
      const x = lx + col * step, y = padT + row * step;
      const isFilled = n < filled;
      const pi = isFilled ? partOf(unitsByDowPart[dow], n) : -1;
      const fill = isFilled ? dwgScheme(dow, pi, colorDenom) : "rgba(255,255,255,0.05)";
      els.push(
        <rect key={`${dow}-${n}`} x={x} y={y} width={box} height={box} rx={rx} fill={fill}
          onMouseEnter={isFilled ? (e => setHover({ x: e.clientX, y: e.clientY, label: parts[dow]?.[pi]?.label ?? DOW_LABELS[dow], sub: `${DOW_LABELS[dow]} · box ${n + 1} of ${filled}` })) : undefined}
          onMouseMove={isFilled ? (e => setHover(hv => hv && { ...hv, x: e.clientX, y: e.clientY })) : undefined}
          onMouseLeave={isFilled ? (() => setHover(null)) : undefined} />
      );
    }
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative" }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          <g transform={`translate(${startX},${startY})`}>{els}</g>
        </svg>
      )}
      <HoverTooltip hover={hover} />
    </div>
  );
}
