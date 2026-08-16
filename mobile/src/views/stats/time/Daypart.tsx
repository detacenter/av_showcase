import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { useTapDismiss } from "../../../hooks/useTapDismiss";
import { hexToRgb, type DaypartFlow } from "./helpers";

const DAYPART_META: [number, number, string, string][] = [
  [0,  5,  "#7f8cff", "Late"],
  [5,  12, "#4ecdc4", "Morning"],
  [12, 17, "#ffd93d", "Day"],
  [17, 22, "#ff8cc8", "Evening"],
  [22, 24, "#a78bfa", "Night"],
];

// Same 5 daypart colors laid out in DAYPART_META, but interpolated continuously between each
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

// ─── DaypartWaffleClock ───────────────────────────────────────────────────────
// Dot-matrix half-circle clock — same geometry/hit-testing as desktop's version,
// trimmed of its mouse-hover path (no pointer on a phone) and of desktop's
// center-tap-to-open-Daypart-Flow affordance (mobile doesn't carry that deep-dive
// at all — decided not worth it on a phone screen for any time slice). A tap just
// selects/deselects an hour's spoke. The "hoveredHour ?? selectedHour" fallback
// desktop needs for mouse-out doesn't apply here either, so this only tracks
// `selectedHour`.
export function DaypartWaffleClock({ data }: { data: DaypartFlow }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: W, h: H } = useSize(ref);
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  useTapDismiss(ref, () => setSelectedHour(null));

  const totals = Array(24).fill(0);
  for (const row of data.hours) row.forEach((c, h) => { totals[h] += c; });
  const maxTotal = Math.max(...totals, 1);
  const peakH = totals.indexOf(Math.max(...totals));
  const grandTotal = totals.reduce((a, b) => a + b, 0) || 1;

  const totalsMinutes = Array(24).fill(0);
  for (const row of data.minutes || []) row.forEach((m, h) => { totalsMinutes[h] += m; });

  const INFO_H = 44;
  const rMax = Math.max(42, Math.min(W / 2 - 24, H - INFO_H - 4 - 44));
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
    return Math.round(hAdj < 18 ? hAdj + 24 : hAdj) % 24;
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

  const hourStepRad = toRad(7.5);
  const dotSize = Math.max(2.5, Math.min(rMin * hourStepRad * 0.72, 10));
  const pitch = dotSize * 1.6;
  const DOTS = Math.max(3, Math.min(9, Math.floor((rMax - rMin) / pitch)));
  const dotRx = dotSize * 0.3;

  function qtCenterOf(h: number): number {
    const hAdj = h >= 6 ? h : h + 24;
    const qtStart = 90 + (18 - hAdj) * 7.5;
    return qtStart - 3.75;
  }

  const dots: JSX.Element[] = [];
  for (let h = 0; h < 24; h++) {
    const qtCenter = qtCenterOf(h);
    const rotationDeg = ((90 - qtCenter) % 360 + 360) % 360;
    const filled = Math.round((totals[h] / maxTotal) * DOTS);
    const isSel = h === selectedHour;
    const col = hourColorSmooth(h);
    const spokeDots: JSX.Element[] = [];
    for (let i = 0; i < DOTS; i++) {
      const r = rMin + (i + 0.5) * pitch;
      const on = i < filled;
      spokeDots.push(
        <rect key={i} x={cx - dotSize / 2} y={cy - r - dotSize / 2} width={dotSize} height={dotSize} rx={dotRx}
          fill={on ? col : "rgba(255,255,255,0.05)"}
          opacity={on ? (isSel ? 1 : 0.88) : 1}
          stroke={on && isSel ? "rgba(255,255,255,0.8)" : "none"} strokeWidth={0.8} />
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
        <svg width={W} height={H} style={{ display: "block", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
          onClick={e => {
            const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const mx = e.clientX - rect.left, my = e.clientY - rect.top;
            const h = getHourAt(mx, my);
            if (h !== null && totals[h] > 0) setSelectedHour(cur => cur === h ? null : h);
            else setSelectedHour(null);
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

          {selectedHour !== null && (
            <>
              <text x={cx} y={cy - 24} fill="#aaa" fontSize={14} fontWeight={700} textAnchor="middle">
                {fmtHours(totalsMinutes[selectedHour])}
              </text>
              <text x={cx} y={cy + 18} fill="#fff" fontSize={11} fontWeight={700} textAnchor="middle">
                {fmtHour(selectedHour)}
              </text>
            </>
          )}

          <circle cx={cx} cy={cy} r={8} fill={hourColorSmooth(peakH)} />

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
