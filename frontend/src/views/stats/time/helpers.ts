// ─── Types ────────────────────────────────────────────────────────────────────

export type TimeMode = "Month" | "Year" | "All Time";

export interface DayEntry { date: string; minutes: number; }
export interface DayPart  { label: string; minutes: number; }
export interface DaypartFlow {
  days: string[];
  hours: number[][];
  minutes: number[][];
  centers: (number | null)[];
  max_hour: number;
}
export interface DaypartFlowMonthly {
  months: { year: number; month: number }[];
  hours: number[][];
  minutes: number[][];
}

export interface TimePayload {
  mode: string;
  label: string | null;
  has_older: boolean;
  has_newer: boolean;
  heatmap: DayEntry[];
  heatmap_all: DayEntry[];
  minutes_by_dow: number[];
  day_parts: DayPart[][];
  daypart_flow: DaypartFlow;
  daypart_flow_monthly: DaypartFlowMonthly;
}

// ─── Shared constants/helpers (used across 2+ of the split-out files) ─────────

export const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const RAINBOW_HUES = Array.from({ length: 12 }, (_, i) => i * 30);
export const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function monthHeatColor(hue: number, strength: number, lMax = 62): string {
  if (strength <= 0) return "#1e1e1e";
  const t = Math.pow(strength, 1.4);
  const s0 = 35, l0 = 14, s1 = 78, l1 = lMax;
  const s = s0 + t * (s1 - s0), l = l0 + t * (l1 - l0);
  return `hsl(${hue} ${s}% ${l}%)`;
}

export function minutesLabel(m: number): string {
  const h = Math.floor(m / 60), r = m % 60;
  return h ? `${h}h ${r}m` : `${r}m`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
