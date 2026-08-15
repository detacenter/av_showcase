import { useState, useRef, useEffect, useCallback, type JSX } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeMode = "Month" | "Year" | "All Time";

interface DayEntry { date: string; minutes: number; }
interface DayPart  { label: string; minutes: number; }
interface DaypartFlow {
  days: string[];
  hours: number[][];
  minutes: number[][];
  centers: (number | null)[];
  max_hour: number;
}
interface DaypartFlowMonthly {
  months: { year: number; month: number }[];
  hours: number[][];
  minutes: number[][];
}

interface TimePayload {
  mode: string;
  label: string | null;
  has_older: boolean;
  has_newer: boolean;
  heatmap: DayEntry[];
  heatmap_all: DayEntry[];
  minutes_by_dow: number[];
  day_parts: DayPart[][];
  daypart_flow: DaypartFlow;
  daypart_flow_monthly: DaypartFlowMonthly;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYPART_META: [number, number, string, string][] = [
  [0,  5,  "#7f8cff", "Late"],
  [5,  12, "#4ecdc4", "Morning"],
  [12, 17, "#ffd93d", "Day"],
  [17, 22, "#ff8cc8", "Evening"],
  [22, 24, "#a78bfa", "Night"],
];

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const DAY_COLORS: [string, string][] = [
  ["#f87171", "#450a0a"],
  ["#fb923c", "#431407"],
  ["#facc15", "#422006"],
  ["#4ade80", "#052e16"],
  ["#60a5fa", "#0c1a3a"],
  ["#818cf8", "#1e1b4b"],
  ["#c084fc", "#2e1065"],
];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RAINBOW_HUES = Array.from({ length: 12 }, (_, i) => i * 30);
const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function monthHeatColor(hue: number, strength: number, lMax = 62): string {
  if (strength <= 0) return "#1e1e1e";
  const t = Math.pow(strength, 1.4);
  const s0 = 35, l0 = 14, s1 = 78, l1 = lMax;
  const s = s0 + t * (s1 - s0), l = l0 + t * (l1 - l0);
  return `hsl(${hue} ${s}% ${l}%)`;
}

function minutesLabel(m: number): string {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h ${r}m` : `${r}m`;
}

function hourColor(h: number): string {
  for (const [s, e, c] of DAYPART_META) if (h >= s && h < e) return c;
  return "#888";
}

// Same 5 daypart colors as hourColor, but interpolated continuously between each
// daypart's center hour instead of returned as flat blocks — used by DaypartWaffleClock
// so adjacent hours within one daypart (e.g. all of "Day") aren't visually identical.
const DAYPART_GRADIENT_STOPS: [number, string][] = [
  [2.5, "#7f8cff"],   // Late center
  [8.5, "#4ecdc4"],   // Morning center
  [14.5, "#ffd93d"],  // Day center
  [19.5, "#ff8cc8"],  // Evening center
  [23,   "#a78bfa"],  // Night center
  [26.5, "#7f8cff"],  // wrap back to Late
];
function hourColorSmooth(h: number): string {
  let hh = ((h % 24) + 24) % 24;
  if (hh < DAYPART_GRADIENT_STOPS[0][0]) hh += 24;
  let lo = DAYPART_GRADIENT_STOPS[0], hi = DAYPART_GRADIENT_STOPS[DAYPART_GRADIENT_STOPS.length - 1];
  for (let i = 0; i < DAYPART_GRADIENT_STOPS.length - 1; i++) {
    if (hh >= DAYPART_GRADIENT_STOPS[i][0] && hh <= DAYPART_GRADIENT_STOPS[i + 1][0]) {
      lo = DAYPART_GRADIENT_STOPS[i]; hi = DAYPART_GRADIENT_STOPS[i + 1]; break;
    }
  }
  const t = (hh - lo[0]) / ((hi[0] - lo[0]) || 1);
  const [r0, g0, b0] = hexToRgb(lo[1]);
  const [r1, g1, b1] = hexToRgb(hi[1]);
  const r = Math.round(r0 + (r1 - r0) * t), g = Math.round(g0 + (g1 - g0) * t), b = Math.round(b0 + (b1 - b0) * t);
  return `rgb(${r},${g},${b})`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function useSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const e = entries[0];
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

// ─── AllTimeMonthGrid ─────────────────────────────────────────────────────────
// All Time zooms out one level further than Year: the atomic cell is a month, not
// a day, so the grid stays legible (12 cols × 1 row/year) no matter how many years
// of history pile up, instead of a day-mosaic shrinking to unreadable dots.

const ATG_PAD = 8, ATG_ROW_LABEL_W = 40, ATG_GAP = 5, ATG_HEAD_H = 22;

function AllTimeMonthGrid({ days }: { days: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

  if (!days.length) return <div ref={ref} style={{ flex: 1, minHeight: 0 }} />;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const totals = new Map<string, number>();
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00");
    const key = `${dt.getFullYear()}-${dt.getMonth() + 1}`;
    totals.set(key, (totals.get(key) ?? 0) + d.minutes);
  }
  const dts = days.map(d => new Date(d.date + "T00:00:00"));
  const minYear = Math.min(...dts.map(d => d.getFullYear()));
  const maxYear = Math.max(...dts.map(d => d.getFullYear()), today.getFullYear());
  const years: number[] = [];
  for (let y = minYear; y <= maxYear; y++) years.push(y);
  const maxTotal = Math.max(...totals.values(), 1);

  const availW = w - 2 * ATG_PAD - ATG_ROW_LABEL_W;
  const availH = h - 2 * ATG_PAD - ATG_HEAD_H;
  const step = years.length && availW > 0 && availH > 0
    ? Math.max(14, Math.min(46, Math.floor(availW / 12) - ATG_GAP, Math.floor(availH / years.length) - ATG_GAP))
    : 30;
  const cell = step;
  const rowH = cell + ATG_GAP;
  const gridH = years.length * rowH;
  const gridW = 12 * (cell + ATG_GAP) - ATG_GAP;
  const startX = ATG_PAD + ATG_ROW_LABEL_W + Math.max(0, Math.floor((availW - gridW) / 2));
  const startY = ATG_PAD + ATG_HEAD_H + Math.max(0, Math.floor((availH - gridH) / 2));
  const fontSize = Math.max(9, Math.min(14, Math.floor(cell * 0.32)));
  const rx = Math.min(6, cell / 5);

  const els: JSX.Element[] = MONTH_NAMES.map((name, mi) => (
    <text key={`mo-${name}`} x={startX + mi * (cell + ATG_GAP) + cell / 2} y={startY - 8}
      fill="#666" fontSize={10} textAnchor="middle">{name}</text>
  ));

  for (const yr of years) {
    const ri = yr - minYear;
    const y = startY + ri * rowH;
    els.push(
      <text key={`yr-${yr}`} x={ATG_PAD + ATG_ROW_LABEL_W - 10} y={y + cell / 2 + fontSize * 0.35}
        fill="#888" fontSize={12} fontWeight={700} textAnchor="end">{yr}</text>
    );
    for (let mo = 1; mo <= 12; mo++) {
      const x = startX + (mo - 1) * (cell + ATG_GAP);
      const isFuture = new Date(yr, mo - 1, 1) > today;
      if (isFuture) {
        els.push(<rect key={`${yr}-${mo}`} x={x} y={y} width={cell} height={cell} rx={rx} ry={rx} fill="rgba(255,255,255,0.035)" />);
        continue;
      }
      const total = totals.get(`${yr}-${mo}`) ?? 0;
      const fill = monthHeatColor(RAINBOW_HUES[mo - 1], total / maxTotal);
      const label = `${MONTH_NAMES[mo - 1]} ${yr}`;
      const sub = total > 0 ? minutesLabel(total) : "No listening";
      els.push(
        <rect key={`${yr}-${mo}`} x={x} y={y} width={cell} height={cell} rx={rx} ry={rx} fill={fill}
          style={{ cursor: "default" }}
          onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, label, sub })}
          onMouseMove={e => setHover(hv => hv && { ...hv, x: e.clientX, y: e.clientY })}
          onMouseLeave={() => setHover(null)} />
      );
    }
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
        {w > 0 && h > 0 && (
          <svg width={w} height={h} style={{ display: "block" }}>
            {els}
          </svg>
        )}
      </div>
      {hover && (
        <div style={{
          position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
          pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
        </div>
      )}
    </div>
  );
}

// ─── YearGrid ─────────────────────────────────────────────────────────────────
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

function YearGrid({ days, year }: { days: DayEntry[]; year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

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

  const els: JSX.Element[] = [];
  cells.forEach((c, idx) => {
    const col = idx % cols, row = Math.floor(idx / cols);
    const x = startX + col * step, y = startY + row * step;
    const isFuture = c.date > today;
    const mins = byDay.get(`${c.mo}-${c.day}`) ?? 0;
    const fill = isFuture ? "rgba(255,255,255,0.035)" : monthHeatColor(RAINBOW_HUES[c.mo - 1], mins / maxMin);
    const dimmed = selectedMonth !== null && selectedMonth !== c.mo;
    const dateLabel = c.date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const sub = isFuture ? "Hasn't happened yet" : minutesLabel(mins);
    els.push(
      <rect key={`${c.mo}-${c.day}`} x={x} y={y} width={cell} height={cell} rx={rx} ry={rx} fill={fill}
        opacity={dimmed ? 0.16 : 1} style={{ cursor: "default" }}
        onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, label: dateLabel, sub })}
        onMouseMove={e => setHover(hv => hv && { ...hv, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)} />
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
          <svg width={w} height={h} style={{ display: "block" }}>
            {els}
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
              }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: monthHeatColor(RAINBOW_HUES[idx], 0.65), flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: active ? "#fff" : "#888", fontWeight: active ? 700 : 400 }}>{name}</span>
            </button>
          );
        })}
      </div>
      {hover && (
        <div style={{
          position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
          pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
        </div>
      )}
    </div>
  );
}

// ─── MonthHeatmap ─────────────────────────────────────────────────────────────

const MH_LABEL_H = 22, MH_PAD_X = 20, MH_PAD_Y = 16, MH_DOW_H = 20;
const MH_CELL = 42, MH_GAP = 6, MH_STEP = MH_CELL + MH_GAP;

function MonthHeatmap({ days }: { days: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

  if (!days.length) return <div ref={ref} style={{ flex: 1, minHeight: 0 }} />;

  const dt0 = new Date(days[0].date + "T00:00:00");
  const year = dt0.getFullYear(), month = dt0.getMonth() + 1;
  const lastDay = daysInMonth(year, month);
  const dow0 = new Date(year, month - 1, 1).getDay(); // Sun=0, calendar-style header order
  const nRows = Math.ceil((dow0 + lastDay) / 7);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const byDay = new Map(days.map(d => [new Date(d.date + "T00:00:00").getDate(), d.minutes]));
  const maxMin = Math.max(...days.map(d => d.minutes), 1);

  // Fixed, modest cell size — centered in whatever room the card has, rather than
  // stretching to fill it (that read as chunky with a lot of dead space around it).
  const gridW = 7 * MH_STEP - MH_GAP;
  const gridH = nRows * MH_STEP - MH_GAP;
  const availW = w - 2 * MH_PAD_X, availH = h - 2 * MH_PAD_Y - MH_LABEL_H - MH_DOW_H;
  const bx = MH_PAD_X + Math.max(0, Math.floor((availW - gridW) / 2));
  const by = MH_PAD_Y + Math.max(0, Math.floor((availH - gridH) / 2));
  const dowY = by + MH_LABEL_H;
  const gridY = dowY + MH_DOW_H;
  const hue = RAINBOW_HUES[month - 1];

  const moName = dt0.toLocaleString("en-US", { month: "long", year: "numeric" });
  const els: JSX.Element[] = [
    <text key="lbl" x={bx} y={by + 14} fill="#666" fontSize={12} fontWeight={700}>{moName}</text>,
    ...DOW_LABELS.map((lbl, i) => (
      <text key={`dow-${lbl}`} x={bx + i * MH_STEP + MH_CELL / 2} y={dowY + 12}
        fill="#555" fontSize={10} textAnchor="middle">{lbl}</text>
    )),
  ];
  for (let day = 1; day <= lastDay; day++) {
    const slot = dow0 + day - 1;
    const cx = bx + (slot % 7) * MH_STEP;
    const cy = gridY + Math.floor(slot / 7) * MH_STEP;
    const date = new Date(year, month - 1, day);
    const isFuture = date > today;
    const isToday = date.getTime() === today.getTime();
    const mins = byDay.get(day) ?? 0;
    const fill = isFuture ? "rgba(255,255,255,0.035)" : monthHeatColor(hue, mins / maxMin, 50);
    const dateLabel = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const sub = isFuture ? "Hasn't happened yet" : minutesLabel(mins);
    els.push(
      <rect key={day} x={cx} y={cy} width={MH_CELL} height={MH_CELL} rx={8} ry={8} fill={fill}
        stroke={isToday ? "rgba(255,255,255,0.8)" : "none"} strokeWidth={isToday ? 1.5 : 0}
        onMouseEnter={e => setHover({ x: e.clientX, y: e.clientY, label: dateLabel, sub })}
        onMouseMove={e => setHover(hv => hv && { ...hv, x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setHover(null)} />
    );
    els.push(
      <text key={`n-${day}`} x={cx + 7} y={cy + 16} fill={isFuture ? "#444" : "rgba(255,255,255,0.75)"}
        fontSize={10} fontWeight={600} style={{ pointerEvents: "none" }}>{day}</text>
    );
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} style={{ display: "block" }}>
          {els}
        </svg>
      )}
      {hover && (
        <div style={{
          position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
          pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
        </div>
      )}
    </div>
  );
}

// ─── DaypartClock ─────────────────────────────────────────────────────────────

function DaypartFlowModal({ data, onClose }: { data: DaypartFlow; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const { w: chartW, h: chartH } = useSize(chartRef);

  const { days, hours, max_hour: maxHour } = data;
  const n = days.length;

  const PAD_L = 74, PAD_R = 8, PAD_T = 18, PAD_B = 28;

  const pw = chartW - PAD_L - PAD_R;
  const ph = chartH - PAD_T - PAD_B;
  const cellW = Math.max(2, pw / Math.max(n, 1));

  const xOf = (i: number) => PAD_L + pw * i / Math.max(n, 1);
  const yBound = (h: number) => PAD_T + ph * h / 24;
  const yCenter = (h: number) => PAD_T + ph * (h + 0.5) / 24;

  const gridEls: JSX.Element[] = [];

  // Daypart background bands
  for (const [s, e, col] of DAYPART_META) {
    const y1 = yBound(s), y2 = yBound(e);
    gridEls.push(
      <rect key={`band-${s}`} x={PAD_L} y={y1} width={pw} height={Math.max(2, y2 - y1)}
        fill={col} fillOpacity={0.055} />
    );
    gridEls.push(
      <text key={`band-lbl-${s}`} x={40} y={(y1 + y2) / 2 + 4} fill={col} fontSize={9}
        fontWeight={700} textAnchor="end">{DAYPART_META.find(m => m[0] === s)?.[3]}</text>
    );
  }

  // Hour markers
  for (const hMark of [0, 6, 12, 18, 23]) {
    const y = yBound(hMark);
    gridEls.push(<line key={`hline-${hMark}`} x1={PAD_L} y1={y} x2={PAD_L + pw} y2={y} stroke="#1e1e1e" strokeWidth={1} />);
    gridEls.push(
      <text key={`hlbl-${hMark}`} x={44} y={yCenter(hMark) + 4} fill="#666" fontSize={9} textAnchor="end">
        {String(hMark).padStart(2, "0")}
      </text>
    );
  }

  // Cells — square dot sized by magnitude (not a full-width alpha-only rect), colored by
  // the same smooth per-hour gradient the Daypart Clock uses, with each day's single
  // busiest hour ringed. Previous version: fixed-width/full-row-height rects at fixed
  // opacity `Math.round(38 + 212 * Math.min(1, Math.log1p(count) / Math.log1p(maxHour||1))) / 255`
  // colored by the flat 5-daypart hourColor(h) — revert to that if this doesn't land.
  const maxCount = Math.max(maxHour || 1, 1);
  // Row height (ph/24) stays roughly constant regardless of how many days are in view;
  // column width (cellW) doesn't — it's ~3px across a full year but ~35px across a
  // month. Sizing dots off cellW alone let Month-view dots balloon past the row height
  // and bleed into neighboring hours. Capping by row height keeps dots proportionate at
  // any zoom level; cellW is still an upper bound so Year view's narrow columns don't
  // let dots overlap horizontally either.
  const rowH = ph / 24;
  for (let i = 0; i < hours.length; i++) {
    const row = hours[i];
    const x = PAD_L + (i + 0.5) * cellW;
    let peakH = -1, peakCount = 0;
    for (let h = 0; h < 24; h++) if (row[h] > peakCount) { peakCount = row[h]; peakH = h; }
    for (let h = 0; h < 24; h++) {
      const count = row[h];
      if (count <= 0) continue;
      const s = Math.max(1.6, Math.min(cellW - 1, rowH * 0.9, 1.6 + Math.sqrt(count / maxCount) * (rowH * 0.85)));
      const cy = yCenter(h);
      gridEls.push(
        <rect key={`cell-${i}-${h}`}
          x={x - s / 2} y={cy - s / 2} width={s} height={s}
          rx={s * 0.28} ry={s * 0.28}
          fill={hourColorSmooth(h)} fillOpacity={0.88} />
      );
      if (h === peakH) {
        const ringS = s + 4;
        gridEls.push(
          <rect key={`peak-${i}-${h}`}
            x={x - ringS / 2} y={cy - ringS / 2} width={ringS} height={ringS}
            rx={ringS * 0.28} ry={ringS * 0.28}
            fill="none" stroke="#fff" strokeWidth={1} strokeOpacity={0.8} />
        );
      }
    }
  }

  // Center-of-gravity spline dropped — the peak-hour ring on each day's busiest cell
  // already answers the same question, and the two together read as one more line than
  // needed. Revert by pulling `centers` back into the destructure above and restoring
  // this block (still in the daypart-flow-alternatives.html artifact if needed verbatim).

  // Month labels along x axis
  const seenYM = new Set<string>();
  for (let i = 0; i < days.length; i++) {
    const dt = new Date(days[i] + "T00:00:00");
    const ym = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (seenYM.has(ym)) continue;
    seenYM.add(ym);
    const moLabel = dt.toLocaleString("en-US", { month: "short" });
    gridEls.push(
      <text key={`mlbl-${i}`} x={xOf(i)} y={chartH - PAD_B + 14} fill="#666" fontSize={10} textAnchor="middle">{moLabel}</text>
    );
  }

  return (
    <div ref={overlayRef} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => { if (e.target === overlayRef.current) onClose(); }}>
      <div style={{
        background: "#181818", borderRadius: 18, padding: "16px 18px 18px",
        display: "flex", flexDirection: "column", gap: 10,
        width: Math.min(1220, Math.max(820, window.innerWidth - 64)),
        maxHeight: "90vh",
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ flex: 1, color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>DAYPART FLOW</span>
          <button onClick={onClose} style={{
            width: 22, height: 22, borderRadius: "50%", background: "#242424",
            border: "none", color: "#666", fontSize: 10, fontWeight: 800, cursor: "pointer",
          }}>X</button>
        </div>
        <div style={{
          background: "#101010", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
          padding: 6,
        }}>
          <div ref={chartRef} style={{ height: Math.min(390, Math.max(330, window.innerHeight - 260)) }}>
            {chartW > 0 && chartH > 0 && (
              <svg width={chartW} height={chartH} style={{ display: "block" }}>
                {gridEls}
              </svg>
            )}
          </div>
        </div>
        <div style={{ color: "#666", fontSize: 10, fontWeight: 700 }}>
          hour × day grid · white line tracks center of gravity
        </div>
      </div>
    </div>
  );
}

// ─── DaypartFlowMonthlyModal (All Time) ────────────────────────────────────────
// Day-level granularity doesn't scale across years any more than the calendar
// heatmap did, so All Time gets its own version of this modal, rebucketed to
// month × hour instead of day × hour — same trick as AllTimeMonthGrid. Each column
// is one calendar month (all years, oldest to newest); brightness = that hour's
// share of the month's listening, so the peak hour is still the brightest cell but
// the full spread/drift is visible too, not just a single point.
function DaypartFlowMonthlyModal({ data, onClose }: { data: DaypartFlowMonthly; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const { w: chartW, h: chartH } = useSize(chartRef);

  const { months, minutes } = data;
  const n = months.length;

  const PAD_L = 74, PAD_R = 8, PAD_T = 18, PAD_B = 28;
  const pw = chartW - PAD_L - PAD_R;
  const ph = chartH - PAD_T - PAD_B;
  const cellW = Math.max(2, pw / Math.max(n, 1));

  const xOf = (i: number) => PAD_L + pw * i / Math.max(n, 1);
  const yBound = (h: number) => PAD_T + ph * h / 24;
  const yCenter = (h: number) => PAD_T + ph * (h + 0.5) / 24;

  const gridEls: JSX.Element[] = [];

  for (const [s, e, col] of DAYPART_META) {
    const y1 = yBound(s), y2 = yBound(e);
    gridEls.push(
      <rect key={`band-${s}`} x={PAD_L} y={y1} width={pw} height={Math.max(2, y2 - y1)} fill={col} fillOpacity={0.055} />
    );
    gridEls.push(
      <text key={`band-lbl-${s}`} x={40} y={(y1 + y2) / 2 + 4} fill={col} fontSize={9} fontWeight={700} textAnchor="end">{DAYPART_META.find(m => m[0] === s)?.[3]}</text>
    );
  }

  for (const hMark of [0, 6, 12, 18, 23]) {
    const y = yBound(hMark);
    gridEls.push(<line key={`hline-${hMark}`} x1={PAD_L} y1={y} x2={PAD_L + pw} y2={y} stroke="#1e1e1e" strokeWidth={1} />);
    gridEls.push(
      <text key={`hlbl-${hMark}`} x={44} y={yCenter(hMark) + 4} fill="#666" fontSize={9} textAnchor="end">
        {String(hMark).padStart(2, "0")}
      </text>
    );
  }

  for (let i = 0; i < minutes.length; i++) {
    const row = minutes[i];
    const total = row.reduce((a, b) => a + b, 0) || 1;
    const x = xOf(i);
    const rowH = ph / 24;
    for (let h = 0; h < 24; h++) {
      const share = row[h] / total;
      if (share <= 0) continue;
      const y = yBound(h);
      const alpha = Math.min(1, 0.06 + share * 9);
      gridEls.push(
        <rect key={`cell-${i}-${h}`} x={x} y={y} width={Math.max(1, cellW - 0.5)} height={rowH}
          fill={hourColorSmooth(h)} fillOpacity={alpha} />
      );
    }
  }

  // Year labels along x axis, once per January (or the first column if history starts mid-year)
  const seenYear = new Set<number>();
  for (let i = 0; i < months.length; i++) {
    const { year, month } = months[i];
    if (month !== 1 && i !== 0) continue;
    if (seenYear.has(year)) continue;
    seenYear.add(year);
    gridEls.push(
      <text key={`ylbl-${i}`} x={xOf(i) + cellW / 2} y={chartH - PAD_B + 14} fill="#666" fontSize={10} textAnchor="middle">{year}</text>
    );
  }

  return (
    <div ref={overlayRef} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={e => { if (e.target === overlayRef.current) onClose(); }}>
      <div style={{
        background: "#181818", borderRadius: 18, padding: "16px 18px 18px",
        display: "flex", flexDirection: "column", gap: 10,
        width: Math.min(1220, Math.max(820, window.innerWidth - 64)),
        maxHeight: "90vh",
      }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ flex: 1, color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>DAYPART FLOW · ALL TIME</span>
          <button onClick={onClose} style={{
            width: 22, height: 22, borderRadius: "50%", background: "#242424",
            border: "none", color: "#666", fontSize: 10, fontWeight: 800, cursor: "pointer",
          }}>X</button>
        </div>
        <div style={{
          background: "#101010", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16,
          padding: 6,
        }}>
          <div ref={chartRef} style={{ height: Math.min(390, Math.max(330, window.innerHeight - 260)) }}>
            {chartW > 0 && chartH > 0 && (
              <svg width={chartW} height={chartH} style={{ display: "block" }}>
                {gridEls}
              </svg>
            )}
          </div>
        </div>
        <div style={{ color: "#666", fontSize: 10, fontWeight: 700 }}>
          hour × month grid, full history · brightness = share of that month's listening
        </div>
      </div>
    </div>
  );
}

// Kept for reversibility — see the call site's comment for how to swap back to this.
export function DaypartClock({ data, onCenterClick }: { data: DaypartFlow; onCenterClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [centerHovered, setCenterHovered] = useState(false);

  const totals = Array(24).fill(0);
  for (const row of data.hours) row.forEach((c, h) => { totals[h] += c; });
  const maxTotal = Math.max(...totals, 1);
  const peakH = totals.indexOf(Math.max(...totals));
  const grandTotal = totals.reduce((a, b) => a + b, 0) || 1;

  const INFO_H = 44;
  const rMax = Math.max(42, Math.min(W / 2 - 24, H - INFO_H - 4 - 44));
  const rMin = rMax * 0.34;
  const yBar = H - INFO_H;
  const cy = Math.max(rMax + 38, (yBar + rMax + 24) / 2);
  const cx = W / 2;

  const toRad = (deg: number) => deg * Math.PI / 180;

  function arcPath(qtStart: number, r: number): string {
    const qtEnd = qtStart - 6;
    const ix1 = cx + rMin * Math.cos(toRad(qtStart));
    const iy1 = cy - rMin * Math.sin(toRad(qtStart));
    const ox1 = cx + r * Math.cos(toRad(qtStart));
    const oy1 = cy - r * Math.sin(toRad(qtStart));
    const ix2 = cx + rMin * Math.cos(toRad(qtEnd));
    const iy2 = cy - rMin * Math.sin(toRad(qtEnd));
    const ox2 = cx + r * Math.cos(toRad(qtEnd));
    const oy2 = cy - r * Math.sin(toRad(qtEnd));
    // Qt sweep=-6 is clockwise on screen → SVG sweep-flag=1 (CW) for outer, 0 (CCW) for inner return
    return `M ${ix1} ${iy1} L ${ox1} ${oy1} A ${r} ${r} 0 0 1 ${ox2} ${oy2} L ${ix2} ${iy2} A ${rMin} ${rMin} 0 0 0 ${ix1} ${iy1} Z`;
  }

  function labelPos(qtAngle: number, radius: number): [number, number] {
    return [cx + radius * Math.cos(toRad(qtAngle)), cy - radius * Math.sin(toRad(qtAngle))];
  }

  function getHourAt(mx: number, my: number): number | null {
    // approximate hit test by checking which hour's wedge the cursor is in
    const dx = mx - cx, dy = -(my - cy);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < rMin * 0.9 || dist > rMax * 1.1) return null;
    const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    // Map angle back to hour: qt_start = 90 + (18 - h_adj) * 7.5 → h_adj = 18 - (qt_start - 90) / 7.5
    const hAdj = 18 - (angle - 90) / 7.5;
    const h = Math.round(hAdj < 18 ? hAdj + 24 : hAdj) % 24;
    return h;
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const dx = mx - cx, dy = my - cy;
    const isCenter = Math.sqrt(dx * dx + dy * dy) < 18;
    setCenterHovered(isCenter);
    if (!isCenter) {
      const h = getHourAt(mx, my);
      setHoveredHour(h !== null && totals[h] > 0 ? h : null);
    } else {
      setHoveredHour(null);
    }
  }

  function handleMouseLeave() {
    setHoveredHour(null);
    setCenterHovered(false);
  }

  function fmtHour(h: number): string {
    const fmt = (x: number) => {
      x = ((x % 24) + 24) % 24;
      if (x === 0) return "12am";
      if (x === 12) return "12pm";
      return x < 12 ? `${x}am` : `${x - 12}pm`;
    };
    return `${fmt(h)} – ${fmt(h + 1)}`;
  }

  const arcs: JSX.Element[] = [];
  for (let h = 0; h < 24; h++) {
    const frac = totals[h] / maxTotal;
    if (frac === 0) continue;
    const hAdj = h >= 6 ? h : h + 24;
    const qtStart = 90 + (18 - hAdj) * 7.5;
    const r = rMin + (rMax - rMin) * frac;
    const col = hourColor(h);
    const isHov = h === hoveredHour;
    const opacity = isHov ? 1 : (55 + 190 * frac) / 255;
    arcs.push(
      <path key={h} d={arcPath(qtStart, r)} fill={col} fillOpacity={opacity}
        stroke={isHov ? "rgba(255,255,255,0.8)" : "none"} strokeWidth={0.8} />
    );
  }

  const lp6p  = labelPos(90,  rMax + 14);
  const lp12p = labelPos(135, rMax + 14);
  const lp12a = labelPos(45,  rMax + 14);

  // Daypart pill layout
  const dotD = 8, pillW = 46, pillH = 20, pillGap = 10;
  const nPills = DAYPART_META.length;
  const pillsTotal = nPills * pillW + (nPills - 1) * pillGap;
  const xPills = (W + 96) / 2 - pillsTotal / 2;

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block", cursor: centerHovered ? "pointer" : "default" }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
          onClick={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const dx = e.clientX - rect.left - cx, dy = e.clientY - rect.top - cy;
            if (Math.sqrt(dx * dx + dy * dy) < 18) onCenterClick();
          }}>

          {/* Guide arc: upper semicircle (West CW → North → East) */}
          <path d={`M ${cx - rMax} ${cy} A ${rMax} ${rMax} 0 0 1 ${cx + rMax} ${cy}`}
            fill="none" stroke="#2c2c2c" strokeWidth={1} />

          {/* Hour arcs */}
          {arcs}

          {/* Baseline */}
          <line x1={cx - rMax} y1={cy} x2={cx + rMax} y2={cy} stroke="#404040" strokeWidth={1} />

          {/* Axis labels */}
          <text x={lp6p[0]} y={lp6p[1] + 4} fill="#666" fontSize={9} textAnchor="middle">6p</text>
          <text x={lp12p[0]} y={lp12p[1] + 4} fill="#666" fontSize={9} textAnchor="middle">12p</text>
          <text x={lp12a[0]} y={lp12a[1] + 4} fill="#666" fontSize={9} textAnchor="middle">12a</text>
          <text x={cx - rMax - 4} y={cy + 4} fill="#666" fontSize={9} textAnchor="end">6a</text>
          <text x={cx + rMax + 4} y={cy + 4} fill="#666" fontSize={9} textAnchor="start">6a</text>

          {/* Hovered hour label */}
          {hoveredHour !== null && (
            <text x={cx} y={cy + 18} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle">
              {fmtHour(hoveredHour)}
            </text>
          )}

          {/* Center dot (glow + dot) */}
          {centerHovered && (
            <circle cx={cx} cy={cy} r={18} fill={hourColor(peakH)} fillOpacity={0.18} />
          )}
          <circle cx={cx} cy={cy} r={centerHovered ? 10 : 8} fill={hourColor(peakH)} />

          {/* Info bar */}
          <text x={16} y={yBar + 13} fill="#666" fontSize={10}>peak hour</text>
          <text x={16} y={yBar + 33} fill={hourColor(peakH)} fontSize={20} fontWeight={700}>
            {String(peakH).padStart(2, "0")}:00
          </text>

          {/* Daypart pills */}
          {DAYPART_META.map(([s, e, col, lbl], i) => {
            const dpTotal = totals.slice(s, e).reduce((a, b) => a + b, 0);
            const pct = Math.round(100 * dpTotal / grandTotal);
            const xi = xPills + i * (pillW + pillGap);
            const yi = yBar + (INFO_H - pillH) / 2 - 2;
            return (
              <g key={lbl}>
                <circle cx={xi + dotD / 2} cy={yi + pillH / 2} r={dotD / 2} fill={col} />
                <text x={xi + dotD + 3} y={yi + pillH / 2} fill="#666" fontSize={10} dominantBaseline="middle" alignmentBaseline="middle">{pct}%</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ─── DaypartWaffleClock ───────────────────────────────────────────────────────
// Dot-matrix alternative to DaypartClock: same half-circle geometry, hit-testing,
// peak-hour readout and daypart pills, just swaps solid arcs for spokes of unit
// squares (unfilled squares use the same "rgba(255,255,255,0.05)" empty-cell
// convention as the By Day grids below). To revert, swap the call site below
// back to <DaypartClock>.
export function DaypartWaffleClock({ data, onCenterClick }: { data: DaypartFlow; onCenterClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [centerHovered, setCenterHovered] = useState(false);

  const totals = Array(24).fill(0);
  for (const row of data.hours) row.forEach((c, h) => { totals[h] += c; });
  const maxTotal = Math.max(...totals, 1);
  const peakH = totals.indexOf(Math.max(...totals));
  const grandTotal = totals.reduce((a, b) => a + b, 0) || 1;

  // data.minutes is undefined against a backend that hasn't been deployed with this
  // field yet (it crashed the whole chart the first time — guard against that).
  const totalsMinutes = Array(24).fill(0);
  for (const row of data.minutes || []) row.forEach((m, h) => { totalsMinutes[h] += m; });
  const displayHour = hoveredHour ?? selectedHour;

  const INFO_H = 44;
  const rMax = Math.max(42, Math.min(W / 2 - 24, H - INFO_H - 4 - 44));
  // 24 hours packed into a HALF circle means only 7.5° between spokes — half the room
  // the full-circle demo had — so rMin has to be driven by how much circumferential
  // space that leaves at the innermost ring, not a flat ratio of rMax borrowed from the
  // solid-arc version (that math produced dots ~11px wide with ~11px of room between
  // adjacent spokes at rMin: they were touching, which read as a smeared mess on real,
  // noisier data instead of clean spokes).
  const rMin = rMax * 0.42;
  const yBar = H - INFO_H;
  const cy = Math.max(rMax + 38, (yBar + rMax + 24) / 2);
  const cx = W / 2;

  const toRad = (deg: number) => deg * Math.PI / 180;

  function polarPt(angleDeg: number, r: number): [number, number] {
    return [cx + r * Math.cos(toRad(angleDeg)), cy - r * Math.sin(toRad(angleDeg))];
  }

  function getHourAt(mx: number, my: number): number | null {
    const dx = mx - cx, dy = -(my - cy);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < rMin * 0.9 || dist > rMax * 1.1) return null;
    const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    const hAdj = 18 - (angle - 90) / 7.5;
    const h = Math.round(hAdj < 18 ? hAdj + 24 : hAdj) % 24;
    return h;
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const dx = mx - cx, dy = my - cy;
    const isCenter = Math.sqrt(dx * dx + dy * dy) < 18;
    setCenterHovered(isCenter);
    if (!isCenter) {
      const h = getHourAt(mx, my);
      setHoveredHour(h !== null && totals[h] > 0 ? h : null);
    } else {
      setHoveredHour(null);
    }
  }

  function handleMouseLeave() {
    setHoveredHour(null);
    setCenterHovered(false);
  }

  function fmtHour(h: number): string {
    const fmt = (x: number) => {
      x = ((x % 24) + 24) % 24;
      if (x === 0) return "12am";
      if (x === 12) return "12pm";
      return x < 12 ? `${x}am` : `${x - 12}pm`;
    };
    return `${fmt(h)} – ${fmt(h + 1)}`;
  }

  function fmtHours(mins: number): string {
    return `${(mins / 60).toFixed(1)}h`;
  }

  // Size the dot by the tightest gap it actually has to fit in — the arc between two
  // adjacent hour-spokes at the innermost ring (rMin) — then fit as many rings as the
  // remaining radial band allows, instead of picking a dot count first and hoping it fits.
  const hourStepRad = toRad(7.5);
  const dotSize = Math.max(2.5, Math.min(rMin * hourStepRad * 0.72, 10));
  const pitch = dotSize * 1.6;
  const DOTS = Math.max(3, Math.min(9, Math.floor((rMax - rMin) / pitch)));
  const dotRx = dotSize * 0.3;

  // qtCenter uses this component's math-angle convention (0°=right, 90°=up, matching
  // polarPt) — the angular midpoint of hour h's 7.5°-wide slot across the half-circle.
  function qtCenterOf(h: number): number {
    const hAdj = h >= 6 ? h : h + 24;
    const qtStart = 90 + (18 - hAdj) * 7.5;
    return qtStart - 3.75;
  }

  // Each hour's dots are drawn straight up from center (local frame), then the whole
  // spoke is rotated into place as one <g> — same technique as the reference: rotating
  // the group moves AND reorients the squares together, so each one's bottom edge faces
  // the center instead of staying screen-horizontal as it rides around the arc.
  // rotationDeg = 90 - qtCenter converts that into the clockwise degrees SVG's rotate()
  // needs to carry a square drawn "straight up" from center to the qtCenter direction.
  const dots: JSX.Element[] = [];
  for (let h = 0; h < 24; h++) {
    const qtCenter = qtCenterOf(h);
    const rotationDeg = ((90 - qtCenter) % 360 + 360) % 360;
    const filled = Math.round((totals[h] / maxTotal) * DOTS);
    const isHov = h === hoveredHour;
    const col = hourColorSmooth(h);
    const spokeDots: JSX.Element[] = [];
    for (let i = 0; i < DOTS; i++) {
      const r = rMin + (i + 0.5) * pitch;
      const on = i < filled;
      spokeDots.push(
        <rect key={i} x={cx - dotSize / 2} y={cy - r - dotSize / 2} width={dotSize} height={dotSize} rx={dotRx}
          fill={on ? col : "rgba(255,255,255,0.05)"}
          opacity={on ? (isHov ? 1 : 0.88) : 1}
          stroke={on && isHov ? "rgba(255,255,255,0.8)" : "none"} strokeWidth={0.8} />
      );
    }
    dots.push(<g key={h} transform={`rotate(${rotationDeg} ${cx} ${cy})`}>{spokeDots}</g>);
  }

  const lp6p  = polarPt(90,  rMax + 14);
  const lp12p = polarPt(135, rMax + 14);
  const lp12a = polarPt(45,  rMax + 14);

  const dotD = 8, pillW = 46, pillH = 20, pillGap = 10;
  const nPills = DAYPART_META.length;
  const pillsTotal = nPills * pillW + (nPills - 1) * pillGap;
  const xPills = (W + 96) / 2 - pillsTotal / 2;

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block", cursor: centerHovered ? "pointer" : "default" }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
          onClick={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const dx = mx - cx, dy = my - cy;
            if (Math.sqrt(dx * dx + dy * dy) < 18) { onCenterClick(); return; }
            const h = getHourAt(mx, my);
            if (h !== null && totals[h] > 0) setSelectedHour(cur => cur === h ? null : h);
          }}>

          <path d={`M ${cx - rMax} ${cy} A ${rMax} ${rMax} 0 0 1 ${cx + rMax} ${cy}`}
            fill="none" stroke="#2c2c2c" strokeWidth={1} />


          {dots}

          <line x1={cx - rMax} y1={cy} x2={cx + rMax} y2={cy} stroke="#404040" strokeWidth={1} />

          <text x={lp6p[0]} y={lp6p[1] + 4} fill="#666" fontSize={9} textAnchor="middle">6p</text>
          <text x={lp12p[0]} y={lp12p[1] + 4} fill="#666" fontSize={9} textAnchor="middle">12p</text>
          <text x={lp12a[0]} y={lp12a[1] + 4} fill="#666" fontSize={9} textAnchor="middle">12a</text>
          <text x={cx - rMax - 4} y={cy + 4} fill="#666" fontSize={9} textAnchor="end">6a</text>
          <text x={cx + rMax + 4} y={cy + 4} fill="#666" fontSize={9} textAnchor="start">6a</text>

          {displayHour !== null && (
            <>
              <text x={cx} y={cy - 24} fill="#aaa" fontSize={14} fontWeight={700} textAnchor="middle">
                {fmtHours(totalsMinutes[displayHour])}
              </text>
              <text x={cx} y={cy + 18} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle">
                {fmtHour(displayHour)}
              </text>
            </>
          )}

          {centerHovered && (
            <circle cx={cx} cy={cy} r={18} fill={hourColorSmooth(peakH)} fillOpacity={0.18} />
          )}
          <circle cx={cx} cy={cy} r={centerHovered ? 10 : 8} fill={hourColorSmooth(peakH)} />

          <text x={16} y={yBar + 13} fill="#666" fontSize={10}>peak hour</text>
          <text x={16} y={yBar + 33} fill={hourColorSmooth(peakH)} fontSize={20} fontWeight={700}>
            {String(peakH).padStart(2, "0")}:00
          </text>

          {DAYPART_META.map(([s, e, col, lbl], i) => {
            const dpTotal = totals.slice(s, e).reduce((a, b) => a + b, 0);
            const pct = Math.round(100 * dpTotal / grandTotal);
            const xi = xPills + i * (pillW + pillGap);
            const yi = yBar + (INFO_H - pillH) / 2 - 2;
            return (
              <g key={lbl}>
                <circle cx={xi + dotD / 2} cy={yi + pillH / 2} r={dotD / 2} fill={col} />
                <text x={xi + dotD + 3} y={yi + pillH / 2} fill="#666" fontSize={10} dominantBaseline="middle" alignmentBaseline="middle">{pct}%</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ─── DaypartWaffleClockFull ───────────────────────────────────────────────────
// Same dot-matrix technique as DaypartWaffleClock, but a full 360° clock face (12a
// top, 6a right, 12p bottom, 6p left, like a 24-hour dial) instead of a half-circle.
// Kept as its own component rather than a flag on DaypartWaffleClock so either one
// can be tuned independently without risking the other — swap the call site below
// to whichever should ship; the other two stay intact for later.
function DaypartWaffleClockFull({ data, onCenterClick }: { data: DaypartFlow; onCenterClick: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [centerHovered, setCenterHovered] = useState(false);

  const totals = Array(24).fill(0);
  for (const row of data.hours) row.forEach((c, h) => { totals[h] += c; });
  const maxTotal = Math.max(...totals, 1);
  const peakH = totals.indexOf(Math.max(...totals));
  const grandTotal = totals.reduce((a, b) => a + b, 0) || 1;

  // data.minutes is undefined against a backend that hasn't been deployed with this
  // field yet (it crashed the whole chart the first time — guard against that).
  const totalsMinutes = Array(24).fill(0);
  for (const row of data.minutes || []) row.forEach((m, h) => { totalsMinutes[h] += m; });
  const displayHour = hoveredHour ?? selectedHour;

  const INFO_H = 44;
  // TOP_CLEARANCE reserves room above the circle for the "12a" label (rMax+16 from
  // center) plus a small margin, so it doesn't clip into the card header above.
  const TOP_CLEARANCE = 22;
  const availH = H - INFO_H - 8;
  const rMax = Math.max(42, Math.min(W / 2 - 24, (availH - TOP_CLEARANCE) / 2 - 8));
  // A full circle gives each hour 15° instead of a half-circle's 7.5° — twice the
  // circumferential room at the inner ring, so this can afford a smaller rMin ratio
  // than DaypartWaffleClock's 0.42 without dots crowding each other again.
  const rMin = rMax * 0.34;
  const cx = W / 2;
  const cy = TOP_CLEARANCE + rMax + 16;
  const yBar = H - INFO_H;

  const toRad = (deg: number) => deg * Math.PI / 180;

  function polarPt(angleDeg: number, r: number): [number, number] {
    return [cx + r * Math.cos(toRad(angleDeg)), cy - r * Math.sin(toRad(angleDeg))];
  }

  // qtCenter(h) = 82.5 - h*15 would put hour 0 (12a) at the top; +180 flips that so
  // 12p lands at top instead (12a/6a/6p all flip to their opposite position too) —
  // rotated this way because most real listening happens midday/afternoon, not
  // overnight, so the busy half of the dial reads at the top instead of the bottom.
  function qtCenterOf(h: number): number { return 82.5 - h * 15 + 180; }

  function getHourAt(mx: number, my: number): number | null {
    const dx = mx - cx, dy = -(my - cy);
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < rMin * 0.9 || dist > rMax * 1.1) return null;
    const angle = ((Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
    // Inverse of qtCenterOf(h) = 82.5 - h*15 + 180, so hit-testing follows the same
    // +180 flip the dots themselves are rotated by.
    let h = Math.round((262.5 - angle) / 15);
    h = ((h % 24) + 24) % 24;
    return h;
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const dx = mx - cx, dy = my - cy;
    const isCenter = Math.sqrt(dx * dx + dy * dy) < 18;
    setCenterHovered(isCenter);
    if (!isCenter) {
      const h = getHourAt(mx, my);
      setHoveredHour(h !== null && totals[h] > 0 ? h : null);
    } else {
      setHoveredHour(null);
    }
  }

  function handleMouseLeave() {
    setHoveredHour(null);
    setCenterHovered(false);
  }

  function fmtHour(h: number): string {
    const fmt = (x: number) => {
      x = ((x % 24) + 24) % 24;
      if (x === 0) return "12am";
      if (x === 12) return "12pm";
      return x < 12 ? `${x}am` : `${x - 12}pm`;
    };
    return `${fmt(h)} – ${fmt(h + 1)}`;
  }

  function fmtHours(mins: number): string {
    return `${(mins / 60).toFixed(1)}h`;
  }

  const hourStepRad = toRad(15);
  const dotSize = Math.max(2.5, Math.min(rMin * hourStepRad * 0.72, 10));
  const pitch = dotSize * 1.6;
  const DOTS = Math.max(3, Math.min(9, Math.floor((rMax - rMin) / pitch)));
  const dotRx = dotSize * 0.3;

  const dots: JSX.Element[] = [];
  for (let h = 0; h < 24; h++) {
    const qtCenter = qtCenterOf(h);
    const rotationDeg = ((90 - qtCenter) % 360 + 360) % 360;
    const filled = Math.round((totals[h] / maxTotal) * DOTS);
    const isHov = h === hoveredHour;
    const col = hourColorSmooth(h);
    const spokeDots: JSX.Element[] = [];
    for (let i = 0; i < DOTS; i++) {
      const r = rMin + (i + 0.5) * pitch;
      const on = i < filled;
      spokeDots.push(
        <rect key={i} x={cx - dotSize / 2} y={cy - r - dotSize / 2} width={dotSize} height={dotSize} rx={dotRx}
          fill={on ? col : "rgba(255,255,255,0.05)"}
          opacity={on ? (isHov ? 1 : 0.88) : 1}
          stroke={on && isHov ? "rgba(255,255,255,0.8)" : "none"} strokeWidth={0.8} />
      );
    }
    dots.push(<g key={h} transform={`rotate(${rotationDeg} ${cx} ${cy})`}>{spokeDots}</g>);
  }

  // Fixed screen positions (top/right/bottom/left) — which hour-label goes at each
  // follows qtCenterOf's +180 flip, so top/bottom and left/right are swapped from
  // the plain "12a at top" mapping.
  const lpTop    = polarPt(90,  rMax + 16);
  const lpRight  = polarPt(0,   rMax + 16);
  const lpBottom = polarPt(270, rMax + 16);
  const lpLeft   = polarPt(180, rMax + 16);

  const dotD = 8, pillW = 46, pillH = 20, pillGap = 10;
  const nPills = DAYPART_META.length;
  const pillsTotal = nPills * pillW + (nPills - 1) * pillGap;
  const xPills = (W + 96) / 2 - pillsTotal / 2;

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block", cursor: centerHovered ? "pointer" : "default" }}
          onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}
          onClick={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const dx = mx - cx, dy = my - cy;
            if (Math.sqrt(dx * dx + dy * dy) < 18) { onCenterClick(); return; }
            const h = getHourAt(mx, my);
            if (h !== null && totals[h] > 0) setSelectedHour(cur => cur === h ? null : h);
          }}>

          <circle cx={cx} cy={cy} r={rMax} fill="none" stroke="#2c2c2c" strokeWidth={1} />

          {dots}

          <text x={lpTop[0]}    y={lpTop[1] + 4}    fill="#666" fontSize={9} textAnchor="middle">12p</text>
          <text x={lpRight[0]}  y={lpRight[1] + 4}  fill="#666" fontSize={9} textAnchor="start">6p</text>
          <text x={lpBottom[0]} y={lpBottom[1] + 4} fill="#666" fontSize={9} textAnchor="middle">12a</text>
          <text x={lpLeft[0]}   y={lpLeft[1] + 4}   fill="#666" fontSize={9} textAnchor="end">6a</text>

          {displayHour !== null && (
            <>
              <text x={cx} y={cy - 24} fill="#aaa" fontSize={14} fontWeight={700} textAnchor="middle">
                {fmtHours(totalsMinutes[displayHour])}
              </text>
              <text x={cx} y={cy + 18} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle">
                {fmtHour(displayHour)}
              </text>
            </>
          )}

          {centerHovered && (
            <circle cx={cx} cy={cy} r={18} fill={hourColorSmooth(peakH)} fillOpacity={0.18} />
          )}
          <circle cx={cx} cy={cy} r={centerHovered ? 10 : 8} fill={hourColorSmooth(peakH)} />

          <text x={16} y={yBar + 13} fill="#666" fontSize={10}>peak hour</text>
          <text x={16} y={yBar + 33} fill={hourColorSmooth(peakH)} fontSize={20} fontWeight={700}>
            {String(peakH).padStart(2, "0")}:00
          </text>

          {DAYPART_META.map(([s, e, col, lbl], i) => {
            const dpTotal = totals.slice(s, e).reduce((a, b) => a + b, 0);
            const pct = Math.round(100 * dpTotal / grandTotal);
            const xi = xPills + i * (pillW + pillGap);
            const yi = yBar + (INFO_H - pillH) / 2 - 2;
            return (
              <g key={lbl}>
                <circle cx={xi + dotD / 2} cy={yi + pillH / 2} r={dotD / 2} fill={col} />
                <text x={xi + dotD + 3} y={yi + pillH / 2} fill="#666" fontSize={10} dominantBaseline="middle" alignmentBaseline="middle">{pct}%</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

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

function atdwScheme(dow: number, yearIdx: number, yearCount: number): string {
  const t = yearCount > 1 ? yearIdx / (yearCount - 1) : 1;
  const s = 55 + t * 30, l = 26 + t * 46;
  const h = DAY_HUES[dow] + (t - 0.5) * 28;
  return `hsl(${h} ${s}% ${l}%)`;
}

function DayOfWeekAllTimeGrid({ days }: { days: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hover, setHover] = useState<{ x: number; y: number; label: string; sub: string } | null>(null);

  const { filledMinutesByDow, minutesByDowYear, years } = allTimeDowBreakdown(days);
  const hoursByDow = filledMinutesByDow.map(m => Math.floor(m / 60));
  const maxHours = Math.max(...hoursByDow, 1);
  const unitHours = maxHours / ATDW_TARGET_ROWS;
  const boxesByDow = hoursByDow.map(h => Math.round(h / unitHours));
  const rows = ATDW_TARGET_ROWS;

  const step = W > 0 && H > 0 ? dwgBestStep(W, H, rows) : 10;
  const gap = step * 0.2, box = step - gap;
  const laneGap = step * 2.2;
  const rx = Math.max(1, box / 4);
  const { labelFontSize, countFontSize, labelY, countY, padT } = dwgHeaderMetrics(step);
  const padB = Math.max(4, Math.round(step * 0.4));
  const laneW = DWG_COLS * step - gap;
  const totalW = 7 * laneW + 6 * laneGap;
  const totalH = padT + rows * step - gap + padB;
  const startX = Math.max(0, (W - totalW) / 2);
  const startY = Math.max(0, (H - totalH) / 2);
  const gridBottomY = padT + rows * step - gap;

  const avgBoxes = boxesByDow.reduce((a, b) => a + b, 0) / 7;
  const avgY = gridBottomY - (avgBoxes / DWG_COLS) * step;

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
    for (let n = 0; n < rows * DWG_COLS; n++) {
      const row = rows - 1 - Math.floor(n / DWG_COLS), col = n % DWG_COLS;
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
      {hover && (
        <div style={{
          position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
          pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
        </div>
      )}
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
function dwgBestStep(W: number, H: number, rows: number): number {
  let best = 6;
  for (let s = 6; s <= 60; s++) {
    const gap = s * 0.2, laneGap = s * 2.2;
    const laneW = DWG_COLS * s - gap;
    const totalW = 7 * laneW + 6 * laneGap;
    const { padT } = dwgHeaderMetrics(s);
    const padB = Math.max(4, Math.round(s * 0.4));
    const totalH = padT + rows * s - gap + padB;
    if (totalW <= W && totalH <= H) best = s;
  }
  return best;
}

function dwgScheme(dow: number, mi: number, lastActiveMonth: number): string {
  const t = Math.min(1, mi / Math.max(1, lastActiveMonth));
  const s = 55 + t * 30, l = 28 + t * 48;
  const h = DAY_HUES[dow] + (t - 0.5) * 32;
  return `hsl(${h} ${s}% ${l}%)`;
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
  const hoursByDowMonth = minutesByDowMonth.map(row => row.map(m => Math.floor(m / 60)));
  const filledByDow = hoursByDowMonth.map(row => row.reduce((a, b) => a + b, 0));
  let lastActiveMonth = 0;
  hoursByDowMonth.forEach(row => row.forEach((h, mi) => { if (h > 0 && mi > lastActiveMonth) lastActiveMonth = mi; }));

  const today = new Date();
  const startOfYear = new Date(year, 0, 1);
  const dayOfYear = Math.floor((+today - +startOfYear) / 86400000) + 1;
  const daysInYear = (+new Date(year, 11, 31) - +startOfYear) / 86400000 + 1;
  const paceMultiplier = Math.min(daysInYear / Math.max(1, dayOfYear), 6);
  const currentMax = Math.max(...filledByDow, 1);
  const projected = currentMax * paceMultiplier;
  const roundCeiling = Math.max(currentMax, Math.ceil(projected / 50) * 50);
  // Round up to a full row (multiple of DWG_COLS) too, so the grey capacity area
  // above the filled bars is itself a complete rectangle, not cut short on its own top row.
  const CEILING = Math.ceil(roundCeiling / DWG_COLS) * DWG_COLS;
  return { CEILING, filledByDow, hoursByDowMonth, lastActiveMonth };
}

function DayOfWeekHourGrid({ days, year }: { days: DayEntry[]; year: number }) {
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

  const rows = Math.ceil(CEILING / DWG_COLS);
  const step = W > 0 && H > 0 ? dwgBestStep(W, H, rows) : 10;
  const gap = step * 0.2, box = step - gap;
  const laneGap = step * 2.2;
  const rx = Math.max(1, box / 4);
  const { labelFontSize, countFontSize, labelY, countY, padT } = dwgHeaderMetrics(step);
  const padB = Math.max(4, Math.round(step * 0.4));
  const laneW = DWG_COLS * step - gap;
  const totalW = 7 * laneW + 6 * laneGap;
  const totalH = padT + rows * step - gap + padB;
  const startX = Math.max(0, (W - totalW) / 2);
  const startY = Math.max(0, (H - totalH) / 2);
  const gridBottomY = padT + rows * step - gap;

  const avgFilled = filledByDow.reduce((a, b) => a + b, 0) / 7;
  const avgY = gridBottomY - (avgFilled / DWG_COLS) * step;

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
    for (let n = 0; n < CEILING; n++) {
      const row = rows - 1 - Math.floor(n / DWG_COLS), col = n % DWG_COLS;
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
      {hover && (
        <div style={{
          position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
          pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
        </div>
      )}
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

function DayOfWeekPartGrid({ minutes, parts, heatmapAll, year }: { minutes: number[]; parts: DayPart[][]; heatmapAll: DayEntry[]; year: number }) {
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

  const rows = Math.ceil(CEILING / DWG_COLS);
  const step = W > 0 && H > 0 ? dwgBestStep(W, H, rows) : 10;
  const gap = step * 0.2, box = step - gap;
  const laneGap = step * 2.2;
  const rx = Math.max(1, box / 4);
  const { labelFontSize, countFontSize, labelY, countY, padT } = dwgHeaderMetrics(step);
  const padB = Math.max(4, Math.round(step * 0.4));
  const laneW = DWG_COLS * step - gap;
  const totalW = 7 * laneW + 6 * laneGap;
  const totalH = padT + rows * step - gap + padB;
  const startX = Math.max(0, (W - totalW) / 2);
  const startY = Math.max(0, (H - totalH) / 2);
  const gridBottomY = padT + rows * step - gap;

  const avgFilled = filledByDow.reduce((a, b) => a + b, 0) / 7;
  const avgY = gridBottomY - (avgFilled / DWG_COLS) * step;

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
    for (let n = 0; n < CEILING; n++) {
      const row = rows - 1 - Math.floor(n / DWG_COLS), col = n % DWG_COLS;
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
      {hover && (
        <div style={{
          position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
          pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
          borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
        }}>
          <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
          <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
        </div>
      )}
    </div>
  );
}

// ─── Section Label ─────────────────────────────────────────────────────────────

function SecLabel({ text }: { text: string }) {
  return (
    <div style={{ color: "#666", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>
      {text}
    </div>
  );
}

// ─── TimeTab ──────────────────────────────────────────────────────────────────

export function TimeTab() {
  const [mode, setMode] = useState<TimeMode>("Year");
  const [monthOffset, setMonthOffset] = useState(0);
  const [flowOpen, setFlowOpen] = useState(false);
  // Not persisted on purpose — this is still an A/B comparison, not a settled choice.
  // Once one wins, hardcode it in the "Daypart clock card" render below and delete
  // this toggle + whichever of DaypartWaffleClock/DaypartWaffleClockFull lost.
  const [clockShape, setClockShape] = useState<"half" | "full">("half");

  const modeParam = mode === "All Time" ? "All Time" : mode;

  const { data, isLoading } = useQuery<TimePayload>({
    queryKey: ["stats-time", modeParam, monthOffset],
    queryFn: () => api.get(`/api/stats/time?mode=${encodeURIComponent(modeParam)}&month_offset=${monthOffset}`),
    staleTime: 60_000,
  });

  const handleModeChange = useCallback((m: TimeMode) => {
    setMode(m);
    setMonthOffset(0);
  }, []);

  const currentYear = new Date().getFullYear();

  if (isLoading || !data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>Loading…</div>;
  }

  const heatmapDays = mode === "Year" ? data.heatmap_all : mode === "All Time" ? data.heatmap_all : data.heatmap;
  const heatLabel = mode === "All Time" ? "HEATMAP · ALL TIME" : mode === "Year" ? "HEATMAP · YEAR" : "HEATMAP";

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "16px 24px" }}>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexShrink: 0 }}>
        {(["Month", "Year", "All Time"] as TimeMode[]).map(m => (
          <button key={m} onClick={() => handleModeChange(m)} style={{
            padding: "5px 14px", borderRadius: 20,
            border: mode === m ? "1px solid var(--green)" : "1px solid #2a2a2a",
            background: "transparent",
            color: mode === m ? "var(--green)" : "#666",
            fontSize: 13, fontWeight: mode === m ? 700 : 400, cursor: "pointer",
          }}>{m}</button>
        ))}
        {(mode === "Month" || mode === "Year") && (
          <>
            <div style={{ width: 10 }} />
            <button onClick={() => mode === "Month" && setMonthOffset(o => o + 1)}
              disabled={mode === "Month" ? !data.has_older : true}
              style={{ background: "transparent", border: "none", color: (mode === "Month" && data.has_older) ? "#666" : "#333", fontSize: 18, cursor: (mode === "Month" && data.has_older) ? "pointer" : "default", padding: "0 4px" }}>‹</button>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "center" }}>
              {data.label}
            </span>
            <button onClick={() => mode === "Month" && setMonthOffset(o => Math.max(0, o - 1))}
              disabled={mode === "Month" ? !data.has_newer : true}
              style={{ background: "transparent", border: "none", color: (mode === "Month" && data.has_newer) ? "#666" : "#333", fontSize: 18, cursor: (mode === "Month" && data.has_newer) ? "pointer" : "default", padding: "0 4px" }}>›</button>
          </>
        )}
      </div>

      {/* Top row: heatmap + clock */}
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>

        {/* Heatmap card */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#141414", borderRadius: 18, overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "12px 16px 8px" }}>
            <SecLabel text={heatLabel} />
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: "0 8px 8px", display: "flex", flexDirection: "column" }}>
            {mode === "All Time" && <AllTimeMonthGrid days={heatmapDays} />}
            {mode === "Year" && <YearGrid days={heatmapDays} year={currentYear} />}
            {mode === "Month" && <MonthHeatmap days={heatmapDays} />}
          </div>
        </div>

        {/* Daypart clock card */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#141414", borderRadius: 18, overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <SecLabel text="DAYPART CLOCK · HOUR DISTRIBUTION" />
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {(["half", "full"] as const).map(shape => (
                <button key={shape} onClick={() => setClockShape(shape)} style={{
                  padding: "3px 10px", borderRadius: 20,
                  border: clockShape === shape ? "1px solid var(--green)" : "1px solid #2a2a2a",
                  background: "transparent",
                  color: clockShape === shape ? "var(--green)" : "#666",
                  fontSize: 11, fontWeight: clockShape === shape ? 700 : 400, cursor: "pointer",
                }}>{shape === "half" ? "Semi" : "Full"}</button>
              ))}
            </div>
          </div>
          {/* Original solid-arc version is still available as <DaypartClock> if neither
              dot-matrix shape wins out. */}
          {clockShape === "half"
            ? <DaypartWaffleClock data={data.daypart_flow} onCenterClick={() => setFlowOpen(true)} />
            : <DaypartWaffleClockFull data={data.daypart_flow} onCenterClick={() => setFlowOpen(true)} />}
        </div>
      </div>

      {/* Bottom: day of week */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 12 }}>
        <SecLabel text="BY DAY · DAY OF WEEK BREAKDOWN" />
        <div style={{ flex: 1, minHeight: 0, background: "#141414", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {mode === "Year" ? (
            <DayOfWeekHourGrid days={data.heatmap_all} year={currentYear} />
          ) : mode === "Month" ? (
            <DayOfWeekPartGrid minutes={data.minutes_by_dow} parts={data.day_parts} heatmapAll={data.heatmap_all} year={currentYear} />
          ) : (
            <DayOfWeekAllTimeGrid days={data.heatmap_all} />
          )}
        </div>
      </div>

      {/* Daypart flow modal */}
      {flowOpen && mode === "All Time" && (data.daypart_flow_monthly?.months?.length ?? 0) > 0 && (
        <DaypartFlowMonthlyModal data={data.daypart_flow_monthly} onClose={() => setFlowOpen(false)} />
      )}
      {flowOpen && mode !== "All Time" && data.daypart_flow.days.length > 0 && (
        <DaypartFlowModal data={data.daypart_flow} onClose={() => setFlowOpen(false)} />
      )}
    </div>
  );
}
