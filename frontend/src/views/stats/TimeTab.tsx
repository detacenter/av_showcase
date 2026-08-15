import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { type TimeMode, type TimePayload } from "./time/helpers";
import { AllTimeMonthGrid } from "./time/AllTimeMonthGrid";
import { YearGrid } from "./time/YearGrid";
import { MonthHeatmap } from "./time/MonthHeatmap";
import { DaypartFlowModal, DaypartFlowMonthlyModal, DaypartWaffleClock, DaypartWaffleClockFull } from "./time/Daypart";
import { DayOfWeekAllTimeGrid, DayOfWeekHourGrid, DayOfWeekPartGrid } from "./time/DayOfWeekGrids";

// ─── Section Label ─────────────────────────────────────────────────────────────

function SecLabel({ text }: { text: string }) {
  return (
    <div style={{ color: "#666", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>
      {text}
    </div>
  );
}

// ─── TimeTab ──────────────────────────────────────────────────────────────────

export function TimeTab() {
  const [mode, setMode] = useState<TimeMode>("Year");
  const [monthOffset, setMonthOffset] = useState(0);
  const [flowOpen, setFlowOpen] = useState(false);
  // Not persisted on purpose — this is still an A/B comparison, not a settled choice.
  // Once one wins, hardcode it in the "Daypart clock card" render below and delete
  // this toggle + whichever of DaypartWaffleClock/DaypartWaffleClockFull lost.
  const [clockShape, setClockShape] = useState<"half" | "full">("half");

  const modeParam = mode === "All Time" ? "All Time" : mode;

  const { data, isLoading } = useQuery<TimePayload>({
    queryKey: ["stats-time", modeParam, monthOffset],
    queryFn: () => api.get(`/api/stats/time?mode=${encodeURIComponent(modeParam)}&month_offset=${monthOffset}`),
    staleTime: 60_000,
  });

  const handleModeChange = useCallback((m: TimeMode) => {
    setMode(m);
    setMonthOffset(0);
  }, []);

  const currentYear = new Date().getFullYear();

  if (isLoading || !data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>Loading…</div>;
  }

  const heatmapDays = mode === "Year" ? data.heatmap_all : mode === "All Time" ? data.heatmap_all : data.heatmap;
  const heatLabel = mode === "All Time" ? "HEATMAP · ALL TIME" : mode === "Year" ? "HEATMAP · YEAR" : "HEATMAP";

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "16px 24px" }}>

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12, flexShrink: 0 }}>
        {(["Month", "Year", "All Time"] as TimeMode[]).map(m => (
          <button key={m} onClick={() => handleModeChange(m)} style={{
            padding: "5px 14px", borderRadius: 20,
            border: mode === m ? "1px solid var(--green)" : "1px solid #2a2a2a",
            background: "transparent",
            color: mode === m ? "var(--green)" : "#666",
            fontSize: 13, fontWeight: mode === m ? 700 : 400, cursor: "pointer",
          }}>{m}</button>
        ))}
        {(mode === "Month" || mode === "Year") && (
          <>
            <div style={{ width: 10 }} />
            <button onClick={() => mode === "Month" && setMonthOffset(o => o + 1)}
              disabled={mode === "Month" ? !data.has_older : true}
              style={{ background: "transparent", border: "none", color: (mode === "Month" && data.has_older) ? "#666" : "#333", fontSize: 18, cursor: (mode === "Month" && data.has_older) ? "pointer" : "default", padding: "0 4px" }}>‹</button>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, minWidth: 80, textAlign: "center" }}>
              {data.label}
            </span>
            <button onClick={() => mode === "Month" && setMonthOffset(o => Math.max(0, o - 1))}
              disabled={mode === "Month" ? !data.has_newer : true}
              style={{ background: "transparent", border: "none", color: (mode === "Month" && data.has_newer) ? "#666" : "#333", fontSize: 18, cursor: (mode === "Month" && data.has_newer) ? "pointer" : "default", padding: "0 4px" }}>›</button>
          </>
        )}
      </div>

      {/* Top row: heatmap + clock */}
      <div style={{ display: "flex", gap: 12, flex: 1, minHeight: 0 }}>

        {/* Heatmap card */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#141414", borderRadius: 18, overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "12px 16px 8px" }}>
            <SecLabel text={heatLabel} />
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: "0 8px 8px", display: "flex", flexDirection: "column" }}>
            {mode === "All Time" && <AllTimeMonthGrid days={heatmapDays} />}
            {mode === "Year" && <YearGrid days={heatmapDays} year={currentYear} />}
            {mode === "Month" && <MonthHeatmap days={heatmapDays} />}
          </div>
        </div>

        {/* Daypart clock card */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", background: "#141414", borderRadius: 18, overflow: "hidden", minWidth: 0 }}>
          <div style={{ padding: "12px 16px 8px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <SecLabel text="DAYPART CLOCK · HOUR DISTRIBUTION" />
            <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
              {(["half", "full"] as const).map(shape => (
                <button key={shape} onClick={() => setClockShape(shape)} style={{
                  padding: "3px 10px", borderRadius: 20,
                  border: clockShape === shape ? "1px solid var(--green)" : "1px solid #2a2a2a",
                  background: "transparent",
                  color: clockShape === shape ? "var(--green)" : "#666",
                  fontSize: 11, fontWeight: clockShape === shape ? 700 : 400, cursor: "pointer",
                }}>{shape === "half" ? "Semi" : "Full"}</button>
              ))}
            </div>
          </div>
          {/* Original solid-arc version is still available as <DaypartClock> if neither
              dot-matrix shape wins out. */}
          {clockShape === "half"
            ? <DaypartWaffleClock data={data.daypart_flow} onCenterClick={() => setFlowOpen(true)} />
            : <DaypartWaffleClockFull data={data.daypart_flow} onCenterClick={() => setFlowOpen(true)} />}
        </div>
      </div>

      {/* Bottom: day of week */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, marginTop: 12 }}>
        <SecLabel text="BY DAY · DAY OF WEEK BREAKDOWN" />
        <div style={{ flex: 1, minHeight: 0, background: "#141414", borderRadius: 18, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {mode === "Year" ? (
            <DayOfWeekHourGrid days={data.heatmap_all} year={currentYear} />
          ) : mode === "Month" ? (
            <DayOfWeekPartGrid minutes={data.minutes_by_dow} parts={data.day_parts} heatmapAll={data.heatmap_all} year={currentYear} />
          ) : (
            <DayOfWeekAllTimeGrid days={data.heatmap_all} />
          )}
        </div>
      </div>

      {/* Daypart flow modal */}
      {flowOpen && mode === "All Time" && (data.daypart_flow_monthly?.months?.length ?? 0) > 0 && (
        <DaypartFlowMonthlyModal data={data.daypart_flow_monthly} onClose={() => setFlowOpen(false)} />
      )}
      {flowOpen && mode !== "All Time" && data.daypart_flow.days.length > 0 && (
        <DaypartFlowModal data={data.daypart_flow} onClose={() => setFlowOpen(false)} />
      )}
    </div>
  );
}
