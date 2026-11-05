import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AppSettings } from "../api/types";
import { AccentPicker } from "../components/AccentPicker";

export function applyAccent(hex: string) {
  document.documentElement.style.setProperty("--green", hex);
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
      <div style={{ maxWidth: 900, padding: "32px 40px 60px" }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: "#fff", marginBottom: 40, letterSpacing: -0.5 }}>
          Settings
        </div>

        <Section title="Accent Color" subtitle="Sets the highlight color used throughout the interface.">
          <AccentPicker
            value={color}
            onChange={handleColorChange}
            saved={settings.saved_accents ?? []}
            onSavedChange={list => {
              queryClient.setQueryData<AppSettings>(["settings"], s => s ? { ...s, saved_accents: list } : s);
              save({ saved_accents: list });
            }}
          />
        </Section>

        <Section title="Auto-Poll Spotify" subtitle="Checks Spotify for new plays at random times: every 10 to 20 minutes while you're listening, about hourly when you're not. Cmd+R syncs anytime.">
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
