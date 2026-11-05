import { useState, type CSSProperties, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { avBeganDate, useHistoryInfo } from "../../api/useHistoryInfo";
import { TimePicker } from "../../components/TimePicker";
import { monthHeatColor, RAINBOW_HUES } from "./time/helpers";
import { CardTitle } from "./PeriodsCardTitle";
import { artUrl, card, decadeColor, decadeName, DOWN, DOWN_TEXT, MUTED, SOFT } from "./periodsShared";

// Periods › Year: one page per year, built from /api/stats/year.

// ─── Types ────────────────────────────────────────────────────────────────────

interface AlbumRef { album_id: string; title: string; artist: string; art_path: string | null; minutes: number; in_top: boolean }
interface SongRef { title: string; artist: string; album: string; art_path: string | null; minutes?: number }
interface MonthRow {
  month: number;
  minutes: number;
  future: boolean;
  album: AlbumRef | null;
  artist: { name: string; art_path: string | null; minutes: number } | null;
  song: (SongRef & { minutes: number }) | null;
}
interface Char { kind: "discovery" | "slow_burn" | "fling" | "comeback"; name: string; sub: string; art_path: string | null; bars: number[] }
interface ClubCard { title: string; kind: string; name: string; art_path: string | null; stat: string; why: string; math: string; bars: number[] }

interface YearPayload {
  year: number;
  years: number[];
  empty: boolean;
  in_progress?: boolean;
  through?: string | null;
  band: {
    minutes: number; plays: number; prev_minutes: number | null; prev_plays: number | null;
    hours_change: number | null; plays_change: number | null;
    artists: number; artists_delta: number | null; new_artists: number;
    albums: number; new_albums: number; days_with_music: number; days_total: number;
    biggest_day: { date: string; minutes: number };
    longest_streak: { days: number; start: string | null; end: string | null };
  };
  months: MonthRow[];
  month_facts: {
    distinct: number; months_with_music: number;
    repeats: { album: string; months: number[] }[];
    reign: { weeks: number; album: string; start: string; end: string } | null;
    off_list: number[];
  };
  yoy: { now: number[]; prev: number[] | null; rank: number; of: number; peak: { month: number; minutes: number }; quietest: { month: number; minutes: number } };
  rhythm: {
    peak_hour: number; evening_pct: number; weekend_ratio: number | null;
    longest_session: { minutes: number; date: string } | null;
    dry_spell: { days: number; start: string | null; end: string | null };
    heat: number[][];
  };
  on_repeat: (SongRef & { date: string; plays: number; minutes: number; first: string; last: string })[];
  discovery: {
    count: number;
    tiles: { name: string; plays: number; month: number; art_path: string | null }[];
    per_month: number[];
    chars: Char[];
    what_stuck: {
      still: number; faded: number; only: number; once: number; faded_until: number | null; current_year: number;
      keepers: { name: string; art_path: string | null }[]; of_tiles: number;
    } | null;
  };
  genres: { name: string; now: number; prev: number }[];
  new_genres: number;
  made: {
    median: number | null; prev_median: number | null;
    decades: { decade: number; pct: number }[];
    oldest: { year: number; album: string; plays: number } | null;
    released_this_year_pct: number;
    known_pct: number;
  };
  club: ClubCard[] | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const UP = "var(--green)";

const monthColor = (i: number, strength = 0.85) => monthHeatColor(RAINBOW_HUES[i], strength);
const num = (n: number) => n.toLocaleString("en-US");
const hrs = (m: number) => `${Math.round(m / 60)}h`;
const fmtMin = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h ? `${h}h ${r}m` : `${r}m`;
};
const parseDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const short = (iso: string) => { const d = parseDay(iso); return `${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const dayLabel = (iso: string) => { const d = parseDay(iso); return `${d.toLocaleDateString("en-US", { weekday: "short" })}, ${MONTHS[d.getMonth()]} ${d.getDate()}`; };
const range = (a: string, b: string) => {
  const x = parseDay(a), y = parseDay(b);
  return x.getMonth() === y.getMonth() ? `${short(a)} to ${y.getDate()}` : `${short(a)} to ${short(b)}`;
};
const hourName = (h: number) => (h === 0 ? "12 AM" : h === 12 ? "12 PM" : h < 12 ? `${h} AM` : `${h - 12} PM`);
const ordinal = (n: number) => {
  const v = n % 100, s = ["th", "st", "nd", "rd"];
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};
const changeStyle = (v: number | null): CSSProperties => ({ color: v == null ? SOFT : v >= 0 ? UP : DOWN_TEXT, fontSize: 11 });
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${Math.abs(v)}` : "±0");

const section: CSSProperties = { background: "#141414", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, padding: "14px 16px 16px", display: "flex", flexDirection: "column", gap: 12, minWidth: 0 };
const kicker: CSSProperties = { color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 };

function SectionHead({ title, sub, color = "var(--green)", children }: { title: string; sub?: string; color?: string; children?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 4, height: 18, background: color, borderRadius: 2, flexShrink: 0 }} />
      <h2 style={{ margin: 0, color: MUTED, fontSize: 12, fontWeight: 700, letterSpacing: 2, whiteSpace: "nowrap" }}>{title}</h2>
      {sub && <span style={{ color: MUTED, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</span>}
      {children}
    </div>
  );
}

function Cover({ path, size, radius = 4 }: { path: string | null | undefined; size?: number; radius?: number }) {
  const url = artUrl(path);
  const box: CSSProperties = size ? { width: size, height: size, flexShrink: 0 } : { width: "100%", aspectRatio: "1" };
  return url
    ? <img src={url} alt="" style={{ ...box, objectFit: "cover", display: "block", borderRadius: radius }} />
    : <div style={{ ...box, background: "#222", borderRadius: radius }} />;
}

function Bars({ values, color, height = 26 }: { values: number[]; color: string; height?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height }}>
      {values.map((v, i) => (
        <div key={i} style={{ flex: 1, height: Math.max(2, Math.round((v / max) * height)), borderRadius: 2, background: v ? color : "#2a2a2a" }} />
      ))}
    </div>
  );
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function StatBand({ d }: { d: YearPayload }) {
  const b = d.band;
  const prev = d.year - 1;
  const quiet = b.days_total - b.days_with_music;
  const tiles: { label: string; value: string; sub: string; style?: CSSProperties }[] = [
    { label: "HOURS", value: num(Math.round(b.minutes / 60)), sub: b.hours_change != null ? `${signed(b.hours_change)}% vs ${prev}` : "first year on record", style: changeStyle(b.hours_change) },
    { label: "PLAYS", value: num(b.plays), sub: b.plays_change != null ? `${signed(b.plays_change)}% vs ${prev}` : "", style: changeStyle(b.plays_change) },
    { label: "ARTISTS", value: num(b.artists), sub: b.artists_delta != null ? `${signed(b.artists_delta)} vs ${prev}` : "", style: changeStyle(b.artists_delta) },
    { label: "NEW ARTISTS", value: num(b.new_artists), sub: "never played before" },
    { label: "ALBUMS", value: num(b.albums), sub: `${num(b.new_albums)} new to you` },
    { label: "DAYS WITH MUSIC", value: num(b.days_with_music), sub: `of ${b.days_total} · ${quiet} quiet` },
    { label: "BIGGEST DAY", value: short(b.biggest_day.date), sub: fmtMin(b.biggest_day.minutes) },
    { label: "LONGEST STREAK", value: `${b.longest_streak.days} days`, sub: b.longest_streak.start && b.longest_streak.end ? range(b.longest_streak.start, b.longest_streak.end) : "" },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(8, minmax(0, 1fr))", gap: 10 }}>
      {tiles.map(t => (
        <div key={t.label} style={{ background: "#1b1b1b", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          <span style={{ ...kicker, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.label}</span>
          <span style={{ fontSize: 22, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", whiteSpace: "nowrap" }}>{t.value}</span>
          <span style={{ color: SOFT, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", ...t.style }}>{t.sub}</span>
        </div>
      ))}
    </div>
  );
}

type MonthsKind = "Albums" | "Artists" | "Songs";

function YearInMonths({ d, onOpenMonth }: { d: YearPayload; onOpenMonth: (month: number) => void }) {
  const [kind, setKind] = useState<MonthsKind>("Albums");
  const maxMonth = Math.max(...d.months.map(m => m.minutes), 1);
  const f = d.month_facts;
  const leaders = d.months.map(m => m.album?.album_id ?? null);

  const pill = (k: MonthsKind): CSSProperties => ({
    padding: "3px 10px", borderRadius: 10, fontSize: 11, cursor: "pointer",
    border: `1px solid ${kind === k ? "var(--green)" : "#2a2a2a"}`, background: "transparent",
    color: kind === k ? "var(--green)" : MUTED, fontWeight: kind === k ? 700 : 400,
  });

  const facts: { k: string; v: string; s: string }[] = [
    {
      k: "DIFFERENT #1s", v: `${f.distinct} of ${f.months_with_music}`,
      s: f.repeats.length ? f.repeats.map(r => `${r.album} led ${r.months.map(m => MONTHS[m - 1]).join(", ")}`).join(" · ") : "a new #1 every month",
    },
    { k: "LONGEST REIGN", v: f.reign ? `${f.reign.weeks} ${f.reign.weeks === 1 ? "week" : "weeks"}` : "–", s: f.reign ? `${f.reign.album}, ${short(f.reign.start)} to ${short(f.reign.end)}` : "" },
    {
      k: "OFF THE YEAR LIST", v: `${f.off_list.length} ${f.off_list.length === 1 ? "month" : "months"}`,
      s: f.off_list.length ? `${f.off_list.map(m => MONTHS[m - 1]).join(", ")} #1s missed your top 16` : "every #1 made your top 16",
    },
  ];

  return (
    <section style={section}>
      <SectionHead title="THE YEAR IN MONTHS" color="#20a7ff">
        <div style={{ flex: 1 }} />
        {(["Albums", "Artists", "Songs"] as MonthsKind[]).map(k => <button key={k} onClick={() => setKind(k)} style={pill(k)}>{k}</button>)}
      </SectionHead>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: "12px 8px" }}>
        {d.months.map((m, i) => {
          const empty = !m.album;
          const t = kind === "Albums" ? m.album && { title: m.album.title, sub: m.album.artist, art: m.album.art_path, min: m.album.minutes }
            : kind === "Artists" ? m.artist && { title: m.artist.name, sub: "", art: m.artist.art_path, min: m.artist.minutes }
            : m.song && { title: m.song.title, sub: m.song.artist, art: m.song.art_path, min: m.song.minutes };
          let again = "";
          if (kind === "Albums" && m.album) {
            const firstIdx = leaders.indexOf(m.album.album_id), lastIdx = leaders.lastIndexOf(m.album.album_id);
            if (firstIdx !== i) again = `also ${MONTHS[firstIdx]}`;
            else if (lastIdx !== i) again = `again ${MONTHS[lastIdx]}`;
          }
          const tip = empty ? `${MONTHS_LONG[i]}: ${m.future ? "still to come" : "no listening"}` : `Open ${MONTHS_LONG[i]} ${d.year} · ${hrs(m.minutes)} that month`;
          return (
            <button key={m.month} disabled={empty} onClick={() => onOpenMonth(m.month)} title={tip} style={{
              display: "flex", flexDirection: "column", gap: 5, padding: 0, border: "none", background: "transparent",
              color: "#fff", textAlign: "left", cursor: empty ? "default" : "pointer", minWidth: 0, fontFamily: "inherit",
            }}>
              <div style={{ position: "relative", width: "100%", aspectRatio: "1", borderRadius: 4, overflow: "hidden", background: "#1a1a1a", border: m.future ? "1px dashed #333" : undefined, boxSizing: "border-box" }}>
                {t && <Cover path={t.art} radius={0} />}
                <span style={{ position: "absolute", top: 6, left: 6, fontSize: 10, fontWeight: 800, letterSpacing: 1, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.72)", color: monthColor(i) }}>{MONTHS[i].toUpperCase()}</span>
                {again && <span style={{ position: "absolute", bottom: 6, right: 6, fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: "rgba(0,0,0,0.72)", color: "#fff" }}>{again}</span>}
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t ? t.title : m.future ? "still to come" : "no listening"}</span>
                <span style={{ fontSize: 10, color: MUTED, flexShrink: 0 }}>{m.minutes ? hrs(m.minutes) : ""}</span>
              </div>
              <span style={{ fontSize: 10, color: MUTED, marginTop: -3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {t ? `${t.sub ? `${t.sub} · ` : ""}${hrs(t.min)} that month` : " "}
              </span>
              <div style={{ height: 4, background: "#242424", borderRadius: 2 }}>
                <div style={{ height: "100%", borderRadius: 2, width: `${(m.minutes / maxMonth) * 100}%`, background: monthColor(i, 0.75) }} />
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
        {facts.map(x => (
          <div key={x.k} style={{ background: "#1b1b1b", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={kicker}>{x.k}</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{x.v}</span>
            <span title={x.s} style={{ color: SOFT, fontSize: 11, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{x.s}</span>
          </div>
        ))}
      </div>
      <span style={{ color: MUTED, fontSize: 11 }}>Each month's most-played {kind === "Albums" ? "album" : kind === "Artists" ? "artist" : "song"} by minutes. Bar = that month's total hours. Click a month to open it.</span>
    </section>
  );
}

function YearVsYear({ d, onOpenMonth }: { d: YearPayload; onOpenMonth: (month: number) => void }) {
  const y = d.yoy;
  const prev = y.prev;
  const max = Math.max(...y.now, ...(prev ?? []), 1);
  const change = d.band.hours_change;
  return (
    <section style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>{prev ? `${d.year} vs ${d.year - 1}` : `${d.year}`}</h2>
        <span style={{ color: MUTED, fontSize: 11 }}>hours per month · click a month to open it</span>
        <div style={{ flex: 1 }} />
        {change != null && !d.in_progress && (
          <span style={{ color: change >= 0 ? UP : DOWN_TEXT, fontSize: 12, fontWeight: 700 }}>
            {signed(change)}% overall · {change >= 0 ? "a bigger year" : "a quieter year"}
          </span>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110 }}>
        {y.now.map((v, i) => {
          const future = d.months[i]?.future;
          return (
            <div key={i} onClick={() => v && onOpenMonth(i + 1)} title={`${MONTHS_LONG[i]}: ${hrs(v)}${prev ? ` (${d.year - 1}: ${hrs(prev[i])})` : ""}`}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, height: "100%", justifyContent: "flex-end", cursor: v ? "pointer" : "default" }}>
              <div style={{ display: "flex", gap: 2, alignItems: "flex-end", width: "100%", height: 92 }}>
                {prev && <div style={{ flex: 1, height: Math.max(2, Math.round((prev[i] / max) * 92)), background: "#3a3a3a", borderRadius: "3px 3px 0 0" }} />}
                <div style={{ flex: 1, height: future ? 0 : Math.max(2, Math.round((v / max) * 92)), background: monthColor(i, 0.8), borderRadius: "3px 3px 0 0" }} />
              </div>
              <span style={{ fontSize: 9, color: MUTED }}>{MONTHS[i][0]}</span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 16, color: MUTED, fontSize: 11, flexWrap: "wrap" }}>
        {prev && <>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "var(--green)" }} />{d.year}</span>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: "#3a3a3a" }} />{d.year - 1}</span>
        </>}
        <span>
          Your {y.rank === 1 ? "biggest" : `${ordinal(y.rank)} biggest`} year of {y.of}
          {" · "}peak month {MONTHS_LONG[y.peak.month - 1]} ({hrs(y.peak.minutes)}) · quietest {MONTHS_LONG[y.quietest.month - 1]} ({hrs(y.quietest.minutes)})
        </span>
      </div>
    </section>
  );
}

function Rhythm({ d }: { d: YearPayload }) {
  const r = d.rhythm;
  const max = Math.max(...r.heat.flat(), 1);
  const ratio = r.weekend_ratio;
  const tiles = [
    { k: "PEAK HOUR", v: hourName(r.peak_hour), s: `${r.evening_pct}% of minutes after 6 PM` },
    { k: "WEEKENDS", v: ratio != null ? `${ratio}×` : "–", s: ratio != null && ratio >= 1 ? "more per day than weekdays" : "per day, against weekdays" },
    { k: "LONGEST SESSION", v: r.longest_session ? fmtMin(r.longest_session.minutes) : "–", s: r.longest_session ? dayLabel(r.longest_session.date) : "" },
    { k: "LONGEST DRY SPELL", v: r.dry_spell.days ? `${r.dry_spell.days} ${r.dry_spell.days === 1 ? "day" : "days"}` : "none", s: r.dry_spell.start && r.dry_spell.end ? (r.dry_spell.days === 1 ? short(r.dry_spell.start) : range(r.dry_spell.start, r.dry_spell.end)) : "music every day" },
  ];
  return (
    <section style={card}>
      <CardTitle title="Rhythm" sub={`how ${d.year} was spread out`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        {tiles.map(t => (
          <div key={t.k} style={{ background: "#222", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={kicker}>{t.k}</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{t.v}</span>
            <span style={{ color: SOFT, fontSize: 11 }}>{t.s}</span>
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "34px repeat(24, minmax(0, 1fr))", gap: 2, alignItems: "center", marginTop: 4 }}>
        {r.heat.map((row, di) => [
          <div key={`l${di}`} style={{ fontSize: 9, color: MUTED, fontWeight: 700 }}>{DOW[di]}</div>,
          ...row.map((v, h) => (
            <div key={`${di}-${h}`} title={`${DOW[di]} ${hourName(h)}: ${fmtMin(v)} over the year`} style={{ height: 12, borderRadius: 2, background: monthHeatColor(170, v / max) }} />
          )),
        ])}
        <div />
        {Array.from({ length: 24 }, (_, h) => (
          <div key={`h${h}`} style={{ fontSize: 9, color: MUTED, whiteSpace: "nowrap", height: 12 }}>
            {h % 3 === 0 ? (h === 0 ? "12a" : h === 12 ? "12p" : `${h % 12}${h < 12 ? "a" : "p"}`) : ""}
          </div>
        ))}
      </div>
      <span style={{ color: MUTED, fontSize: 11 }}>Each square is one weekday at one hour, added up over every week of {d.year}. Brighter = more minutes.</span>
    </section>
  );
}

function OnRepeat({ d }: { d: YearPayload }) {
  const rows = d.on_repeat;
  if (rows.length === 0) return null;
  const top = rows[0];
  return (
    <section style={{ ...card, gap: 6, padding: "14px 18px", flexGrow: 1 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "#fff" }}>On repeat</h2>
        <span style={{ color: MUTED, fontSize: 11 }}>the days one song took over</span>
        <div style={{ flex: 1 }} />
        <span style={{ color: MUTED, fontSize: 11 }}>record: {dayLabel(top.date)} · {fmtMin(top.minutes)} on loop</span>
      </div>
      {rows.map(l => (
        <div key={`${l.title}${l.date}`} title={`${l.plays} plays, ${fmtMin(l.minutes)}, first at ${l.first}, last at ${l.last}`}
          style={{ display: "grid", gridTemplateColumns: "30px minmax(0, 1fr) 96px minmax(0, 1.1fr) 44px", alignItems: "center", gap: 12 }}>
          <Cover path={l.art_path} size={30} />
          <div style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.title}</span>
            <span style={{ fontSize: 10, color: MUTED, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.artist} · from {l.album}</span>
          </div>
          <span style={{ fontSize: 11, color: SOFT, whiteSpace: "nowrap" }}>{dayLabel(l.date)}</span>
          <div style={{ height: 8, background: "#242424", borderRadius: 4, position: "relative" }}>
            <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, background: "var(--green)", width: `${(l.plays / top.plays) * 100}%` }} />
          </div>
          <span style={{ fontSize: 16, fontWeight: 800, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "#fff" }}>×{l.plays}</span>
        </div>
      ))}
    </section>
  );
}

const CHAR_META: Record<Char["kind"], { title: string; color: string }> = {
  discovery: { title: "DISCOVERY OF THE YEAR", color: "var(--green)" },
  slow_burn: { title: "SLOW BURN", color: "#8cc9a3" },
  fling: { title: "THE FLING", color: DOWN },
  comeback: { title: "THE COMEBACK", color: "#d9a441" },
};

function WhatStuck({ d }: { d: YearPayload }) {
  const w = d.discovery.what_stuck;
  if (!w) return null;
  const total = w.still + w.faded + w.only + w.once;
  const groups = [
    { k: "STILL PLAYING", n: w.still, s: `played in ${w.current_year}`, c: "var(--green)" },
    { k: "FADED", n: w.faded, s: `played after ${d.year}, not in ${w.current_year}`, c: "#1d8f88" },
    { k: `ONLY ${d.year}`, n: w.only, s: "more than one play, never again", c: "#2f5f5b" },
    { k: "ONE AND DONE", n: w.once, s: "a single play, ever", c: "#3a3a3a" },
  ].filter(g => g.n > 0);
  return (
    <div style={{ background: "#1b1b1b", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10, flexGrow: 1 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--green)", fontSize: 10, fontWeight: 800, letterSpacing: 1.5, whiteSpace: "nowrap" }}>WHAT STUCK</span>
        <span style={{ color: MUTED, fontSize: 11, whiteSpace: "nowrap" }}>the {num(total)}, checked against {d.year + 1 === w.current_year ? w.current_year : `${d.year + 1}–${w.current_year}`}</span>
        <div style={{ flex: 1 }} />
        {w.keepers.length > 0 && (
          <span title={w.keepers.map(k => k.name).join(", ")} style={{ display: "flex", gap: 3, alignItems: "center" }}>
            {w.keepers.slice(0, 5).map(k => <Cover key={k.name} path={k.art_path} size={18} radius={3} />)}
            <span style={{ fontSize: 10, color: MUTED, marginLeft: 4, whiteSpace: "nowrap" }}>{w.keepers.length} of {w.of_tiles} kept</span>
          </span>
        )}
      </div>
      <div style={{ display: "flex", height: 26, gap: 2 }}>
        {groups.map((g, i) => (
          <div key={g.k} title={`${g.k.toLowerCase()}: ${g.n} of ${total}`} style={{
            flex: `${g.n} 1 0`, minWidth: 0, background: g.c, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
            borderRadius: `${i === 0 ? 4 : 0}px ${i === groups.length - 1 ? 4 : 0}px ${i === groups.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
          }}>
            {g.n / total >= 0.08 && <span style={{ fontSize: 11, fontWeight: 800, color: g.c === "#3a3a3a" || g.c === "#2f5f5b" ? "#ddd" : "#0d0d0d" }}>{g.n}</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${groups.length}, minmax(0, 1fr))`, gap: 8 }}>
        {groups.map(g => (
          <div key={g.k} style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: 1, color: SOFT }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, flexShrink: 0, background: g.c }} />{g.k}
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{num(g.n)}</span>
            <span style={{ fontSize: 10, color: MUTED }}>{g.s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Discovery({ d }: { d: YearPayload }) {
  const x = d.discovery;
  const peak = Math.max(...x.per_month, 1);
  const bigMonth = x.per_month.indexOf(peak);
  return (
    <section style={{ ...section, gap: 14 }}>
      <SectionHead title="DISCOVERY" sub={`${num(x.count)} artists you had never played before ${d.year} · "never" is checked against every year of history`} />
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 1fr)", gap: 14, alignItems: "stretch" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 10 }}>
            {x.tiles.map(t => (
              <div key={t.name} title={`${t.name}: ${t.plays} plays, first heard in ${MONTHS_LONG[t.month - 1]}`} style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                <Cover path={t.art_path} radius={6} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
                <span style={{ fontSize: 10, color: MUTED }}>{num(t.plays)} plays · {MONTHS[t.month - 1]}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 56, marginTop: 4 }}>
            {x.per_month.map((n, i) => (
              <div key={i} title={`${MONTHS_LONG[i]}: ${n} new artists`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
                <div style={{ width: "100%", height: Math.round((n / peak) * 44), background: monthColor(i, i === bigMonth ? 0.95 : 0.6), borderRadius: "3px 3px 0 0" }} />
                <span style={{ fontSize: 9, color: MUTED }}>{MONTHS[i][0]}</span>
              </div>
            ))}
          </div>
          <span style={{ color: MUTED, fontSize: 11 }}>New artists found per month. {MONTHS_LONG[bigMonth]} was the big dig ({peak}).</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            {x.chars.map(c => {
              const meta = CHAR_META[c.kind];
              return (
                <div key={c.kind} style={{ background: "#1b1b1b", borderRadius: 12, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                  <span style={{ color: meta.color, fontSize: 10, fontWeight: 800, letterSpacing: 1.5 }}>{meta.title}</span>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
                    <Cover path={c.art_path} size={44} radius={6} />
                    <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                      <span style={{ fontSize: 11, color: SOFT }}>{c.sub}</span>
                    </div>
                  </div>
                  <Bars values={c.bars} color={meta.color} />
                </div>
              );
            })}
          </div>
          <WhatStuck d={d} />
        </div>
      </div>
    </section>
  );
}

function Sound({ d }: { d: YearPayload }) {
  if (d.genres.length === 0) return <section style={card}><CardTitle title={`Your sound vs. ${d.year - 1}`} sub="no year before this one to compare" /></section>;
  const max = Math.max(...d.genres.map(g => Math.max(g.now, g.prev)), 1);
  return (
    <section style={card}>
      <CardTitle title={`Your sound vs. ${d.year - 1}`} sub={`share of plays · ${d.genres.length} biggest movers`} />
      {d.genres.map(g => {
        const delta = g.now - g.prev;
        return (
          <div key={g.name} style={{ display: "grid", gridTemplateColumns: "120px minmax(0, 1fr) 76px", alignItems: "center", gap: 10, height: 22 }}>
            <span style={{ fontSize: 12, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{g.name}</span>
            <div style={{ position: "relative", height: 8, background: "#242424", borderRadius: 4 }}>
              <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, borderRadius: 4, width: `${(g.now / max) * 100}%`, background: delta >= 0 ? "var(--green)" : DOWN }} />
              <div style={{ position: "absolute", top: -3, bottom: -3, width: 2, background: SOFT, left: `calc(${(g.prev / max) * 100}% - 1px)` }} />
            </div>
            <span style={{ fontSize: 11, textAlign: "right", fontVariantNumeric: "tabular-nums", color: delta > 0 ? "var(--green)" : delta < 0 ? DOWN_TEXT : MUTED }}>
              {g.now}% · {signed(delta)}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", gap: 16, color: MUTED, fontSize: 11, paddingTop: 4 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 14, height: 6, borderRadius: 3, background: "var(--green)" }} />{d.year}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 2, height: 12, background: SOFT }} />{d.year - 1}</span>
        {d.new_genres > 0 && <span>{num(d.new_genres)} {d.new_genres === 1 ? "genre" : "genres"} you had never played before</span>}
      </div>
    </section>
  );
}

function WhenMade({ d }: { d: YearPayload }) {
  const m = d.made;
  return (
    <section style={{ ...card, gap: 12 }}>
      <CardTitle title="When it was made" sub={`${d.year}'s plays by release decade`} />
      {m.median && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.03em", color: decadeColor(Math.floor(m.median / 10) * 10) }}>{m.median}</span>
          <span style={{ color: SOFT, fontSize: 12 }}>middle release year, weighted by minutes{m.prev_median ? ` · ${d.year - 1} was ${m.prev_median}` : ""}</span>
        </div>
      )}
      <div style={{ display: "flex", height: 34, gap: 2 }}>
        {m.decades.map((x, i) => (
          <div key={x.decade} title={`${decadeName(x.decade)} · ${Math.round(x.pct)}%`} style={{
            flex: `${x.pct} 1 0`, minWidth: 0, background: decadeColor(x.decade), display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden",
            borderRadius: `${i === 0 ? 4 : 0}px ${i === m.decades.length - 1 ? 4 : 0}px ${i === m.decades.length - 1 ? 4 : 0}px ${i === 0 ? 4 : 0}px`,
          }}>
            {x.pct >= 12 && <span style={{ fontSize: 11, fontWeight: 700, whiteSpace: "nowrap", color: "#0d0d0d" }}>{decadeName(x.decade)} {Math.round(x.pct)}%</span>}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px" }}>
        {m.decades.map(x => (
          <span key={x.decade} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: SOFT, whiteSpace: "nowrap" }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: decadeColor(x.decade) }} />
            {decadeName(x.decade)} <span style={{ color: "#fff", fontWeight: 600 }}>{Math.round(x.pct)}%</span>
          </span>
        ))}
      </div>
      {m.known_pct < 95 && <span style={{ color: MUTED, fontSize: 11 }}>Release year known for {m.known_pct}% of plays so far; shares are of those.</span>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 4 }}>
        {m.oldest && (
          <div title={m.oldest.album} style={{ background: "#222", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            <span style={kicker}>OLDEST PLAYED</span>
            <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{m.oldest.year}</span>
            <span style={{ color: SOFT, fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.oldest.album} · {m.oldest.plays} {m.oldest.plays === 1 ? "play" : "plays"}</span>
          </div>
        )}
        <div style={{ background: "#222", borderRadius: 10, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={kicker}>RELEASED IN {d.year}</span>
          <span style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{m.released_this_year_pct}%</span>
          <span style={{ color: SOFT, fontSize: 11 }}>of your minutes were brand new</span>
        </div>
      </div>
    </section>
  );
}

function AVClub({ d }: { d: YearPayload }) {
  if (!d.club) {
    return (
      <section style={section}>
        <SectionHead title={`THE AV CLUB · CLASS OF ${d.year}`} sub="yearbook superlatives, each one picked by the numbers" />
        <span style={{ color: MUTED, fontSize: 12, padding: "6px 0 2px" }}>The {d.year} class is announced when the year is over.</span>
      </section>
    );
  }
  return (
    <section style={{ ...section, gap: 14 }}>
      <SectionHead title={`THE AV CLUB · CLASS OF ${d.year}`} sub="yearbook superlatives, each one picked by the numbers · hover a card for the math" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 14 }}>
        {d.club.map(c => (
          <div key={c.title} title={c.math} style={{ background: "#1b1b1b", borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
            <div style={{ background: "#222", borderRadius: 6, padding: "8px 8px 0" }}>
              <Cover path={c.art_path} radius={3} />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 2px 8px", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                <span style={{ color: MUTED, fontSize: 10, flexShrink: 0 }}>{c.kind}</span>
              </div>
            </div>
            <span style={{ color: "var(--green)", fontSize: 11, fontWeight: 800, letterSpacing: 1.5 }}>{c.title}</span>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", lineHeight: 1, color: "#fff" }}>{c.stat}</span>
            <span style={{ color: SOFT, fontSize: 11, lineHeight: 1.35 }}>{c.why}</span>
            <div style={{ marginTop: "auto" }}><Bars values={c.bars} color="var(--green)" height={22} /></div>
          </div>
        ))}
      </div>
      <span style={{ color: MUTED, fontSize: 11 }}>Bars = that pick's hours per month, Jan to Dec. One winner per title; nobody wins twice.</span>
    </section>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function PeriodsYear({ pills, onOpenMonth }: { pills: ReactNode; onOpenMonth: (year: number, month: number) => void }) {
  const [year, setYear] = useState<number | null>(null);
  const { data: historyInfo } = useHistoryInfo();
  const { data, isLoading, isError } = useQuery<YearPayload>({
    queryKey: ["stats-year", year],
    queryFn: () => api.get(`/api/stats/year${year ? `?year=${year}` : ""}`),
    staleTime: 60_000,
  });

  const avBegan = avBeganDate(historyInfo);
  const shown = data?.year ?? year ?? new Date().getFullYear();
  const years = data?.years ?? [];
  const older = years.includes(shown - 1) ? shown - 1 : null;
  const newer = years.includes(shown + 1) ? shown + 1 : null;
  const note = avBegan ? (shown < avBegan.getFullYear() ? "from Spotify history" : shown === avBegan.getFullYear() ? `AV began ${MONTHS[avBegan.getMonth()]} ${avBegan.getDate()}` : null) : null;

  const navStyle = (disabled: boolean): CSSProperties => ({
    padding: "4px 12px", borderRadius: 14, border: "1px solid #2a2a2a", background: "#202020",
    color: disabled ? "#333" : "#aaa", fontSize: 12, fontWeight: 500, cursor: disabled ? "default" : "pointer",
  });
  const openMonth = (m: number) => onOpenMonth(shown, m);

  return (
    <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "16px 24px 32px", display: "flex", flexDirection: "column", gap: 14, boxSizing: "border-box" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {pills}
          <div style={{ width: 4, height: 18, background: "var(--green)", borderRadius: 2, marginLeft: 16 }} />
          <TimePicker
            label={`${shown} · YEAR`}
            granularity="year"
            value={new Date(shown, 0, 1)}
            avBegan={avBegan}
            note={note}
            onPick={d => setYear(d.getFullYear())}
          />
          {data?.in_progress && data.through && <span style={{ color: MUTED, fontSize: 12 }}>through {short(data.through)}</span>}
          <div style={{ flex: 1 }} />
          <button onClick={() => older && setYear(older)} disabled={!older} style={navStyle(!older)}>← {older ?? shown - 1}</button>
          <button onClick={() => newer && setYear(newer)} disabled={!newer} style={navStyle(!newer)}>{newer ?? shown + 1} →</button>
        </div>

        {isError || (data && !Array.isArray(data.years))
          ? <div style={{ padding: "80px 0", textAlign: "center", color: "#666", fontSize: 13 }}>Couldn't load the year. The backend may need a restart to pick up the Year page.</div>
          : isLoading || !data
          ? <div style={{ padding: "80px 0", textAlign: "center", color: "#555", fontSize: 13 }}>Loading…</div>
          : data.empty
          ? <div style={{ padding: "80px 0", textAlign: "center", color: "#444", fontSize: 13 }}>No plays in {shown}</div>
          : <>
            <StatBand d={data} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 0.9fr) minmax(0, 1fr)", gap: 14, alignItems: "stretch" }}>
              <YearInMonths d={data} onOpenMonth={openMonth} />
              <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
                <YearVsYear d={data} onOpenMonth={openMonth} />
                <Rhythm d={data} />
                <OnRepeat d={data} />
              </div>
            </div>
            <Discovery d={data} />
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.3fr) minmax(0, 1fr)", gap: 14 }}>
              <Sound d={data} />
              <WhenMade d={data} />
            </div>
            <AVClub d={data} />
          </>}
      </div>
    </div>
  );
}
