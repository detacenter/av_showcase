import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { HoverTooltip } from "../HoverTooltip";
import { type DayEntry, RAINBOW_HUES, MONTH_NAMES, monthHeatColor, minutesLabel } from "./helpers";

// All Time zooms out one level further than Year: the atomic cell is a month, not
// a day, so the grid stays legible (12 cols × 1 row/year) no matter how many years
// of history pile up, instead of a day-mosaic shrinking to unreadable dots.

const ATG_PAD = 8, ATG_ROW_LABEL_W = 40, ATG_GAP = 5, ATG_HEAD_H = 22;

export function AllTimeMonthGrid({ days }: { days: DayEntry[] }) {
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
      <HoverTooltip hover={hover} />
    </div>
  );
}
