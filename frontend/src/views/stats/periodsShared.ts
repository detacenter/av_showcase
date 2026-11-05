import type { CSSProperties } from "react";
import { API_BASE as ART_BASE } from "../../api/config";

// Pieces shared by Periods › Week/Month (PeriodsTab) and Periods › Year (PeriodsYear).

export function artUrl(path: string | null | undefined): string | null {
  const fn = path?.split("/").pop();
  return fn ? `${ART_BASE}/artwork/${fn}` : null;
}

export const MUTED = "#8a8a8a";
export const SOFT = "#b3b3b3";
export const DOWN = "#e8175d";
export const DOWN_TEXT = "#ff6b9a";

// Decades are ordered, so an ordered ramp (OKLab, amber → cyan, lightness rising),
// not categorical hues. Validated against #1b1b1b; decades before the '40s clamp.
export const DECADE_RAMP: Record<number, string> = {
  1940: "#b0662a", 1950: "#a97b3e", 1960: "#a28d57", 1970: "#9e9c6f", 1980: "#9daa82",
  1990: "#99b991", 2000: "#8cc9a3", 2010: "#6fdbbd", 2020: "#2aebe2",
};
export const decadeColor = (d: number) => DECADE_RAMP[Math.min(2020, Math.max(1940, d))];
export const decadeName = (d: number) => `’${String(d % 100).padStart(2, "0")}s`;

export const card: CSSProperties = { background: "#1b1b1b", borderRadius: 12, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 10, minWidth: 0 };
