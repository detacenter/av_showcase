import { useEffect, useState } from "react";
import { Routes, Route, NavLink, useMatch, useNavigate, useLocation } from "react-router-dom";
import { RecentView } from "./views/RecentView";
import { ArtistsView } from "./views/ArtistsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { AlbumDetailView } from "./views/AlbumDetailView";
import { PlaylistsView } from "./views/PlaylistsView";
import { VinylView, VinylDetailView } from "./views/VinylView";
import { StatsView } from "./views/StatsView";
import { SettingsView } from "./views/SettingsView";
import { api } from "./api/client";
import { DemoBanner } from "./DemoBanner";

// ─── Library popup ────────────────────────────────────────────────────────────

const LIBRARY_ITEMS = [
  { to: "/artists",  icon: "♬", label: "Artists"   },
  { to: "/albums",   icon: "◉", label: "Albums"    },
  { to: "/playlists",icon: "≡", label: "Playlists" },
  { to: "/vinyl",    icon: "◎", label: "Vinyl"     },
];

function LibraryPopup({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  return (
    <>
      <div onClick={onClose} style={{
        position: "fixed", inset: 0, zIndex: 200,
        WebkitTapHighlightColor: "transparent",
      }} />
      <div style={{
        position: "fixed", bottom: "calc(56px + env(safe-area-inset-bottom))", left: "25%",
        zIndex: 201, background: "#1c1c1e", borderRadius: 14,
        boxShadow: "0 -4px 32px rgba(0,0,0,0.7)", overflow: "hidden",
        width: 180,
      }}>
        {LIBRARY_ITEMS.map(({ to, icon, label }, i) => (
          <div
            key={to}
            onClick={() => { navigate(to); onClose(); }}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "14px 16px",
              borderBottom: i < LIBRARY_ITEMS.length - 1 ? "1px solid #2a2a2a" : "none",
              cursor: "pointer", WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ fontSize: 18, color: "var(--green, #1db954)", width: 22, textAlign: "center" }}>{icon}</span>
            <span style={{ fontSize: 15, color: "#fff", fontWeight: 500 }}>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Nav item ─────────────────────────────────────────────────────────────────

function NavItem({ to, label, icon }: { to: string; label: string; icon: string }) {
  const match = useMatch(`${to}/*`);
  const isActive = to === "/" ? window.location.pathname === "/" : !!match;
  return (
    <NavLink to={to} style={{ flex: 1, textDecoration: "none" }}>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "10px 0 8px", gap: 3,
        color: isActive ? "var(--green, #1db954)" : "#555",
        fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
      }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        {label}
      </div>
    </NavLink>
  );
}

function LibraryNavItem({ active, onTap }: { active: boolean; onTap: () => void }) {
  return (
    <div onClick={onTap} style={{ flex: 1, textDecoration: "none", cursor: "pointer" }}>
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center",
        padding: "10px 0 8px", gap: 3,
        color: active ? "var(--green, #1db954)" : "#555",
        fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase",
        WebkitTapHighlightColor: "transparent",
      }}>
        <span style={{ fontSize: 20 }}>♫</span>
        Library
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const location = useLocation();

  const libraryPaths = LIBRARY_ITEMS.map(i => i.to);
  const libraryActive = libraryPaths.some(p => location.pathname.startsWith(p));

  useEffect(() => {
    api.get("/api/settings").then((s) => {
      const color = (s as { accent_color?: string })?.accent_color;
      if (color) document.documentElement.style.setProperty("--green", color);
    }).catch(() => {});
  }, []);

  // Close library popup on route change
  useEffect(() => { setLibraryOpen(false); }, [location.pathname]);

  return (
    <div style={{
      display: "flex", flexDirection: "column",
      height: "100dvh", background: "#121212", color: "#fff",
      fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      overscrollBehavior: "none",
    }}>
      <DemoBanner />
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Routes>
          <Route path="/"           element={<RecentView />} />
          <Route path="/albums"     element={<AlbumsView />} />
          <Route path="/albums/:id" element={<AlbumDetailView />} />
          <Route path="/artists"    element={<ArtistsView />} />
          <Route path="/artists/:name" element={<ArtistDetailView />} />
          <Route path="/playlists"  element={<PlaylistsView />} />
          <Route path="/vinyl"      element={<VinylView />} />
          <Route path="/vinyl/:id"  element={<VinylDetailView />} />
          <Route path="/stats"      element={<StatsView />} />
          <Route path="/settings"   element={<SettingsView />} />
        </Routes>
      </div>

      {libraryOpen && <LibraryPopup onClose={() => setLibraryOpen(false)} />}

      <nav style={{
        display: "flex", borderTop: "1px solid #1e1e1e",
        background: "#0e0e0e",
        paddingBottom: "env(safe-area-inset-bottom)",
        position: "relative", zIndex: 202,
      }}>
        <NavItem to="/"       label="Recent"  icon="◷" />
        <LibraryNavItem active={libraryActive} onTap={() => setLibraryOpen(v => !v)} />
        <NavItem to="/stats"    label="Stats"    icon="◈" />
        <NavItem to="/settings" label="Settings" icon="⚙" />
      </nav>
    </div>
  );
}
