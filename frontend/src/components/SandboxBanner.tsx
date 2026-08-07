import { Link } from "react-router-dom";

// Permanent, non-dismissible by design — this is the one disclosure that
// should always be visible regardless of how long a visitor has been
// browsing the demo.
export function SandboxBanner() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 20px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        borderLeft: "3px solid var(--green)",
        fontSize: 13,
        color: "var(--white)",
        flexShrink: 0,
      }}
    >
      <span>
        This is a sandbox: real catalog data, sample listening history.{" "}
        <Link to="/about" style={{ color: "var(--green)", fontWeight: 600 }}>
          How it works ↗
        </Link>
      </span>
    </div>
  );
}
