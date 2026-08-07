import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface AppSettings {
  accent_color: string;
}

// ── Color math ────────────────────────────────────────────────────────────────

function hueFromHex(hex: string): number {
  if (!hex || hex.length < 7) return 0;
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return 0;
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0)
        : max === g ? (b - r) / d + 2
        : (r - g) / d + 4;
  return ((h / 6) % 1 + 1) % 1;
}

function hexFromHue(hue: number): string {
  const h = ((hue % 1) + 1) % 1 * 6;
  const s = 0.82, v = 0.92;
  const i = Math.floor(h), f = h - i;
  const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  const rgb = [
    [v, t, p], [q, v, p], [p, v, t],
    [p, q, v], [t, p, v], [v, p, q],
  ][i] ?? [v, p, q];
  return "#" + rgb.map(c => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
}

function applyAccent(hex: string) {
  document.documentElement.style.setProperty("--green", hex);
}

// ── Gradient ──────────────────────────────────────────────────────────────────

const GRADIENT =
  "linear-gradient(to right, #ff3d5c 0%, #ff7f3f 12%, #ffd23f 20%, #7ed957 34%, #00c9a7 50%, #4b9fff 64%, #9b5de5 78%, #d45fbf 90%, #ff3d5c 100%)";

// ── HueBar (touch) ────────────────────────────────────────────────────────────

function HueBar({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const hue = hueFromHex(color);

  const pickAt = (clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const h = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(hexFromHue(h));
  };

  return (
    <div>
      <div
        ref={barRef}
        onTouchStart={e => { e.preventDefault(); pickAt(e.touches[0].clientX); }}
        onTouchMove={e => { e.preventDefault(); pickAt(e.touches[0].clientX); }}
        style={{
          height: 44, borderRadius: 22, background: GRADIENT,
          position: "relative", userSelect: "none", touchAction: "none",
          marginBottom: 20,
        }}
      >
        {/* handle */}
        <div style={{
          position: "absolute",
          left: `calc(${hue * 100}% - 14px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 28, height: 56, borderRadius: 14,
          background: "#111", border: "3px solid #fff",
          pointerEvents: "none", zIndex: 1,
          boxShadow: "0 2px 8px rgba(0,0,0,0.5)",
        }} />
        {/* color swatch inside handle */}
        <div style={{
          position: "absolute",
          left: `calc(${hue * 100}% - 7px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 14, height: 34, borderRadius: 7,
          background: color, pointerEvents: "none", zIndex: 2,
        }} />
      </div>

      {/* Current color display */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: color, border: "1px solid #333", flexShrink: 0,
        }} />
        <span style={{ fontFamily: "monospace", fontSize: 15, color: "#b3b3b3", letterSpacing: 1 }}>
          {color.toUpperCase()}
        </span>
      </div>
    </div>
  );
}

// ── SettingsView ──────────────────────────────────────────────────────────────

export function SettingsView() {
  const queryClient = useQueryClient();
  const [localColor, setLocalColor] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => api.get("/api/settings"),
    staleTime: 60_000,
  });

  useEffect(() => {
    if (settings?.accent_color) {
      applyAccent(settings.accent_color);
      setLocalColor(settings.accent_color);
    }
  }, [settings?.accent_color]);

  const handleColorChange = (hex: string) => {
    setLocalColor(hex);
    applyAccent(hex);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      api.patch("/api/settings", { accent_color: hex })
        .then(updated => queryClient.setQueryData(["settings"], updated))
        .catch(() => {});
    }, 300);
  };

  const color = localColor ?? settings?.accent_color ?? "#1db954";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        borderBottom: "1px solid #1e1e1e",
        background: "#0e0e0e", flexShrink: 0,
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>
          Settings
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ padding: "28px 20px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#555", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 16 }}>
              Accent Color
            </div>
            <HueBar color={color} onChange={handleColorChange} />
            <div style={{ fontSize: 12, color: "#444", marginTop: 14 }}>
              Sets the highlight color throughout the app.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
