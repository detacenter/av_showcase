// Showcase-only addition, not part of the real app's source — same purpose as
// frontend/src/components/SandboxBanner.tsx, kept deliberately compact since
// vertical space on a real phone screen is precious.
export function DemoBanner() {
  return (
    <div
      style={{
        padding: "6px 12px",
        background: "#0e0e0e",
        borderBottom: "1px solid #1e1e1e",
        fontSize: 11,
        color: "#888",
        flexShrink: 0,
        paddingTop: "calc(6px + env(safe-area-inset-top))",
      }}
    >
      Sandbox demo, sample data
    </div>
  );
}
