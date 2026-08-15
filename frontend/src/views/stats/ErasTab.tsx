import { useState, useRef, useCallback, type JSX } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "../../api/client";
import { useSize } from "../../hooks/useSize";

import { API_BASE as ART_BASE } from "../../api/config";
function artUrl(path: string): string | null {
  if (!path) return null;
  const idx = path.indexOf("artwork/");
  const relative = idx !== -1 ? path.slice(idx + 8) : path.split("/").pop() ?? "";
  return relative ? `${ART_BASE}/artwork/${relative}` : null;
}

// ─── Color helpers ────────────────────────────────────────────────────────────

function hsvToHex(h: number, s: number, v: number): string {
  const sn = s / 255, vn = v / 255;
  const hh = h / 60;
  const i = Math.floor(hh) % 6;
  const f = hh - Math.floor(hh);
  const p = vn * (1 - sn);
  const q = vn * (1 - sn * f);
  const t = vn * (1 - sn * (1 - f));
  const rgb: [number, number, number][] = [
    [vn, t, p], [q, vn, p], [p, vn, t], [p, q, vn], [t, p, vn], [vn, p, q],
  ];
  const [r, g, b] = rgb[i].map(x => Math.round(x * 255));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function barColor(idx: number, nBars: number): string {
  const t = idx / Math.max(1, nBars);
  return hsvToHex(Math.round(t * 270), 195, 225);
}

function yearColor(year: number | null, bars: TimelineBar[]): string {
  if (!year || !bars.length) return "#20a7ff";
  const idx = bars.findIndex(b => b.year === year);
  if (idx < 0) return "#20a7ff";
  return barColor(idx, bars.length - 1);
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ErasView = "Timeline" | "Drift";
type TimelineMetric = "Albums" | "Plays" | "Vinyl";

interface TimelineBar { year: number; value: number; plays: number; albums: number; vinyl?: number; }
interface DetailItem { title: string; subtitle: string; meta: string; art_path: string; art_key: string; }
interface TimelinePayload {
  bars: TimelineBar[];
  selected_year: number | null;
  summary: string;
  detail_title: string;
  detail_totals: { albums?: number; plays?: number; vinyl?: number };
  details: DetailItem[];
  timeline_source?: string;
}
interface DriftPayload {
  days: string[];
  points: { i: number; year: number }[];
  avg_years: number[];
  current_avg: number;
}
interface ProfilePayload {
  avg_year: number;
  median_year: number;
  min_year: number;
  max_year: number;
  total_plays: number;
  album_count: number;
  years: { year: number; plays: number; albums: number }[];
  decades: { decade: number; label: string; plays: number }[];
  dominant_decade: string;
}
interface EraDataPayload { drift: DriftPayload; profile: ProfilePayload; }


// ─── TimelineChart ────────────────────────────────────────────────────────────

const SIDE_PAD = 28;
const BLOCK_H = 10.5;
const BLOCK_GAP = 2.0;
const HEADROOM = 34;
const CHART_H = 286;

function TimelineChart({
  bars, selectedYear, metric,
  onYearClick, onMetricChange,
}: {
  bars: TimelineBar[];
  selectedYear: number | null;
  metric: TimelineMetric;
  onYearClick: (y: number) => void;
  onMetricChange: (m: TimelineMetric) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { w: containerW } = useSize(ref);
  const [hoveredYear, setHoveredYear] = useState<number | null>(null);

  if (!bars.length) {
    return (
      <div ref={ref} style={{ height: CHART_H, background: "#101010", borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>
        No release-year data yet.
      </div>
    );
  }

  const W = Math.max(containerW || 720, 720);
  const left = SIDE_PAD;
  const right = W - SIDE_PAD;
  const top = 38;
  const bottom = CHART_H - 28;
  const baseY = bottom - 16;
  const barArea = baseY - top;
  const nBars = bars.length;
  const span = Math.max(1, nBars - 1);
  const step = (right - left) / span;
  const colW = Math.max(7, Math.min(18, step * 0.62));
  const maxBlocks = Math.max(4, Math.floor((barArea - HEADROOM) / (BLOCK_H + BLOCK_GAP)));
  const maxVal = Math.max(...bars.map(b => b.value), 1);

  function barX(idx: number) { return nBars === 1 ? (left + right) / 2 : left + idx * step; }

  // Build decade groups
  const decades: Map<number, number[]> = new Map();
  bars.forEach((bar, idx) => {
    const dec = Math.floor(bar.year / 10) * 10;
    if (!decades.has(dec)) decades.set(dec, []);
    decades.get(dec)!.push(idx);
  });

  const metricLabels: TimelineMetric[] = ["Albums", "Plays", "Vinyl"];

  // Metric toggle hit zones (computed for SVG click handling)
  let mx = left;
  const metricZones: { label: TimelineMetric; x1: number; x2: number }[] = [];
  const approxCharW = 7.5;
  metricLabels.forEach(lbl => {
    const w = lbl.length * approxCharW;
    metricZones.push({ label: lbl, x1: mx - 4, x2: mx + w + 4 });
    mx += w + 18;
  });

  const svgEls: JSX.Element[] = [];

  // Background
  svgEls.push(<rect key="bg" x={0} y={0} width={W} height={CHART_H} rx={18} ry={18} fill="#101010" />);

  // Metric toggle labels
  let tx = left;
  metricLabels.forEach(lbl => {
    const active = lbl === metric;
    svgEls.push(
      <text key={`m-${lbl}`} x={tx} y={top - 6} fill={active ? "#20a7ff" : "#555"}
        fontSize={11} fontWeight={700} style={{ cursor: "pointer" }}
        onClick={() => onMetricChange(lbl)}>
        {lbl}
      </text>
    );
    tx += lbl.length * 7.5 + 18;
  });

  // Base line
  svgEls.push(<line key="base" x1={left - 12} y1={baseY} x2={right + 12} y2={baseY} stroke="rgba(255,255,255,0.11)" strokeWidth={1} />);

  // Decade dividers + labels
  decades.forEach((indices, decade) => {
    const x0 = barX(indices[0]);
    const xN = barX(indices[indices.length - 1]);
    if (indices[0] !== 0) {
      const bx = x0 - step / 2;
      svgEls.push(<line key={`ddiv-${decade}`} x1={bx} y1={top + 24} x2={bx} y2={baseY - 6} stroke="rgba(255,255,255,0.063)" strokeWidth={1} />);
    }
    const cx = (x0 + xN) / 2;
    svgEls.push(
      <text key={`dlbl-${decade}`} x={cx} y={baseY + 18} fill="#555" fontSize={9} textAnchor="middle">{decade}s</text>
    );
  });

  // Bars
  bars.forEach((bar, idx) => {
    const x = barX(idx);
    const col = barColor(idx, nBars - 1);
    const selected = bar.year === selectedYear;
    const hovered = bar.year === hoveredYear;
    const blocks = Math.max(1, Math.round((bar.value / maxVal) * maxBlocks));
    const stackH = blocks * BLOCK_H + (blocks - 1) * BLOCK_GAP;
    const opacity = 1.0;

    if (selected) {
      svgEls.push(
        <rect key={`glow-${idx}`} x={x - colW / 2 - 4} y={baseY - stackH - 5} width={colW + 8} height={stackH + 8}
          rx={5} fill={col} fillOpacity={0.11} />
      );
    }

    for (let b = 0; b < blocks; b++) {
      const by = baseY - (b + 1) * BLOCK_H - b * BLOCK_GAP;
      const intensity = 0.66 + 0.34 * ((b + 1) / Math.max(1, blocks));
      const alpha = ((selected ? 210 : hovered ? 200 : 185) * intensity) / 255;
      svgEls.push(
        <rect key={`blk-${idx}-${b}`}
          x={x - colW / 2} y={by} width={colW} height={BLOCK_H}
          rx={2.4} fill={col} fillOpacity={selected ? Math.min(1, alpha * 1.15) : alpha}
          style={{ opacity }} />
      );
    }

    // Selected year badge
    if (selected) {
      const bw = 44, bh = 20;
      let bx = x - bw / 2;
      bx = Math.max(left + 6, Math.min(bx, right - bw - 6));
      const byBadge = Math.max(top + 6, baseY - stackH - bh - 8);
      svgEls.push(
        <g key={`badge-${idx}`}>
          <rect x={bx} y={byBadge} width={bw} height={bh} rx={10} fill="#121212" />
          <rect x={bx + 0.5} y={byBadge + 0.5} width={bw - 1} height={bh - 1} rx={10} fill="none" stroke="rgba(255,255,255,0.13)" strokeWidth={1} />
          <text x={bx + bw / 2} y={byBadge + 13} fill="#fff" fontSize={8} fontWeight={700} textAnchor="middle">{bar.year}</text>
        </g>
      );
    }

    // Invisible hit area
    const hitH = Math.max(stackH + 18, 36);
    svgEls.push(
      <rect key={`hit-${idx}`}
        x={x - Math.max(step * 0.45, 13)} y={baseY - hitH}
        width={Math.max(step * 0.9, 26)} height={hitH + 8}
        fill="transparent" style={{ cursor: "pointer" }}
        onClick={() => onYearClick(bar.year)}
        onMouseEnter={() => setHoveredYear(bar.year)}
        onMouseLeave={() => setHoveredYear(null)} />
    );
  });

  // Tooltip for hovered year
  if (hoveredYear !== null && hoveredYear !== selectedYear) {
    const idx = bars.findIndex(b => b.year === hoveredYear);
    if (idx >= 0) {
      const x = barX(idx);
      const bx = Math.max(left + 6, Math.min(x - 18, right - 42));
      const blocks = Math.max(1, Math.round((bars[idx].value / maxVal) * maxBlocks));
      const stackH = blocks * BLOCK_H + (blocks - 1) * BLOCK_GAP;
      svgEls.push(
        <g key="tooltip" pointerEvents="none">
          <rect x={bx} y={baseY - stackH - 28} width={36} height={18} rx={9} fill="#1a1a1a" />
          <text x={bx + 18} y={baseY - stackH - 15} fill="#aaa" fontSize={8} fontWeight={700} textAnchor="middle">{hoveredYear}</text>
        </g>
      );
    }
  }

  return (
    <div ref={ref} style={{ overflow: "hidden" }}>
      <div style={{ overflowX: "auto", overflowY: "hidden" }}>
        <svg width={W} height={CHART_H} style={{ display: "block" }}>
          {svgEls}
        </svg>
      </div>
    </div>
  );
}

// ─── DetailGallery ────────────────────────────────────────────────────────────

function DetailGallery({ items }: { items: DetailItem[] }) {
  if (!items.length) {
    return <div style={{ color: "#444", fontSize: 13, padding: "24px 0", textAlign: "center" }}>No data</div>;
  }
  return (
    <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, padding: "4px 0 8px" }}>
        {items.map((item, i) => {
          const url = artUrl(item.art_path);
          return (
            <div key={item.art_key || i} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 700, textAlign: "center", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.title}
              </div>
              <div style={{
                width: "100%", aspectRatio: "1", background: "#222", borderRadius: 8, overflow: "hidden",
                display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
              }}>
                {url
                  ? <img src={url} alt={item.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  : <span style={{ color: "#444", fontSize: 24 }}>♪</span>
                }
              </div>
              <div style={{ color: "#666", fontSize: 11, textAlign: "center", marginTop: 5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.subtitle}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── DetailCard ───────────────────────────────────────────────────────────────

function ExpandIcon({ expanded }: { expanded: boolean }) {
  const q = 4, a = 5;
  const w = 22, h = 22;
  if (!expanded) return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={w - q - a} y1={q} x2={w - q} y2={q} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={w - q} y1={q} x2={w - q} y2={q + a} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={q} y1={h - q} x2={q + a} y2={h - q} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={q} y1={h - q - a} x2={q} y2={h - q} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <line x1={w - q - a} y1={q + a} x2={w - q} y2={q + a} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={w - q - a} y1={q} x2={w - q - a} y2={q + a} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={q} y1={h - q - a} x2={q + a} y2={h - q - a} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
      <line x1={q + a} y1={h - q - a} x2={q + a} y2={h - q} stroke="#aaa" strokeWidth={1.5} strokeLinecap="round" />
    </svg>
  );
}

function DetailCard({
  payload, bars, expanded, onToggleExpand,
}: {
  payload: TimelinePayload;
  bars: TimelineBar[];
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const year = payload.selected_year;
  const accent = yearColor(year, bars);
  const isVinyl = payload.timeline_source === "vinyl";
  const totals = payload.detail_totals || {};
  const albumCount = totals.albums ?? 0;
  const playCount = totals.plays ?? 0;
  const vinylCount = totals.vinyl ?? albumCount;

  const titleEl = year ? (
    <span>
      <span style={{ color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>
        {isVinyl ? "VINYL FROM " : "ALBUMS FROM "}
      </span>
      <span style={{ color: accent, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>{year}</span>
    </span>
  ) : (
    <span style={{ color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>
      {(payload.detail_title || "").toUpperCase()}
    </span>
  );

  const statsEl = year ? (
    isVinyl ? (
      <span style={{ color: "#555", fontSize: 11, fontWeight: 600 }}>
        <span style={{ color: accent }}>{vinylCount}</span>{" "}
        {vinylCount === 1 ? "record" : "records"}
      </span>
    ) : (
      <span style={{ color: "#555", fontSize: 11, fontWeight: 600 }}>
        <span style={{ color: accent }}>{albumCount}</span>{" "}
        {albumCount === 1 ? "album" : "albums"}
        {"   "}
        <span style={{ color: accent }}>{playCount}</span>{" "}
        {playCount === 1 ? "play" : "plays"}
      </span>
    )
  ) : null;

  return (
    <div style={{
      flex: 1, minHeight: 0,
      background: "#141414",
      border: year ? `1px solid ${accent}` : "none",
      borderRadius: 18,
      padding: "16px 18px 18px",
      display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexShrink: 0 }}>
        <div style={{ flex: 1 }}>{titleEl}</div>
        {statsEl && <div>{statsEl}</div>}
        {year && (
          <button onClick={onToggleExpand} style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, display: "flex" }}>
            <ExpandIcon expanded={expanded} />
          </button>
        )}
      </div>
      <DetailGallery items={payload.details} />
    </div>
  );
}

// ─── EraDriftChart ────────────────────────────────────────────────────────────

const DRIFT_PAD = { l: 70, r: 22, t: 24, b: 34 };
const DRIFT_H = 212;
const DRIFT_MIN_STEP = 8;

function EraDriftChart({ drift }: { drift: DriftPayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w: containerW } = useSize(containerRef);
  const { days, points, avg_years } = drift;

  if (!days.length || !points.length) return <div ref={containerRef} />;

  const n = days.length;
  const years = points.map(p => p.year);
  const minY = Math.floor(Math.min(...years) / 10) * 10;
  const maxY = Math.floor((Math.max(...years) + 9) / 10) * 10;
  const contentW = DRIFT_PAD.l + DRIFT_PAD.r + Math.max(1, n - 1) * DRIFT_MIN_STEP;
  const W = Math.max(containerW > 0 ? containerW : 720, contentW);
  const H = DRIFT_H;
  const pw = W - DRIFT_PAD.l - DRIFT_PAD.r;
  const ph = H - DRIFT_PAD.t - DRIFT_PAD.b;

  function xOf(i: number) { return DRIFT_PAD.l + pw * i / Math.max(n - 1, 1); }
  function yOf(v: number) { return DRIFT_PAD.t + ph * (1 - (v - minY) / Math.max(maxY - minY, 1)); }
  function hueForYear(yr: number) { return Math.round((yr - minY) / Math.max(maxY - minY, 1) * 270); }

  const els: JSX.Element[] = [];

  // Background
  els.push(<rect key="bg" x={0} y={0} width={W} height={H} rx={18} fill="#141414" />);

  // Y-axis grid + labels
  for (let yv = minY; yv <= maxY; yv += 10) {
    const y = yOf(yv);
    els.push(<line key={`grid-${yv}`} x1={DRIFT_PAD.l} y1={y} x2={DRIFT_PAD.l + pw} y2={y} stroke="#1e1e1e" strokeWidth={1} />);
    els.push(<text key={`ylabel-${yv}`} x={DRIFT_PAD.l - 16} y={y + 4} fill="#555" fontSize={10} textAnchor="end">{yv}</text>);
  }

  // Color scale bar on left
  const scaleX = 10, scaleW = 3;
  const scaleTop = yOf(maxY), scaleBot = yOf(minY);
  const scaleId = "drift-scale-grad";
  const gradStops: [number, number][] = [[0, 0], [0.22, 55], [0.42, 115], [0.62, 175], [0.82, 225], [1, 270]];
  els.push(
    <defs key="defs">
      <linearGradient id={scaleId} x1="0" y1="1" x2="0" y2="0">
        {gradStops.map(([offset, hue]) => (
          <stop key={offset} offset={offset} stopColor={hsvToHex(hue, 195, 225)} stopOpacity={0.57} />
        ))}
      </linearGradient>
    </defs>
  );
  els.push(<rect key="scalebar" x={scaleX} y={scaleTop} width={scaleW} height={scaleBot - scaleTop} rx={scaleW / 2} fill={`url(#${scaleId})`} />);

  // Points
  points.forEach((pt, i) => {
    const x = xOf(pt.i);
    const y = yOf(pt.year);
    const col = hsvToHex(hueForYear(pt.year), 195, 225);
    els.push(<circle key={`pt-${i}`} cx={x} cy={y} r={4.5} fill={col} fillOpacity={0.165} />);
  });

  // Smoothed avg line
  const linePts = avg_years
    .map((v, i) => v ? `${i === 0 || !avg_years[i - 1] ? "M" : "L"} ${xOf(i)} ${yOf(v)}` : null)
    .filter(Boolean);
  if (linePts.length > 1) {
    els.push(<path key="line" d={linePts.join(" ")} fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />);
  }

  // Month labels on x-axis
  const seenMonths = new Set<string>();
  days.forEach((d, i) => {
    const dt = new Date(d + "T00:00:00");
    const key = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (seenMonths.has(key)) return;
    seenMonths.add(key);
    const lbl = dt.toLocaleString("en-US", { month: "short" });
    els.push(<text key={`mlbl-${i}`} x={xOf(i)} y={H - DRIFT_PAD.b + 12} fill="#555" fontSize={10} textAnchor="middle">{lbl}</text>);
  });

  return (
    <div ref={containerRef} style={{ overflowX: "auto", overflowY: "hidden" }}>
      {containerW > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          {els}
        </svg>
      )}
    </div>
  );
}

// ─── CenterOfMassChart ────────────────────────────────────────────────────────

function CenterOfMassChart({ profile }: { profile: ProfilePayload }) {
  const ref = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { w: W } = useSize(containerRef);
  const H = 112;
  const { avg_year, min_year, max_year, dominant_decade } = profile;
  if (!avg_year) return <div ref={containerRef} style={{ height: H }} />;

  const leftW = Math.min(190, Math.max(140, Math.round(W * 0.26)));
  const trackLeft = leftW + 14;
  const trackRight = W - 26;
  const trackY = H - 48;
  const trackW = trackRight - trackLeft;

  function xFor(yr: number) {
    return trackLeft + trackW * (yr - min_year) / Math.max(1, max_year - min_year);
  }

  const gradStops: [number, number][] = [[0, 0], [0.25, 45], [0.5, 115], [0.75, 190], [1, 270]];
  const gradId = "com-grad";

  const xAvg = xFor(avg_year);

  return (
    <div ref={containerRef} style={{ background: "#141414", borderRadius: 18, overflow: "hidden" }}>
      {W > 0 && (
        <svg ref={ref} width={W} height={H} style={{ display: "block" }}>
          <defs>
            <linearGradient id={gradId} x1={trackLeft} y1="0" x2={trackRight} y2="0" gradientUnits="userSpaceOnUse">
              {gradStops.map(([o, hue]) => (
                <stop key={o} offset={o} stopColor={hsvToHex(hue, 175, 220)} />
              ))}
            </linearGradient>
          </defs>
          {/* Big avg year */}
          <text x={18} y={48} fill="#fff" fontSize={34} fontWeight={700}>{avg_year}</text>
          {/* Meta */}
          {dominant_decade && (
            <text x={20} y={66} fill="#444" fontSize={10} fontWeight={700}>{`heaviest decade: ${dominant_decade}`}</text>
          )}
          {/* Track bar */}
          {trackW >= 80 && (
            <>
              <rect x={trackLeft} y={trackY - 5} width={trackW} height={20} rx={10} fill={`url(#${gradId})`} />
              {/* Avg marker line */}
              <line x1={xAvg} y1={trackY - 18} x2={xAvg} y2={trackY + 28} stroke="#fff" strokeWidth={2.2} />
              {/* Avg dot */}
              <circle cx={xAvg} cy={trackY + 5} r={9} fill="#fff" />
              {/* Labels */}
              <text x={trackLeft} y={trackY + 32} fill="#555" fontSize={9}>{min_year}</text>
              <text x={trackRight} y={trackY + 32} fill="#555" fontSize={9} textAnchor="end">{max_year}</text>
              <text x={xAvg} y={trackY - 22} fill="#555" fontSize={9} textAnchor="middle">{avg_year}</text>
            </>
          )}
        </svg>
      )}
    </div>
  );
}

// ─── DecadeFingerprintChart ───────────────────────────────────────────────────

function DecadeFingerprintChart({ profile }: { profile: ProfilePayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w: W } = useSize(containerRef);
  const { decades } = profile;
  if (!decades.length) return <div ref={containerRef} />;

  const H = Math.max(112, decades.length * 15 + 20);
  const left = 18, right = W - 18;
  const labelW = 48, countW = 44;
  const barX = left + labelW;
  const barW = Math.max(20, right - barX - countW);
  const maxPlays = Math.max(...decades.map(d => d.plays), 1);
  const total = decades.reduce((a, d) => a + d.plays, 0) || 1;

  return (
    <div ref={containerRef} style={{ background: "#141414", borderRadius: 18, overflow: "hidden" }}>
      {W > 0 && (
        <svg width={W} height={H} style={{ display: "block" }}>
          {decades.map((item, i) => {
            const y = 10 + i * 15;
            const hue = Math.round((i / Math.max(1, decades.length - 1)) * 250);
            const col = hsvToHex(hue, 175, 220);
            const fillW = barW * item.plays / maxPlays;
            const pct = Math.round(item.plays * 100 / total);
            return (
              <g key={item.decade}>
                <text x={left} y={y + 7} fill="#555" fontSize={9} fontWeight={700} dominantBaseline="middle">{item.label}</text>
                <rect x={barX} y={y} width={barW} height={8} rx={4} fill="#232323" />
                <rect x={barX} y={y} width={fillW} height={8} rx={4} fill={col} />
                <text x={right - countW} y={y + 7} fill="#444" fontSize={9} fontWeight={700} dominantBaseline="middle">{pct}%</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

// ─── YearConstellationChart ───────────────────────────────────────────────────

function YearConstellationChart({ profile }: { profile: ProfilePayload }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w: W } = useSize(containerRef);
  const H = 190;
  const { years } = profile;
  if (!years.length) return <div ref={containerRef} style={{ height: H }} />;

  const left = 56, right = W - 24, top = 14, bottom = H - 42;
  const minYear = years[0].year, maxYear = years[years.length - 1].year;
  const maxPlays = Math.max(...years.map(y => y.plays), 1);
  const maxAlbums = Math.max(...years.map(y => y.albums), 1);
  const decadeSpan = Math.max(10, maxYear - minYear);
  const baseDecade = Math.floor(minYear / 10) * 10;

  function xFor(yr: number) { return left + (right - left) * (yr - minYear) / Math.max(1, maxYear - minYear); }
  function yFor(alb: number) { return bottom - (bottom - top) * alb / maxAlbums; }
  function hueFor(yr: number) { return Math.round((Math.floor(yr / 10) * 10 - baseDecade) / decadeSpan * 270); }

  // Decade peaks
  const decPeaks = new Map<number, typeof years[0]>();
  years.forEach(item => {
    const dec = Math.floor(item.year / 10) * 10;
    if (!decPeaks.has(dec) || item.albums > decPeaks.get(dec)!.albums) decPeaks.set(dec, item);
  });
  const peakYears = new Set(Array.from(decPeaks.values()).map(d => d.year));

  const els: JSX.Element[] = [];

  if (W <= 0) return <div ref={containerRef} style={{ height: H }} />;

  // Background
  els.push(<rect key="bg" x={0} y={0} width={W} height={H} rx={18} fill="#141414" />);

  // Grid
  [0.25, 0.5, 0.75, 1.0].forEach(frac => {
    const alb = Math.max(1, Math.round(maxAlbums * frac));
    const y = yFor(alb);
    els.push(<line key={`hg-${frac}`} x1={left} y1={y} x2={right} y2={y} stroke="#1c1c1c" strokeWidth={1} />);
    els.push(<text key={`ha-${frac}`} x={left - 6} y={y + 4} fill="#484848" fontSize={9} fontWeight={700} textAnchor="end">{alb}</text>);
  });
  for (let dec = baseDecade; dec <= maxYear + 10; dec += 10) {
    const x = xFor(dec);
    if (x < left || x > right) continue;
    els.push(<line key={`vg-${dec}`} x1={x} y1={top} x2={x} y2={bottom} stroke="#1c1c1c" strokeWidth={1} />);
    els.push(<text key={`vl-${dec}`} x={x} y={bottom + 14} fill="#505050" fontSize={9} fontWeight={700} textAnchor="middle">{dec}</text>);
  }

  // Axis labels
  els.push(<text key="xax" x={(left + right) / 2} y={H - 4} fill="#444" fontSize={9} fontWeight={700} textAnchor="middle">release year</text>);
  els.push(<text key="bsz" x={right - 2} y={top + 10} fill="#444" fontSize={9} fontWeight={700} textAnchor="end">bubble size = plays</text>);

  // Bubbles sorted small → large
  [...years].sort((a, b) => a.plays - b.plays).forEach((item, i) => {
    const x = xFor(item.year);
    const y = yFor(item.albums);
    const radius = 1.8 + 8.4 * Math.pow(item.plays / maxPlays, 0.55);
    const col = hsvToHex(hueFor(item.year), 200, 235);
    if (item.plays >= maxPlays * 0.35) {
      els.push(<circle key={`glow-${i}`} cx={x} cy={y} r={radius + 2.5} fill="rgba(255,255,255,0.039)" />);
    }
    els.push(<circle key={`bub-${i}`} cx={x} cy={y} r={radius} fill={col} fillOpacity={0.667} />);
    if (peakYears.has(item.year)) {
      const ring = hsvToHex(hueFor(item.year), 180, Math.min(255, 235 * 1.35));
      els.push(<circle key={`ring-${i}`} cx={x} cy={y} r={radius} fill="none" stroke={ring} strokeOpacity={0.667} strokeWidth={1.1} />);
    }
  });

  // Decade-peak labels
  const labelRects: [number, number, number, number][] = [];
  Array.from(decPeaks.values())
    .sort((a, b) => b.albums - a.albums)
    .forEach(item => {
      const x = xFor(item.year);
      const y = yFor(item.albums);
      const radius = 1.8 + 8.4 * Math.pow(item.plays / maxPlays, 0.55);
      const candidates: [number, number][] = [
        [x - 22, y - radius - 14],
        [x - 22, y + radius + 1],
        [x - 48, y - 6],
        [x + 4, y - 6],
        [x - 48, y - radius - 14],
        [x + 4, y - radius - 14],
      ];
      let placed = false;
      for (const [lx, ly] of candidates) {
        if (ly < top || ly + 13 > bottom) continue;
        const overlaps = labelRects.some(([rx, ry, rw, rh]) =>
          lx < rx + rw + 3 && lx + 44 > rx - 3 && ly < ry + rh + 3 && ly + 13 > ry - 3
        );
        if (overlaps) continue;
        labelRects.push([lx, ly, 44, 13]);
        const col = hsvToHex(hueFor(item.year), 200, 240);
        els.push(<text key={`lbl-${item.year}`} x={lx + 22} y={ly + 10} fill={col} fontSize={10} fontWeight={700} textAnchor="middle">{item.year}</text>);
        placed = true;
        break;
      }
      return placed;
    });

  return (
    <div ref={containerRef} style={{ overflow: "hidden" }}>
      <svg width={W} height={H} style={{ display: "block" }}>
        {els}
      </svg>
    </div>
  );
}

// ─── Card wrapper (for Drift sub-view sections) ───────────────────────────────

function DriftSection({ title, headerRight, children }: { title: string; headerRight?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: "#141414", borderRadius: 18, padding: "14px 16px 16px", flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
        <span style={{ color: "#666", fontSize: 11, fontWeight: 700, letterSpacing: 2 }}>{title}</span>
        <div style={{ flex: 1 }} />
        {headerRight}
      </div>
      {children}
    </div>
  );
}

// ─── ErasTab ──────────────────────────────────────────────────────────────────

export function ErasTab() {
  const [view, setView] = useState<ErasView>("Timeline");
  const [metric, setMetric] = useState<TimelineMetric>("Albums");
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);

  const { data: tlData, isLoading: tlLoading, isError: tlError } = useQuery<TimelinePayload>({
    queryKey: ["stats-timeline", metric, selectedYear],
    queryFn: () => api.get(`/api/stats/timeline?metric=${metric}${selectedYear ? `&year=${selectedYear}` : ""}`),
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  const { data: eraData, isLoading: eraLoading } = useQuery<EraDataPayload>({
    queryKey: ["stats-era-data"],
    queryFn: () => api.get("/api/stats/era-data"),
    staleTime: 300_000,
    enabled: view === "Drift",
  });

  const handleYearClick = useCallback((y: number) => {
    setSelectedYear(prev => prev === y ? null : y);
    setExpanded(false);
  }, []);

  const handleToggleExpand = useCallback(() => {
    setExpanded(e => !e);
  }, []);

  const pillStyle = (active: boolean): React.CSSProperties => ({
    padding: "5px 14px", borderRadius: 20,
    border: active ? "1px solid var(--green)" : "1px solid #2a2a2a",
    background: "transparent",
    color: active ? "var(--green)" : "#666",
    fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer",
  });

  const bars = tlData?.bars ?? [];
  const hasYear = !!selectedYear && view === "Timeline";

  if ((tlLoading || tlError) && view === "Timeline") {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
        {tlLoading ? "Loading…" : "Failed to load timeline data"}
      </div>
    );
  }

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "16px 24px", gap: 12 }}>

      {/* View pills */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {(["Timeline", "Drift"] as ErasView[]).map(v => (
          <button key={v} onClick={() => setView(v)} style={pillStyle(view === v)}>{v}</button>
        ))}
      </div>

      {/* ── Timeline ── */}
      {view === "Timeline" && tlData && (
        <>
          {/* Summary */}
          {!expanded && (
            <div style={{ color: "#666", fontSize: 12, fontWeight: 700, letterSpacing: 2, flexShrink: 0 }}>
              {tlData.summary}
            </div>
          )}

          {/* Hero: timeline chart */}
          {!expanded && (
            <div style={{ flexShrink: 0 }}>
              <TimelineChart
                bars={bars}
                selectedYear={selectedYear}
                metric={metric}
                onYearClick={handleYearClick}
                onMetricChange={m => { setMetric(m); setSelectedYear(null); setExpanded(false); }}
              />
            </div>
          )}

          {/* Detail card */}
          {hasYear ? (
            <DetailCard
              payload={tlData}
              bars={bars}
              expanded={expanded}
              onToggleExpand={handleToggleExpand}
            />
          ) : (
            <div style={{ flex: 1 }} />
          )}
        </>
      )}

      {/* ── Drift ── */}
      {view === "Drift" && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {eraLoading && <div style={{ color: "#555", fontSize: 13, textAlign: "center", paddingTop: 32 }}>Loading…</div>}
          {eraData && (
            <>
              <DriftSection
                title="ERA DRIFT"
                headerRight={
                  <div style={{ textAlign: "right" }}>
                    <div style={{ color: "#fff", fontSize: 13, fontWeight: 700 }}>{eraData.drift.current_avg}</div>
                    <div style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: 1 }}>avg release year</div>
                  </div>
                }
              >
                <EraDriftChart drift={eraData.drift} />
              </DriftSection>

              <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DriftSection title="CENTER OF MASS">
                    <CenterOfMassChart profile={eraData.profile} />
                  </DriftSection>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DriftSection title="DECADE FINGERPRINT">
                    <DecadeFingerprintChart profile={eraData.profile} />
                  </DriftSection>
                </div>
              </div>

              <DriftSection title="YEAR CONSTELLATION">
                <YearConstellationChart profile={eraData.profile} />
              </DriftSection>
            </>
          )}
        </div>
      )}
    </div>
  );
}
