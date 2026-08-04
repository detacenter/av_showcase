// Exact port of OGAV brand.py — viewBox is always 0 0 72 82
// All geometry uses the same coordinate space as the PyQt6 original.
// mark_rect for all styles = QRectF(9, 0, 54, 54); cx=36, cy=27

import { useEffect, useRef } from "react";

// ── AV glyph ──────────────────────────────────────────────────────────────────

const A_PATH = "M16.60,79.95 L23.65,66 L26.95,66 L34,79.95 L29.95,79.95 L25.30,70.65 L20.65,79.95 Z";
const V_PATH = "M38,66 L42.05,66 L46.85,75.60 L51.65,66 L55.70,66 L48.65,79.95 L45.05,79.95 Z";

function AvGlyph() {
  return (
    <>
      <path d="M16.60,80.95 L23.65,67 L26.95,67 L34,80.95 L29.95,80.95 L25.30,71.65 L20.65,80.95 Z"
        fill="white" fillOpacity={52 / 255} />
      <path d="M38,67 L42.05,67 L46.85,76.60 L51.65,67 L55.70,67 L48.65,80.95 L45.05,80.95 Z"
        fill="white" fillOpacity={52 / 255} />
      <path d={A_PATH} fill="#f2f2f2" />
      <path d={V_PATH} fill="var(--green)" />
    </>
  );
}

// ── Fan ────────────────────────────────────────────────────────────────────────

const FAN_COLORS = ["#ff3d5c", "#ffd23f", "#00c9a7", "#4b9fff", "#9b5de5"];
const FAN_EDGES  = [11, 21, 31, 41, 52, 61];
const FAN_AX = 36, FAN_AY = 12, FAN_BOT = 51;

function fanPoints(i: number) {
  return `${FAN_AX},${FAN_AY} ${FAN_EDGES[i]},${FAN_BOT} ${FAN_EDGES[i + 1]},${FAN_BOT}`;
}

function fanAnimated(polys: NodeListOf<SVGPolygonElement>, angle: number) {
  const active = Math.floor((angle / 18) % 5);
  polys.forEach((poly, i) => {
    const dist = Math.min((i - active + 5) % 5, (active - i + 5) % 5);
    const pop  = dist === 0 ? 1.14 : dist === 1 ? 1.06 : 0.94;
    const opac = dist <= 1 ? 1 : 170 / 255;
    const y  = FAN_BOT  + (pop - 1) * 10;
    const lx = FAN_AX   + (FAN_EDGES[i]     - FAN_AX) * pop;
    const rx = FAN_AX   + (FAN_EDGES[i + 1] - FAN_AX) * pop;
    poly.setAttribute("points", `${FAN_AX},${FAN_AY} ${lx},${y} ${rx},${y}`);
    poly.setAttribute("fill-opacity", String(opac));
  });
}

function fanStatic(polys: NodeListOf<SVGPolygonElement>) {
  polys.forEach((poly, i) => {
    poly.setAttribute("points", fanPoints(i));
    poly.setAttribute("fill-opacity", "1");
  });
}

function FanMark({ width, height, fetching }: { width: number; height: number; fetching: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const fetchRef = useRef(fetching);
  fetchRef.current = fetching;
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let angle = 0, animating = false;
    const id = setInterval(() => {
      const polys = svg.querySelectorAll<SVGPolygonElement>("[data-fan]");
      if (fetchRef.current) {
        animating = true;
        fanAnimated(polys, angle);
        angle = (angle + 6) % 360;
      } else if (animating) {
        animating = false;
        angle = 0;
        fanStatic(polys);
      }
    }, 30);
    return () => clearInterval(id);
  }, []);
  return (
    <svg ref={ref} viewBox="0 0 72 82" width={width} height={height} style={{ display: "block" }}>
      {FAN_COLORS.map((c, i) => (
        <polygon key={i} data-fan fill={c} points={fanPoints(i)} />
      ))}
      <AvGlyph />
    </svg>
  );
}

// ── Rings ──────────────────────────────────────────────────────────────────────

const RING_COLORS = ["#ff3d5c", "#ff8a3d", "#ffd23f", "#00c9a7", "#26d9ff"];
const RING_RADII  = [24, 20, 16, 12, 8];
const RCX = 36, RCY = 27;

function arcD(cx: number, cy: number, r: number, startDeg: number, spanDeg: number): string {
  const s = (startDeg * Math.PI) / 180;
  const e = ((startDeg + spanDeg) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(s), y1 = cy - r * Math.sin(s);
  const x2 = cx + r * Math.cos(e), y2 = cy - r * Math.sin(e);
  return `M${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${spanDeg > 180 ? 1 : 0} 0 ${x2.toFixed(2)},${y2.toFixed(2)}`;
}

function ringsAnimated(paths: NodeListOf<SVGPathElement>, angle: number) {
  RING_RADII.forEach((r, i) =>
    paths[i]?.setAttribute("d", arcD(RCX, RCY, r, angle + i * 49, 210)));
}

function ringsStatic(paths: NodeListOf<SVGPathElement>) {
  RING_RADII.forEach((r, i) =>
    paths[i]?.setAttribute("d", arcD(RCX, RCY, r, 0, 359.99)));
}

function RingsMark({ width, height, fetching }: { width: number; height: number; fetching: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const fetchRef = useRef(fetching);
  fetchRef.current = fetching;
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let angle = 0, animating = false;
    const id = setInterval(() => {
      const paths = svg.querySelectorAll<SVGPathElement>("[data-ring]");
      if (fetchRef.current) {
        animating = true;
        ringsAnimated(paths, angle);
        angle = (angle + 6) % 360;
      } else if (animating) {
        animating = false;
        angle = 0;
        ringsStatic(paths);
      }
    }, 30);
    return () => clearInterval(id);
  }, []);
  return (
    <svg ref={ref} viewBox="0 0 72 82" width={width} height={height} style={{ display: "block" }}>
      <ellipse cx={RCX} cy={RCY} rx={25} ry={25} fill="#151515" />
      {RING_COLORS.map((c, i) => (
        <path key={i} data-ring stroke={c} strokeWidth={1.25} fill="none" strokeLinecap="round"
          d={arcD(RCX, RCY, RING_RADII[i], 0, 359.99)} />
      ))}
      <circle cx={RCX} cy={RCY} r={8} fill="#1c1c1c" />
      <circle cx={RCX} cy={RCY} r={3} fill="#050505" />
      <AvGlyph />
    </svg>
  );
}

// ── Spectrum ───────────────────────────────────────────────────────────────────

const SPEC_COLORS  = ["#ff3d5c", "#ffd23f", "#00c9a7", "#4b9fff", "#9b5de5"];
const SPEC_WIDTHS  = [28, 34, 24, 38, 30];
const SPEC_BASE_X  = [17, 21, 17, 21, 17];
const SPEC_BASE_Y  = [10, 17, 24, 31, 38];

function specAnimated(lines: NodeListOf<SVGLineElement>, angle: number) {
  const phase = (angle / 360) * 2 * Math.PI;
  SPEC_WIDTHS.forEach((w, i) => {
    const drift   = Math.sin(phase + i * 0.9) * 5;
    const stretch = 1 + Math.sin(phase + i * 0.7) * 0.12;
    const x1 = SPEC_BASE_X[i] + drift;
    lines[i]?.setAttribute("x1", x1.toFixed(2));
    lines[i]?.setAttribute("y1", String(SPEC_BASE_Y[i]));
    lines[i]?.setAttribute("x2", (x1 + w * stretch).toFixed(2));
    lines[i]?.setAttribute("y2", String(SPEC_BASE_Y[i]));
  });
}

function specStatic(lines: NodeListOf<SVGLineElement>) {
  SPEC_WIDTHS.forEach((w, i) => {
    lines[i]?.setAttribute("x1", String(SPEC_BASE_X[i]));
    lines[i]?.setAttribute("y1", String(SPEC_BASE_Y[i]));
    lines[i]?.setAttribute("x2", String(SPEC_BASE_X[i] + w));
    lines[i]?.setAttribute("y2", String(SPEC_BASE_Y[i]));
  });
}

function SpectrumMark({ width, height, fetching }: { width: number; height: number; fetching: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const fetchRef = useRef(fetching);
  fetchRef.current = fetching;
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let angle = 0, animating = false;
    const id = setInterval(() => {
      const lines = svg.querySelectorAll<SVGLineElement>("[data-spec]");
      if (fetchRef.current) {
        animating = true;
        specAnimated(lines, angle);
        angle = (angle + 6) % 360;
      } else if (animating) {
        animating = false;
        angle = 0;
        specStatic(lines);
      }
    }, 30);
    return () => clearInterval(id);
  }, []);
  return (
    <svg ref={ref} viewBox="0 0 72 82" width={width} height={height} style={{ display: "block" }}>
      {SPEC_COLORS.map((c, i) => (
        <line key={i} data-spec stroke={c} strokeWidth={4.2} strokeLinecap="round"
          x1={SPEC_BASE_X[i]} y1={SPEC_BASE_Y[i]}
          x2={SPEC_BASE_X[i] + SPEC_WIDTHS[i]} y2={SPEC_BASE_Y[i]} />
      ))}
      <AvGlyph />
    </svg>
  );
}

// ── Prism ──────────────────────────────────────────────────────────────────────

const PRISM_FACETS: [string, string][] = [
  ["#ff3d5c", "36,4 13,27 31,31"],
  ["#ff8a3d", "13,27 36,49 31,31"],
  ["#ffd23f", "36,4 31,31 36,49"],
  ["#00c9a7", "36,4 36,49 41,31"],
  ["#26d9ff", "36,4 41,31 59,27"],
  ["#4b9fff", "59,27 41,31 36,49"],
  ["#9b5de5", "13,27 36,49 59,27"],
];

function prismAnimated(polys: NodeListOf<SVGPolygonElement>, angle: number) {
  const sweep = (angle / 360) % 1;
  const n = PRISM_FACETS.length;
  polys.forEach((poly, i) => {
    const ft   = (i + 0.5) / n;
    const dist = Math.min(Math.abs(sweep - ft), Math.abs(sweep + 1 - ft), Math.abs(sweep - 1 - ft));
    const lift = Math.max(0, 1 - dist * 6);
    poly.setAttribute("fill-opacity", String((150 + Math.round(lift * 95)) / 255));
  });
}

function prismStatic(polys: NodeListOf<SVGPolygonElement>) {
  polys.forEach(poly => poly.setAttribute("fill-opacity", String(210 / 255)));
}

function PrismMark({ width, height, fetching }: { width: number; height: number; fetching: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const fetchRef = useRef(fetching);
  fetchRef.current = fetching;
  useEffect(() => {
    const svg = ref.current;
    if (!svg) return;
    let angle = 0, animating = false;
    const id = setInterval(() => {
      const polys = svg.querySelectorAll<SVGPolygonElement>("[data-prism]");
      if (fetchRef.current) {
        animating = true;
        prismAnimated(polys, angle);
        angle = (angle + 6) % 360;
      } else if (animating) {
        animating = false;
        angle = 0;
        prismStatic(polys);
      }
    }, 30);
    return () => clearInterval(id);
  }, []);
  return (
    <svg ref={ref} viewBox="0 0 72 82" width={width} height={height} style={{ display: "block" }}>
      {PRISM_FACETS.map(([c, pts], i) => (
        <polygon key={i} data-prism points={pts} fill={c} fillOpacity={210 / 255} />
      ))}
      <AvGlyph />
    </svg>
  );
}

// ── Public API ─────────────────────────────────────────────────────────────────

// Glyph hit regions in the 72x82 viewBox.
const A_HIT = { x: 11, y: 61, width: 28, height: 22 };
const V_HIT = { x: 36, y: 61, width: 25, height: 22 };

export function LogoMark({ style, width = 72, fetching = false, onAClick, onVClick }: {
  style: string;
  width?: number;
  fetching?: boolean;
  onAClick?: () => void;
  onVClick?: () => void;
}) {
  const height = Math.round(width * 82 / 72);
  const props = { width, height, fetching };
  let mark: React.ReactElement;
  switch (style) {
    case "fan":      mark = <FanMark      {...props} />; break;
    case "spectrum": mark = <SpectrumMark {...props} />; break;
    case "prism":    mark = <PrismMark    {...props} />; break;
    default:         mark = <RingsMark    {...props} />; break;
  }
  if (!onAClick && !onVClick) return mark;
  return (
    <div style={{ position: "relative", display: "inline-block", lineHeight: 0 }}>
      {mark}
      <svg
        viewBox="0 0 72 82"
        width={width}
        height={height}
        style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none" }}
      >
        {onAClick && (
          <rect
            {...A_HIT}
            fill="transparent"
            style={{ cursor: "pointer", pointerEvents: "all" }}
            onClick={e => { e.stopPropagation(); onAClick(); }}
          />
        )}
        {onVClick && (
          <rect
            {...V_HIT}
            fill="transparent"
            style={{ cursor: "pointer", pointerEvents: "all" }}
            onClick={e => { e.stopPropagation(); onVClick(); }}
          />
        )}
      </svg>
    </div>
  );
}
