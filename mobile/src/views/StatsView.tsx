import React, { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { type TimeMode, type TimePayload } from "./stats/time/helpers";
import { AllTimeMonthGrid } from "./stats/time/AllTimeMonthGrid";
import { YearGrid } from "./stats/time/YearGrid";
import { MonthHeatmap } from "./stats/time/MonthHeatmap";
import { DaypartWaffleClock } from "./stats/time/Daypart";
import { DayOfWeekAllTimeGrid, DayOfWeekHourGrid, DayOfWeekPartGrid } from "./stats/time/DayOfWeekGrids";

// ─── Shared types & helpers ───────────────────────────────────────────────────

const GOLD = "#c9a84c";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function artUrl(localPath: string): string | null {
  if (!localPath) return null;
  const fn = localPath.split("/").pop();
  return fn ? `/artwork/${fn}` : null;
}

function vinylArtUrl(f: string | null | undefined): string | null {
  if (!f) return null;
  return f.startsWith("/") ? `/artwork/${f.split("/").pop()}` : `/artwork/${f}`;
}

function getMondayOf(d: Date): Date {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  const day = r.getDay();
  r.setDate(r.getDate() + (day === 0 ? -6 : 1 - day));
  return r;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function dayIndex(d: Date, weekStart: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function useContainerSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  return size;
}

function fmtDuration(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `${Math.round(minutes)}m`;
}

function fmtClock(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function fmtClockTs(ts: number): string {
  return fmtClock(new Date(ts * 1000).toISOString());
}

function fmtShort(iso: string): string {
  const d = new Date(iso);
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// ─── Sessions types ───────────────────────────────────────────────────────────

interface Track {
  played_at: string;
  track_name: string;
  artist_names: string[];
  album_id: string;
  album_name: string;
  duration_ms: number;
  album_art_local_path: string;
}

interface Session {
  id: string;
  start: string;
  end: string;
  duration_minutes: number;
  track_count: number;
  top_artist: string;
  genres: string[];
  album_colors: Record<string, string>;
  tracks: Track[];
}

interface VinylSession {
  id: string;
  started_at: number;
  ended_at: number | null;
  duration_seconds: number;
  status: "active" | "confirmed" | "unconfirmed";
  title: string | null;
  artists: string[];
  art_filename: string | null;
}

// ─── Sessions: day strip ──────────────────────────────────────────────────────

function DayStrip({ weekStart, selectedDay, digPerDay, vinylPerDay, onSelect }: {
  weekStart: Date;
  selectedDay: number;
  digPerDay: number[];
  vinylPerDay: number[];
  onSelect: (i: number) => void;
}) {
  const todayIdx = dayIndex(new Date(), weekStart);
  return (
    <div style={{ display: "flex", gap: 4, padding: "0 4px" }}>
      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const sel = selectedDay === i;
        const isToday = todayIdx === i;
        return (
          <div key={i} onClick={() => onSelect(i)} style={{
            flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
            gap: 3, padding: "6px 0 8px", borderRadius: 10, cursor: "pointer",
            background: sel ? "#252525" : "transparent",
            WebkitTapHighlightColor: "transparent",
          }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.5px", color: sel ? "var(--green, #1db954)" : "#444" }}>
              {DAY_NAMES[i]}
            </span>
            <span style={{ fontSize: 15, fontWeight: isToday ? 800 : 500, color: sel ? "#fff" : isToday ? "#ccc" : "#555" }}>
              {date.getDate()}
            </span>
            <div style={{ display: "flex", gap: 2, height: 6, alignItems: "center" }}>
              {digPerDay[i] > 0 && <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--green, #1db954)" }} />}
              {vinylPerDay[i] > 0 && <div style={{ width: 5, height: 5, borderRadius: "50%", background: GOLD }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Sessions: cards ──────────────────────────────────────────────────────────

function SessionCard({ session, expanded, onToggle }: {
  session: Session; expanded: boolean; onToggle: () => void;
}) {
  const albumsSeen = new Map<string, string>();
  for (const t of session.tracks) {
    const key = t.album_id || t.album_name;
    if (key && !albumsSeen.has(key)) albumsSeen.set(key, t.album_art_local_path || "");
  }
  return (
    <div style={{ background: "#171717", borderRadius: 12, overflow: "hidden", marginBottom: 10 }}>
      <div onClick={onToggle} style={{ padding: "12px 14px", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
            {fmtClock(session.start)} – {fmtClock(session.end)}
          </span>
          <span style={{ fontSize: 12, color: "#555" }}>{fmtDuration(session.duration_minutes)}</span>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8, overflowX: "auto" } as React.CSSProperties}>
          {Array.from(albumsSeen.entries()).slice(0, 10).map(([key, localPath]) => {
            const url = artUrl(localPath);
            return url
              ? <img key={key} src={url} width={36} height={36} style={{ borderRadius: 4, flexShrink: 0, objectFit: "cover" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
              : <div key={key} style={{ width: 36, height: 36, borderRadius: 4, flexShrink: 0, background: "#2a2a2a" }} />;
          })}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#b3b3b3" }}>{session.top_artist}</span>
          <span style={{ fontSize: 12, color: "#333" }}>·</span>
          <span style={{ fontSize: 12, color: "#555" }}>{session.track_count} tracks</span>
          {session.genres.slice(0, 2).map(g => (
            <span key={g} style={{ fontSize: 10, color: "#777", background: "#222", borderRadius: 8, padding: "2px 8px" }}>{g}</span>
          ))}
        </div>
      </div>
      {expanded && (
        <div style={{ borderTop: "1px solid #222", paddingBottom: 6 }}>
          {session.tracks.map((t, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 14px" }}>
              <span style={{ fontSize: 10, color: "#444", width: 36, flexShrink: 0 }}>{fmtShort(t.played_at)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.track_name}</div>
                <div style={{ fontSize: 11, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist_names[0]}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function VinylCard({ vs }: { vs: VinylSession }) {
  const url = vinylArtUrl(vs.art_filename);
  return (
    <div style={{ background: "#131108", border: `1px solid ${GOLD}44`, borderRadius: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
        <div style={{ width: 52, height: 52, borderRadius: 6, overflow: "hidden", background: "#2a2a2a", flexShrink: 0 }}>
          {url
            ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, opacity: 0.2 }}>◎</div>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 9, color: GOLD, fontWeight: 700, letterSpacing: "1px" }}>VINYL</span>
            {vs.status === "active" && <span style={{ fontSize: 9, color: GOLD, fontWeight: 700 }}>● LIVE</span>}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: vs.title ? "#fff" : "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {vs.title || "Unknown album"}
          </div>
          <div style={{ fontSize: 12, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>
            {vs.artists.join(", ") || "—"}
          </div>
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 12, color: GOLD, fontWeight: 600 }}>{fmtDuration((vs.duration_seconds || 0) / 60)}</div>
          <div style={{ fontSize: 11, color: "#555", marginTop: 3 }}>{fmtClockTs(vs.started_at)}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Sessions panel ───────────────────────────────────────────────────────────

function SessionsPanel() {
  const [weekStart, setWeekStart] = useState(() => getMondayOf(new Date()));
  const [selectedDay, setSelectedDay] = useState(() => Math.max(0, Math.min(6, dayIndex(new Date(), getMondayOf(new Date())))));
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [initialised, setInitialised] = useState(false);

  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => api.get("/api/stats/sessions"),
    staleTime: 60_000,
  });

  const { data: vinylSessions = [] } = useQuery<VinylSession[]>({
    queryKey: ["vinyl-sessions"],
    queryFn: () => api.get("/api/vinyl/sessions"),
    refetchInterval: 30_000,
    staleTime: 0,
  });

  useEffect(() => {
    if (initialised || sessions.length === 0) return;
    setInitialised(true);
    const d = new Date(sessions[0].start);
    const week = getMondayOf(d);
    setWeekStart(week);
    setSelectedDay(dayIndex(d, week));
  }, [sessions]);

  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;

  const digPerDay = Array.from({ length: 7 }, (_, i) =>
    sessions.filter(s => dayIndex(new Date(s.start), weekStart) === i).length
  );
  const vinylPerDay = Array.from({ length: 7 }, (_, i) =>
    vinylSessions.filter(vs => dayIndex(new Date(vs.started_at * 1000), weekStart) === i).length
  );

  const allItems = [
    ...sessions.filter(s => dayIndex(new Date(s.start), weekStart) === selectedDay)
      .map(s => ({ type: "digital" as const, id: s.id, t: new Date(s.start).getTime(), s })),
    ...vinylSessions.filter(vs => dayIndex(new Date(vs.started_at * 1000), weekStart) === selectedDay)
      .map(vs => ({ type: "vinyl" as const, id: vs.id, t: vs.started_at * 1000, vs })),
  ].sort((a, b) => b.t - a.t);

  const oldestWeek = sessions.length > 0 ? getMondayOf(new Date(sessions[sessions.length - 1].start)) : weekStart;
  const canPrev = weekStart > oldestWeek;
  const canNext = weekStart < getMondayOf(new Date());

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Week nav + day strip */}
      <div style={{ background: "#0e0e0e", borderBottom: "1px solid #1e1e1e", flexShrink: 0, padding: "10px 12px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <button disabled={!canPrev} onClick={() => setWeekStart(w => addDays(w, -7))}
            style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#1e1e1e", color: canPrev ? "#b3b3b3" : "#333", fontSize: 14, cursor: canPrev ? "pointer" : "default", flexShrink: 0 }}>←</button>
          <span style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 600, color: "#555" }}>{weekLabel}</span>
          <button disabled={!canNext} onClick={() => setWeekStart(w => addDays(w, 7))}
            style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#1e1e1e", color: canNext ? "#b3b3b3" : "#333", fontSize: 14, cursor: canNext ? "pointer" : "default", flexShrink: 0 }}>→</button>
        </div>
        <DayStrip weekStart={weekStart} selectedDay={selectedDay} digPerDay={digPerDay} vinylPerDay={vinylPerDay} onSelect={setSelectedDay} />
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "12px 12px 24px" } as React.CSSProperties}>
        {allItems.length === 0 && (
          <div style={{ textAlign: "center", color: "#333", fontSize: 13, paddingTop: 48 }}>No sessions</div>
        )}
        {allItems.map(item =>
          item.type === "digital"
            ? <SessionCard key={item.id} session={item.s} expanded={expandedId === item.id} onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)} />
            : <VinylCard key={item.id} vs={item.vs} />
        )}
      </div>
    </div>
  );
}

// ─── Periods types ────────────────────────────────────────────────────────────

type PeriodMode = "Week" | "Month";

interface AlbumTile {
  title: string;
  subtitle: string;
  meta: string;
  art_path: string;
  art_key: string;
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
}

// ─── Periods panel ────────────────────────────────────────────────────────────

const COLS = 3;
const TILE_GAP = 3;

function PeriodTileGrid({ tiles, tappedIdx, onTap }: {
  tiles: AlbumTile[];
  tappedIdx: number | null;
  onTap: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const shown = tiles.slice(0, 12);
  const rows = Math.ceil(shown.length / COLS);
  const tileFromW = size.w > 0 ? Math.floor((size.w - TILE_GAP * (COLS - 1)) / COLS) : 0;
  const tileFromH = size.h > 0 && rows > 0 ? Math.floor((size.h - TILE_GAP * (rows - 1)) / rows) : 0;
  const tileSize = tileFromW > 0 && tileFromH > 0 ? Math.min(tileFromW, tileFromH) : 0;
  const gridW = COLS * tileSize + (COLS - 1) * TILE_GAP;
  const gridH = rows * tileSize + (rows - 1) * TILE_GAP;
  const xOffset = Math.max(0, Math.floor((size.w - gridW) / 2));
  const yOffset = Math.max(0, Math.floor((size.h - gridH) / 2));

  return (
    <div ref={ref} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden" }}>
      {tileSize > 0 && shown.map((tile, idx) => {
        const col = idx % COLS;
        const row = Math.floor(idx / COLS);
        const x = xOffset + col * (tileSize + TILE_GAP);
        const y = yOffset + row * (tileSize + TILE_GAP);
        const url = artUrl(tile.art_path);
        const tapped = tappedIdx === idx;
        return (
          <div
            key={tile.art_key || idx}
            onClick={() => onTap(idx)}
            style={{ position: "absolute", left: x, top: y, width: tileSize, height: tileSize, background: "#222", overflow: "hidden", cursor: "pointer", WebkitTapHighlightColor: "transparent" }}
          >
            {url
              ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, opacity: 0.15 }}>♪</div>
            }
            {tapped && (
              <div style={{
                position: "absolute", inset: 0,
                background: "linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.35) 55%, transparent 100%)",
                display: "flex", flexDirection: "column", justifyContent: "flex-end",
                padding: 8,
              }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.title}</div>
                <div style={{ fontSize: 10, color: "#bbb", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tile.subtitle}</div>
                {tile.meta && <div style={{ fontSize: 10, color: "var(--green, #1db954)", marginTop: 2 }}>{tile.meta}</div>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PeriodsPanel() {
  const [mode, setMode] = useState<PeriodMode>("Week");
  const [offset, setOffset] = useState(0);
  const [tappedIdx, setTappedIdx] = useState<number | null>(null);

  const { data, isLoading } = useQuery<PeriodPayload>({
    queryKey: ["stats-period", mode, offset],
    queryFn: () => api.get(`/api/stats/period?mode=${mode}&offset=${offset}`),
    staleTime: 60_000,
  });

  useEffect(() => { setTappedIdx(null); }, [mode, offset]);

  const modePill = (m: PeriodMode): React.CSSProperties => ({
    background: "none", border: "none",
    borderBottom: `2px solid ${mode === m ? "var(--green, #1db954)" : "transparent"}`,
    padding: "4px 14px", marginBottom: -1,
    fontSize: 13, fontWeight: mode === m ? 600 : 400,
    cursor: "pointer", color: mode === m ? "var(--green, #1db954)" : "#555",
  });

  const navBtn = (disabled: boolean): React.CSSProperties => ({
    background: "#1e1e1e", border: "none", borderRadius: 8,
    color: disabled ? "#333" : "#888", fontSize: 18,
    cursor: disabled ? "default" : "pointer",
    padding: "4px 10px", lineHeight: 1,
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Mode tabs */}
      <div style={{ background: "#0e0e0e", borderBottom: "1px solid #1e1e1e", flexShrink: 0, padding: "10px 16px 0" }}>
        <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a" }}>
          {(["Week", "Month"] as PeriodMode[]).map(m => (
            <button key={m} onClick={() => { setMode(m); setOffset(0); }} style={modePill(m)}>{m}</button>
          ))}
        </div>
      </div>

      {isLoading && <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>Loading…</div>}

      {data && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", padding: "12px 12px 8px" }}>
          {/* Period header */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 10, flexShrink: 0 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{data.label}</div>
              <div style={{ fontSize: 12, color: "#666", marginTop: 3 }}>
                {data.minutes}{data.plays_label ? ` · ${data.plays_label}` : ""}
              </div>
              {data.top_new_artist && (
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                  New: <span style={{ color: "#888" }}>{data.top_new_artist.name}</span>
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 2 }}>
              <button disabled={!data.has_older} onClick={() => setOffset(o => o + 1)} style={navBtn(!data.has_older)}>←</button>
              <button disabled={data.offset === 0} onClick={() => setOffset(o => o - 1)} style={navBtn(data.offset === 0)}>→</button>
            </div>
          </div>

          {data.album_tiles.length === 0
            ? <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 13 }}>No plays this period</div>
            : <PeriodTileGrid
                tiles={data.album_tiles}
                tappedIdx={tappedIdx}
                onTap={i => setTappedIdx(tappedIdx === i ? null : i)}
              />
          }
        </div>
      )}
    </div>
  );
}

// ─── Trends: helpers & types ─────────────────────────────────────────────────

const MOUNTAIN_PALETTE = [
  "#0fd7a5","#2bb7ff","#6f7dff","#a46cff","#e65aa5","#ff7a59",
  "#f2c94c","#9be15d","#00b8a9","#5dd6ff","#8f9bff","#c084fc",
  "#ff8cc6","#ff9f43","#d4e157","#5eead4",
];

interface TrendsDailyEntry { date: string; plays: number; time_h: number; artists: number; albums: number; }
interface MountainMode { title: string; subtitle: string; weeks: string[]; labels: string[]; cumulative: Record<string, number[]>; total_cum: number[]; }
interface GenreMountainData { default_mode: string; modes: Record<string, MountainMode>; }
interface TrendsDiscoveryData { days: string[]; new: number[]; returning: number[]; ratio: number[]; cumulative: number[]; total_new: number; }
interface TrendsData { daily: TrendsDailyEntry[]; genre_mountain: GenreMountainData; discovery: TrendsDiscoveryData; discovery_tracks: TrendsDiscoveryData; }

function rolling(values: number[], window = 7): number[] {
  return values.map((_, i) => {
    const chunk = values.slice(Math.max(0, i - window + 1), i + 1);
    return chunk.reduce((a, b) => a + b, 0) / chunk.length;
  });
}

function monthTicksT(days: string[]): Array<{ i: number; label: string }> {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const ticks: Array<{ i: number; label: string }> = [];
  let prev = -1;
  days.forEach((d, i) => { const m = new Date(d).getMonth(); if (m !== prev) { ticks.push({ i, label: MONTHS[m] }); prev = m; } });
  return ticks;
}

function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * amt));
  const g = Math.min(255, Math.round(((n >> 8)  & 0xff) * amt));
  const b = Math.min(255, Math.round(( n        & 0xff) * amt));
  return `rgb(${r},${g},${b})`;
}

// ─── Trends: SparklineMobile ──────────────────────────────────────────────────

const SPARK_METRICS = [
  { key: "plays",   label: "Plays",   color: "#00c2a8" },
  { key: "time_h",  label: "Hours",   color: "#4f8cff" },
  { key: "artists", label: "Artists", color: "#ffb000" },
] as const;
type SparkMetric = typeof SPARK_METRICS[number]["key"];

function SparklineMobile({ days }: { days: TrendsDailyEntry[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w } = useContainerSize(ref);
  const [metric, setMetric] = useState<SparkMetric>("plays");
  const H = 240;
  const left = 18, top = 36, bottom = H - 24;

  if (!w || days.length < 2) return <div ref={ref} style={{ height: H }} />;

  const right = w - 18, pw = right - left, ph = bottom - top, n = days.length;
  const xOf = (i: number) => left + pw * i / Math.max(n - 1, 1);
  const m = SPARK_METRICS.find(x => x.key === metric)!;
  const values = days.map(d => d[metric] as number);
  const avg = rolling(values);
  const maxV = Math.max(...values) || 1;
  const yOf = (v: number) => top + ph * (1 - v / maxV);
  const ticks = monthTicksT(days.map(d => d.date));
  const current = avg[avg.length - 1] ?? 0;
  const display = metric === "time_h" ? current.toFixed(1) : String(Math.round(current));
  const areaD = [`M${xOf(0)},${bottom}`].concat(avg.map((v, i) => `L${xOf(i)},${yOf(v)}`)).concat([`L${xOf(n-1)},${bottom}Z`]).join(" ");
  const lineD = avg.map((v, i) => `${i === 0 ? "M" : "L"}${xOf(i)},${yOf(v)}`).join(" ");

  return (
    <div ref={ref} style={{ height: H }}>
      <svg width={w} height={H} style={{ display: "block" }}>
        {SPARK_METRICS.map((sm, idx) => {
          let tx = 18;
          for (let k = 0; k < idx; k++) tx += SPARK_METRICS[k].label.length * 7.5 + 20;
          return <text key={sm.key} x={tx} y={20} fill={sm.key === metric ? sm.color : "#555"} fontSize={11} fontWeight={700} onClick={() => setMetric(sm.key)} style={{ cursor: "pointer" }}>{sm.label}</text>;
        })}
        <text x={right} y={20} textAnchor="end" fill="#fff" fontSize={17} fontWeight={700}>{display}</text>
        {[0.25, 0.5, 0.75].map(frac => <line key={frac} x1={left} y1={top + ph * frac} x2={right} y2={top + ph * frac} stroke="rgba(255,255,255,0.063)" strokeWidth={1} />)}
        <defs>
          <linearGradient id="m-sg-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={m.color} stopOpacity="0.20" />
            <stop offset="100%" stopColor={m.color} stopOpacity="0.016" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#m-sg-fill)" />
        {values.map((v, i) => v > 0 && <circle key={i} cx={xOf(i)} cy={yOf(v)} r={2} fill={m.color} fillOpacity={0.3} />)}
        <path d={lineD} fill="none" stroke={m.color} strokeWidth={5} strokeOpacity={0.22} strokeLinecap="round" strokeLinejoin="round" />
        <path d={lineD} fill="none" stroke={m.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        {ticks.map(({ i, label }) => (
          <g key={i}>
            <line x1={xOf(i)} y1={bottom} x2={xOf(i)} y2={bottom + 4} stroke="#2a2a2a" strokeWidth={1} />
            <text x={xOf(i)} y={bottom + 14} textAnchor="middle" fill="#555" fontSize={9}>{label}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

// ─── Trends: MountainMobile ───────────────────────────────────────────────────

function MountainMobile({ data }: { data: GenreMountainData }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w } = useContainerSize(ref);
  const [mode, setMode] = useState(data.default_mode || "Genres");
  const H = 240;
  const PAD_L = 10, PAD_R = 10, PAD_T = 36, PAD_B = 24;

  const MODES = Object.keys(data.modes || {});
  const modeData = data.modes?.[mode];
  const weeks = modeData?.weeks ?? [], labels = modeData?.labels ?? [];
  const cumulative = modeData?.cumulative ?? {}, total_cum = modeData?.total_cum ?? [];

  if (!w || weeks.length < 2 || !labels.length || !total_cum.length) return <div ref={ref} style={{ height: H }} />;

  const pw = w - PAD_L - PAD_R, ph = H - PAD_T - PAD_B, n = weeks.length;
  const maxV = total_cum[total_cum.length - 1] || 1;
  const xOf = (i: number) => PAD_L + pw * i / Math.max(n - 1, 1);
  const yOf = (v: number) => PAD_T + ph * (1 - v / maxV);

  const sumTop = Array.from({ length: n }, (_, i) => labels.reduce((s, g) => s + (cumulative[g]?.[i] ?? 0), 0));
  const scale = sumTop.map((s, i) => total_cum[i] / Math.max(s, 1));
  const scaled: Record<string, number[]> = {};
  for (const g of labels) scaled[g] = (cumulative[g] ?? new Array(n).fill(0)).map((v, i) => v * scale[i]);

  const bottoms: number[] = new Array(n).fill(0);
  const areas: Array<{ gi: number; genre: string; pathD: string; seamD: string }> = [];
  for (let gi = 0; gi < labels.length; gi++) {
    const g = labels[gi];
    const tops = bottoms.map((b, i) => b + (scaled[g]?.[i] ?? 0));
    const pathD = `M${xOf(0)},${yOf(bottoms[0])}` + tops.map((_, i) => `L${xOf(i)},${yOf(tops[i])}`).join("") + Array.from({ length: n }, (_, i) => n-1-i).map(i => `L${xOf(i)},${yOf(bottoms[i])}`).join("") + "Z";
    const seamD = gi > 0 ? `M${xOf(0)},${yOf(bottoms[0])}` + bottoms.slice(1).map((_, i) => `L${xOf(i+1)},${yOf(bottoms[i+1])}`).join("") : "";
    areas.push({ gi, genre: g, pathD, seamD });
    for (let i = 0; i < n; i++) bottoms[i] = tops[i];
  }

  const outlineD = `M${xOf(0)},${yOf(total_cum[0])}` + total_cum.slice(1).map((v, i) => `L${xOf(i+1)},${yOf(v)}`).join("");
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const seenYM = new Set<string>();
  const mLabels: Array<{ x: number; label: string }> = [];
  weeks.forEach((wk, i) => { const dt = new Date(wk + "T12:00:00"); const ym = `${dt.getFullYear()}-${dt.getMonth()}`; if (!seenYM.has(ym)) { seenYM.add(ym); mLabels.push({ x: xOf(i), label: MONTHS[dt.getMonth()] }); } });

  return (
    <div ref={ref} style={{ height: H }}>
      <svg width={w} height={H} style={{ display: "block" }}>
        {(() => { let tx = PAD_L; return MODES.map(m => { const el = <text key={m} x={tx} y={22} fill={m === mode ? "#20a7ff" : "#555"} fontSize={11} fontWeight={700} style={{ cursor: "pointer" }} onClick={() => setMode(m)}>{m}</text>; tx += m.length * 7.2 + 18; return el; }); })()}
        <text x={w - PAD_R} y={22} textAnchor="end" fill="#666" fontSize={10}>{total_cum[total_cum.length - 1]?.toLocaleString()} total</text>
        <defs>{areas.map(({ gi }) => {
          const col = MOUNTAIN_PALETTE[gi % MOUNTAIN_PALETTE.length];
          return <linearGradient key={gi} id={`m-mg-${gi}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lighten(col, 1.25)} stopOpacity={238/255} /><stop offset="100%" stopColor={lighten(col, 0.89)} stopOpacity={218/255} /></linearGradient>;
        })}</defs>
        {areas.map(({ gi, genre, pathD, seamD }) => <g key={genre}><path d={pathD} fill={`url(#m-mg-${gi})`} />{seamD && <path d={seamD} fill="none" stroke="rgba(0,0,0,0.149)" strokeWidth={0.8} />}</g>)}
        <path d={outlineD} fill="none" stroke="rgba(255,255,255,0.212)" strokeWidth={4.2} strokeLinecap="round" strokeLinejoin="round" />
        <path d={outlineD} fill="none" stroke="#fff" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" />
        {mLabels.map(({ x, label }) => <g key={label+x}><line x1={x} y1={H-PAD_B} x2={x} y2={H-PAD_B+4} stroke="#2a2a2a" strokeWidth={1} /><text x={x} y={H-PAD_B+14} textAnchor="middle" fill="#555" fontSize={9}>{label}</text></g>)}
      </svg>
    </div>
  );
}

// ─── Trends: DiscoveryMobile ──────────────────────────────────────────────────

function DiscoveryMobile({ artistData, trackData }: { artistData: TrendsDiscoveryData; trackData: TrendsDiscoveryData }) {
  const ref = useRef<HTMLDivElement>(null);
  const { w } = useContainerSize(ref);
  const [mode, setMode] = useState<"Artists" | "Tracks">("Artists");
  const [tappedIdx, setTappedIdx] = useState(-1);
  const H = 200;
  const PAD_L = 14, PAD_R = 14, PAD_T = 32, PAD_B = 20;

  const data = mode === "Tracks" ? trackData : artistData;
  const { days, new: dayNew, returning: dayRet, total_new } = data;
  const n = days.length;

  if (!w || n < 2) return <div ref={ref} style={{ height: H }} />;

  const pw = w - PAD_L - PAD_R, ph = H - PAD_T - PAD_B;
  const cy = PAD_T + ph * 0.54;
  const maxVal = Math.max(...dayNew, ...dayRet, 1);
  const barW = Math.max(1.5, pw / Math.max(n, 1) * 0.72);
  const xOf = (i: number) => PAD_L + pw * i / Math.max(n - 1, 1);
  const newCol = "#2bb7ff", retCol = "#a46cff";
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const seenYM = new Set<string>();
  const mLabels: Array<{ x: number; label: string }> = [];
  days.forEach((d, i) => { const dt = new Date(d); const ym = `${dt.getFullYear()}-${dt.getMonth()}`; if (!seenYM.has(ym)) { seenYM.add(ym); mLabels.push({ x: xOf(i), label: MONTHS[dt.getMonth()] }); } });

  function handleTap(e: React.MouseEvent<SVGSVGElement>) {
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let best = -1, bestDist = Infinity;
    for (let i = 0; i < n; i++) { const dist = Math.abs(mx - xOf(i)); if (dist < bestDist) { bestDist = dist; best = i; } }
    const hit = bestDist <= barW * 4 ? best : -1;
    setTappedIdx(prev => prev === hit ? -1 : hit);
  }

  const hi = tappedIdx;

  return (
    <div ref={ref} style={{ height: H }}>
      <svg width={w} height={H} style={{ display: "block", WebkitTapHighlightColor: "transparent" } as React.CSSProperties} onClick={handleTap}>
        {(["Artists", "Tracks"] as const).map((m, idx) => (
          <text key={m} x={14 + idx * 68} y={22} fill={m === mode ? newCol : "#555"} fontSize={11} fontWeight={700} style={{ cursor: "pointer" }} onClick={e => { e.stopPropagation(); setMode(m); setTappedIdx(-1); }}>{m}</text>
        ))}
        <text x={w - PAD_R} y={22} textAnchor="end" fill="#fff" fontSize={13} fontWeight={700}>{total_new.toLocaleString()}</text>
        <line x1={PAD_L} y1={cy} x2={PAD_L + pw} y2={cy} stroke="rgba(255,255,255,0.133)" strokeWidth={1} />
        {days.map((_, i) => {
          const nv = dayNew[i] ?? 0, rv = dayRet[i] ?? 0, isTapped = i === hi;
          return (
            <g key={i}>
              {nv > 0 && (() => { const bh = (ph/2-4) * Math.sqrt(nv/maxVal); return <rect x={xOf(i)-barW/2} y={cy-bh} width={barW} height={bh} rx={1} fill={newCol} fillOpacity={isTapped ? 1 : 0.7} />; })()}
              {rv > 0 && (() => { const bh = (ph/2-4) * Math.sqrt(rv/maxVal); return <rect x={xOf(i)-barW/2} y={cy+1}  width={barW} height={bh} rx={1} fill={retCol} fillOpacity={isTapped ? 1 : 0.65} />; })()}
            </g>
          );
        })}
        <text x={PAD_L+4} y={cy-8}  fill={newCol} fontSize={9} fontWeight={600}>↑ new</text>
        <text x={PAD_L+4} y={cy+18} fill={retCol} fontSize={9} fontWeight={600}>↓ returning</text>
        {hi >= 0 && (() => {
          const dt = new Date(days[hi]);
          const lbl = `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
          const tx = Math.min(xOf(hi) + 8, w - 94);
          return (
            <g>
              <line x1={xOf(hi)} y1={PAD_T} x2={xOf(hi)} y2={H-PAD_B} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
              <rect x={tx} y={PAD_T+2} width={86} height={52} rx={6} fill="#1e1e2a" />
              <text x={tx+8} y={PAD_T+18} fill="#fff"   fontSize={10}>{lbl}</text>
              <text x={tx+8} y={PAD_T+34} fill={newCol} fontSize={10}>↑ {dayNew[hi] ?? 0} new</text>
              <text x={tx+8} y={PAD_T+48} fill={retCol} fontSize={10}>↓ {dayRet[hi] ?? 0} returning</text>
            </g>
          );
        })()}
        {mLabels.map(({ x, label }) => <text key={label+x} x={x} y={H-PAD_B+12} textAnchor="middle" fill="#555" fontSize={9}>{label}</text>)}
      </svg>
    </div>
  );
}

// ─── TrendsPanel ──────────────────────────────────────────────────────────────

function TrendsPanel() {
  const { data, isLoading } = useQuery<TrendsData>({
    queryKey: ["trends"],
    queryFn: () => api.get("/api/stats/trends"),
    staleTime: 300_000,
  });

  if (isLoading || !data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>Loading…</div>;
  }

  const card: React.CSSProperties = { background: "#141414", borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 4 };
  const lbl = (t: string) => <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: 2 }}>{t}</div>;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px 12px 24px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={card}>{lbl("RECENT PULSE")}<SparklineMobile days={data.daily} /></div>
      <div style={card}>{lbl("COMPOSITION MOUNTAIN")}<MountainMobile data={data.genre_mountain} /></div>
      <div style={card}>{lbl("DISCOVERY BALANCE")}<DiscoveryMobile artistData={data.discovery} trackData={data.discovery_tracks} /></div>
    </div>
  );
}

// ─── TimeTabMobile ────────────────────────────────────────────────────────────

function TimeSecLabel({ text }: { text: string }) {
  return (
    <div style={{ color: "#555", fontSize: 10, fontWeight: 700, letterSpacing: 2, marginBottom: 6 }}>
      {text}
    </div>
  );
}

function TimeTabMobile() {
  const [mode, setMode] = useState<TimeMode>("Year");
  const [monthOffset, setMonthOffset] = useState(0);

  const modeParam = mode === "All Time" ? "All Time" : mode;

  const { data, isLoading } = useQuery<TimePayload>({
    queryKey: ["stats-time-mobile", modeParam, monthOffset],
    queryFn: () => api.get(`/api/stats/time?mode=${encodeURIComponent(modeParam)}&month_offset=${monthOffset}`),
    staleTime: 60_000,
  });

  const handleModeChange = useCallback((m: TimeMode) => {
    setMode(m);
    setMonthOffset(0);
  }, []);

  const currentYear = new Date().getFullYear();

  if (isLoading || !data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>Loading…</div>;
  }

  const heatmapDays = mode === "Year" ? data.heatmap_all : mode === "All Time" ? data.heatmap_all : data.heatmap;
  const heatLabel = mode === "All Time" ? "HEATMAP · ALL TIME" : mode === "Year" ? "HEATMAP · YEAR" : "HEATMAP";

  const pillBtn = (active: boolean): React.CSSProperties => ({
    padding: "5px 12px", borderRadius: 20,
    border: active ? "1px solid var(--green, #1db954)" : "1px solid #2a2a2a",
    background: "transparent",
    color: active ? "var(--green, #1db954)" : "#666",
    fontSize: 12, fontWeight: active ? 700 : 400, cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  } as React.CSSProperties);

  const pagerBtn = (enabled: boolean): React.CSSProperties => ({
    background: "none", border: "none", color: enabled ? "#666" : "#333",
    fontSize: 18, cursor: enabled ? "pointer" : "default", padding: "0 6px",
    WebkitTapHighlightColor: "transparent",
  } as React.CSSProperties);

  const card = (label: string, body: React.ReactNode) => (
    <div style={{ height: 260, flexShrink: 0, display: "flex", flexDirection: "column", background: "#141414", borderRadius: 16, overflow: "hidden" }}>
      <div style={{ padding: "10px 12px 6px" }}>
        <TimeSecLabel text={label} />
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: "0 6px 6px", display: "flex", flexDirection: "column" }}>
        {body}
      </div>
    </div>
  );

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Mode toggle + pager */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 12px 4px", flexShrink: 0, flexWrap: "wrap" }}>
        {(["Month", "Year", "All Time"] as TimeMode[]).map(m => (
          <button key={m} onClick={() => handleModeChange(m)} style={pillBtn(mode === m)}>{m}</button>
        ))}
        {(mode === "Month" || mode === "Year") && (
          <>
            <div style={{ width: 4 }} />
            <button onClick={() => mode === "Month" && setMonthOffset(o => o + 1)}
              disabled={mode === "Month" ? !data.has_older : true}
              style={pagerBtn(mode === "Month" && data.has_older)}>‹</button>
            <span style={{ color: "#fff", fontSize: 12, fontWeight: 600, minWidth: 70, textAlign: "center" }}>
              {data.label}
            </span>
            <button onClick={() => mode === "Month" && setMonthOffset(o => Math.max(0, o - 1))}
              disabled={mode === "Month" ? !data.has_newer : true}
              style={pagerBtn(mode === "Month" && data.has_newer)}>›</button>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", WebkitOverflowScrolling: "touch", padding: "8px 12px 16px", display: "flex", flexDirection: "column", gap: 12 } as React.CSSProperties}>
        {card(heatLabel, <>
          {mode === "All Time" && <AllTimeMonthGrid days={heatmapDays} />}
          {mode === "Year" && <YearGrid days={heatmapDays} year={currentYear} />}
          {mode === "Month" && <MonthHeatmap days={heatmapDays} />}
        </>)}

        {card("DAYPART CLOCK · HOUR DISTRIBUTION",
          <DaypartWaffleClock data={data.daypart_flow} />
        )}

        {card("BY DAY · DAY OF WEEK BREAKDOWN", (
          mode === "Year" ? (
            <DayOfWeekHourGrid days={data.heatmap_all} year={currentYear} />
          ) : mode === "Month" ? (
            <DayOfWeekPartGrid minutes={data.minutes_by_dow} parts={data.day_parts} heatmapAll={data.heatmap_all} year={currentYear} />
          ) : (
            <DayOfWeekAllTimeGrid days={data.heatmap_all} />
          )
        ))}
      </div>
    </div>
  );
}

// ─── StatsView ────────────────────────────────────────────────────────────────

type StatTab = "sessions" | "periods" | "time" | "trends" | "genres";

export function StatsView() {
  const [tab, setTab] = useState<StatTab>("sessions");

  const tabStyle = (t: StatTab): React.CSSProperties => ({
    background: "none", border: "none",
    borderBottom: `2px solid ${tab === t ? "var(--green, #1db954)" : "transparent"}`,
    padding: "8px 16px", marginBottom: -1,
    fontSize: 13, fontWeight: tab === t ? 600 : 400,
    cursor: "pointer", color: tab === t ? "var(--green, #1db954)" : "#555",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        padding: "16px 16px 0",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        background: "#0e0e0e", flexShrink: 0, borderBottom: "1px solid #1e1e1e",
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", marginBottom: 8 }}>Stats</div>
        <div style={{ display: "flex", borderBottom: "1px solid #1a1a1a" }}>
          <button style={tabStyle("sessions")} onClick={() => setTab("sessions")}>Sessions</button>
          <button style={tabStyle("periods")} onClick={() => setTab("periods")}>Periods</button>
          <button style={tabStyle("time")} onClick={() => setTab("time")}>Time</button>
          <button style={tabStyle("trends")} onClick={() => setTab("trends")}>Trends</button>
          <button style={tabStyle("genres")} onClick={() => setTab("genres")}>Genres</button>
        </div>
      </div>

      {tab === "sessions" && <SessionsPanel />}
      {tab === "periods" && <PeriodsPanel />}
      {tab === "time" && <TimeTabMobile />}
      {tab === "trends" && <TrendsPanel />}
      {tab === "genres" && (
        <iframe
          src="/api/stats/genres-page"
          style={{ flex: 1, border: "none", display: "block", minHeight: 0 }}
          title="Genre Network"
        />
      )}
    </div>
  );
}
