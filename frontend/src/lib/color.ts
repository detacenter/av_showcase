// Color helpers for the accent picker. HSV is what the picker drags in: hue 0-360,
// saturation and value 0-1.

export interface Hsv { h: number; s: number; v: number }

export function normalizeHex(input: string): string | null {
  const m = input.trim().replace(/^#/, "").match(/^([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) return null;
  const hex = m[1].length === 3 ? m[1].split("").map(c => c + c).join("") : m[1];
  return "#" + hex.toLowerCase();
}

export function hexToHsv(hex: string): Hsv {
  const n = normalizeHex(hex) ?? "#1ed760";
  const r = parseInt(n.slice(1, 3), 16) / 255;
  const g = parseInt(n.slice(3, 5), 16) / 255;
  const b = parseInt(n.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    h = max === r ? (g - b) / d + (g < b ? 6 : 0)
      : max === g ? (b - r) / d + 2
      : (r - g) / d + 4;
    h *= 60;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return "#" + [f(5), f(3), f(1)].map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
}

function luminance(hex: string): number {
  const ch = (i: number) => {
    const x = parseInt(hex.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
}

/** WCAG contrast ratio, e.g. 4.5 is the usual floor for body text. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a) + 0.05, lb = luminance(b) + 0.05;
  return Math.max(la, lb) / Math.min(la, lb);
}
