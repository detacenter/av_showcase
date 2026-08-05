import { useState } from "react";
import { Link } from "react-router-dom";

const DISMISS_KEY = "av_showcase_sandbox_banner_dismissed";

export function SandboxBanner() {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");

  if (dismissed) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "7px 20px",
        background: "var(--surface)",
        borderBottom: "1px solid var(--border)",
        fontSize: 12,
        color: "var(--gray)",
        flexShrink: 0,
      }}
    >
      <span>
        This is a sandbox — real catalog data, sample listening history.{" "}
        <Link to="/about" style={{ color: "var(--white)", fontWeight: 600 }}>
          How it works ↗
        </Link>
      </span>
      <button
        onClick={dismiss}
        aria-label="Dismiss"
        style={{
          marginLeft: "auto",
          background: "none",
          border: "none",
          color: "var(--dim)",
          fontSize: 14,
          cursor: "pointer",
          padding: "0 4px",
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
