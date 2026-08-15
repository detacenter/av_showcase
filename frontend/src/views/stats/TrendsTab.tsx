import { useRef, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSize } from "../../hooks/useSize";

import { API_BASE as API } from "../../api/config";

// ─────────────────────────────────────────────────────────────────────────────
// Color helpers
// ─────────────────────────────────────────────────────────────────────────────

function hslFromGenre(genre: string): string {
  // Port of _genre_stable_color: MD5 hash → hue, sat=179/255≈70%, lightness=158/255≈62%
  let h = 0;
  for (let i = 0; i < genre.length; i++) {
    h = (Math.imul(31, h) + genre.charCodeAt(i)) | 0;
  }
  // Simple hash that distributes well enough
  h = Math.abs(h) % 360;
  return `hsl(${h}, 70%, 62%)`;
}

const MOUNTAIN_PALETTE = [
  "#0fd7a5", "#2bb7ff", "#6f7dff", "#a46cff",
  "#e65aa5", "#ff7a59", "#f2c94c", "#9be15d",
  "#00b8a9", "#5dd6ff", "#8f9bff", "#c084fc",
  "#ff8cc6", "#ff9f43", "#d4e157", "#5eead4",
];

function rolling(values: number[], window = 7): number[] {
  return values.map((_, i) => {
    const chunk = values.slice(Math.max(0, i - window + 1), i + 1);
    return chunk.reduce((a, b) => a + b, 0) / chunk.length;
  });
}

function monthTicks(days: string[]): Array<{ i: number; label: string }> {
  const ticks: Array<{ i: number; label: string }> = [];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  let prev = -1;
  days.forEach((d, i) => {
    const m = new Date(d).getMonth();
    if (m !== prev) {
      ticks.push({ i, label: months[m] });
      prev = m;
    }
  });
  return ticks;
}

// ─────────────────────────────────────────────────────────────────────────────
// Card wrapper
// ─────────────────────────────────────────────────────────────────────────────

function TrendsCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{
      background: "#141414",
      borderRadius: 14,
      padding: "14px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
    }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, letterSpacing: "0.05em" }}>{title}</span>
        {subtitle && <span style={{ color: "#555", fontSize: 11 }}>{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SparklineGrid
// ─────────────────────────────────────────────────────────────────────────────

const METRICS = [
  { key: "plays",   label: "Plays",   color: "#00c2a8" },
  { key: "time_h",  label: "Hours",   color: "#4f8cff" },
  { key: "artists", label: "Artists", color: "#ffb000" },
] as const;
type MetricKey = typeof METRICS[number]["key"] | "all";

interface DailyEntry {
  date: string;
  plays: number;
  time_h: number;
  artists: number;
  albums: number;
}

function SparklineGrid({ days }: { days: DailyEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w } = useSize(containerRef);
  const [metric, setMetric] = useState<MetricKey>("plays");
  const H = 280;
  const left = 18, right = w - 18, top = 42, bottom = H - 28;
  const pw = right - left, ph = bottom - top;
  const n = days.length;
  const xOf = (i: number) => left + pw * i / Math.max(n - 1, 1);

  // Metric toggle hit areas
  const [toggleRects, setToggleRects] = useState<Array<{ key: MetricKey; x: number; y: number; w: number; h: number }>>([]);

  const handleClick = useCallback((e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    for (const tr of toggleRects) {
      if (mx >= tr.x && mx <= tr.x + tr.w && my >= tr.y && my <= tr.y + tr.h) {
        setMetric(tr.key);
        return;
      }
    }
  }, [toggleRects]);

  if (!w || days.length < 2) {
    return <div ref={containerRef} style={{ height: H, width: "100%" }} />;
  }

  const ticks = monthTicks(days.map(d => d.date));

  function renderSingle(m: typeof METRICS[number]) {
    const values = days.map(d => d[m.key as keyof DailyEntry] as number);
    const avg = rolling(values);
    const maxV = Math.max(...values) || 1;
    const yOf = (v: number) => top + ph * (1 - v / maxV);

    const areaD = [`M${xOf(0)},${bottom}`]
      .concat(avg.map((v, i) => `L${xOf(i)},${yOf(v)}`))
      .concat([`L${xOf(n - 1)},${bottom}Z`])
      .join(" ");

    const lineD = avg.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");

    const current = avg[avg.length - 1] ?? 0;
    const display = m.key === "time_h" ? current.toFixed(1) : String(Math.round(current));

    return (
      <>
        <defs>
          <linearGradient id={`sg-fill-${m.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={m.color} stopOpacity="0.20" />
            <stop offset="100%" stopColor={m.color} stopOpacity="0.016" />
          </linearGradient>
        </defs>
        <path d={areaD} fill={`url(#sg-fill-${m.key})`} />
        {values.map((v, i) => v > 0 && (
          <circle key={i} cx={xOf(i)} cy={yOf(v)} r={2.4} fill={m.color} fillOpacity={0.35} />
        ))}
        {/* glow */}
        <path d={lineD} fill="none" stroke={m.color} strokeWidth={5} strokeOpacity={0.25} strokeLinecap="round" strokeLinejoin="round" />
        <path d={lineD} fill="none" stroke={m.color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        <text x={right - 8} y={20} textAnchor="end" fill="#fff" fontSize={18} fontWeight={700}>{display}</text>
        <text x={right - 8} y={37} textAnchor="end" fill="#666" fontSize={10} fontWeight={600}>7-day avg {m.label.toLowerCase()}</text>
      </>
    );
  }

  function renderAll() {
    return METRICS.map((m) => {
      const values = days.map(d => d[m.key as keyof DailyEntry] as number);
      const avg = rolling(values);
      const maxAvg = Math.max(...avg) || 1;
      const yOf = (v: number) => top + ph * (1 - v / maxAvg);
      const lineD = avg.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");
      return (
        <path key={m.key} d={lineD} fill="none" stroke={m.color} strokeWidth={1.9} strokeOpacity={0.82} strokeLinecap="round" strokeLinejoin="round" />
      );
    });
  }

  // Build toggle rects for click
  const allMetrics: Array<{ key: MetricKey; label: string; color: string }> = [
    ...METRICS,
    { key: "all", label: "All", color: "#ffffff" },
  ];
  const approxCharW = 7;
  let tx = 18;
  const ty = 8;
  const computedRects = allMetrics.map(m => {
    const tw = m.label.length * approxCharW;
    const r = { key: m.key, x: tx - 8, y: ty - 5, w: tw + 16, h: 28 };
    tx += tw + 18;
    return r;
  });

  // Y axis labels (only for single metric)
  const activeMetric = METRICS.find(m => m.key === metric);
  const gridLabels = activeMetric ? (() => {
    const values = days.map(d => d[activeMetric.key as keyof DailyEntry] as number);
    const maxV = Math.max(...values) || 1;
    return [0.25, 0.5, 0.75].map(frac => ({
      y: top + ph * frac,
      label: activeMetric.key === "time_h" ? (maxV * (1 - frac)).toFixed(1) : String(Math.round(maxV * (1 - frac))),
    }));
  })() : [];

  return (
    <div ref={containerRef} style={{ height: H, width: "100%" }}>
      <svg
        width={w}
        height={H}
        onClick={handleClick}
        style={{ cursor: "default", display: "block" }}
        ref={el => {
          if (el && toggleRects.length === 0) {
            setToggleRects(computedRects);
          }
        }}
      >
        <rect x={0} y={0} width={w} height={H} rx={18} fill="#0d0d0d" />

        {/* metric toggle */}
        {allMetrics.map((m, idx) => {
          let tx2 = 18;
          for (let k = 0; k < idx; k++) tx2 += allMetrics[k].label.length * approxCharW + 18;
          return (
            <text key={m.key} x={tx2} y={22} fill={m.key === metric ? m.color : "#555"} fontSize={11} fontWeight={700} style={{ cursor: "pointer" }}>
              {m.label}
            </text>
          );
        })}

        {/* grid lines */}
        {[0.25, 0.5, 0.75].map(frac => {
          const gy = top + ph * frac;
          return (
            <g key={frac}>
              <line x1={left} y1={gy} x2={right} y2={gy} stroke="rgba(255,255,255,0.063)" strokeWidth={1} />
              {metric !== "all" && gridLabels.length > 0 && (
                <text x={left + 4} y={gy - 4} fill="#555" fontSize={9} fontWeight={600}>
                  {gridLabels.find((_, i) => [0.25, 0.5, 0.75][i] === frac)?.label}
                </text>
              )}
            </g>
          );
        })}

        {/* chart */}
        {metric === "all" ? renderAll() : renderSingle(METRICS.find(m => m.key === metric)!)}

        {/* month ticks */}
        {ticks.map(({ i, label }) => (
          <g key={i}>
            <line x1={xOf(i)} y1={bottom} x2={xOf(i)} y2={bottom + 5} stroke="#2a2a2a" strokeWidth={1} />
            <text x={xOf(i)} y={bottom + 16} textAnchor="middle" fill="#555" fontSize={10}>{label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GenreMountain
// ─────────────────────────────────────────────────────────────────────────────

interface MountainMode {
  title: string;
  subtitle: string;
  weeks: string[];
  labels: string[];
  cumulative: Record<string, number[]>;
  total_cum: number[];
}

interface GenreMountainData {
  default_mode: string;
  modes: Record<string, MountainMode>;
}

const PAL = MOUNTAIN_PALETTE;

function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * amt));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * amt));
  const b = Math.min(255, Math.round((n & 0xff) * amt));
  return `rgb(${r},${g},${b})`;
}

function GenreMountainChart({ data }: { data: GenreMountainData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w } = useSize(containerRef);
  const [mode, setMode] = useState(data.default_mode || "Genres");

  const PAD_L = 14, PAD_R = 96, PAD_T = 38, PAD_B = 28;
  const H = 316;

  const modeData: MountainMode | undefined = data.modes?.[mode];
  const weeks = modeData?.weeks ?? [];
  const labels = modeData?.labels ?? [];
  const cumulative = modeData?.cumulative ?? {};
  const total_cum = modeData?.total_cum ?? [];
  const MODES = Object.keys(data.modes || {});

  if (!w || weeks.length < 2 || !labels.length || !total_cum.length) {
    return <div ref={containerRef} style={{ height: H, width: "100%" }} />;
  }

  const pw = w - PAD_L - PAD_R;
  const ph = H - PAD_T - PAD_B;
  const n = weeks.length;
  // OGAV: max_v = total_cum[-1] (last/highest cumulative value)
  const maxV = total_cum[total_cum.length - 1] || 1;
  const xOf = (i: number) => PAD_L + pw * i / Math.max(n - 1, 1);
  const yOf = (v: number) => PAD_T + ph * (1 - v / maxV);

  // OGAV: scale genres proportionally so the stack always fills to total_cum
  const sumTop = Array.from({ length: n }, (_, i) => labels.reduce((s, g) => s + (cumulative[g]?.[i] ?? 0), 0));
  const scale = sumTop.map((s, i) => total_cum[i] / Math.max(s, 1));
  const scaled: Record<string, number[]> = {};
  for (const g of labels) {
    scaled[g] = (cumulative[g] ?? new Array(n).fill(0)).map((v, i) => v * scale[i]);
  }

  // Build stacked area paths (bottoms → tops for each genre)
  const bottoms: number[] = new Array(n).fill(0);
  interface AreaEntry { gi: number; genre: string; color: string; pathD: string; seamD: string; bottoms0: number[]; tops0: number[]; }
  const areas: AreaEntry[] = [];
  for (let gi = 0; gi < labels.length; gi++) {
    const g = labels[gi];
    const tops = bottoms.map((b, i) => b + (scaled[g]?.[i] ?? 0));
    const pathD =
      `M${xOf(0)},${yOf(bottoms[0])}` +
      tops.map((_, i) => `L${xOf(i)},${yOf(tops[i])}`).join("") +
      Array.from({ length: n }, (_, i) => n - 1 - i).map(i => `L${xOf(i)},${yOf(bottoms[i])}`).join("") +
      "Z";
    const seamD = gi > 0
      ? `M${xOf(0)},${yOf(bottoms[0])}` + bottoms.slice(1).map((_, i) => `L${xOf(i + 1)},${yOf(bottoms[i + 1])}`).join("")
      : "";
    areas.push({ gi, genre: g, color: PAL[gi % PAL.length], pathD, seamD, bottoms0: [...bottoms], tops0: [...tops] });
    for (let i = 0; i < n; i++) bottoms[i] = tops[i];
  }

  // Y-axis grid at every 1000
  const gridStep = 1000;
  const gridLines: number[] = [];
  for (let v = gridStep; v < maxV; v += gridStep) gridLines.push(v);

  // Total outline
  const outlineD =
    `M${xOf(0)},${yOf(total_cum[0])}` +
    total_cum.slice(1).map((v, i) => `L${xOf(i + 1)},${yOf(v)}`).join("");

  // Month ticks
  const seenYM = new Set<string>();
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const monthLabels: Array<{ x: number; label: string }> = [];
  weeks.forEach((w2, i) => {
    const dt = new Date(w2 + "T12:00:00");
    const ym = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (!seenYM.has(ym)) {
      seenYM.add(ym);
      monthLabels.push({ x: xOf(i), label: MONTHS[dt.getMonth()] });
    }
  });

  // Right-side genre labels positioned at band midpoints (at the last x position)
  const lastBottoms: number[] = new Array(labels.length + 1).fill(0);
  for (let gi = 0; gi < labels.length; gi++) {
    lastBottoms[gi + 1] = lastBottoms[gi] + (scaled[labels[gi]]?.[n - 1] ?? 0);
  }

  return (
    <div ref={containerRef} style={{ height: H, width: "100%" }}>
      <svg width={w} height={H} style={{ display: "block" }}>
        {/* Background */}
        <rect x={0} y={0} width={w} height={H} rx={18} fill="#101010" />

        {/* Mode toggle */}
        {(() => {
          let tx = PAD_L;
          return MODES.map(m => {
            const tw = m.length * 7.2;
            const gap = 18;
            const el = (
              <text key={m} x={tx} y={22} fill={m === mode ? "#20a7ff" : "#555"} fontSize={11} fontWeight={700}
                style={{ cursor: "pointer" }} onClick={() => setMode(m)}>
                {m}
              </text>
            );
            tx += tw + gap;
            return el;
          });
        })()}

        {/* Y-axis grid */}
        {gridLines.map(v => (
          <g key={v}>
            <line x1={PAD_L} y1={yOf(v)} x2={PAD_L + pw} y2={yOf(v)} stroke="rgba(255,255,255,0.055)" strokeWidth={1} />
            <text x={PAD_L + 4} y={yOf(v) - 4} fill="#444" fontSize={9} fontWeight={600}>
              {v >= 1000 && v % 1000 === 0 ? `${v / 1000}k` : v}
            </text>
          </g>
        ))}

        {/* Gradient defs */}
        <defs>
          {areas.map(({ gi, color }) => (
            <linearGradient key={gi} id={`mg-${gi}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={lighten(color, 1.25)} stopOpacity={238 / 255} />
              <stop offset="100%" stopColor={lighten(color, 0.89)} stopOpacity={218 / 255} />
            </linearGradient>
          ))}
        </defs>

        {/* Stacked bands */}
        {areas.map(({ gi, genre, pathD, seamD }) => (
          <g key={genre}>
            <path d={pathD} fill={`url(#mg-${gi})`} />
            {seamD && <path d={seamD} fill="none" stroke="rgba(0,0,0,0.149)" strokeWidth={0.8} />}
          </g>
        ))}

        {/* White outline glow */}
        <path d={outlineD} fill="none" stroke="rgba(255,255,255,0.212)" strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" />
        <path d={outlineD} fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />

        {/* Total label */}
        <text x={PAD_L + pw + 8} y={PAD_T - 10} fill="#fff" fontSize={11} fontWeight={600}>
          {total_cum[total_cum.length - 1]?.toLocaleString()} total
        </text>

        {/* Genre labels at band midpoints on right edge */}
        {labels.map((g, gi) => {
          const bandH = Math.abs(yOf(lastBottoms[gi]) - yOf(lastBottoms[gi + 1]));
          if (bandH < 10) return null;
          const labelY = yOf(lastBottoms[gi] + (scaled[g]?.[n - 1] ?? 0) / 2);
          const col = PAL[gi % PAL.length];
          return (
            <text key={g} x={PAD_L + pw + 8} y={labelY + 4} fill={col} fillOpacity={0.9} fontSize={10}>
              {g.length > 20 ? g.slice(0, 20) : g}
            </text>
          );
        })}

        {/* Month ticks */}
        {monthLabels.map(({ x, label }) => (
          <g key={label + x}>
            <line x1={x} y1={H - PAD_B} x2={x} y2={H - PAD_B + 4} stroke="#2a2a2a" strokeWidth={1} />
            <text x={x} y={H - PAD_B + 14} textAnchor="middle" fill="#555" fontSize={10}>{label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MyDiscoveryChart
// ─────────────────────────────────────────────────────────────────────────────

interface DiscoveryData {
  days: string[];
  new: number[];
  returning: number[];
  ratio: number[];
  cumulative: number[];
  total_new: number;
}

function DiscoveryChart({ artistData, trackData }: { artistData: DiscoveryData; trackData: DiscoveryData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w } = useSize(containerRef);
  const [mode, setMode] = useState<"Artists" | "Tracks">("Artists");
  const [hoveredIdx, setHoveredIdx] = useState(-1);
  const H = 220;
  const PAD_L = 36, PAD_R = 116, PAD_T = 32, PAD_B = 28;

  const data = mode === "Tracks" ? trackData : artistData;
  const { days, new: dayNew, returning: dayRet, total_new } = data;
  const n = days.length;

  if (!w || n < 2) {
    return <div ref={containerRef} style={{ height: H, width: "100%" }} />;
  }

  const pw = w - PAD_L - PAD_R;
  const ph = H - PAD_T - PAD_B;
  const cy = PAD_T + ph * 0.54;
  const maxVal = Math.max(...dayNew, ...dayRet, 1);
  const barW = Math.max(1.5, pw / Math.max(n, 1) * 0.72);
  const xOf = (i: number) => PAD_L + pw * i / Math.max(n - 1, 1);

  const newCol = "#2bb7ff";
  const retCol = "#a46cff";

  // Month labels
  const seenYM = new Set<string>();
  const mLabels: Array<{ x: number; label: string }> = [];
  days.forEach((d, i) => {
    const dt = new Date(d);
    const ym = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (!seenYM.has(ym)) {
      seenYM.add(ym);
      mLabels.push({ x: xOf(i), label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()] });
    }
  });

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < n; i++) {
      const dist = Math.abs(mx - xOf(i));
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    setHoveredIdx(bestDist <= barW * 2.5 ? best : -1);
  };

  const hi = hoveredIdx;
  const hx = hi >= 0 ? xOf(hi) : 0;
  const hNew = hi >= 0 ? (dayNew[hi] ?? 0) : 0;
  const hRet = hi >= 0 ? (dayRet[hi] ?? 0) : 0;

  return (
    <div ref={containerRef} style={{ height: H, width: "100%" }}>
      <svg
        width={w} height={H}
        style={{ display: "block" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHoveredIdx(-1)}
      >
        <rect x={0} y={0} width={w} height={H} rx={18} fill="#101010" />

        {/* Mode toggle */}
        {(["Artists", "Tracks"] as const).map((m, idx) => {
          const tx = 14 + idx * 68;
          return (
            <text key={m} x={tx} y={22} fill={m === mode ? newCol : "#555"} fontSize={11} fontWeight={700}
              style={{ cursor: "pointer" }} onClick={() => { setMode(m); setHoveredIdx(-1); }}>
              {m}
            </text>
          );
        })}

        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(frac => (
          <line key={frac} x1={PAD_L} y1={PAD_T + ph * frac} x2={PAD_L + pw} y2={PAD_T + ph * frac} stroke="rgba(255,255,255,0.055)" strokeWidth={1} />
        ))}
        <line x1={PAD_L} y1={cy} x2={PAD_L + pw} y2={cy} stroke="rgba(255,255,255,0.133)" strokeWidth={1} />

        {/* Bars */}
        {days.map((_, i) => {
          const x = xOf(i);
          const nv = dayNew[i] ?? 0;
          const rv = dayRet[i] ?? 0;
          return (
            <g key={i}>
              {nv > 0 && (() => {
                const bh = (ph / 2 - 4) * Math.sqrt(nv / maxVal);
                return <rect x={x - barW / 2} y={cy - bh} width={barW} height={bh} rx={2} fill={newCol} fillOpacity={0.843} />;
              })()}
              {rv > 0 && (() => {
                const bh = (ph / 2 - 4) * Math.sqrt(rv / maxVal);
                return <rect x={x - barW / 2} y={cy + 1} width={barW} height={bh} rx={2} fill={retCol} fillOpacity={0.804} />;
              })()}
            </g>
          );
        })}

        {/* Hover */}
        {hi >= 0 && (
          <>
            <line x1={hx} y1={PAD_T} x2={hx} y2={H - PAD_B} stroke="rgba(255,255,255,0.118)" strokeWidth={1} />
            {(() => {
              const dLabel = (() => {
                const dt = new Date(days[hi]);
                const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
                return `${months[dt.getMonth()]} ${dt.getDate()}`;
              })();
              const lines = [dLabel, `↑ ${hNew} new`, `↓ ${hRet} returning`];
              const tw = Math.max(...lines.map(l => l.length)) * 7 + 20;
              const th = lines.length * 18 + 10;
              let tx = hx + 8;
              const ty = PAD_T + 4;
              if (tx + tw > w - PAD_R - 4) tx = hx - tw - 8;
              return (
                <g>
                  <rect x={tx} y={ty} width={tw} height={th} rx={6} fill="#1e1e2a" />
                  {lines.map((line, row) => (
                    <text key={row} x={tx + 10} y={ty + 17 + row * 18}
                      fill={row === 0 ? "#fff" : row === 1 ? newCol : retCol} fontSize={11}>{line}</text>
                  ))}
                </g>
              );
            })()}
          </>
        )}

        {/* Month labels */}
        {mLabels.map(({ x, label }) => (
          <text key={label + x} x={x} y={H - PAD_B + 14} textAnchor="middle" fill="#555" fontSize={10}>{label}</text>
        ))}

        {/* Right panel */}
        {(() => {
          const x0 = w - PAD_R + 14;
          const countText = total_new.toLocaleString();
          return (
            <>
              <text x={x0} y={30} fill="#fff" fontSize={18} fontWeight={700}>{countText}</text>
              <text x={x0 + countText.length * 10 + 4} y={27} fill={newCol} fontSize={10} fontWeight={600}>{mode.toLowerCase()}</text>
              <text x={x0} y={cy - 16} fill={newCol} fontSize={10} fontWeight={600}>↑ new</text>
              <text x={x0} y={cy + 24} fill={retCol} fontSize={10} fontWeight={600}>↓ returning</text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GenreWeatherChart
// ─────────────────────────────────────────────────────────────────────────────

interface WeatherData {
  days: string[];
  genres: string[];
  counts: Record<string, number[]>;
  totals: number[];
  diversity: number[];
  leader: string;
  color_map?: Record<string, string>;
}

function GenreWeatherChart({ data }: { data: WeatherData }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { w } = useSize(containerRef);
  const [hoveredDayI, setHoveredDayI] = useState(-1);
  const [hoveredGenre, setHoveredGenre] = useState<string | null>(null);
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const H = 260;
  const PAD_L = 8, PAD_R = 160, PAD_T = 12, PAD_B = 24;

  const { days, genres, counts, totals, color_map } = data;
  const colOf = (genre: string) => color_map?.[genre] ?? hslFromGenre(genre);
  const n = days.length;

  if (!w || n < 2 || !genres.length) {
    return <div ref={containerRef} style={{ height: H, width: "100%" }} />;
  }

  const pw = w - PAD_L - PAD_R;
  const ph = H - PAD_T - PAD_B;
  const colW = Math.max(2, pw / Math.max(n, 1) * 0.92);

  // Build cells
  interface Cell { x: number; y: number; h: number; genre: string; dayI: number; count: number; }
  const cells: Cell[] = [];
  for (let i = 0; i < n; i++) {
    const total = totals[i] ?? 0;
    if (total <= 0) continue;
    let base = PAD_T + ph;
    const x = PAD_L + i * pw / Math.max(n, 1);
    for (let gi = genres.length - 1; gi >= 0; gi--) {
      const g = genres[gi];
      const v = counts[g]?.[i] ?? 0;
      if (v <= 0) continue;
      const segH = ph * v / total;
      cells.push({ x, y: base - segH, h: segH, genre: g, dayI: i, count: v });
      base -= segH;
    }
  }

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let hitGenre: string | null = null;
    for (const c of cells) {
      if (mx >= c.x && mx <= c.x + colW && my >= c.y && my <= c.y + c.h) {
        hitGenre = c.genre;
        break;
      }
    }

    let bestI = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const cx = PAD_L + i * pw / Math.max(n, 1) + colW / 2;
      const d = Math.abs(mx - cx);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    setHoveredDayI(bestD <= colW ? bestI : -1);
    setHoveredGenre(hitGenre);
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let hitGenre: string | null = null;
    for (const c of cells) {
      if (mx >= c.x && mx <= c.x + colW && my >= c.y && my <= c.y + c.h) {
        hitGenre = c.genre;
        break;
      }
    }
    setSelectedGenre(prev => prev === hitGenre ? null : hitGenre);
  };

  // Month labels
  const seenYM = new Set<string>();
  const mLabels: Array<{ x: number; label: string }> = [];
  days.forEach((d, i) => {
    const dt = new Date(d);
    const ym = `${dt.getFullYear()}-${dt.getMonth()}`;
    if (!seenYM.has(ym)) {
      seenYM.add(ym);
      mLabels.push({ x: PAD_L + i * pw / Math.max(n, 1), label: ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][dt.getMonth()] });
    }
  });

  const active = selectedGenre || hoveredGenre;

  return (
    <div ref={containerRef} style={{ height: H, width: "100%" }}>
      <svg
        width={w} height={H}
        style={{ display: "block", cursor: hoveredGenre ? "pointer" : "default" }}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => { setHoveredDayI(-1); setHoveredGenre(null); }}
        onClick={handleClick}
      >
        {/* Columns */}
        {cells.map((c, idx) => {
          const col = colOf(c.genre);
          let opacity = 1;
          if (selectedGenre) opacity = c.genre === selectedGenre ? 1 : 0.118;
          else if (hoveredDayI >= 0) opacity = c.dayI === hoveredDayI ? 1 : 0.353;
          return (
            <rect key={idx} x={c.x} y={c.y} width={colW} height={c.h + 0.3} fill={col} fillOpacity={opacity} />
          );
        })}

        {/* Hover column edge */}
        {hoveredDayI >= 0 && (
          <rect
            x={PAD_L + hoveredDayI * pw / Math.max(n, 1)}
            y={PAD_T} width={colW} height={ph}
            fill="none" stroke="rgba(255,255,255,0.137)" strokeWidth={1}
          />
        )}

        {/* Month labels */}
        {mLabels.map(({ x, label }) => (
          <text key={label + x} x={x} y={H - PAD_B + 14} fill="#555" fontSize={10} textAnchor="middle">{label}</text>
        ))}

        {/* Right panel */}
        {(() => {
          const x0 = w - PAD_R + 14;
          if (hoveredDayI >= 0 && hoveredDayI < n) {
            const total = totals[hoveredDayI] ?? 0;
            const dayGenres = genres
              .map(g => ({ g, cnt: counts[g]?.[hoveredDayI] ?? 0 }))
              .filter(x => x.cnt > 0)
              .sort((a, b) => b.cnt - a.cnt);
            const dt = new Date(days[hoveredDayI]);
            const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
            const dLabel = `${months[dt.getMonth()]} ${dt.getDate()}`;
            return (
              <>
                <text x={x0} y={22} fill="#fff" fontSize={11} fontWeight={700}>{dLabel}</text>
                {dayGenres.slice(0, 10).map(({ g, cnt }, i) => {
                  const pct = total ? `${Math.round(cnt / total * 100)}%` : "";
                  const col = colOf(g);
                  const isActive = !active || g === active;
                  return (
                    <g key={g}>
                      <rect x={x0} y={32 + i * 18 + 4} width={10} height={10} rx={3} fill={col} fillOpacity={isActive ? 1 : 0.275} />
                      <text x={x0 + 16} y={32 + i * 18 + 13} fill={col} fillOpacity={isActive ? 1 : 0.275} fontSize={10}>
                        {(g.length > 14 ? g.slice(0, 14) : g) + "  " + pct}
                      </text>
                    </g>
                  );
                })}
              </>
            );
          }
          return (
            <>
              <text x={x0} y={22} fill="#fff" fontSize={11} fontWeight={700}>daily genre dna</text>
              <text x={x0} y={42} fill="#555" fontSize={10}>daily composition</text>
              <text x={x0} y={60} fill="#555" fontSize={10}>hover · click to isolate</text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TrendsTab
// ─────────────────────────────────────────────────────────────────────────────

interface TrendsData {
  daily: DailyEntry[];
  genre_mountain: GenreMountainData;
  discovery: DiscoveryData;
  discovery_tracks: DiscoveryData;
  genre_weather: WeatherData;
}

export function TrendsTab() {
  const { data } = useQuery<TrendsData>({
    queryKey: ["trends"],
    queryFn: () => fetch(`${API}/api/stats/trends`).then(r => r.json()),
    staleTime: 60_000,
  });

  if (!data) {
    return (
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ color: "#444", fontSize: 12 }}>Loading…</span>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
      <TrendsCard title="RECENT PULSE" subtitle="last 90 days · rolling average">
        <SparklineGrid days={data.daily} />
      </TrendsCard>

      <TrendsCard title="COMPOSITION MOUNTAIN" subtitle="">
        <GenreMountainChart data={data.genre_mountain} />
      </TrendsCard>

      <TrendsCard title="DISCOVERY BALANCE" subtitle="sqrt-scaled · new rises, returning falls">
        <DiscoveryChart artistData={data.discovery} trackData={data.discovery_tracks} />
      </TrendsCard>

      <TrendsCard title="Daily Genre DNA" subtitle="daily genre composition columns · hover to isolate a genre">
        <GenreWeatherChart data={data.genre_weather} />
      </TrendsCard>
    </div>
  );
}
