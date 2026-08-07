import { useEffect, useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { AppSettings } from "../api/types";
import { LogoMark } from "./LogoMark";

const NAV = [
  { to: "/recent",    label: "Recent" },
  { to: "/artists",   label: "Artists" },
  { to: "/albums",    label: "Albums" },
  { to: "/stats",     label: "Stats" },
  { to: "/tops",      label: "Tops" },
  { to: "/vinyl",     label: "Vinyl" },
  { to: "/playlists", label: "Playlists" },
  { to: "/revisit",   label: "Revisit" },
  { to: "/claudio",   label: "Claudio" },
  { to: "/settings",  label: "Settings" },
];

export function Sidebar() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const { data: settings } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => api.get("/api/settings"),
    staleTime: 60_000,
  });

  const { data: fetchStatus } = useQuery<{ fetching: boolean; new_plays: number | null }>({
    queryKey: ["fetchStatus"],
    queryFn: () => api.get("/api/fetch/status"),
    refetchInterval: (query) => query.state.data?.fetching ? 1500 : false,
    staleTime: 0,
  });

  const isFetching = fetchStatus?.fetching ?? false;
  const prevFetchingRef = useRef(isFetching);
  useEffect(() => {
    if (prevFetchingRef.current && !isFetching) {
      queryClient.invalidateQueries();
    }
    prevFetchingRef.current = isFetching;
  }, [isFetching, queryClient]);

  const triggerFetch = () => {
    if (isFetching) return;
    api.post("/api/fetch").then(() => {
      queryClient.invalidateQueries({ queryKey: ["fetchStatus"] });
    });
  };
  const triggerFetchRef = useRef(triggerFetch);
  triggerFetchRef.current = triggerFetch;

  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Cmd+[/] — cycle tabs. In the real Electron app this never reaches the
  // renderer's keydown handler at all (before-input-event intercepts it
  // first), so cycling is wired through an IPC bridge instead. That bridge
  // doesn't exist in this browser-based demo — window.electronEvents is
  // undefined — so cycleTab needs a real keydown case here too. Without it,
  // Cmd+[/] falls through to the browser's own native History Back/Forward
  // binding, which only looks like it works for whatever routes happen to
  // already be in the tab's click history, and not in cycle order.
  const cycleTab = (dir: number) => {
    const current = NAV.findIndex(n => window.location.pathname.startsWith(n.to));
    const base = current === -1 ? 0 : current;
    const next = dir > 0
      ? (base + 1) % NAV.length
      : (base - 1 + NAV.length) % NAV.length;
    navigateRef.current(NAV[next].to);
  };
  const cycleTabRef = useRef(cycleTab);
  cycleTabRef.current = cycleTab;

  useEffect(() => {
    window.electronEvents?.onCycleTab((dir: number) => cycleTabRef.current(dir));
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;

      // Cmd+R — sync
      if (e.key === "r") {
        e.preventDefault();
        triggerFetchRef.current();
        return;
      }

      // Cmd+[/] — cycle tabs (must preventDefault, or the browser's own
      // History Back/Forward binding fires alongside this and fights it)
      if (e.key === "[" || e.key === "]") {
        e.preventDefault();
        cycleTabRef.current(e.key === "]" ? 1 : -1);
        return;
      }

      // Cmd+1–9,0 — jump to tab
      const numMatch = "1234567890".indexOf(e.key);
      if (numMatch !== -1) {
        e.preventDefault();
        const idx = numMatch; // "1"→0, "2"→1 … "9"→8, "0"→9
        if (NAV[idx]) navigate(NAV[idx].to);
        return;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [navigate]);

  const logoStyle = settings?.sidebar_logo ?? "rings";
  const openVisualizer = () => {
    const popup = window.open("/visualizer?popout=1", "audiovault-visualizer", "width=760,height=430");
    if (!popup) navigate("/visualizer");
  };

  return (
    <aside style={{
      width: 80,
      flexShrink: 0,
      background: "#0a0a0a",
      borderRight: "1px solid var(--border)",
      display: "flex",
      flexDirection: "column",
      padding: "30px 0 20px",
      gap: 2,
    }}>
      {/* Logo mark */}
      <div style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        padding: "0 0 12px 4px",
        marginBottom: 4,
      }}>
        <div
          onClick={triggerFetch}
          title={isFetching ? "Syncing with Spotify…" : "Click to sync with Spotify"}
          style={{ cursor: isFetching ? "default" : "pointer" }}
        >
          <LogoMark
            style={logoStyle}
            width={70}
            fetching={isFetching}
            onAClick={() => navigate("/tops")}
            onVClick={openVisualizer}
          />
        </div>
      </div>

      {NAV.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            padding: "9px 16px 9px 11px",
            fontSize: 14,
            fontWeight: isActive ? 700 : 400,
            color: isActive ? "var(--white)" : "var(--dim)",
            borderLeft: isActive ? "3px solid var(--green)" : "3px solid transparent",
            transition: "color 0.15s",
          })}
        >
          {label}
        </NavLink>
      ))}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8, marginLeft: 11 }}>
        <NavLink
          to="/api-guide"
          title="API guide"
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `1px solid ${isActive ? "var(--white)" : "var(--dim)"}`,
            color: isActive ? "var(--white)" : "var(--dim)",
            fontSize: 10,
            fontWeight: 700,
            textDecoration: "none",
            flexShrink: 0,
          })}
        >
          {"</>"}
        </NavLink>
        <NavLink
          to="/about"
          title="About this demo"
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `1px solid ${isActive ? "var(--white)" : "var(--dim)"}`,
            color: isActive ? "var(--white)" : "var(--dim)",
            fontSize: 12,
            fontWeight: 700,
            textDecoration: "none",
            flexShrink: 0,
          })}
        >
          ?
        </NavLink>
        <NavLink
          to="/shortcuts"
          title="Keyboard shortcuts"
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `1px solid ${isActive ? "var(--white)" : "var(--dim)"}`,
            color: isActive ? "var(--white)" : "var(--dim)",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
            flexShrink: 0,
          })}
        >
          ⌘
        </NavLink>
        <NavLink
          to="/mobile"
          title="Mobile preview"
          style={({ isActive }) => ({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            border: `1px solid ${isActive ? "var(--white)" : "var(--dim)"}`,
            color: isActive ? "var(--white)" : "var(--dim)",
            fontSize: 11,
            fontWeight: 700,
            textDecoration: "none",
            flexShrink: 0,
          })}
        >
          📱
        </NavLink>
      </div>
    </aside>
  );
}
