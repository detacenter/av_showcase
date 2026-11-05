import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { avBeganDate, historyBounds, useHistoryInfo } from "../../api/useHistoryInfo";
import { TimePicker } from "../../components/TimePicker";
import { mondayOf } from "../../lib/dates";
import { api } from "../../api/client";
import { PeriodsYear } from "./PeriodsYear";
import { CardTitle } from "./PeriodsCardTitle";
import { artUrl, card, decadeColor, decadeName, DOWN, DOWN_TEXT, MUTED, SOFT } from "./periodsShared";

// ─── Types ────────────────────────────────────────────────────────────────────

type PeriodMode = "Week" | "Month" | "Year";

interface AlbumTile {
  title: string;
  subtitle: string;
  meta: string;
  play_count?: number;
  art_path: string;
  art_key: string;
}

interface RecapDay {
  date: string;
  future?: boolean;
  minutes?: number;
  top_minutes?: number;
  title?: string;
  artist?: string;
  art_path?: string | null;
}

interface Recap {
  in_progress: boolean;
  through: string | null;
  days_elapsed: number;
  days_total: number;
  minutes: number;
  listening: string;
  projected_minutes: number;
  usual_minutes: number | null;
  usual_label: string | null;
  biggest_since: { kind: "ever" } | { kind: "since"; date: string } | null;
  artists_played: number;
  new_artist_count: number;
  albums_played: number;
  new_album_count: number;
  new_artists: { name: string; plays: number; art_path: string | null }[];
  biggest_day: { date: string; minutes: number; label: string } | null;
  decades: { decade: number; pct: number }[];
  genres: { name: string; now: number; usual: number }[];
  days: RecapDay[];
}

interface PeriodPayload {
  label: string;
  album_header: string;
  offset: number;
  minutes: string;
  plays_label: string;
  album_tiles: AlbumTile[];
  top_new_artist: { name: string; count: number } | null;
  has_older: boolean;
  recap: Recap | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DOW = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const parseDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const dowOf = (iso: string) => (parseDay(iso).getDay() + 6) % 7; // Monday = 0
const fmtMin = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
const num = (n: number) => n.toLocaleString("en-US");

// Periods before AV's own log come from the imported Spotify history; the one that
// straddles the boundary says where AV began.
function sourceNote(days: RecapDay[], avBegan: Date | null): string | null {
  if (!avBegan || days.length === 0) return null;
  const first = parseDay(days[0].date);
  const last = parseDay(days[days.length - 1].date);
  const began = new Date(avBegan.getFullYear(), avBegan.getMonth(), avBegan.getDate());
  if (last < began) return "from Spotify history";
  if (first < began) return `AV began ${MONTHS[began.getMonth()]} ${began.getDate()}`;
  return null;
}

function headerLabel(mode: PeriodMode, days: RecapDay[]): string {
  const first = parseDay(days[0].date);
  const last = parseDay(days[days.length - 1].date);
  if (mode === "Month") {
    return `${first.toLocaleString("en-US", { month: "long" })} ${first.getFullYear()} · RECAP`.toUpperCase();
  }
  const a = `${MONTHS[first.getMonth()]} ${first.getDate()}`;
  const b = first.getMonth() === last.getMonth() ? `${last.getDate()}` : `${MONTHS[last.getMonth()]} ${last.getDate()}`;
  return `${a}–${b} · WEEK RECAP`.toUpperCase();
}

function biggestSinceLine(mode: PeriodMode, r: Recap): string | null {
  const unit = mode === "Week" ? "week" : "month";
  if (!r.biggest_since) return null;
  if (r.biggest_since.kind === "ever") return `your biggest ${unit} on record`;
  const d = parseDay(r.biggest_since.date);
  return mode === "Week"
    ? `your biggest week since the week of ${MONTHS[d.getMonth()]} ${d.getDate()}`
    : `your biggest month since ${d.toLocaleString("en-US", { month: "long" })}`;
}

// ─── Building blocks ──────────────────────────────────────────────────────────

function AlbumGrid({ tiles }: { tiles: AlbumTile[] }) {
  return (
    <section style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 4, height: 18, background: "#20a7ff", borderRadius: 2 }} />
        <span style={{ color: MUTED, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>TOP ALBUMS</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
        {tiles.slice(0, 16).map((t, i) => {
          const url = artUrl(t.art_path);
          return (
            <div key={t.art_key || i} title={`${t.title} · ${t.subtitle} · ${t.meta}`} style={{ position: "relative", aspectRatio: "1", background: "#222", overflow: "hidden" }}>
              {url
                ? <img src={url} alt={t.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                : <span style={{ color: "#444", fontSize: 28, display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>♪</span>}
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(to top, rgba(0,0,0,0.82) 0%, rgba(0,0,0,0.25) 50%, transparent 100%)", display: "flex", flexDirection: "column", justifyContent: "flex-end", padding: 8, pointerEvents: "none" }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.title}</span>
                <span style={{ color: "#bbb", fontSize: 10, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.subtitle}{t.play_count != null ? ` · ${t.play_count}` : ""}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatTile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div style={{ background: "#1b1b1b", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
      <span style={{ color: MUTED, fontSize: 11, fontWeight: 700, letterSpacing: 1.5 }}>{label}</span>
      <span style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>{value}</span>
      <span style={{ color: SOFT, fontSize: 12 }}>{sub}</span>
    </div>
  );
}

function PaceCard({ mode, r }: { mode: PeriodMode; r: Recap }) {
  const unit = mode === "Week" ? "week" : "month";
  const usual = r.usual_minutes;
  const max = Math.max(r.projected_minutes, usual ?? 0, r.minutes, 1);
  const pct = (v: number) => `${(v / max) * 100}%`;
  const since = biggestSinceLine(mode, r);
  let headline: ReactNode;
  if (r.in_progress) {
    headline = <span style={{ color: SOFT, fontSize: 13 }}>in {r.days_elapsed} {r.days_elapsed === 1 ? "day" : "days"}</span>;
  } else if (usual) {
    const d = Math.round(((r.minutes - usual) / usual) * 100);
    headline = <span style={{ color: SOFT, fontSize: 13 }}>{d >= 0 ? `+${d}% on` : `${d}% under`} a usual {unit}</span>;
  }
  return (
    <section style={{ background: "#141414", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ color: MUTED, fontSize: 12, fontWeight: 700, letterSpacing: 2 }}>{r.in_progress ? "PACE" : `THIS ${unit.toUpperCase()}`}</span>
        <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff" }}>{num(r.minutes)} min</span>
        {headline}
      </div>
      <div style={{ position: "relative", height: 12, background: "#1f1f1f", borderRadius: 6 }}>
        <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: pct(r.minutes), background: "var(--green)", borderRadius: 6 }} />
        {r.in_progress && r.projected_minutes > r.minutes && (
          <div style={{ position: "absolute", left: pct(r.minutes), top: 0, bottom: 0, width: pct(r.projected_minutes - r.minutes), background: "repeating-linear-gradient(90deg, color-mix(in srgb, var(--green) 35%, #1f1f1f) 0 6px, transparent 6px 10px)", borderRadius: "0 6px 6px 0" }} />
        )}
        {usual != null && (
          <div style={{ position: "absolute", top: -5, bottom: -5, left: `calc(${pct(usual)} - 1px)`, width: 2, background: SOFT }} />
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, color: SOFT, fontSize: 12 }}>
        {r.in_progress
          ? <><span>so far</span><span>on pace for ~{num(Math.round(r.projected_minutes / 100) * 100)}</span></>
          : <span>{since ?? ""}</span>}
        {usual != null && <span>usual {num(usual)}{r.usual_label ? ` (${r.usual_label} avg)` : ""}</span>}
      </div>
    </section>
  );
}

function NewToYou({ r }: { r: Recap }) {
  return (
    <section style={card}>
      <CardTitle title="New to you" sub={`${r.new_artist_count} first-time ${r.new_artist_count === 1 ? "artist" : "artists"}`} />
      {r.new_artists.length === 0
        ? <span style={{ color: MUTED, fontSize: 12 }}>Nobody new this time.</span>
        : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            {r.new_artists.map(a => {
              const url = artUrl(a.art_path);
              return (
                <div key={a.name} style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                  {url
                    ? <img src={url} alt="" style={{ width: 40, height: 40, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 40, height: 40, borderRadius: 4, background: "#222", flexShrink: 0 }} />}
                  <div style={{ minWidth: 0, display: "flex", flexDirection: "column" }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
                    <span style={{ fontSize: 11, color: SOFT }}>{a.plays} {a.plays === 1 ? "play" : "plays"}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
    </section>
  );
}

function Decades({ mode, r }: { mode: PeriodMode; r: Recap }) {
  if (r.decades.length === 0) return null;
  const aria = r.decades.map(d => `${d.decade}s ${Math.round(d.pct)}%`).join(", ");
  return (
    <section style={{ ...card, gap: 12 }}>
      <CardTitle title="When it was made" sub={`this ${mode === "Week" ? "week" : "month"}'s plays by release decade`} />
      <div role="img" aria-label={`Plays by release decade: ${aria}`} style={{ display: "flex", height: 34, gap: 2 }}>
        {r.decades.map((d, i) => (
          <div key={d.decade} title={`${decadeName(d.decade)} · ${Math.round(d.pct)}%`} style={{
            flex: `${d.pct} 1 0`, minWidth: 0, background: decadeColor(d.decade),
            display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
            borderRadius: `${i === 0 ? 4 : 0}px ${i === r.decades.length - 1 ? 4 : 0}px ${i === r.decades.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
          }}>
            {d.pct >= 12 && <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", color: "#0d0d0d" }}>{decadeName(d.decade)} {Math.round(d.pct)}%</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
        {r.decades.map(d => (
          <span key={d.decade} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: SOFT, whiteSpace: "nowrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: decadeColor(d.decade) }} />
            {decadeName(d.decade)} <span style={{ color: "#fff", fontWeight: 600 }}>{Math.round(d.pct)}%</span>
          </span>
        ))}
      </div>
    </section>
  );
}

function SoundVsUsual({ mode, r }: { mode: PeriodMode; r: Recap }) {
  if (r.genres.length === 0) return <section style={card}><CardTitle title="Your sound vs. usual" sub="not enough history yet" /></section>;
  const max = Math.max(...r.genres.map(g => Math.max(g.now, g.usual)), 1);
  const unit = mode === "Week" ? "this week" : "this month";
  return (
    <section style={card}>
      <CardTitle title="Your sound vs. usual" sub={`share of plays · ${unit} vs. ${r.usual_label}`} />
      {r.genres.map(g => {
        const d = g.now - g.usual;
        return (
          <div key={g.name} style={{ display: "grid", gridTemplateColumns: "130px minmax(0, 1fr) 76px", alignItems: "center", gap: 10, height: 22 }}>
            <span style={{ fontSize: 12, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
            <div style={{ position: "relative", height: 8, background: "#242424", borderRadius: 4 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, width: `${(g.now / max) * 100}%`, background: d >= 0 ? "var(--green)" : DOWN }} />
              <div style={{ position: "absolute", top: -3, bottom: -3, width: 2, background: SOFT, left: `calc(${(g.usual / max) * 100}% - 1px)` }} />
            </div>
            <span style={{ fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums", color: d > 0 ? "var(--green)" : d < 0 ? DOWN_TEXT : MUTED }}>
              {g.now}% · {d > 0 ? "+" : d < 0 ? "−" : "±"}{Math.abs(d)}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, color: MUTED, fontSize: 11, paddingTop: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 6, borderRadius: 3, background: "var(--green)" }} />{unit}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 2, height: 12, background: SOFT }} />your usual</span>
      </div>
    </section>
  );
}

function dayTip(d: RecapDay): string {
  const date = parseDay(d.date);
  const label = `${DOW[dowOf(d.date)].charAt(0)}${DOW[dowOf(d.date)].slice(1).toLowerCase()} ${MONTHS[date.getMonth()]} ${date.getDate()}`;
  if (d.future) return `${label}: still to come`;
  if (!d.minutes) return `${label}: no listening`;
  return `${label}: ${d.title} by ${d.artist}, ${fmtMin(d.top_minutes ?? 0)} of ${fmtMin(d.minutes)}`;
}

const RING = "0 0 0 2px #1b1b1b, 0 0 0 4px var(--green)";

function AlbumADay({ mode, r }: { mode: PeriodMode; r: Recap }) {
  const biggest = r.biggest_day?.date;
  const legend = <span style={{ color: MUTED, fontSize: 11 }}>Faded = under an hour that day. Ringed = biggest day.</span>;

  if (mode === "Week") {
    const peak = Math.max(...r.days.map(d => d.minutes ?? 0), 1);
    return (
      <section style={{ ...card, gap: 12 }}>
        <CardTitle title="Album a day" sub="each day's most-played album and total listening" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6, alignItems: "end" }}>
          {r.days.map(d => {
            const url = artUrl(d.art_path);
            const big = d.date === biggest;
            const m = d.minutes ?? 0;
            return (
              <div key={d.date} title={dayTip(d)} style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <div style={{ height: 150, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 4 }}>
                  {!d.future && <span style={{ fontSize: 11, fontWeight: 600, color: SOFT, fontVariantNumeric: "tabular-nums" }}>{fmtMin(m)}</span>}
                  {!d.future && m > 0 && (
                    <div style={{ width: "70%", borderRadius: "4px 4px 0 0", height: Math.max(4, Math.round((m / peak) * 120)), background: big ? "var(--green)" : "color-mix(in srgb, var(--green) 35%, #1b1b1b)" }} />
                  )}
                </div>
                <div style={{
                  aspectRatio: "1", borderRadius: 4, boxSizing: "border-box",
                  background: url ? `url("${url}") center / cover` : "#141414",
                  border: d.future ? "1px dashed #333" : undefined,
                  opacity: !d.future && m < 60 ? 0.4 : 1,
                  boxShadow: big ? RING : undefined,
                }} />
                <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1, textAlign: "center" }}>{DOW[dowOf(d.date)]} {parseDay(d.date).getDate()}</span>
              </div>
            );
          })}
        </div>
        {legend}
      </section>
    );
  }

  const lead = dowOf(r.days[0].date);
  return (
    <section style={card}>
      <CardTitle title="Album a day" sub="each day's most-played album" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 5 }}>
        {DOW.map(d => <span key={d} style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1, textAlign: "center" }}>{d}</span>)}
        {Array.from({ length: lead }, (_, i) => <div key={`blank${i}`} />)}
        {r.days.map(d => {
          const url = artUrl(d.art_path);
          const m = d.minutes ?? 0;
          return (
            <div key={d.date} title={dayTip(d)} style={{
              aspectRatio: "1", borderRadius: 4, position: "relative", overflow: "hidden", boxSizing: "border-box",
              background: url ? `url("${url}") center / cover` : d.future ? "transparent" : "#141414",
              border: d.future ? "1px dashed #333" : undefined,
              opacity: !d.future && m < 60 ? 0.4 : 1,
              boxShadow: d.date === biggest ? RING : undefined,
            }}>
              <span style={{
                position: "absolute", top: 3, left: 3, fontSize: 10, fontWeight: 700, lineHeight: 1, padding: "2px 4px", borderRadius: 3,
                background: url ? "rgba(0,0,0,0.72)" : undefined, color: d.future ? "#555" : "#fff",
              }}>{parseDay(d.date).getDate()}</span>
            </div>
          );
        })}
      </div>
      {legend}
    </section>
  );
}

// ─── PeriodsTab ───────────────────────────────────────────────────────────────

export function PeriodsTab() {
  const [mode, setMode] = useState<PeriodMode>("Week");
  const [offset, setOffset] = useState(0);

  const { data: historyInfo } = useHistoryInfo();
  const { data, isLoading } = useQuery<PeriodPayload>({
    queryKey: ["stats-period", mode, offset],
    queryFn: () => api.get(`/api/stats/period?mode=${mode}&offset=${offset}`),
    staleTime: 60_000,
    enabled: mode !== "Year",
  });

  // Offsets count back from the period holding the latest play, so a picked date
  // becomes "how many weeks (or months) before that".
  const bounds = historyBounds(historyInfo);
  function jumpTo(start: Date) {
    if (mode === "Week") {
      const latestMonday = mondayOf(bounds.max);
      setOffset(Math.max(0, Math.round((latestMonday.getTime() - mondayOf(start).getTime()) / 604800000)));
    } else {
      setOffset(Math.max(0, (bounds.max.getFullYear() - start.getFullYear()) * 12 + (bounds.max.getMonth() - start.getMonth())));
    }
  }

  function handleModeChange(m: PeriodMode) {
    setMode(m);
    setOffset(0);
  }

  const pillStyle = (active: boolean): CSSProperties => ({
    padding: "5px 14px",
    borderRadius: 20,
    border: active ? "1px solid var(--green)" : "1px solid #2a2a2a",
    background: "transparent",
    color: active ? "var(--green)" : "#666",
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    cursor: "pointer",
  });

  const navStyle = (disabled: boolean): CSSProperties => ({
    padding: "4px 12px",
    borderRadius: 14,
    border: "1px solid #2a2a2a",
    background: "#202020",
    color: disabled ? "#333" : "#aaa",
    fontSize: 12,
    fontWeight: 500,
    cursor: disabled ? "default" : "pointer",
  });

  const pills = (["Week", "Month", "Year"] as PeriodMode[]).map(m => (
    <button key={m} onClick={() => handleModeChange(m)} style={pillStyle(mode === m)}>{m}</button>
  ));

  if (mode === "Year") {
    // A month in the Year page opens that month here.
    return <PeriodsYear pills={pills} onOpenMonth={(y, m) => {
      setMode("Month");
      setOffset(Math.max(0, (bounds.max.getFullYear() - y) * 12 + (bounds.max.getMonth() - (m - 1))));
    }} />;
  }

  if (isLoading || !data) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 13 }}>
        Loading…
      </div>
    );
  }

  const r = data.recap;
  const empty = data.album_tiles.length === 0 && (r?.minutes ?? 0) === 0;
  const through = r?.through ? parseDay(r.through) : null;
  const biggest = r?.biggest_day ? parseDay(r.biggest_day.date) : null;
  const unit = mode === "Week" ? "week" : "month";

  let listeningSub = "";
  if (r?.in_progress) {
    listeningSub = `on pace for ~${num(Math.round(r.projected_minutes / 100) * 100)} min` + (r.usual_minutes ? ` · usual ${num(r.usual_minutes)}` : "");
  } else if (r?.usual_minutes) {
    const d = Math.round(((r.minutes - r.usual_minutes) / r.usual_minutes) * 100);
    listeningSub = `${d >= 0 ? `+${d}% on` : `${d}% under`} a usual ${unit} (${fmtMin(r.usual_minutes)})`;
  } else if (r) {
    listeningSub = `${num(r.minutes)} min`;
  }

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 24px 32px", display: "flex", flexDirection: "column", gap: 14, boxSizing: "border-box" }}>

        {/* Mode pills + period nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {pills}
          {r && r.days.length > 0 && <>
            <div style={{ width: 4, height: 18, background: "var(--green)", borderRadius: 2, marginLeft: 16 }} />
            <TimePicker
              label={headerLabel(mode, r.days)}
              granularity={mode === "Week" ? "week" : "month"}
              value={parseDay(r.days[0].date)}
              avBegan={avBeganDate(historyInfo)}
              note={sourceNote(r.days, avBeganDate(historyInfo))}
              onPick={jumpTo}
            />
            <span style={{ color: MUTED, fontSize: 12 }}>
              {through ? `through ${MONTHS[through.getMonth()]} ${through.getDate()}` : mode === "Week" ? "Mon to Sun" : ""}
            </span>
          </>}
          <div style={{ flex: 1 }} />
          <button onClick={() => setOffset(o => o + 1)} disabled={!data.has_older} style={navStyle(!data.has_older)}>
            ← Older
          </button>
          <button onClick={() => setOffset(o => o - 1)} disabled={data.offset === 0} style={navStyle(data.offset === 0)}>
            Newer →
          </button>
        </div>

        {empty
          ? <div style={{ padding: "80px 0", textAlign: "center", color: "#444", fontSize: 13 }}>No plays this period</div>
          : !r
          // Backend without the recap block yet: just the album grid.
          ? <div style={{ maxWidth: 640 }}><AlbumGrid tiles={data.album_tiles} /></div>
          : <>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1fr)", gap: 14, alignItems: "start" }}>
              <AlbumGrid tiles={data.album_tiles} />
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
                  <StatTile label="LISTENING" value={r.listening} sub={listeningSub} />
                  <StatTile label="NEW ARTISTS" value={num(r.new_artist_count)} sub={`of ${num(r.artists_played)} artists you played`} />
                  <StatTile label="NEW ALBUMS" value={num(r.new_album_count)} sub={`of ${num(r.albums_played)} albums played`} />
                  <StatTile
                    label="BIGGEST DAY"
                    value={biggest ? `${DOW[dowOf(r.biggest_day!.date)].charAt(0)}${DOW[dowOf(r.biggest_day!.date)].slice(1, 3).toLowerCase()} ${biggest.getDate()}` : "–"}
                    sub={r.biggest_day ? `${r.biggest_day.label} of music` : ""}
                  />
                </div>
                <PaceCard mode={mode} r={r} />
                <NewToYou r={r} />
                <Decades mode={mode} r={r} />
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 14 }}>
              <SoundVsUsual mode={mode} r={r} />
              <AlbumADay mode={mode} r={r} />
            </div>
          </>}
      </div>
    </div>
  );
}
