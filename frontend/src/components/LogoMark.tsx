// Exact port of OGAV brand.py — viewBox is always 0 0 72 82
// All geometry uses the same coordinate space as the PyQt6 original.
// mark_rect = QRectF(9, 0, 54, 54); cx=36, cy=27

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

// ── Public API ─────────────────────────────────────────────────────────────────

// Glyph hit regions in the 72x82 viewBox.
const A_HIT = { x: 11, y: 61, width: 28, height: 22 };
const V_HIT = { x: 36, y: 61, width: 25, height: 22 };

export function LogoMark({ width = 72, fetching = false, onAClick, onVClick }: {
  width?: number;
  fetching?: boolean;
  onAClick?: () => void;
  onVClick?: () => void;
}) {
  const height = Math.round(width * 82 / 72);
  const mark = <FanMark width={width} height={height} fetching={fetching} />;
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
