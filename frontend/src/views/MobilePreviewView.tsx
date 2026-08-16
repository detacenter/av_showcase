import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

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

function QrIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
    </svg>
  );
}

function MobileQrOverlay({ onClose }: { onClose: () => void }) {
  const targetUrl = `${window.location.origin}${MOBILE_APP_URL}`;
  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div style={{
        background: "#171717", borderRadius: 12, padding: "24px 28px 20px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.8)", border: "1px solid #2a2a2a",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Scan to open on your phone</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "#555", fontSize: 16, cursor: "pointer", padding: "2px 6px", borderRadius: 4, marginLeft: 16 }}
          >
            ✕
          </button>
        </div>
        <div style={{ background: "#fff", padding: 12, borderRadius: 8 }}>
          <QRCodeSVG value={targetUrl} size={200} />
        </div>
        <div style={{ fontSize: 12, color: "var(--dim)", textAlign: "center", maxWidth: 220 }}>
          Opens the real, installable PWA — not this preview frame.
        </div>
      </div>
    </div>
  );
}

export function MobilePreviewView() {
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);
  const [showQr, setShowQr] = useState(false);

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
      flex: 1, position: "relative", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 16, padding: 32, overflow: "auto",
    }}>
      <button
        onClick={() => setShowQr(true)}
        title="Scan with your phone"
        style={{
          position: "absolute", top: 20, right: 24,
          display: "flex", alignItems: "center", gap: 7,
          padding: "7px 12px", flexShrink: 0,
          background: "rgba(255,255,255,0.03)", border: "1px solid var(--green)",
          borderRadius: 20, color: "var(--green)", fontSize: 12, fontWeight: 600,
          cursor: "pointer",
        }}
      >
        <QrIcon />
        Scan on your phone
      </button>
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
      {showQr && <MobileQrOverlay onClose={() => setShowQr(false)} />}
    </div>
  );
}
