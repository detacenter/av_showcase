import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { API_BASE } from "../api/config";

// Mounted once at the app level (outside <Routes>) so navigating away from /stats and
// back doesn't unmount the iframe — that used to restart the D3 force simulation from
// scratch every time, making the genre bubbles "repopulate" on every visit. Instead this
// tracks the on-screen slot GenresTab renders and mirrors the iframe's position over it.
export function GenresFrameHost() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [everActive, setEverActive] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);

  const active = location.pathname === "/stats" && (searchParams.get("tab") ?? "Sessions") === "Genres";

  useEffect(() => {
    if (active) setEverActive(true);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const slot = document.getElementById("genres-frame-slot");
    if (!slot) return;
    const update = () => {
      const r = slot.getBoundingClientRect();
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(slot);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [active, location.pathname, searchParams]);

  if (!everActive) return null;

  const visible = active && rect;
  return (
    <iframe
      ref={frameRef}
      src={`${API_BASE}/api/stats/genres-page`}
      title="Genre Network"
      style={{
        position: "fixed",
        border: "none",
        top: rect?.top ?? 0,
        left: rect?.left ?? 0,
        width: rect?.width ?? 0,
        height: rect?.height ?? 0,
        visibility: visible ? "visible" : "hidden",
        pointerEvents: visible ? "auto" : "none",
        zIndex: visible ? 1 : -1,
      }}
    />
  );
}
