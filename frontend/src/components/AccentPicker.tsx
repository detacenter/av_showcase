import { useState, type CSSProperties, type PointerEvent } from "react";
import { contrastRatio, hexToHsv, hsvToHex, normalizeHex, type Hsv } from "../lib/color";
import { LogoMark } from "./LogoMark";

// Full accent picker: a hue strip plus a square for how vivid (left to right) and how light
// (top to bottom), a hex field, starting points (vivid and muted), colors you've saved, and a
// live preview of the places the accent shows up. The picker keeps its own HSV so the hue
// survives dragging to gray.

const DEFAULT_ACCENT = "#1ed760";
const BG = "#121212";
const SQ_W = 260, SQ_H = 170;
const MAX_SAVED = 16;
const HUE_LINE =
  "linear-gradient(to right, #ff0000 0%, #ffff00 16.67%, #00ff00 33.33%, #00ffff 50%, #0000ff 66.67%, #ff00ff 83.33%, #ff0000 100%)";

const STARTING_POINTS: [string, string][] = [
  ["Green", DEFAULT_ACCENT], ["Teal", "#2aebe2"], ["Sage", "#8fa98b"], ["Sand", "#c9b48a"],
  ["Dusty rose", "#c08a95"], ["Slate", "#7d93b2"], ["Clay", "#c27a5a"], ["Lavender", "#a597c9"],
];

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

function Knob({ left, top, color, size = 20 }: { left: number; top: number; color: string; size?: number }) {
  return (
    <span style={{
      position: "absolute", left: left - size / 2, top: top - size / 2, width: size, height: size,
      borderRadius: "50%", background: color, border: "3px solid #fff", boxSizing: "border-box",
      boxShadow: "0 1px 6px rgba(0,0,0,.6)", pointerEvents: "none",
    }} />
  );
}

const label: CSSProperties = { fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: 1 };

export function AccentPicker({ value, onChange, saved, onSavedChange }: {
  value: string; onChange: (hex: string) => void;
  saved: string[]; onSavedChange: (list: string[]) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(value));
  const [seen, setSeen] = useState(value);
  const [draft, setDraft] = useState<string | null>(null);
  // A new value from outside (first load, another device): follow it unless it's our own.
  if (value !== seen) {
    setSeen(value);
    if (value.toLowerCase() !== hsvToHex(hsv)) setHsv(hexToHsv(value));
  }
  const hex = hsvToHex(hsv);

  const set = (next: Hsv) => {
    setHsv(next);
    const out = hsvToHex(next);
    setSeen(out);
    onChange(out);
  };
  const setHex = (h: string) => {
    const next = hexToHsv(h);
    set(next.s === 0 ? { ...next, h: hsv.h } : next);
  };

  const dragSquare = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect();
    set({ h: hsv.h, s: clamp01((e.clientX - r.left) / r.width), v: 1 - clamp01((e.clientY - r.top) / r.height) });
  };
  const dragHue = (e: PointerEvent<HTMLDivElement>) => {
    if (e.type === "pointerdown") e.currentTarget.setPointerCapture(e.pointerId);
    else if (!e.buttons) return;
    const r = e.currentTarget.getBoundingClientRect();
    set({ ...hsv, h: clamp01((e.clientX - r.left) / r.width) * 359.9 });
  };

  const ratio = contrastRatio(hex, BG);
  const pureHue = hsvToHex({ h: hsv.h, s: 1, v: 1 });

  return (
    <div style={{ display: "flex", gap: 30, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, width: SQ_W }}>
        <div
          onPointerDown={dragSquare}
          onPointerMove={dragSquare}
          style={{
            position: "relative", width: SQ_W, height: SQ_H, borderRadius: 10, cursor: "crosshair", touchAction: "none",
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureHue})`,
          }}
        >
          <Knob left={hsv.s * SQ_W} top={(1 - hsv.v) * SQ_H} color={hex} />
        </div>
        <div
          onPointerDown={dragHue}
          onPointerMove={dragHue}
          style={{ position: "relative", width: SQ_W, height: 10, borderRadius: 5, background: HUE_LINE, cursor: "pointer", touchAction: "none" }}
        >
          <Knob left={(hsv.h / 360) * SQ_W} top={5} color={pureHue} size={18} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "#1a1a1a", border: "1px solid #2a2a2a",
            borderRadius: 8, padding: "6px 10px", width: 100, boxSizing: "border-box",
          }}>
            <span style={{ color: "#535353", fontFamily: "monospace", fontSize: 13 }}>#</span>
            <input
              value={draft ?? hex.slice(1).toUpperCase()}
              onChange={e => {
                setDraft(e.target.value);
                const n = normalizeHex(e.target.value);
                if (n && e.target.value.replace(/^#/, "").length === 6) setHex(n);
              }}
              onBlur={() => setDraft(null)}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              maxLength={7}
              spellCheck={false}
              style={{
                width: "100%", background: "transparent", border: "none", outline: "none", padding: 0,
                fontFamily: "monospace", fontSize: 13, color: "#ddd", letterSpacing: 1,
              }}
            />
          </label>
          {hex !== DEFAULT_ACCENT && (
            <button onClick={() => setHex(DEFAULT_ACCENT)} style={{
              background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 12, color: "#666", fontFamily: "inherit",
            }}>Reset to green</button>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
          <span style={label}>Starting points</span>
          <div style={{ display: "flex", gap: 8 }}>
            {STARTING_POINTS.map(([name, c]) => (
              <button key={c} title={name} onClick={() => setHex(c)} style={{
                width: 20, height: 20, borderRadius: "50%", background: c, border: "none", padding: 0, cursor: "pointer",
                boxShadow: c === hex ? `0 0 0 2px ${BG}, 0 0 0 4px #fff` : "none",
              }} />
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={label}>Saved</span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {saved.map(c => (
              <span key={c} style={{ position: "relative" }} onMouseEnter={() => setHover(c)} onMouseLeave={() => setHover(null)}>
                <button title={c.toUpperCase()} onClick={() => setHex(c)} style={{
                  width: 20, height: 20, borderRadius: "50%", background: c, border: "none", padding: 0, cursor: "pointer", display: "block",
                  boxShadow: c === hex ? `0 0 0 2px ${BG}, 0 0 0 4px #fff` : "none",
                }} />
                {hover === c && (
                  <button title="Remove" onClick={() => onSavedChange(saved.filter(x => x !== c))} style={{
                    position: "absolute", top: -6, right: -6, width: 13, height: 13, borderRadius: "50%", padding: 0,
                    background: "#333", border: `1px solid ${BG}`, color: "#ddd", fontSize: 9, lineHeight: "10px", cursor: "pointer",
                  }}>×</button>
                )}
              </span>
            ))}
            {!saved.includes(hex) && (
              <button
                title={`Save ${hex.toUpperCase()}`}
                onClick={() => onSavedChange([...saved, hex].slice(-MAX_SAVED))}
                style={{
                  height: 20, borderRadius: 10, padding: "0 8px", border: "1px dashed #444", background: "transparent",
                  color: "#888", fontSize: 11, cursor: "pointer", fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5,
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: hex }} />Save this color
              </button>
            )}
          </div>
        </div>
      </div>
      <Preview ratio={ratio} />
    </div>
  );
}

// Uses var(--green), which the picker sets live, so this is the real accent as you drag.
function Preview({ ratio }: { ratio: number }) {
  const pill = (t: string, on = false) => (
    <span style={{
      padding: "4px 11px", borderRadius: 14, fontSize: 12, whiteSpace: "nowrap",
      border: `1px solid ${on ? "var(--green)" : "#2a2a2a"}`, color: on ? "var(--green)" : "#8a8a8a", fontWeight: on ? 700 : 400,
    }}>{t}</span>
  );
  const nav = (t: string, on = false) => (
    <span style={{
      display: "block", padding: "5px 10px", fontSize: 12, color: on ? "#fff" : "#535353", fontWeight: on ? 700 : 400,
      borderLeft: `3px solid ${on ? "var(--green)" : "transparent"}`,
    }}>{t}</span>
  );
  return (
    <div style={{
      width: 330, flexShrink: 0, background: "#181818", border: "1px solid #232323", borderRadius: 12,
      padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14, boxSizing: "border-box",
    }}>
      <span style={label}>Preview</span>
      <div style={{ display: "flex", gap: 18, alignItems: "center" }}>
        <div style={{ background: "#0a0a0a", borderRadius: 8, padding: "10px 0 8px", width: 96, flexShrink: 0 }}>
          <div style={{ padding: "0 0 6px 8px" }}><LogoMark width={36} /></div>
          {nav("Albums")}{nav("Stats", true)}{nav("Vinyl")}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6 }}>{pill("Recent")}{pill("A→Z", true)}</div>
          <div style={{ display: "flex", gap: 2, fontSize: 15 }}>
            {[0, 1, 2, 3, 4].map(i => <span key={i} style={{ color: i < 4 ? "var(--green)" : "#333" }}>★</span>)}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 42 }}>
            {[14, 22, 30, 18, 40, 26, 34].map((h, i) => (
              <span key={i} style={{ width: 12, height: h, borderRadius: "3px 3px 0 0", background: "var(--green)", opacity: 0.35 + h / 70 }} />
            ))}
          </div>
        </div>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: "#2a2a2a" }}>
        <div style={{ width: "62%", height: "100%", borderRadius: 2, background: "var(--green)" }} />
      </div>
      {ratio >= 4.5
        ? <span style={{ fontSize: 11.5, color: "#777" }}>✓ Reads well as text ({ratio.toFixed(1)}:1)</span>
        : <span style={{ fontSize: 11.5, color: "#d9a441" }}>⚠ Hard to read as text ({ratio.toFixed(1)}:1)</span>}
    </div>
  );
}
