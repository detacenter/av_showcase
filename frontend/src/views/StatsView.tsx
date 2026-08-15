import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { SessionsTab } from "./stats/SessionsTab";
import { TimeTab } from "./stats/TimeTab";
import { PeriodsTab } from "./stats/PeriodsTab";
import { ErasTab } from "./stats/ErasTab";
import { TrendsTab } from "./stats/TrendsTab";
import { GenresTab } from "./stats/GenresTab";
import { OverviewTab } from "./stats/OverviewTab";
import { VinylTab } from "./stats/VinylTab";

const TABS = ["Sessions", "Time", "Periods", "Eras", "Trends", "Genres", "Overview", "Vinyl"] as const;
type Tab = typeof TABS[number];

function isTab(v: string | null): v is Tab {
  return !!v && (TABS as readonly string[]).includes(v);
}

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div style={{ display: "flex", gap: 6, padding: "12px 24px 8px", flexWrap: "wrap" }}>
      {TABS.map(t => (
        <button
          key={t}
          onClick={() => onChange(t)}
          style={{
            padding: "6px 16px",
            borderRadius: 20,
            border: active === t ? "1px solid var(--green)" : "1px solid #2a2a2a",
            background: active === t ? "transparent" : "transparent",
            color: active === t ? "var(--green)" : "#666",
            fontSize: 13,
            fontWeight: active === t ? 700 : 400,
            cursor: "pointer",
          }}
        >
          {t}
        </button>
      ))}
    </div>
  );
}

function Placeholder({ tab }: { tab: Tab }) {
  return (
    <div style={{ padding: 32, color: "#555", fontSize: 13 }}>{tab} — coming soon</div>
  );
}

export function StatsView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = isTab(searchParams.get("tab")) ? (searchParams.get("tab") as Tab) : "Sessions";
  const setTab = (t: Tab) => setSearchParams(t === "Sessions" ? {} : { tab: t }, { replace: true });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "[" && e.key !== "]")) return;
      e.preventDefault();
      const idx = TABS.indexOf(tab);
      const next = e.key === "]" ? (idx + 1) % TABS.length : (idx - 1 + TABS.length) % TABS.length;
      setTab(TABS[next]);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [tab]);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <TabBar active={tab} onChange={setTab} />
      <div style={{ flex: 1, overflow: (tab === "Sessions" || tab === "Time" || tab === "Periods" || tab === "Eras" || tab === "Genres") ? "hidden" : "auto", display: "flex", flexDirection: "column" }}>
        {tab === "Sessions" && <SessionsTab />}
        {tab === "Time" && <TimeTab />}
        {tab === "Periods" && <PeriodsTab />}
        {tab === "Eras" && <ErasTab />}
        {tab === "Trends" && <TrendsTab />}
        <div style={{ display: tab === "Genres" ? "flex" : "none", flex: 1, flexDirection: "column" }}>
          <GenresTab />
        </div>
        {tab === "Overview" && <OverviewTab />}
        {tab === "Vinyl" && <VinylTab />}
        {tab !== "Sessions" && tab !== "Time" && tab !== "Periods" && tab !== "Eras" && tab !== "Trends" && tab !== "Genres" && tab !== "Overview" && <Placeholder tab={tab} />}
      </div>
    </div>
  );
}
