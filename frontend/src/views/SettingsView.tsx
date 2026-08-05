import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AppSettings } from "../api/types";


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

export function applyAccent(hex: string) {
  document.documentElement.style.setProperty("--green", hex);
}

// ── HueBar ────────────────────────────────────────────────────────────────────

const GRADIENT =
  "linear-gradient(to right, #ff3d5c 0%, #ff7f3f 12%, #ffd23f 20%, #7ed957 34%, #00c9a7 50%, #4b9fff 64%, #9b5de5 78%, #d45fbf 90%, #ff3d5c 100%)";

function HueBar({ color, onChange }: { color: string; onChange: (hex: string) => void }) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const hue = hueFromHex(color);

  const pickAt = (clientX: number) => {
    if (!barRef.current) return;
    const rect = barRef.current.getBoundingClientRect();
    const h = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(hexFromHue(h));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => { if (dragging.current) pickAt(e.clientX); };
    const onUp = () => { dragging.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const previewHex = hexFromHue(hue);

  return (
    <div>
      <div
        ref={barRef}
        onMouseDown={e => { dragging.current = true; pickAt(e.clientX); }}
        style={{
          height: 36, borderRadius: 18, background: GRADIENT,
          position: "relative", cursor: "crosshair", userSelect: "none",
          marginBottom: 16,
        }}
      >
        {/* outer handle */}
        <div style={{
          position: "absolute",
          left: `calc(${hue * 100}% - 12px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 24, height: 52, borderRadius: 12,
          background: "#111", border: "2.5px solid #fff",
          pointerEvents: "none", zIndex: 1,
        }} />
        {/* inner color swatch */}
        <div style={{
          position: "absolute",
          left: `calc(${hue * 100}% - 6px)`,
          top: "50%", transform: "translateY(-50%)",
          width: 12, height: 30, borderRadius: 6,
          background: previewHex, pointerEvents: "none", zIndex: 2,
        }} />
      </div>
      {/* Hex label */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          width: 28, height: 28, borderRadius: 6,
          background: color, border: "1px solid #333", flexShrink: 0,
        }} />
        <span style={{ fontFamily: "monospace", fontSize: 14, color: "#b3b3b3", letterSpacing: 1 }}>
          {color.toUpperCase()}
        </span>
        <span style={{ fontSize: 12, color: "#444", marginLeft: 6 }}>
          drag to pick · affects all accent colors in the app
        </span>
      </div>
    </div>
  );
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Section({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 48 }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{title}</div>
        <div style={{ fontSize: 13, color: "#555" }}>{subtitle}</div>
      </div>
      {children}
    </div>
  );
}

// ── SettingsView ──────────────────────────────────────────────────────────────

export function SettingsView() {
  const queryClient = useQueryClient();
  const [localColor, setLocalColor] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const { data: settings, isLoading } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => api.get("/api/settings"),
    staleTime: 60_000,
  });

  // Apply saved accent on load
  useEffect(() => {
    if (settings?.accent_color) {
      applyAccent(settings.accent_color);
      setLocalColor(settings.accent_color);
    }
  }, [settings?.accent_color]);

  const save = (patch: Partial<AppSettings>) => {
    api.patch<AppSettings>("/api/settings", patch).then(updated => {
      queryClient.setQueryData(["settings"], updated);
    });
  };

  const handleColorChange = (hex: string) => {
    setLocalColor(hex);
    applyAccent(hex);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save({ accent_color: hex }), 300);
  };

  if (isLoading || !settings) {
    return <div style={{ padding: 32, color: "#555", fontSize: 13 }}>Loading…</div>;
  }

  const color = localColor ?? settings.accent_color;

  return (
    <div style={{ flex: 1, overflowY: "auto" }}>
      <div style={{ maxWidth: 740, padding: "32px 40px 60px" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 40, letterSpacing: -0.5 }}>
          Settings
        </div>

        <Section title="Accent Color" subtitle="Sets the highlight color used throughout the interface.">
          <HueBar color={color} onChange={handleColorChange} />
        </Section>

        <Section title="Auto-Poll Spotify" subtitle="Automatically fetch new plays from Spotify every 3 minutes. Disable to only sync manually (Cmd+R).">
          <div
            onClick={() => save({ auto_poll: !settings.auto_poll })}
            style={{
              display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none",
            }}
          >
            <div style={{
              width: 44, height: 24, borderRadius: 12, flexShrink: 0,
              background: settings.auto_poll ? "var(--green, #1db954)" : "#333",
              position: "relative", transition: "background 0.2s",
            }}>
              <div style={{
                position: "absolute", top: 3, left: settings.auto_poll ? 23 : 3,
                width: 18, height: 18, borderRadius: "50%", background: "#fff",
                transition: "left 0.2s",
              }} />
            </div>
            <span style={{ fontSize: 13, color: settings.auto_poll ? "var(--green, #1db954)" : "#555" }}>
              {settings.auto_poll ? "On" : "Off"}
            </span>
          </div>
        </Section>
      </div>
    </div>
  );
}
