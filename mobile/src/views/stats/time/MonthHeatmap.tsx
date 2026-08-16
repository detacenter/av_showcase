import { useState, useRef, type JSX } from "react";
import { useSize } from "../../../hooks/useSize";
import { HoverTooltip } from "../../../components/HoverTooltip";
import { type DayEntry, type TapHover, RAINBOW_HUES, DOW_LABELS, monthHeatColor, minutesLabel, daysInMonth } from "./helpers";

const MH_LABEL_H = 20, MH_PAD_X = 12, MH_PAD_Y = 10, MH_DOW_H = 16, MH_GAP = 4;

export function MonthHeatmap({ days }: { days: DayEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w, h } = useSize(ref);
  const [hover, setHover] = useState<TapHover | null>(null);

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

  const availW = w - 2 * MH_PAD_X;
  const availH = h - 2 * MH_PAD_Y - MH_LABEL_H - MH_DOW_H;
  // Cell size solved to fit whatever room the card actually has, capped at a modest
  // max — a fixed size (fine on desktop's taller card) overflowed mobile's shorter
  // fixed-height Month card and clipped the last week or two of the grid.
  const cell = availW > 0 && availH > 0 && nRows > 0
    ? Math.max(16, Math.min(42, Math.floor(availW / 7) - MH_GAP, Math.floor(availH / nRows) - MH_GAP))
    : 30;
  const step = cell + MH_GAP;
  const gridW = 7 * step - MH_GAP;
  const gridH = nRows * step - MH_GAP;
  const bx = MH_PAD_X + Math.max(0, Math.floor((availW - gridW) / 2));
  const by = MH_PAD_Y + Math.max(0, Math.floor((availH - gridH) / 2));
  const dowY = by + MH_LABEL_H;
  const gridY = dowY + MH_DOW_H;
  const hue = RAINBOW_HUES[month - 1];
  const rx = Math.min(8, cell / 5);
  const dayFontSize = Math.max(8, Math.min(10, Math.floor(cell * 0.26)));

  const moName = dt0.toLocaleString("en-US", { month: "long", year: "numeric" });
  const els: JSX.Element[] = [
    <text key="lbl" x={bx} y={by + 13} fill="#666" fontSize={11} fontWeight={700}>{moName}</text>,
    ...DOW_LABELS.map((lbl, i) => (
      <text key={`dow-${lbl}`} x={bx + i * step + cell / 2} y={dowY + 11}
        fill="#555" fontSize={9} textAnchor="middle">{lbl}</text>
    )),
  ];
  for (let day = 1; day <= lastDay; day++) {
    const slot = dow0 + day - 1;
    const cx = bx + (slot % 7) * step;
    const cy = gridY + Math.floor(slot / 7) * step;
    const date = new Date(year, month - 1, day);
    const isFuture = date > today;
    const isToday = date.getTime() === today.getTime();
    const mins = byDay.get(day) ?? 0;
    const fill = isFuture ? "rgba(255,255,255,0.035)" : monthHeatColor(hue, mins / maxMin, 50);
    const dateLabel = date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const sub = isFuture ? "Hasn't happened yet" : minutesLabel(mins);
    const key = `d-${day}`;
    els.push(
      <rect key={day} x={cx} y={cy} width={cell} height={cell} rx={rx} ry={rx} fill={fill}
        stroke={isToday ? "rgba(255,255,255,0.8)" : "none"} strokeWidth={isToday ? 1.5 : 0}
        onClick={e => setHover(hv => hv?.key === key ? null : { x: e.clientX, y: e.clientY, label: dateLabel, sub, key })} />
    );
    els.push(
      <text key={`n-${day}`} x={cx + cell * 0.17} y={cy + cell * 0.4 + dayFontSize * 0.4} fill={isFuture ? "#444" : "rgba(255,255,255,0.75)"}
        fontSize={dayFontSize} fontWeight={600} style={{ pointerEvents: "none" }}>{day}</text>
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
