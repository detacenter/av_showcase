import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";

// ─── Types ────────────────────────────────────────────────────────────────────

type TimeMode = "Month" | "Year" | "All Time";

interface DayEntry { date: string; minutes: number; }
interface DayPart  { label: string; minutes: number; }
interface DaypartFlow {
  days: string[];
  hours: number[][];
  centers: (number | null)[];
  max_hour: number;
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

// ─── Helpers ──────────────────────────────────────────────────────────────────

function heatColor(strength: number): string {
  if (strength <= 0) return "#1e1e1e";
  const t = Math.pow(strength, 1.4);
  const stops: [number, [number, number, number]][] = [
    [0.00, [10,  42,  28]],
    [0.25, [13,  90,  50]],
    [0.55, [20, 160,  75]],
    [0.80, [29, 185,  84]],
    [1.00, [110, 230, 145]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      return `rgb(${Math.round(c0[0] + f * (c1[0] - c0[0]))},${Math.round(c0[1] + f * (c1[1] - c0[1]))},${Math.round(c0[2] + f * (c1[2] - c0[2]))})`;
    }
  }
  return "rgb(110,230,145)";
}

function minutesLabel(m: number): string {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h ${r}m` : `${r}m`;
}

function hourColor(h: number): string {
  for (const [s, e, c] of DAYPART_META) if (h >= s && h < e) return c;
  return "#888";
}

function groupMonths(days: DayEntry[]): { label: string; year: number; month: number; items: DayEntry[] }[] {
  const map = new Map<string, DayEntry[]>();
  for (const d of days) {
    const dt = new Date(d.date + "T00:00:00");
    const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  const keys = [...map.keys()].sort();
  return keys.map(k => {
    const items = map.get(k)!;
    const dt = new Date(items[0].date + "T00:00:00");
    const y = dt.getFullYear(), mo = dt.getMonth() + 1;
    const label = dt.toLocaleString("en-US", { month: "short", year: "numeric" });
    return { label, year: y, month: mo, items };
  });
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function firstDow(year: number, month: number): number {
  return (new Date(year, month - 1, 1).getDay() + 6) % 7; // Mon=0
}

function blockWeeks(year: number, month: number, lastDay: number): number {
  return Math.floor((firstDow(year, month) + lastDay + 6) / 7);
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

// ─── CalendarStrip (All Time) ─────────────────────────────────────────────────

const STRIP_CELL = 13, STRIP_STEP = 16, STRIP_PAD_X = 20, STRIP_PAD_Y = 20, STRIP_BLOCK_GAP = 28;
const STRIP_H = 170;

function CalendarStrip({ days }: { days: DayEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const months = groupMonths(days);
  const maxMin = Math.max(...days.map(d => d.minutes), 1);

  // compute layout
  let x = STRIP_PAD_X;
  const layout = months.map(({ label, year, month, items }) => {
    const lastDay = Math.max(...items.map(d => new Date(d.date + "T00:00:00").getDate()));
    const nw = blockWeeks(year, month, lastDay);
    const bw = nw * STRIP_STEP + 4;
    const bx = x;
    x += bw + STRIP_BLOCK_GAP;
    const byDay = new Map(items.map(d => [new Date(d.date + "T00:00:00").getDate(), d.minutes]));
    return { label, year, month, bx, lastDay, nw, byDay };
  });
  const totalW = x + STRIP_PAD_X;

  // scroll to end on mount
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
  }, [days.length]);

  const cells: JSX.Element[] = [];
  for (const { label, year, month, bx, lastDay, byDay } of layout) {
    const dow0 = firstDow(year, month);
    const by = STRIP_PAD_Y;
    const gridY = by + 18;
    cells.push(
      <text key={`lbl-${year}-${month}`} x={bx} y={by + 12} fill="#666" fontSize={11}>{label}</text>
    );
    for (let day = 1; day <= lastDay; day++) {
      const slot = dow0 + day - 1;
      const cx = bx + Math.floor(slot / 7) * STRIP_STEP;
      const cy = gridY + (slot % 7) * STRIP_STEP;
      const mins = byDay.get(day) ?? 0;
      cells.push(
        <rect key={`${year}-${month}-${day}`} x={cx} y={cy} width={STRIP_CELL} height={STRIP_CELL}
          rx={4} ry={4} fill={heatColor(mins / maxMin)} />
      );
    }
  }

  return (
    <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "hidden", height: STRIP_H }}>
      <svg width={totalW} height={STRIP_H} style={{ display: "block" }}>
        {cells}
      </svg>
    </div>
  );
}

// ─── YearGrid ─────────────────────────────────────────────────────────────────

const YG_LABEL_H = 16, YG_PAD = 6, YG_GAP_X = 10, YG_GAP_Y = 8;

function YearGrid({ days, year }: { days: DayEntry[]; year: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);

  const yearDays = days.filter(d => new Date(d.date + "T00:00:00").getFullYear() === year);
  const byDay = new Map(yearDays.map(d => {
    const dt = new Date(d.date + "T00:00:00");
    return [`${dt.getMonth() + 1}-${dt.getDate()}`, d.minutes];
  }));
  const maxMin = Math.max(...yearDays.map(d => d.minutes), 1);

  const availW = w - 2 * YG_PAD;
  const availH = h - 2 * YG_PAD;
  const stepW = availW > 0 ? Math.floor((availW - 3 * YG_GAP_X) / 4 / 6) : 14;
  const stepH = availH > 0 ? Math.floor(((availH - 2 * YG_GAP_Y) / 3 - YG_LABEL_H) / 7) : 14;
  const step = Math.max(8, Math.min(stepW, stepH));
  const cell = Math.max(1, step - 2);

  const monthW = 6 * step, rowH = YG_LABEL_H + 7 * step;
  const totalW = 4 * monthW + 3 * YG_GAP_X;
  const totalH = 3 * rowH + 2 * YG_GAP_Y;
  const startX = YG_PAD + Math.max(0, Math.floor((availW - totalW) / 2));
  const startY = YG_PAD + Math.max(0, Math.floor((availH - totalH) / 2));

  const els: JSX.Element[] = [];
  for (let idx = 0; idx < 12; idx++) {
    const mo = idx + 1;
    const gridRow = Math.floor(idx / 4), gridCol = idx % 4;
    const bx = startX + gridCol * (monthW + YG_GAP_X);
    const by = startY + gridRow * (rowH + YG_GAP_Y);
    const lastDay = daysInMonth(year, mo);
    const dow0 = firstDow(year, mo);
    const moLabel = new Date(year, mo - 1, 1).toLocaleString("en-US", { month: "short" });

    els.push(
      <text key={`lbl-${mo}`} x={bx + monthW / 2} y={by + YG_LABEL_H - 2} fill="#666" fontSize={11} textAnchor="middle">{moLabel}</text>
    );
    const gridY = by + YG_LABEL_H;
    for (let day = 1; day <= lastDay; day++) {
      const slot = dow0 + day - 1;
      const cx = bx + Math.floor(slot / 7) * step;
      const cy = gridY + (slot % 7) * step;
      const mins = byDay.get(`${mo}-${day}`) ?? 0;
      els.push(
        <rect key={`${mo}-${day}`} x={cx} y={cy} width={cell} height={cell} rx={2} ry={2} fill={heatColor(mins / maxMin)} />
      );
    }
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} style={{ display: "block" }}>
          {els}
        </svg>
      )}
    </div>
  );
}

// ─── MonthHeatmap ─────────────────────────────────────────────────────────────

const MH_LABEL_H = 28, MH_PAD_X = 20, MH_PAD_Y = 20;

function MonthHeatmap({ days }: { days: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);

  if (!days.length) return <div ref={ref} style={{ flex: 1, minHeight: 0 }} />;

  const dt0 = new Date(days[0].date + "T00:00:00");
  const year = dt0.getFullYear(), month = dt0.getMonth() + 1;
  const lastDay = daysInMonth(year, month);
  const dow0 = firstDow(year, month);
  const nWeeks = Math.floor((dow0 + lastDay + 6) / 7);

  const byDay = new Map(days.map(d => [new Date(d.date + "T00:00:00").getDate(), d.minutes]));
  const maxMin = Math.max(...days.map(d => d.minutes), 1);

  const availW = w - 2 * MH_PAD_X;
  const availH = h - MH_LABEL_H - 2 * MH_PAD_Y;
  const stepW = nWeeks > 0 ? Math.floor(availW / nWeeks) : 36;
  const stepH = Math.floor(availH / 7);
  const step = Math.max(12, Math.min(stepW, stepH));
  const gap = Math.max(5, Math.floor(step / 5));
  const cell = step - gap;

  const gridW = nWeeks * step;
  const gridH = 7 * step;
  const totalH = MH_LABEL_H + gridH;
  const bx = MH_PAD_X + Math.max(0, Math.floor((availW - gridW) / 2));
  const by = Math.max(MH_PAD_Y, Math.floor((h - totalH) / 2));
  const gridY = by + MH_LABEL_H;

  const moName = dt0.toLocaleString("en-US", { month: "long", year: "numeric" });
  const els: JSX.Element[] = [
    <text key="lbl" x={bx} y={by + 14} fill="#666" fontSize={12} fontWeight={700}>{moName}</text>
  ];
  for (let day = 1; day <= lastDay; day++) {
    const slot = dow0 + day - 1;
    const cx = bx + Math.floor(slot / 7) * step;
    const cy = gridY + (slot % 7) * step;
    const mins = byDay.get(day) ?? 0;
    els.push(
      <rect key={day} x={cx} y={cy} width={cell} height={cell} rx={4} ry={4} fill={heatColor(mins / maxMin)} />
    );
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {w > 0 && h > 0 && (
        <svg width={w} height={h} style={{ display: "block" }}>
          {els}
        </svg>
      )}
    </div>
  );
}

// ─── DaypartClock ─────────────────────────────────────────────────────────────

function DaypartFlowModal({ data, onClose }: { data: DaypartFlow; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const { w: chartW, h: chartH } = useSize(chartRef);

  const { days, hours, centers, max_hour: maxHour } = data;
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

  // Cells
  const logMax = Math.log1p(maxHour || 1);
  for (let i = 0; i < hours.length; i++) {
    const row = hours[i];
    const x = PAD_L + i * cellW;
    for (let h = 0; h < 24; h++) {
      const count = row[h];
      if (count <= 0) continue;
      const t = Math.min(1, Math.log1p(count) / logMax);
      const alpha = Math.round(38 + 212 * t);
      const col = hourColor(h);
      gridEls.push(
        <rect key={`cell-${i}-${h}`}
          x={x + 0.5} y={yBound(h) + ph / 24 * 0.06}
          width={Math.max(1, cellW - 1)} height={Math.max(2, ph / 24 * 0.88)}
          rx={1.2} ry={1.2}
          fill={col} fillOpacity={alpha / 255} />
      );
    }
  }

  // Center-of-gravity spline
  const segments: [number, number][][] = [];
  let seg: [number, number][] = [];
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i];
    if (c == null) { if (seg.length) { segments.push(seg); seg = []; } }
    else seg.push([xOf(i) + cellW / 2, yCenter(c)]);
  }
  if (seg.length) segments.push(seg);

  for (let si = 0; si < segments.length; si++) {
    const pts = segments[si];
    if (pts.length < 2) continue;
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let k = 1; k < pts.length; k++) {
      const p0 = pts[Math.max(0, k - 2)];
      const p1 = pts[k - 1];
      const p2 = pts[k];
      const p3 = pts[Math.min(pts.length - 1, k + 1)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`;
    }
    gridEls.push(
      <path key={`spline-${si}`} d={d} fill="none" stroke="#fff" strokeWidth={1.8}
        strokeLinecap="round" strokeLinejoin="round" />
    );
  }

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

function DaypartClock({ data, onCenterClick }: { data: DaypartFlow; onCenterClick: () => void }) {
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

// ─── DayOfWeekBars ────────────────────────────────────────────────────────────

interface SegHit { dow: number; seg: number; label: string; minutes: number; cx: number; segMidY: number; }

function DayOfWeekBars({ minutes, parts }: { minutes: number[]; parts: DayPart[][] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [hov, setHov] = useState<{ dow: number; seg: number } | null>(null);

  if (!minutes.some(m => m > 0)) return <div ref={ref} style={{ flex: 1, minHeight: 0 }} />;

  const total = minutes.reduce((a, b) => a + b, 0);
  const avg = total / 7;
  const maxMin = Math.max(...minutes, 1);
  const spread = Math.max(...minutes) - Math.min(...minutes);
  const peakIdx = minutes.indexOf(Math.max(...minutes));

  const TEXT_H = 68, BAR_BOT = H - 28, barArea = BAR_BOT - TEXT_H;
  const colW = (W - 40) / 7;
  const barW = Math.max(16, colW * 0.52);
  const avgY = BAR_BOT - barArea * (avg / maxMin);

  function colCx(i: number): number { return 20 + (i + 0.5) * colW; }

  const bars: JSX.Element[] = [];
  const hitAreas: JSX.Element[] = [];
  const segHits: SegHit[] = [];

  // Avg line + label
  bars.push(<line key="avg" x1={20} y1={avgY} x2={W - 20} y2={avgY} stroke="#2e2e2e" strokeWidth={1} strokeDasharray="4 4" />);
  bars.push(<text key="avg-lbl" x={W - 4} y={avgY - 2} fill="#3a3a3a" fontSize={9} textAnchor="end">avg</text>);

  for (let i = 0; i < 7; i++) {
    const mins = minutes[i];
    const cx = colCx(i);
    const isPeak = i === peakIdx;
    const isLow = mins === Math.min(...minutes);
    const isHov = hov !== null && hov.dow === i;
    const [cTop, cBot] = DAY_COLORS[i];

    const bh = mins > 0 ? Math.max(4, barArea * (mins / maxMin)) : 0;
    const barTop = BAR_BOT - bh;

    const gradId = `dow-grad-${i}`;
    const topAlpha = isPeak ? 1 : isHov ? 0.85 : 0.6;
    bars.push(
      <defs key={`defs-${i}`}>
        <linearGradient id={gradId} x1={String(cx)} y1={String(barTop)} x2={String(cx)} y2={String(BAR_BOT)}
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={cTop} stopOpacity={topAlpha} />
          <stop offset="1" stopColor={cBot} stopOpacity={1} />
        </linearGradient>
      </defs>
    );

    if (mins > 0) {
      const dayParts = parts[i] || [];
      const SEG_GAP = 3;
      if (dayParts.length > 1) {
        const totalDay = Math.max(1, mins);
        const usableH = bh - SEG_GAP * (dayParts.length - 1);
        let yCursor = BAR_BOT;
        for (let j = 0; j < dayParts.length; j++) {
          let segH = Math.max(6, usableH * (dayParts[j].minutes / totalDay));
          if (j === dayParts.length - 1) segH = yCursor - barTop;
          const segTop = yCursor - segH;
          const r = Math.min(5, segH / 3);
          const isSegHov = hov?.dow === i && hov?.seg === j;
          bars.push(
            <rect key={`seg-${i}-${j}`} x={cx - barW / 2} y={segTop} width={barW} height={segH}
              rx={r} ry={r} fill={`url(#${gradId})`} opacity={isSegHov ? 1 : undefined} />
          );
          // Store hit geometry (full column width, exact seg height for precise hit)
          segHits.push({ dow: i, seg: j, label: dayParts[j].label, minutes: dayParts[j].minutes, cx, segMidY: segTop + segH / 2 });
          hitAreas.push(
            <rect key={`hit-${i}-${j}`}
              x={20 + i * colW} y={segTop} width={colW} height={segH + SEG_GAP}
              fill="transparent"
              onMouseEnter={() => setHov({ dow: i, seg: j })}
              onMouseLeave={() => setHov(null)} />
          );
          yCursor = segTop - SEG_GAP;
        }
      } else {
        bars.push(
          <rect key={`bar-${i}`} x={cx - barW / 2} y={barTop} width={barW} height={bh}
            rx={6} ry={6} fill={`url(#${gradId})`} />
        );
        // Single-segment: whole bar column is the hit area, no sub-label to show
        hitAreas.push(
          <rect key={`hit-${i}-0`}
            x={20 + i * colW} y={barTop} width={colW} height={bh}
            fill="transparent"
            onMouseEnter={() => setHov({ dow: i, seg: 0 })}
            onMouseLeave={() => setHov(null)} />
        );
        if (dayParts.length === 1) {
          segHits.push({ dow: i, seg: 0, label: dayParts[0].label, minutes: dayParts[0].minutes, cx, segMidY: barTop + bh / 2 });
        }
      }

      // Peak cap
      if (isPeak) {
        bars.push(
          <rect key={`cap-${i}`} x={cx - barW / 2} y={barTop} width={barW} height={4} rx={3} ry={3} fill={cTop} />
        );
      }
    }

    // Day label
    bars.push(
      <text key={`dlbl-${i}`} x={cx} y={22} fill={isPeak || isHov ? "#fff" : "#aaa"}
        fontSize={12} fontWeight={700} textAnchor="middle">{DOW_LABELS[i]}</text>
    );
    // Duration
    bars.push(
      <text key={`dur-${i}`} x={cx} y={42} fill="#fff" fontSize={17} fontWeight={700} textAnchor="middle">
        {minutesLabel(mins)}
      </text>
    );
    // Delta
    const delta = mins - avg;
    const dsign = delta >= 0 ? "+" : "−";
    bars.push(
      <text key={`delta-${i}`} x={cx} y={58} fill={delta > 0 ? "#1db954" : "#555"}
        fontSize={10} textAnchor="middle">{dsign}{minutesLabel(Math.abs(Math.round(delta)))}</text>
    );
    // Peak/low pill
    if (isPeak || isLow) {
      bars.push(
        <text key={`tag-${i}`} x={cx} y={BAR_BOT + 14} fill={isPeak ? "var(--green)" : "#444"}
          fontSize={9} textAnchor="middle">{isPeak ? "peak" : "low"}</text>
      );
    }
  }

  // Footer
  bars.push(
    <text key="footer" x={W - 20} y={H - 6} fill="#3a3a3a" fontSize={10} textAnchor="end">
      {minutesLabel(total)} total · spread {minutesLabel(spread)}
    </text>
  );

  // Tooltip
  const tooltipEl: JSX.Element[] = [];
  if (hov !== null) {
    const hit = segHits.find(s => s.dow === hov.dow && s.seg === hov.seg);
    if (hit) {
      const TW = 90, TH = 32, PAD = 6;
      let tx = hit.cx - TW / 2;
      if (tx < PAD) tx = PAD;
      if (tx + TW > W - PAD) tx = W - PAD - TW;
      let ty = hit.segMidY - TH / 2;
      if (ty < TEXT_H) ty = TEXT_H;
      if (ty + TH > BAR_BOT) ty = BAR_BOT - TH;
      tooltipEl.push(
        <g key="tooltip" pointerEvents="none">
          <rect x={tx} y={ty} width={TW} height={TH} rx={4} ry={4} fill="#1a1a1a" stroke="#333" strokeWidth={1} />
          <text x={tx + TW / 2} y={ty + 12} fill="#aaa" fontSize={10} textAnchor="middle">{hit.label}</text>
          <text x={tx + TW / 2} y={ty + 24} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle">{minutesLabel(hit.minutes)}</text>
        </g>
      );
    }
  }

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0 }}>
      {W > 0 && H > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          {bars}
          {hitAreas}
          {tooltipEl}
        </svg>
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
            {mode === "All Time" && <CalendarStrip days={heatmapDays} />}
            {mode === "Year" && <YearGrid days={heatmapDays} year={currentYear} />}
            {mode === "Month" && <MonthHeatmap days={heatmapDays} />}
          </div>
        </div>

        {/* Daypart clock card */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#141414", borderRadius: 18, overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "12px 16px 8px" }}>
            <SecLabel text="DAYPART CLOCK · HOUR DISTRIBUTION" />
          </div>
          <DaypartClock data={data.daypart_flow} onCenterClick={() => setFlowOpen(true)} />
        </div>
      </div>

      {/* Bottom: day of week */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 12 }}>
        <SecLabel text="BY DAY · DAY OF WEEK BREAKDOWN" />
        <div style={{ flex: 1, minHeight: 0, background: "#141414", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <DayOfWeekBars minutes={data.minutes_by_dow} parts={data.day_parts} />
        </div>
      </div>

      {/* Daypart flow modal */}
      {flowOpen && data.daypart_flow.days.length > 0 && (
        <DaypartFlowModal data={data.daypart_flow} onClose={() => setFlowOpen(false)} />
      )}
    </div>
  );
}
