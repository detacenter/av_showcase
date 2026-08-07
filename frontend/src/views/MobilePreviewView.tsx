import { useEffect, useState } from "react";

// The real mobile PWA build lives at /mobile-app/ — a fully separate Vite
// app/bundle (own routes, own basename, own service-worker registration),
// not a responsive resize of the desktop app. This page just frames it.
const MOBILE_APP_URL = "/mobile-app/";

// Below this width there's no point showing a phone mockup of a phone-sized
// screen — an actual mobile visitor should just get the real, installable
// PWA directly, full-bleed, not an iframe of itself.
const NARROW_BREAKPOINT = 680;

const FRAME_W = 390;
const FRAME_H = 844;

export function MobilePreviewView() {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (isNarrow) window.location.replace(MOBILE_APP_URL);
  }, [isNarrow]);

  if (isNarrow) return null;

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 16, padding: 32, overflow: "auto",
    }}>
      <div style={{
        width: FRAME_W + 16, height: FRAME_H + 16,
        borderRadius: 52, background: "#111",
        border: "1px solid #2a2a2a",
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
      }}>
        <iframe
          title="Audiovault mobile"
          src={MOBILE_APP_URL}
          style={{
            width: FRAME_W, height: FRAME_H,
            border: "none", borderRadius: 40,
            background: "#121212",
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: "var(--dim)", textAlign: "center" }}>
        The real mobile PWA, running in a frame sized to a phone screen.{" "}
        <a
          href={MOBILE_APP_URL}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--green)" }}
        >
          Open it standalone ↗
        </a>
      </div>
    </div>
  );
}
