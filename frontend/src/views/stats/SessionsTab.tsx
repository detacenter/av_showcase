import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { API_BASE as ART_BASE } from "../../api/config";
import type { VinylRecord, VinylResponse } from "../../api/types";

// ── Types ──────────────────────────────────────────────────────────────────────

interface Track {
  played_at: string;
  track_name: string;
  artist_names: string[];
  album_id: string;
  album_name: string;
  duration_ms: number;
  release_year?: number;
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
  release_years: number[];
  artist_counts: [string, number][];
  album_counts: [string, number][];
  album_colors: Record<string, string>;
  tracks: Track[];
}

interface VinylSession {
  id: string;
  started_at: number;    // unix timestamp
  ended_at: number | null;
  duration_seconds: number;
  status: "active" | "confirmed" | "unconfirmed";
  release_id: string | null;
  title: string | null;
  artists: string[];
  art_filename: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const ART_SIZE = 104;
const GOLD = "#c8a84b";
const GOLD_DIM = "color-mix(in srgb, #c8a84b 40%, black)";
const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const VINYL_POLL_MS = 4000;
const LIVE_INTERVAL_MIN = 5;

function artUrl(localPath: string): string | null {
  if (!localPath) return null;
  const fn = localPath.split("/").pop();
  return fn ? `${ART_BASE}/artwork/${fn}` : null;
}

function vinylArtUrl(filename: string | null | undefined): string | null {
  return filename ? `${ART_BASE}/artwork/${filename}` : null;
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

function localDayIndex(d: Date, weekStart: Date): number {
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const b = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function formatHour(h: number): string {
  if (h === 0) return "12am";
  if (h === 12) return "12pm";
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

function formatClockTimeFromTs(ts: number): string {
  return formatClockTime(new Date(ts * 1000).toISOString());
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  return `${Math.round(minutes)}m`;
}

function formatDurationSecs(seconds: number): string {
  return formatDuration(seconds / 60);
}

function formatTrackDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function daypart(d: Date): string {
  const h = d.getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "late night";
}

function vinylStartDate(vs: VinylSession): Date {
  return new Date(vs.started_at * 1000);
}

// Displayed duration for a live session: floor to nearest 5-min interval
function liveDisplayMinutes(startedAt: number): number {
  const elapsed = (Date.now() / 1000) - startedAt;
  return Math.floor((elapsed / 60) / LIVE_INTERVAL_MIN) * LIVE_INTERVAL_MIN;
}

// Active OR confirmed-but-still-playing (no ended_at)
function isLive(vs: VinylSession): boolean {
  return vs.status === "active" || (vs.status === "confirmed" && !vs.ended_at);
}

// ── Week grid ──────────────────────────────────────────────────────────────────

const ROW_H = 24;
const LABEL_W = 72;
const BAR_UNSEL = "color-mix(in srgb, var(--green) 43%, black)";

function computeWindow(
  weekSessions: Session[],
  weekVinyl: VinylSession[],
): { start: number; span: number; hours: number[] } {
  const offsets: [number, number][] = [];
  for (const s of weekSessions) {
    const startMin = minutesOfDay(new Date(s.start));
    const endMin = startMin + s.duration_minutes;
    offsets.push([startMin, Math.min(endMin, 1440)]);
    // A session crossing midnight gets rendered as a second segment starting
    // at minute 0 on the following day (see the dayDigital-building loop
    // below) — that continuation segment's own start (0) needs to be part of
    // this window computation too, or it can fall outside [winStart, winEnd]
    // and render at a negative pct(), pushing the bar left of the timeline
    // into the date-label column.
    if (endMin > 1440) {
      offsets.push([0, endMin - 1440]);
    }
  }
  for (const vs of weekVinyl) {
    const d = vinylStartDate(vs);
    const startMin = minutesOfDay(d);
    const durMin = (vs.duration_seconds || 0) / 60;
    offsets.push([startMin, Math.min(startMin + durMin, 1440)]);
  }
  if (offsets.length === 0) {
    return { start: 8 * 60, span: 14 * 60, hours: Array.from({ length: 15 }, (_, i) => i + 8) };
  }
  const minOff = Math.min(...offsets.map(([s]) => s));
  const maxOff = Math.max(...offsets.map(([, e]) => e));
  let winStart = Math.max(0, Math.floor(minOff / 60) * 60 - 60);
  let winEnd = Math.min(1440, Math.floor((maxOff + 119) / 60) * 60);
  if (winEnd - winStart < 8 * 60) {
    const mid = Math.floor((winStart + winEnd) / 2);
    winStart = Math.max(0, mid - 4 * 60);
    winEnd = winStart + 8 * 60;
  }
  const span = Math.max(8 * 60, winEnd - winStart);
  const hours: number[] = [];
  for (let h = winStart / 60; h <= (winStart + span) / 60; h++) {
    if (Number.isInteger(h) && h >= 0 && h <= 24) hours.push(h);
  }
  return { start: winStart, span, hours };
}

function WeekGrid({ sessions, vinylSessions, weekStart, selectedId, onSelect }: {
  sessions: Session[];
  vinylSessions: VinylSession[];
  weekStart: Date;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const hasLive = vinylSessions.some(isLive);
    if (!hasLive) return;
    const id = setInterval(() => setTick(t => t + 1), 30_000);
    return () => clearInterval(id);
  }, [vinylSessions]);

  const dayDigital: { session: Session; startMin: number; endMin: number }[][] =
    Array.from({ length: 7 }, () => []);
  const dayVinyl: { vs: VinylSession; startMin: number; endMin: number }[][] =
    Array.from({ length: 7 }, () => []);

  for (const s of sessions) {
    const startD = new Date(s.start);
    const endD = new Date(s.end);
    const dayIdx = localDayIndex(startD, weekStart);
    const endDayIdx = localDayIndex(endD, weekStart);
    if (dayIdx >= 0 && dayIdx < 7) {
      dayDigital[dayIdx].push({ session: s, startMin: minutesOfDay(startD), endMin: dayIdx === endDayIdx ? (minutesOfDay(endD) || 1440) : 1440 });
    }
    if (endDayIdx !== dayIdx && endDayIdx >= 0 && endDayIdx < 7 && minutesOfDay(endD) > 0) {
      dayDigital[endDayIdx].push({ session: s, startMin: 0, endMin: minutesOfDay(endD) });
    }
  }

  for (const vs of vinylSessions) {
    const startD = vinylStartDate(vs);
    const dayIdx = localDayIndex(startD, weekStart);
    if (dayIdx < 0 || dayIdx >= 7) continue;
    const startMin = minutesOfDay(startD);
    let durMin = (vs.duration_seconds || 0) / 60;
    if (isLive(vs)) {
      durMin = liveDisplayMinutes(vs.started_at);
    }
    if (durMin < LIVE_INTERVAL_MIN && !isLive(vs) && vs.status !== "confirmed") continue;
    const displayDurMin = !isLive(vs) && vs.status === "confirmed" && durMin < LIVE_INTERVAL_MIN ? LIVE_INTERVAL_MIN : durMin;
    const endMin = Math.min(startMin + displayDurMin, 1440);
    dayVinyl[dayIdx].push({ vs, startMin, endMin });
  }

  const { start: winStart, span: winSpan, hours } = computeWindow(
    sessions.filter(s => {
      const d = new Date(s.start);
      return d >= weekStart && d < addDays(weekStart, 7);
    }),
    vinylSessions.filter(vs => {
      const d = vinylStartDate(vs);
      return d >= weekStart && d < addDays(weekStart, 7);
    }),
  );
  const pct = (min: number) => `${((min - winStart) / winSpan) * 100}%`;
  const wPct = (dur: number) => `${Math.max(0.4, (dur / winSpan) * 100)}%`;

  return (
    <div style={{ background: "#101010", borderRadius: 10, overflow: "hidden", flexShrink: 0 }}>
      <div style={{ display: "flex", height: 16, position: "relative", marginLeft: LABEL_W }}>
        {hours.filter(h => h < 24).map(h => (
          <div key={h} style={{ position: "absolute", left: pct(h * 60), fontSize: 9, color: "#535353", transform: "translateX(-50%)", whiteSpace: "nowrap", lineHeight: "14px" }}>{formatHour(h)}</div>
        ))}
      </div>
      {Array.from({ length: 7 }, (_, i) => {
        const date = addDays(weekStart, i);
        const rowBg = i % 2 === 0 ? "#191919" : "#101010";
        return (
          <div key={i} style={{ display: "flex", height: ROW_H, borderTop: "1px solid #141414", background: rowBg, position: "relative" }}>
            <div style={{ width: LABEL_W, flexShrink: 0, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", fontSize: 9, lineHeight: 1.3 }}>
              <span style={{ color: "#fff", fontWeight: 700 }}>{DAY_NAMES[i]}</span>
              <span style={{ color: "#b3b3b3" }}>{date.getMonth() + 1}/{date.getDate()}</span>
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              {hours.filter(h => h < 24).map(h => (
                <div key={h} style={{ position: "absolute", left: pct(h * 60), top: 2, bottom: 2, width: 1, borderLeft: "1px dotted rgba(75,75,75,0.6)" }} />
              ))}
              {/* Digital bars */}
              {dayDigital[i].map((seg, j) => {
                const isSel = seg.session.id === selectedId;
                return (
                  <div key={`d${j}`} onClick={() => onSelect(seg.session.id)} title={`${seg.session.top_artist} · ${Math.round(seg.session.duration_minutes)}m`}
                    style={{ position: "absolute", left: pct(seg.startMin), width: wPct(seg.endMin - seg.startMin), top: 3, bottom: 3, borderRadius: 3, background: isSel ? "var(--green)" : BAR_UNSEL, cursor: "pointer" }}
                  />
                );
              })}
              {/* Vinyl bars */}
              {dayVinyl[i].map((seg, j) => {
                const isSel = seg.vs.id === selectedId;
                const isLive = seg.vs.status === "active";
                const isUnconf = seg.vs.status === "unconfirmed";
                const dur = seg.endMin - seg.startMin;
                return (
                  <div key={`v${j}`} onClick={() => onSelect(seg.vs.id)} title={seg.vs.title || "Vinyl session"}
                    style={{ position: "absolute", left: pct(seg.startMin), width: wPct(dur), top: 6, bottom: 6, borderRadius: 3, background: isSel ? GOLD : GOLD_DIM, cursor: "pointer", border: isLive ? `1px solid ${GOLD}` : "none", opacity: isUnconf ? 0.6 : 1 }}
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Vinyl session detail ───────────────────────────────────────────────────────

function VinylSessionDetail({ vs, record, onDelete }: { vs: VinylSession; record: VinylRecord | null; onDelete: () => void }) {
  const startD = vinylStartDate(vs);
  const [elapsed, setElapsed] = useState(liveDisplayMinutes(vs.started_at));

  useEffect(() => {
    if (!isLive(vs)) return;
    const id = setInterval(() => setElapsed(liveDisplayMinutes(vs.started_at)), 30_000);
    return () => clearInterval(id);
  }, [vs.status, vs.ended_at, vs.started_at]);

  const displayMin = isLive(vs) ? elapsed : (vs.duration_seconds ?? 0) / 60;
  const url = vinylArtUrl(vs.art_filename);

  return (
    <div style={{ flex: 1, minHeight: 0, background: "#141414", borderRadius: 16, padding: "14px 18px", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box" }}>
      {/* Header row */}
      <div style={{ display: "flex", gap: 14, marginBottom: 12, flexShrink: 0 }}>
        <div style={{ width: ART_SIZE, height: ART_SIZE, borderRadius: 8, overflow: "hidden", flexShrink: 0, background: "#222" }}>
          {url
            ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 32 }}>♪</div>
          }
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 10, color: GOLD, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>Vinyl</span>
            {isLive(vs) && <span style={{ fontSize: 10, color: GOLD, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", animation: "pulse 2s infinite" }}>● Live</span>}
            {(vs.status === "unconfirmed" || (isLive(vs) && !vs.title)) && (
              <button
                onClick={() => window.dispatchEvent(new CustomEvent("vinyl-reconfirm", { detail: { sessionId: vs.id } }))}
                style={{ fontSize: 10, color: "#fff", background: GOLD_DIM, border: "none", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 700 }}
              >{vs.status === "unconfirmed" ? "Confirm album" : "Set album"}</button>
            )}
            <button
              onClick={onDelete}
              style={{ fontSize: 10, color: "#ff5555", background: "rgba(255,85,85,0.1)", border: "1px solid rgba(255,85,85,0.25)", borderRadius: 4, padding: "2px 8px", cursor: "pointer", fontWeight: 700, marginLeft: "auto" }}
            >Delete</button>
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: vs.title ? "#fff" : "#555", marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {vs.title || "Unknown album"}
          </div>
          <div style={{ fontSize: 13, color: "#888", marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {vs.artists.join(", ") || "—"}
          </div>
          <div style={{ fontSize: 12, color: "#666" }}>
            {startD.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
            {" · "}
            {formatClockTimeFromTs(vs.started_at)}
            {vs.ended_at ? ` – ${formatClockTimeFromTs(vs.ended_at)}` : ""}
            {" · "}
            <span style={{ color: vs.status === "active" ? GOLD : "#888" }}>{formatDurationSecs(displayMin * 60)}</span>
          </div>
        </div>
      </div>

      {/* Record details from collection */}
      {record && (
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          {/* Meta row */}
          <div style={{ display: "flex", gap: 16, marginBottom: 12, flexWrap: "wrap" }}>
            {record.year && <MetaChip label="Year" value={String(record.year)} />}
            {record.original_year && record.original_year !== record.year && <MetaChip label="Original" value={String(record.original_year)} />}
            {record.vinyl_type && <MetaChip label="Format" value={record.vinyl_type} color={GOLD} />}
            {record.labels?.[0] && <MetaChip label="Label" value={record.labels[0]} />}
            {record.country && <MetaChip label="Country" value={record.country} />}
          </div>
          {/* Tracklist */}
          {record.tracklist?.length > 0 && (
            <div style={{ background: "#0d0d0d", borderRadius: 10, padding: "6px 0" }}>
              {record.tracklist.map((t: any, i: number) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "36px 1fr auto", alignItems: "center", height: 26, padding: "0 10px", gap: 8 }}>
                  <span style={{ fontSize: 10, color: GOLD, fontWeight: 700, textAlign: "right" }}>{t.position}</span>
                  <span style={{ fontSize: 12, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  {t.duration && <span style={{ fontSize: 10, color: "#555", fontVariantNumeric: "tabular-nums" }}>{t.duration}</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MetaChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 9, color: "#555", fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>{label}</span>
      <span style={{ fontSize: 12, color: color || "#bbb", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

// ── Digital session detail ─────────────────────────────────────────────────────

function BreakdownBar({ label, count, max, color }: { label: string; count: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>{label}</span>
        <span style={{ fontSize: 11, color: "#b3b3b3", flexShrink: 0, marginLeft: 8, width: 28, textAlign: "right" }}>{count}</span>
      </div>
      <div style={{ height: 5, background: "#242424", borderRadius: 3 }}>
        <div style={{ height: "100%", borderRadius: 3, width: `${(count / max) * 100}%`, background: color }} />
      </div>
    </div>
  );
}

function SessionDetail({ session }: { session: Session }) {
  const startD = new Date(session.start);
  const albumColors = session.album_colors ?? {};
  const albumsSeen = new Map<string, string>();
  for (const t of session.tracks) {
    const key = t.album_id || t.album_name;
    if (key && !albumsSeen.has(key)) albumsSeen.set(key, t.album_art_local_path || "");
  }
  const totalMs = Math.max(1, session.tracks.reduce((s, t) => s + (t.duration_ms || 0), 0));
  const fpSegs: { key: string; pct: number }[] = [];
  for (const t of session.tracks) {
    const key = t.album_id || t.album_name || "";
    const pct = (t.duration_ms || 0) / totalMs * 100;
    if (fpSegs.length && fpSegs[fpSegs.length - 1].key === key) fpSegs[fpSegs.length - 1].pct += pct;
    else fpSegs.push({ key, pct });
  }
  const era = session.release_years.length === 0 ? "" :
    session.release_years.length === 1 ? String(session.release_years[0]) :
    `${session.release_years[0]}–${session.release_years[session.release_years.length - 1]}`;
  const uniqueArtists = new Set(session.tracks.flatMap(t => t.artist_names)).size;
  const uniqueAlbums = albumsSeen.size;
  const subtitle = [
    `${uniqueArtists} ${uniqueArtists === 1 ? "artist" : "artists"}`,
    `${uniqueAlbums} ${uniqueAlbums === 1 ? "album" : "albums"}`,
    era, daypart(startD),
  ].filter(Boolean).join("  ·  ");
  const maxArtist = session.artist_counts[0]?.[1] ?? 1;
  const maxAlbum = session.album_counts[0]?.[1] ?? 1;

  return (
    <div style={{ flex: 1, minHeight: 0, background: "#141414", borderRadius: 16, padding: "10px 14px 12px", display: "flex", flexDirection: "column", overflow: "hidden", boxSizing: "border-box" }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 10, overflowX: "auto", height: ART_SIZE + 10, alignItems: "center", flexShrink: 0 }}>
        {Array.from(albumsSeen.entries()).map(([key, localPath]) => {
          const url = artUrl(localPath);
          return url
            ? <img key={key} src={url} width={ART_SIZE} height={ART_SIZE} style={{ borderRadius: 4, flexShrink: 0, objectFit: "cover", background: "#1e1e1e" }} onError={e => { (e.target as HTMLImageElement).style.display = "none"; }} />
            : <div key={key} style={{ width: ART_SIZE, height: ART_SIZE, borderRadius: 4, flexShrink: 0, background: "#1e1e1e" }} />;
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
          {startD.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          {" · "}{formatClockTime(session.start)} – {formatClockTime(session.end)}
          {" · "}{formatDuration(session.duration_minutes)}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
          {session.genres.map(g => (
            <span key={g} style={{ fontSize: 11, fontWeight: 600, color: "#fff", background: "#202020", borderRadius: 10, padding: "3px 10px", whiteSpace: "nowrap" }}>{g}</span>
          ))}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "#b3b3b3", marginBottom: 8, flexShrink: 0 }}>{subtitle}</div>
      <div style={{ height: 24, position: "relative", marginBottom: 10, flexShrink: 0 }}>
        <div style={{ position: "absolute", top: 4, left: 0, right: 0, height: 16, background: "#242424", overflow: "hidden", display: "flex" }}>
          {fpSegs.map((seg, i) => <div key={i} style={{ width: `${seg.pct}%`, background: albumColors[seg.key] || "#333", flexShrink: 0 }} />)}
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
        <div style={{ flex: 3, minWidth: 0, overflowY: "auto", background: "#0d0d0d", borderRadius: 12, padding: "4px 0" }}>
          {session.tracks.map((t, i) => {
            const key = t.album_id || t.album_name || "";
            const color = albumColors[key] || "#535353";
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "3px 36px 1fr 120px 36px", alignItems: "center", height: 26, padding: "0 6px 0 0", gap: 8 }}>
                <div style={{ width: 3, height: 18, borderRadius: 2, background: color }} />
                <span style={{ fontSize: 10, color: "#535353", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatShortTime(t.played_at)}</span>
                <span style={{ fontSize: 11, color: "#fff", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.track_name}</span>
                <span style={{ fontSize: 10, color: "#b3b3b3", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist_names[0] ?? ""}</span>
                <span style={{ fontSize: 10, color: "#535353", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{formatTrackDuration(t.duration_ms)}</span>
              </div>
            );
          })}
        </div>
        <div style={{ flex: 2, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#101010", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Artists</div>
            {session.artist_counts.map(([name, count]) => <BreakdownBar key={name} label={name} count={count} max={maxArtist} color="var(--green)" />)}
          </div>
          <div style={{ background: "#101010", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", marginBottom: 10 }}>Albums</div>
            {session.album_counts.map(([name, count]) => <BreakdownBar key={name} label={name} count={count} max={maxAlbum} color="#4e8cff" />)}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SessionsTab ────────────────────────────────────────────────────────────────

export function SessionsTab() {
  const { data: sessions = [] } = useQuery<Session[]>({
    queryKey: ["sessions"],
    queryFn: () => api.get("/api/stats/sessions"),
    staleTime: 60_000,
  });

  const { data: vinylSessions = [], refetch: refetchVinyl } = useQuery<VinylSession[]>({
    queryKey: ["vinyl-sessions"],
    queryFn: () => api.get("/api/vinyl/sessions"),
    refetchInterval: VINYL_POLL_MS,
    staleTime: 0,
  });

  const { data: vinylCollection } = useQuery<VinylResponse>({
    queryKey: ["vinyl"],
    queryFn: () => api.get("/api/vinyl"),
    staleTime: 60_000,
  });

  const [weekStart, setWeekStart] = useState<Date>(() => getMondayOf(new Date()));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    // Default to most recent digital session
    if (sessions.length === 0) return;
    const d = new Date(sessions[0].start);
    setWeekStart(getMondayOf(d));
    setSelectedId(sessions[0].id);
  }, [sessions.length > 0]);

  const weekEnd = addDays(weekStart, 6);
  const weekLabel = `${weekStart.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  const weekSessions = sessions.filter(s => {
    const d = new Date(s.start);
    return d >= weekStart && d < addDays(weekStart, 7);
  });

  const weekVinyl = vinylSessions.filter(vs => {
    const d = vinylStartDate(vs);
    return d >= weekStart && d < addDays(weekStart, 7);
  });

  const unconfirmed = vinylSessions.filter(vs => vs.status === "unconfirmed");

  const oldestWeek = sessions.length > 0 ? getMondayOf(new Date(sessions[sessions.length - 1].start)) : weekStart;
  const currentWeek = getMondayOf(new Date());
  const canPrev = weekStart > oldestWeek;
  const canNext = weekStart < currentWeek;

  const selectedSession = sessions.find(s => s.id === selectedId) ?? null;
  const selectedVinyl = vinylSessions.find(vs => vs.id === selectedId) ?? null;

  const recordForVinyl = useCallback((vs: VinylSession | null): VinylRecord | null => {
    if (!vs?.release_id || !vinylCollection) return null;
    return vinylCollection.records.find(r => String(r.release_id) === vs.release_id) ?? null;
  }, [vinylCollection]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", padding: "16px 24px 16px", gap: 8, boxSizing: "border-box" }}>

      {/* Unconfirmed vinyl sessions banner */}
      {unconfirmed.length > 0 && (
        <div style={{ background: "#1a160a", border: `1px solid ${GOLD_DIM}`, borderRadius: 8, padding: "8px 12px", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13 }}>♪</span>
            <span style={{ fontSize: 12, color: "#bbb" }}>
              {unconfirmed.length} unconfirmed vinyl {unconfirmed.length === 1 ? "session" : "sessions"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {unconfirmed.slice(0, 3).map(vs => (
              <button
                key={vs.id}
                onClick={() => {
                  setSelectedId(vs.id);
                  // Navigate to the week containing this session
                  setWeekStart(getMondayOf(vinylStartDate(vs)));
                }}
                style={{ fontSize: 11, color: GOLD, background: "rgba(200,168,75,0.12)", border: `1px solid ${GOLD_DIM}`, borderRadius: 5, padding: "3px 10px", cursor: "pointer", fontWeight: 600 }}
              >
                {vs.title
                  ? vs.title.length > 20 ? vs.title.slice(0, 20) + "…" : vs.title
                  : vinylStartDate(vs).toLocaleDateString("en-US", { month: "short", day: "numeric" })
                } ?
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Week navigation */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <button disabled={!canPrev} onClick={() => setWeekStart(w => addDays(w, -7))}
          style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#202020", color: canPrev ? "#b3b3b3" : "#333", fontSize: 14, cursor: canPrev ? "pointer" : "default" }}>←</button>
        <span style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600, color: "#fff" }}>{weekLabel}</span>
        <button disabled={!canNext} onClick={() => setWeekStart(w => addDays(w, 7))}
          style={{ width: 28, height: 28, borderRadius: 8, border: "none", background: "#202020", color: canNext ? "#b3b3b3" : "#333", fontSize: 14, cursor: canNext ? "pointer" : "default" }}>→</button>
      </div>

      <WeekGrid
        sessions={weekSessions}
        vinylSessions={weekVinyl}
        weekStart={weekStart}
        selectedId={selectedId}
        onSelect={setSelectedId}
      />

      {selectedVinyl && (
        <VinylSessionDetail
          key={selectedVinyl.id}
          vs={selectedVinyl}
          record={recordForVinyl(selectedVinyl)}
          onDelete={async () => {
            await api.del(`/api/vinyl/sessions/${selectedVinyl.id}`);
            setSelectedId(null);
            refetchVinyl();
          }}
        />
      )}
      {selectedSession && !selectedVinyl && <SessionDetail session={selectedSession} />}
    </div>
  );
}
