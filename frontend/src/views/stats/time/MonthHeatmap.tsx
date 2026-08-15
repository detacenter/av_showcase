import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { HoverTooltip } from "../HoverTooltip";
import { type DayEntry, RAINBOW_HUES, DOW_LABELS, monthHeatColor, minutesLabel, daysInMonth } from "./helpers";

const MH_LABEL_H = 22, MH_PAD_X = 20, MH_PAD_Y = 16, MH_DOW_H = 20;
const MH_CELL = 42, MH_GAP = 6, MH_STEP = MH_CELL + MH_GAP;

export function MonthHeatmap({ days }: { days: DayEntry[] }) {
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
      <HoverTooltip hover={hover} />
    </div>
  );
}
