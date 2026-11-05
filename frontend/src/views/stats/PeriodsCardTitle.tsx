import { MUTED } from "./periodsShared";

export function CardTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
      <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>{title}</h2>
      {sub && <span style={{ color: MUTED, fontSize: 11 }}>{sub}</span>}
    </div>
  );
}

