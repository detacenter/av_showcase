interface HoverInfo {
  x: number;
  y: number;
  label: string;
  sub: string;
}

export function HoverTooltip({ hover }: { hover: HoverInfo | null }) {
  if (!hover) return null;
  return (
    <div style={{
      position: "fixed", left: hover.x + 14, top: hover.y + 14, zIndex: 1000,
      pointerEvents: "none", background: "#1e1e1e", border: "1px solid #2a2a2a",
      borderRadius: 8, padding: "6px 10px", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
    }}>
      <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{hover.label}</div>
      <div style={{ color: "#999", fontSize: 11, marginTop: 2 }}>{hover.sub}</div>
    </div>
  );
}
