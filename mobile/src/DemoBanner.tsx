// Showcase-only addition, not part of the real app's source — same purpose as
// frontend/src/components/SandboxBanner.tsx, kept deliberately compact since
// vertical space on a real phone screen is precious. Doubles as the link back
// to the desktop app: a plain <a>, not a react-router Link, since /mobile-app
// is a fully separate bundle from the desktop app at site root.
export function DemoBanner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        padding: "6px 12px",
        background: "#0e0e0e",
        borderBottom: "1px solid #1e1e1e",
        fontSize: 11,
        color: "#888",
        flexShrink: 0,
        paddingTop: "calc(6px + env(safe-area-inset-top))",
      }}
    >
      <span>Sandbox demo, sample data</span>
      <a href="/" style={{ color: "var(--green, #1db954)", fontWeight: 600, textDecoration: "none", flexShrink: 0 }}>
        Desktop ↗
      </a>
    </div>
  );
}
