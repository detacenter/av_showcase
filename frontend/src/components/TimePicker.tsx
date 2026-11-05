import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { mondayOf, addDays } from "../lib/dates";
import { RAINBOW_HUES, monthHeatColor } from "../views/stats/time/helpers";

// One calendar picker for the Stats tabs, built on the Time tab's All Time heatmap: one
// row per year, twelve cells in their month hue (brighter = more hours). Weeks go on to
// the chosen month as a day calendar with the picked week outlined; months and years
// are picked straight from the grid.

export type Granularity = "week" | "month" | "year";

interface DayEntry { date: string; minutes: number }
interface HeatPayload { heatmap_all: DayEntry[] }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CELL_W = 22, CELL_H = 18, GAP = 4;

const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const hours = (mins: number) => `${Math.round(mins / 60)} hours`;

export function TimePicker({ label, granularity, value, onPick, avBegan, note, variant = "caps" }: {
  label: string;                 // what the trigger shows, e.g. "OCT 26–NOV 1 · WEEK RECAP"
  granularity: Granularity;
  value: Date;                   // the period's start (a Monday for weeks, the 1st for months, Jan 1 for years)
  onPick: (start: Date) => void;
  avBegan?: Date | null;         // footnote: months before this come from Spotify history
  note?: string | null;          // small badge next to the trigger, e.g. "from Spotify history"
  variant?: "caps" | "plain";    // trigger style: the Stats headers' grey caps, or Sessions' white title
}) {
  const [open, setOpen] = useState(false);
  // Where the user has browsed to inside the popover (weeks only); null = follow the value.
  const [view, setView] = useState<{ year: number; month: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const { data } = useQuery<HeatPayload>({
    queryKey: ["stats-time", "All Time", 0, null, null],
    queryFn: () => api.get("/api/stats/time?mode=All%20Time&month_offset=0"),
    staleTime: 5 * 60_000,
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  // Minutes per day and per month, from the heatmap.
  const { byDay, byMonth, years, maxMonth } = useMemo(() => {
    const byDay = new Map<string, number>();
    const byMonth = new Map<string, number>();
    let maxMonth = 0;
    for (const d of data?.heatmap_all ?? []) {
      if (!d.minutes) continue;
      byDay.set(d.date.slice(0, 10), d.minutes);
      const key = d.date.slice(0, 7);
      const v = (byMonth.get(key) ?? 0) + d.minutes;
      byMonth.set(key, v);
      if (v > maxMonth) maxMonth = v;
    }
    const ys = [...new Set([...byMonth.keys()].map(k => Number(k.slice(0, 4))))].sort();
    return { byDay, byMonth, years: ys, maxMonth };
  }, [data]);

  const shown = view ?? { year: value.getFullYear(), month: value.getMonth() };
  const hue = RAINBOW_HUES[shown.month];

  // Calendar cells for the shown month, Monday first (weeks only).
  const cal = useMemo(() => {
    const first = new Date(shown.year, shown.month, 1);
    const lead = (first.getDay() + 6) % 7;
    const n = new Date(shown.year, shown.month + 1, 0).getDate();
    let maxDay = 0;
    for (let d = 1; d <= n; d++) maxDay = Math.max(maxDay, byDay.get(iso(shown.year, shown.month, d)) ?? 0);
    const weekStart = mondayOf(value), weekEnd = addDays(weekStart, 6);
    const cells: Array<{ key: string; date?: Date; minutes: number; inWeek: boolean }> = [];
    for (let i = 0; i < lead; i++) cells.push({ key: `lead${i}`, minutes: 0, inWeek: false });
    for (let d = 1; d <= n; d++) {
      const date = new Date(shown.year, shown.month, d);
      const key = iso(shown.year, shown.month, d);
      cells.push({ key, date, minutes: byDay.get(key) ?? 0, inWeek: date >= weekStart && date <= weekEnd });
    }
    return { cells, maxDay };
  }, [shown.year, shown.month, byDay, value]);

  // The picked week's days sit in one Monday-first row; outline that span (it can be
  // partial in the month's first or last row).
  const weekIdx = cal.cells.flatMap((c, i) => c.inWeek ? [i] : []);
  const weekBox = weekIdx.length
    ? { row: Math.floor(weekIdx[0] / 7), c0: weekIdx[0] % 7, c1: weekIdx[weekIdx.length - 1] % 7 }
    : null;

  const close = () => { setOpen(false); setView(null); };
  const pickDay = (d: Date) => { onPick(mondayOf(d)); close(); };
  const onMonthCell = (y: number, m: number) => {
    if (granularity === "week") setView({ year: y, month: m });
    else if (granularity === "month") { onPick(new Date(y, m, 1)); close(); }
    else { onPick(new Date(y, 0, 1)); close(); }
  };
  const pickYear = (y: number) => { onPick(granularity === "month" ? new Date(y, value.getMonth(), 1) : new Date(y, 0, 1)); close(); };

  const trigger: CSSProperties = variant === "plain"
    ? { color: "#fff", fontSize: 13, fontWeight: 600, padding: "4px 12px" }
    : { color: "#8a8a8a", fontSize: 12, fontWeight: 700, letterSpacing: 2, padding: "4px 10px 4px 8px" };

  return (
    <div ref={ref} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: variant === "plain" ? "center" : undefined, gap: 8 }}>
      <button onClick={() => { setOpen(o => !o); setView(null); }} aria-expanded={open} aria-haspopup="dialog" style={{
        display: "flex", alignItems: "center", gap: 8, borderRadius: 14, cursor: "pointer",
        border: `1px solid ${open ? "var(--green)" : "transparent"}`, background: open ? "#0f1a1a" : "transparent", ...trigger,
      }}>
        {label}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4l4 4 4-4" fill="none" stroke={variant === "plain" ? "var(--green)" : "currentColor"} strokeWidth="1.6" /></svg>
      </button>
      {note && <span style={{ color: "#8a8a8a", fontSize: 11, padding: "2px 8px", border: "1px solid var(--border)", borderRadius: 10 }}>{note}</span>}

      {open && (
        <div role="dialog" aria-label={`Jump to a ${granularity}`} style={{
          position: "absolute", top: "calc(100% + 8px)", zIndex: 50,
          ...(variant === "plain" ? { left: "50%", transform: "translateX(-50%)" } : { left: 0 }),
          background: "#141414", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, padding: "14px 16px",
          boxShadow: "0 24px 60px rgba(0,0,0,0.6)", display: "flex", flexDirection: "column", gap: 10,
        }}>
          {!data && <span style={{ color: "#555", fontSize: 12, padding: 20 }}>Loading…</span>}
          {data && (
            <div style={{ display: "flex", gap: 20, alignItems: "flex-start" }}>
              <div style={{ display: "grid", gridTemplateColumns: `30px repeat(12, ${CELL_W}px)`, gap: GAP, alignItems: "center" }}>
                <span />
                {MONTHS.map((m, i) => (
                  <span key={m} style={{ color: monthHeatColor(RAINBOW_HUES[i], 0.7), fontSize: 8, fontWeight: 700, textAlign: "center", letterSpacing: 0.5 }}>{m.toUpperCase()}</span>
                ))}
                {years.map(y => (
                  <YearRow key={y} year={y} granularity={granularity} shown={shown} picked={value}
                    byMonth={byMonth} maxMonth={maxMonth} onMonth={m => onMonthCell(y, m)} onYear={() => pickYear(y)} />
                ))}
              </div>
              {granularity === "week" && (
                <>
                  <div style={{ width: 1, alignSelf: "stretch", background: "#222" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: monthHeatColor(hue, 0.85) }}>{MONTHS[shown.month]} {shown.year}</span>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 18px)", gridAutoRows: 18, gridTemplateRows: "10px", gap: GAP, position: "relative" }}>
                      {weekBox && (
                        // One outline around the picked week's days, not a ring per day.
                        <div aria-hidden="true" style={{
                          position: "absolute", pointerEvents: "none", zIndex: 1, boxSizing: "border-box",
                          top: 14 + weekBox.row * 22 - 3, left: weekBox.c0 * 22 - 3,
                          width: (weekBox.c1 - weekBox.c0) * 22 + 18 + 6, height: 18 + 6,
                          border: "2px solid var(--green)", borderRadius: 7,
                        }} />
                      )}
                      {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i} style={{ color: "#555", fontSize: 8, fontWeight: 700, textAlign: "center", lineHeight: "10px" }}>{d}</span>)}
                      {cal.cells.map(c => c.date ? (
                        <button key={c.key} onClick={() => pickDay(c.date as Date)} title={`${MONTHS[shown.month]} ${c.date.getDate()} · ${Math.round(c.minutes / 60)}h ${c.minutes % 60}m`} aria-label={`${MONTHS[shown.month]} ${c.date.getDate()}`} style={{
                          width: 18, height: 18, borderRadius: 4, padding: 0, border: "none", cursor: "pointer",
                          background: monthHeatColor(hue, cal.maxDay ? c.minutes / cal.maxDay : 0),
                        }} />
                      ) : <span key={c.key} style={{ width: 18, height: 18 }} />)}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
          {data && avBegan && (
            <span style={{ color: "#555", fontSize: 10, whiteSpace: "nowrap" }}>
              AV began {avBegan.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · earlier is Spotify history
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function YearRow({ year, granularity, shown, picked, byMonth, maxMonth, onMonth, onYear }: {
  year: number; granularity: Granularity; shown: { year: number; month: number }; picked: Date;
  byMonth: Map<string, number>; maxMonth: number; onMonth: (m: number) => void; onYear: () => void;
}) {
  const isPickedYear = year === picked.getFullYear();
  const yearTotal = MONTHS.reduce((s, _, m) => s + (byMonth.get(`${year}-${String(m + 1).padStart(2, "0")}`) ?? 0), 0);
  // Years are picked by row: the picked year gets one outline around its twelve cells.
  const rowOutline = granularity === "year" && isPickedYear;
  return (
    <>
      <button onClick={onYear} disabled={!yearTotal || granularity === "week"} title={`${year} · ${hours(yearTotal)}`} style={{
        background: "transparent", border: "none", padding: 0, textAlign: "left", fontFamily: "inherit",
        color: isPickedYear ? "#ddd" : "#555", fontSize: 10, fontWeight: 700,
        cursor: yearTotal && granularity !== "week" ? "pointer" : "default",
      }}>{String(year).slice(2)}</button>
      {MONTHS.map((name, m) => {
        const mins = byMonth.get(`${year}-${String(m + 1).padStart(2, "0")}`) ?? 0;
        const ringed = granularity === "week" ? year === shown.year && m === shown.month
          : granularity === "month" ? isPickedYear && m === picked.getMonth() : false;
        return (
          <button key={m} disabled={!mins} onClick={() => onMonth(m)} title={`${name} ${year}${mins ? ` · ${hours(mins)}` : ""}`} aria-label={`${name} ${year}`} style={{
            position: "relative", width: CELL_W, height: CELL_H, borderRadius: 3, padding: 0, cursor: mins ? "pointer" : "default",
            background: monthHeatColor(RAINBOW_HUES[m], maxMonth ? mins / maxMonth : 0),
            border: ringed ? "2px solid #fff" : "1px solid transparent", boxSizing: "border-box",
          }}>
            {rowOutline && m === 0 && (
              <span aria-hidden="true" style={{
                position: "absolute", pointerEvents: "none", left: -4, top: -4, boxSizing: "border-box",
                width: 12 * CELL_W + 11 * GAP + 8, height: CELL_H + 8, border: "2px solid var(--green)", borderRadius: 6, zIndex: 1,
              }} />
            )}
          </button>
        );
      })}
    </>
  );
}
