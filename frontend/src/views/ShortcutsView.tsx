import { useEffect, useState } from "react";

type Shortcut = { mac: string; pc: string; action: string };
type Group = { name: string; note?: string; shortcuts: Shortcut[] };

// cmdCtrl: works with either ⌘ (Mac) or Ctrl (Win/Linux) — most shortcuts.
// ctrlOnly: literal Ctrl key required on both platforms (a few spots in the
// real app's key handlers check e.ctrlKey without an e.metaKey fallback, so
// ⌘ genuinely does nothing there even on Mac — not a documentation choice).
function cmdCtrl(key: string): Pick<Shortcut, "mac" | "pc"> {
  return { mac: `⌘ ${key}`, pc: `Ctrl ${key}` };
}
function ctrlOnly(key: string): Pick<Shortcut, "mac" | "pc"> {
  return { mac: `Ctrl ${key}`, pc: `Ctrl ${key}` };
}

const GROUPS: Group[] = [
  {
    name: "Global",
    note: "Works on every view.",
    shortcuts: [
      { ...cmdCtrl("["), action: "Previous nav tab" },
      { ...cmdCtrl("]"), action: "Next nav tab" },
      { ...cmdCtrl("1–9, 0"), action: "Jump directly to nav tab N" },
      { ...cmdCtrl("R"), action: "Trigger a library sync" },
    ],
  },
  {
    name: "Grid views",
    note: "Artists, Albums, Vinyl, Playlists: shared navigation pattern.",
    shortcuts: [
      { mac: "/", pc: "/", action: "Open filter search bar" },
      { mac: "j k h l  /  arrows", pc: "j k h l  /  arrows", action: "Move grid focus down / up / left / right" },
      { ...ctrlOnly("↑ / ↓"), action: "Jump to first / last item (Artists, Albums)" },
      { mac: "Enter", pc: "Enter", action: "Open the focused item" },
      { mac: "g", pc: "g", action: "Toggle genre filter palette (Artists, Albums, Vinyl)" },
      { mac: "f", pc: "f", action: "Toggle “favorites only” filter (Artists, Albums)" },
      { mac: "t", pc: "t", action: "Cycle type filter (Albums, Vinyl)" },
      { mac: "y", pc: "y", action: "Toggle year filter (Albums)" },
      { mac: "n", pc: "n", action: "Create a new playlist (Playlists)" },
      { ...cmdCtrl("F"), action: "Toggle favorite on the focused item" },
      { ...ctrlOnly("O"), action: "Open focused album in Spotify (Albums: Ctrl only, even on Mac)" },
      { mac: "Escape", pc: "Escape", action: "Staged back-out: close panel → clear search → clear focus" },
    ],
  },
  {
    name: "Genre filter palette",
    note: "Sub-overlay, opened with g.",
    shortcuts: [
      { mac: "j k h l  /  arrows", pc: "j k h l  /  arrows", action: "Move between search pane / genre list / adjacent-genre list" },
      { mac: "Enter  /  Space", pc: "Enter  /  Space", action: "Toggle the focused genre" },
      { mac: "Escape", pc: "Escape", action: "Step back a pane, or close if already on the search pane" },
    ],
  },
  {
    name: "Recent",
    shortcuts: [
      { mac: "Ctrl /", pc: "Ctrl /", action: "Toggle filter/search bar" },
      { mac: "h l  /  ← →", pc: "h l  /  ← →", action: "Select previous / next album" },
      { mac: "j k  /  ↑ ↓", pc: "j k  /  ↑ ↓", action: "Move focused track within selected album" },
      { mac: "Enter", pc: "Enter", action: "Go to the focused track's artist page" },
      { ...cmdCtrl("F"), action: "Toggle favorite on focused track" },
      { ...cmdCtrl("O"), action: "Open focused track in Spotify" },
      { ...cmdCtrl("D"), action: "Toggle delete mode" },
      { mac: "d", pc: "d", action: "(delete mode) Open confirm-delete dialog for focused track" },
      { mac: "Escape", pc: "Escape", action: "Staged back-out: exit delete mode → clear search → close search" },
    ],
  },
  {
    name: "Artist detail",
    shortcuts: [
      { mac: "j l ↓ →  /  k h ↑ ←", pc: "j l ↓ →  /  k h ↑ ←", action: "Select next / previous album or vinyl release" },
      { mac: "n", pc: "n", action: "Open notes editor" },
      { mac: "s  /  v", pc: "s  /  v", action: "Switch source view to Spotify / Vinyl" },
      { ...cmdCtrl("F"), action: "Toggle favorite (syncs artist + album)" },
      { mac: "Escape", pc: "Escape", action: "Back to Artists" },
    ],
  },
  {
    name: "Stats",
    note: "Deliberately modifier-free, so it doesn't collide with the global tab-cycle shortcut.",
    shortcuts: [
      { mac: "[  /  ]", pc: "[  /  ]", action: "Cycle Stats subtab (Sessions/Time/Periods/Eras/Trends/Genres/Overview/Vinyl)" },
    ],
  },
  {
    name: "Tops",
    shortcuts: [
      { mac: "j  /  ↓", pc: "j  /  ↓", action: "Move decade-shelf focus down" },
      { mac: "k  /  ↑", pc: "k  /  ↑", action: "Move decade-shelf focus up" },
    ],
  },
  {
    name: "Vinyl “now playing” match prompt",
    note: "Overlay, appears when a vinyl side is detected.",
    shortcuts: [
      { mac: "↑  /  ↓", pc: "↑  /  ↓", action: "Move between candidate matches" },
      { mac: "Enter", pc: "Enter", action: "Confirm the focused match" },
      { mac: "Escape", pc: "Escape", action: "Dismiss the prompt" },
    ],
  },
];

const STORAGE_KEY = "av_showcase_shortcuts_platform";

function detectDefaultPlatform(): "mac" | "pc" {
  const ua = navigator.userAgent || "";
  return /Mac|iPhone|iPad|iPod/.test(ua) ? "mac" : "pc";
}

function PlatformToggle({ platform, onChange }: { platform: "mac" | "pc"; onChange: (p: "mac" | "pc") => void }) {
  const opt = (value: "mac" | "pc", label: string) => {
    const active = platform === value;
    return (
      <button
        onClick={() => onChange(value)}
        style={{
          fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 999,
          border: `1px solid ${active ? "var(--green)" : "var(--border)"}`,
          background: active ? "var(--green)" : "transparent",
          color: active ? "#000" : "var(--gray)",
          cursor: "pointer", transition: "all 0.12s",
        }}
      >
        {label}
      </button>
    );
  };
  return (
    <div style={{ display: "inline-flex", gap: 6, padding: 3, background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 999, marginBottom: 24 }}>
      {opt("mac", "⌘ Mac")}
      {opt("pc", "⊞ Windows/Linux")}
    </div>
  );
}

function GroupSection({ g, platform }: { g: Group; platform: "mac" | "pc" }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--white)", letterSpacing: 0.5, marginBottom: 4, textTransform: "uppercase" }}>
        {g.name}
      </div>
      {g.note && (
        <div style={{ fontSize: 11, color: "var(--dim)", marginBottom: 8 }}>{g.note}</div>
      )}
      {g.shortcuts.map((s) => (
        <div
          key={s.mac + s.pc + s.action}
          style={{
            display: "flex", alignItems: "baseline", gap: 14, padding: "5px 0",
            borderBottom: "1px solid var(--border)", fontSize: 12,
          }}
        >
          <code
            style={{
              flexShrink: 0, minWidth: 170, color: "var(--green)", fontSize: 11,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {platform === "mac" ? s.mac : s.pc}
          </code>
          <span style={{ color: "var(--gray)" }}>{s.action}</span>
        </div>
      ))}
    </div>
  );
}

export function ShortcutsView() {
  const [platform, setPlatform] = useState<"mac" | "pc">(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "mac" || saved === "pc" ? saved : detectDefaultPlatform();
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, platform);
  }, [platform]);

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "28px 32px 48px" }}>
      <div style={{ maxWidth: 720 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: "var(--white)", marginBottom: 8 }}>
          Keyboard shortcuts
        </div>
        <p style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.6, marginBottom: 16 }}>
          The whole app is keyboard-navigable: vim-style (h/j/k/l) plus arrow keys
          throughout. Every shortcut below is live on this site, same as the real app.
        </p>

        <PlatformToggle platform={platform} onChange={setPlatform} />

        {GROUPS.map((g) => (
          <GroupSection key={g.name} g={g} platform={platform} />
        ))}
      </div>
    </div>
  );
}
