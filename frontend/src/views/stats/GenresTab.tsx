import type { CSSProperties } from "react";
import { useSearchParams } from "react-router-dom";
import { GenresRing } from "./GenresRing";

// Two views. Network: the D3 force graph, whose iframe lives in <GenresFrameHost> (mounted
// once at the app level so it survives navigating away from /stats) and is positioned over
// the slot div below. Ring: the static family ring (GenresRing), rendered here directly.
type GenresView = "network" | "ring";
const genresViewOf = (params: URLSearchParams): GenresView => (params.get("view") === "ring" ? "ring" : "network");

export function GenresTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = genresViewOf(searchParams);
  const setView = (v: GenresView) => {
    const next = new URLSearchParams(searchParams);
    if (v === "ring") next.set("view", "ring"); else next.delete("view");
    setSearchParams(next, { replace: true });
  };
  const pillStyle = (active: boolean): CSSProperties => ({
    padding: "5px 14px", borderRadius: 20, border: active ? "1px solid var(--green)" : "1px solid #2a2a2a",
    background: "transparent", color: active ? "var(--green)" : "#666", fontSize: 13, fontWeight: active ? 700 : 400, cursor: "pointer",
  });
  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "8px 16px" }}>
        <button onClick={() => setView("network")} style={pillStyle(view === "network")}>Network</button>
        <button onClick={() => setView("ring")} style={pillStyle(view === "ring")}>Ring</button>
      </div>
      {view === "network" ? <div id="genres-frame-slot" style={{ flex: 1, minHeight: 0 }} /> : <GenresRing />}
    </div>
  );
}
