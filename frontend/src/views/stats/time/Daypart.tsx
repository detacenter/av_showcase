import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { hexToRgb, type DaypartFlow, type DaypartFlowMonthly } from "./helpers";

const DAYPART_META: [number, number, string, string][] = [
  [0,  5,  "#7f8cff", "Late"],
  [5,  12, "#4ecdc4", "Morning"],
  [12, 17, "#ffd93d", "Day"],
  [17, 22, "#ff8cc8", "Evening"],
  [22, 24, "#a78bfa", "Night"],
];

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


// ─── DaypartClock ─────────────────────────────────────────────────────────────

export function DaypartFlowModal({ data, onClose }: { data: DaypartFlow; onClose: () => void }) {
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
export function DaypartFlowMonthlyModal({ data, onClose }: { data: DaypartFlowMonthly; onClose: () => void }) {
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
export function DaypartWaffleClockFull({ data, onCenterClick }: { data: DaypartFlow; onCenterClick: () => void }) {
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
