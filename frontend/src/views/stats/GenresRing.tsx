import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { GenresFocus } from "./GenresFocus";
import { artUrl, MUTED, SOFT } from "./periodsShared";

// Stats › Genres › Ring: the most-played genres on a ring, grouped into families, joined by
// curves where artists carry both tags. Layout is pure geometry, so there is nothing to settle.
// "Focus" swaps the ring for a map centred on one genre, or on a stack of them (GenresFocus).

interface RingNode {
  g: string; hours: number; plays: number; artists: number; fam: number;
  by_year: number[]; top_artists: { name: string; plays: number; art_path: string | null }[];
}
interface RingArtist { name: string; plays: number; art_path: string | null; genres: string[] }
export interface RingPayload {
  nodes: RingNode[]; links: [string, string, number][]; families: { name: string; hue: number }[];
  artists?: RingArtist[];   // missing from payloads built before the artist search shipped
  genre_fams?: Record<string, number>;   // every played genre's family; missing before the focus view shipped
  years: string[]; total_genres: number; tagged_artists: number; total_artists: number;
}

type SizeBy = "hours" | "artists";
const COUNTS = [64, 96, 128] as const;
const MIN_LINK = 3;
const LABEL_ROOM = 150; // radial space outside the ring for genre and family labels

const col = (hue: number, l = 60, s = 70) => `hsl(${hue} ${s}% ${l}%)`;
const fmt = (n: number) => n.toLocaleString("en-US");

// d3's curveBundle: pull the interior points toward the chord by (1 - beta), then run a basis spline.
function bundlePath(points: [number, number][], beta = 0.88): string {
  const n = points.length;
  const [x0, y0] = points[0], [xn, yn] = points[n - 1];
  const dx = xn - x0, dy = yn - y0;
  const pts = points.map(([x, y], i) => [beta * x + (1 - beta) * (x0 + (i / (n - 1)) * dx), beta * y + (1 - beta) * (y0 + (i / (n - 1)) * dy)] as [number, number]);
  if (n < 3) return `M${pts[0]}L${pts[n - 1]}`;
  let [ax, ay] = pts[0], [bx, by] = pts[1];
  let d = `M${ax},${ay}L${(5 * ax + bx) / 6},${(5 * ay + by) / 6}`;
  const seg = (x: number, y: number) => { d += `C${(2 * ax + bx) / 3},${(2 * ay + by) / 3},${(ax + 2 * bx) / 3},${(ay + 2 * by) / 3},${(ax + 4 * bx + x) / 6},${(ay + 4 * by + y) / 6}`; ax = bx; ay = by; bx = x; by = y; };
  for (let i = 2; i < n; i++) seg(pts[i][0], pts[i][1]);
  seg(bx, by);
  return d + `L${bx},${by}`;
}

// Opening an artist from the side panel leaves Stats; Esc / "← Genres" on the artist page
// comes back here, so keep what was on screen. Module level: lasts while the app is open.
// The focus view's path, as the breadcrumb shows it: each step either re-centres on a genre
// or (add) stacks one onto the current centre.
type Step = { g: string; add: boolean };
let savedRing: { sizeBy: SizeBy; count: (typeof COUNTS)[number]; selected: string | null; artist: string | null; trail: Step[] } | null = null;

export function GenresRing() {
  const navigate = useNavigate();
  const { data, isLoading, isError } = useQuery<RingPayload>({
    queryKey: ["stats-genres-ring"],
    queryFn: () => api.get<RingPayload>("/api/stats/genres-ring"),
    staleTime: 5 * 60 * 1000,
  });
  const [sizeBy, setSizeBy] = useState<SizeBy>(savedRing?.sizeBy ?? "hours");
  const [count, setCount] = useState<(typeof COUNTS)[number]>(savedRing?.count ?? 96);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelectedRaw] = useState<string | null>(savedRing?.selected ?? null);
  // A found artist lights up all of their genres at once; picking a genre clears it.
  const [artistSel, setArtistSelRaw] = useState<string | null>(savedRing?.artist ?? null);
  const setSelected = (g: string | null) => { setSelectedRaw(g); setArtistSelRaw(null); };
  const setArtistSel = (a: string | null) => { setArtistSelRaw(a); setSelectedRaw(null); };
  const [trail, setTrail] = useState<Step[]>(savedRing?.trail ?? []);
  useEffect(() => { savedRing = { sizeBy, count, selected, artist: artistSel, trail }; }, [sizeBy, count, selected, artistSel, trail]);
  // The stack in the middle of the focus view: the last re-centre plus everything added since.
  const stackStart = (t: Step[]) => { let i = t.length - 1; while (i > 0 && t[i].add) i--; return i; };
  const stack = useMemo(() => trail.slice(stackStart(trail)).map(s => s.g), [trail]);
  const focusOn = (g: string) => setTrail(t => (t.length && !t[t.length - 1].add && t[t.length - 1].g === g ? t : [...t, { g, add: false }]));
  const addToStack = (g: string) => setTrail(t => (t.slice(stackStart(t)).some(s => s.g === g) ? t : [...t, { g, add: true }]));
  const removeFromStack = (g: string) => setTrail(t => {
    const i = stackStart(t), rest = t.slice(i).map(s => s.g).filter(x => x !== g);
    return rest.length ? [...t.slice(0, i), ...rest.map((x, j) => ({ g: x, add: j > 0 }))] : t.slice(0, i);
  });
  const onRingSet = useMemo(() => new Set((data?.nodes ?? []).slice(0, count).map(n => n.g)), [data, count]);
  // Esc walks back one breadcrumb step in the focus view, and clears the selection on the ring.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement)?.tagName === "INPUT") return;
      if (trail.length) setTrail(t => t.slice(0, -1));
      else if (selected || artistSel) { setSelectedRaw(null); setArtistSelRaw(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [trail.length, selected, artistSel]);
  const [q, setQ] = useState("");
  // Laid out in real pixels so labels keep a readable size whatever the panel's shape. A
  // callback ref, so the stage is measured every time it mounts: it unmounts while the focus
  // view is up, and opening Stats straight into focus never mounted it at all (blank ring after).
  const [size, setSize] = useState({ w: 0, h: 0 });
  const observer = useRef<ResizeObserver | null>(null);
  const stageRef = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    observer.current = null;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(prev => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    });
    ro.observe(el);
    observer.current = ro;
  }, []);

  const layout = useMemo(() => {
    if (!data || size.w < 200 || size.h < 200) return null;
    const W = size.w, H = size.h, CX = W / 2, CY = H / 2 + 4, R = Math.max(110, Math.min(W, H) / 2 - LABEL_ROOM);
    const metric = (n: RingNode) => (sizeBy === "hours" ? n.hours : n.artists);
    const nodes = data.nodes.slice(0, count).map(n => ({ ...n, hue: data.families[n.fam].hue, ang: 0, x: 0, y: 0, r: 0 }));
    nodes.sort((a, b) => a.fam - b.fam || metric(b) - metric(a));
    const famsPresent = [...new Set(nodes.map(n => n.fam))];
    const gap = 0.07, slot = (2 * Math.PI - gap * famsPresent.length) / nodes.length;
    const famStart: Record<number, number> = {}, famMid: Record<number, number> = {};
    let a = -Math.PI / 2 + gap / 2, prev = nodes[0]?.fam;
    nodes.forEach(n => {
      if (n.fam !== prev) { a += gap; prev = n.fam; }
      if (famStart[n.fam] === undefined) famStart[n.fam] = a;
      n.ang = a + slot / 2; a += slot;
      famMid[n.fam] = (famStart[n.fam] + a) / 2;
    });
    const maxM = Math.max(1, ...nodes.map(metric));
    const pt = (ang: number, r: number): [number, number] => [CX + Math.cos(ang) * r, CY + Math.sin(ang) * r];
    nodes.forEach(n => { [n.x, n.y] = pt(n.ang, R); n.r = 2.5 + Math.sqrt(metric(n) / maxM) * 11; });
    const byG = Object.fromEntries(nodes.map(n => [n.g, n]));
    const links = data.links
      .filter(([p, q2, w]) => w >= MIN_LINK && byG[p] && byG[q2])
      .map(([p, q2, w]) => {
        const s = byG[p], t = byG[q2], same = s.fam === t.fam;
        const pts: [number, number][] = same
          ? [[s.x, s.y], pt((s.ang + t.ang) / 2, R * 0.58), [t.x, t.y]]
          : [[s.x, s.y], pt(famMid[s.fam], R * 0.42), [CX, CY], pt(famMid[t.fam], R * 0.42), [t.x, t.y]];
        return { s, t, w, d: bundlePath(pts), small: metric(s) < metric(t) ? s : t };
      })
      .sort((p, q2) => p.w - q2.w);
    const maxW = Math.max(1, ...links.map(l => l.w));
    const neighbours: Record<string, { g: string; w: number }[]> = {};
    data.links.forEach(([p, q2, w]) => { (neighbours[p] ||= []).push({ g: q2, w }); (neighbours[q2] ||= []).push({ g: p, w }); });
    Object.values(neighbours).forEach(l => l.sort((x, y) => y.w - x.w));
    const famLabels = famsPresent.map(f => ({ f, name: data.families[f].name, hue: data.families[f].hue, p: pt(famMid[f], R + LABEL_ROOM - 22) }));
    return { nodes, links, maxW, byG, neighbours, famLabels, pt, metric, maxM, W, H, R };
  }, [data, sizeBy, count, size]);

  if (isLoading) return <div style={{ padding: 32, color: MUTED, fontSize: 13 }}>Loading…</div>;
  if (isError || !data) return <div style={{ padding: 32, color: MUTED, fontSize: 13 }}>Couldn't load the ring. The backend may need a restart to pick up the Ring view.</div>;

  const artist = artistSel && data ? (data.artists ?? []).find(a => a.name === artistSel) ?? null : null;
  const artistGenres = artist && !hover ? new Set(artist.genres) : null;
  const active = hover ?? (artist ? null : selected);
  const activeSet = active && layout ? new Set((layout.neighbours[active] || []).map(n => n.g)) : null;
  const weightTo = (g: string) => (active && layout ? layout.neighbours[active]?.find(n => n.g === g)?.w : undefined);
  const sel = selected && layout ? layout.byG[selected] : null;
  const needle = q.trim().toLowerCase();
  const fold = (t: string) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const matches = needle && layout ? layout.nodes.filter(n => n.g.includes(needle)).slice(0, 6) : [];
  const artistMatches = needle ? (data.artists ?? []).filter(a => fold(a.name).includes(fold(needle))).slice(0, 6) : [];
  // In the focus view a found genre becomes the new centre; a found artist goes back to the ring.
  const pickGenre = (g: string) => { if (trail.length) focusOn(g); else setSelected(g); setQ(""); };
  const pickArtist = (a: string) => { setTrail([]); setArtistSel(a); setQ(""); };
  const pickFirst = () => {
    if (matches[0]) pickGenre(matches[0].g); else if (artistMatches[0]) pickArtist(artistMatches[0].name);
    setQ("");
  };
  const openArtist = (name: string) => navigate(`/artists/${encodeURIComponent(name)}`, { state: { from: "/stats?tab=Genres&view=ring", fromLabel: "Genres" } });
  const crumb = (on: boolean): CSSProperties => ({ border: "none", background: "transparent", padding: 0, fontSize: 12, fontFamily: "inherit", cursor: on ? "pointer" : "default", color: on ? "var(--green)" : "#fff", fontWeight: on ? 600 : 800 });

  const pill = (on: boolean): CSSProperties => ({
    padding: "3px 10px", borderRadius: 10, border: on ? "1px solid var(--green)" : "1px solid #2a2a2a",
    background: "transparent", color: on ? "var(--green)" : MUTED, fontSize: 11, fontWeight: on ? 700 : 400, cursor: "pointer",
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, padding: "0 16px 12px" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        {trail.length ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", minWidth: 0 }}>
            <button onClick={() => setTrail([])} style={crumb(true)}>← Ring</button>
            {trail.map((s, i) => (
              <span key={i} style={{ display: "contents" }}>
                <span style={{ color: "#555", fontSize: 12 }}>›</span>
                <button onClick={() => setTrail(t => t.slice(0, i + 1))} disabled={i === trail.length - 1} style={crumb(i < trail.length - 1)}>{s.add ? `× ${s.g}` : s.g}</button>
              </span>
            ))}
          </div>
        ) : (
          <span style={{ color: MUTED, fontSize: 11, marginRight: 8 }}>
            {fmt(data.tagged_artists)} of {fmt(data.total_artists)} artists tagged · {fmt(data.total_genres)} genres · showing the {count} most played
          </span>
        )}
        <div style={{ flexGrow: 1 }} />
        <span style={{ color: MUTED, fontSize: 11 }}>size</span>
        {(["hours", "artists"] as SizeBy[]).map(s => <button key={s} onClick={() => setSizeBy(s)} style={pill(sizeBy === s)}>{s === "hours" ? "Hours" : "Artists"}</button>)}
        <span style={{ color: MUTED, fontSize: 11, marginLeft: 8 }}>show</span>
        {COUNTS.map(c => <button key={c} onClick={() => setCount(c)} style={pill(count === c)}>{c}</button>)}
        <div style={{ position: "relative", marginLeft: 8 }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="find a genre or artist…"
            onKeyDown={e => { if (e.key === "Enter") pickFirst(); if (e.key === "Escape") setQ(""); }}
            style={{ width: 200, padding: "5px 10px", borderRadius: 14, border: "1px solid #2a2a2a", background: "#1b1b1b", color: "#fff", fontSize: 12 }} />
          {(matches.length > 0 || artistMatches.length > 0) && (
            <div style={{ position: "absolute", top: 30, right: 0, zIndex: 5, background: "#1b1b1b", border: "1px solid #2a2a2a", borderRadius: 10, padding: 4, minWidth: 240 }}>
              {matches.length > 0 && <div style={{ color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: "4px 8px 2px" }}>GENRES</div>}
              {matches.map(m => (
                <button key={m.g} onClick={() => pickGenre(m.g)}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "5px 8px", border: "none", background: "transparent", color: "#fff", fontSize: 12, cursor: "pointer", textAlign: "left" }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: col(m.hue) }} />{m.g}
                  <span style={{ marginLeft: "auto", color: MUTED }}>{Math.round(m.hours)}h</span>
                </button>
              ))}
              {artistMatches.length > 0 && <div style={{ color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: 1.5, padding: "6px 8px 2px" }}>ARTISTS</div>}
              {artistMatches.map(a => {
                const src = artUrl(a.art_path);
                return (
                  <button key={a.name} onClick={() => pickArtist(a.name)}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 8px", border: "none", background: "transparent", color: "#fff", fontSize: 12, cursor: "pointer", textAlign: "left" }}>
                    <span style={{ width: 20, height: 20, borderRadius: 3, background: "#2a2a2a", overflow: "hidden", flexShrink: 0 }}>
                      {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.name}</span>
                    <span style={{ marginLeft: "auto", color: MUTED, flexShrink: 0 }}>{fmt(a.plays)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {trail.length > 0 && (
        <GenresFocus data={data} stack={stack} onRing={onRingSet} onFocus={focusOn} onAdd={addToStack} onRemove={removeFromStack} onOpenArtist={openArtist} />
      )}
      {!trail.length && <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: sel || artist ? "minmax(0, 1fr) 280px" : "minmax(0, 1fr)", gridTemplateRows: "minmax(0, 1fr)", gap: 12 }}>
        {/* The ring */}
        <div ref={stageRef} style={{ position: "relative", background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, overflow: "hidden", minHeight: 0 }}>
          {layout && <svg width={layout.W} height={layout.H} style={{ display: "block", position: "absolute", inset: 0 }} onClick={() => setSelected(null)}>
            <g>
              {layout.links.map((l, i) => {
                const t = Math.pow(l.w / layout.maxW, 0.55);
                const focus = !!active || !!artistGenres;
                const hit = active ? (l.s.g === active || l.t.g === active)
                  : artistGenres ? artistGenres.has(l.s.g) && artistGenres.has(l.t.g) : false;
                const stroke = focus && hit ? "#ffffff" : col(l.small.hue, 62, 65);
                const op = focus ? (hit ? 0.35 + t * 0.6 : 0.025) : 0.07 + t * 0.55;
                const sw = focus ? (hit ? 1 + t * 3 : 0.6) : 0.6 + t * 2.6;
                return <path key={i} d={l.d} fill="none" stroke={stroke} strokeOpacity={op} strokeWidth={sw} strokeLinecap="round" />;
              })}
            </g>
            <g>
              {layout.nodes.map(n => {
                const isActive = n.g === active || !!artistGenres?.has(n.g), isNb = !!activeSet?.has(n.g);
                const dim = (!!active || !!artistGenres) && !isActive && !isNb;
                const deg = (n.ang * 180) / Math.PI, left = Math.cos(n.ang) < 0;
                const [lx, ly] = layout.pt(n.ang, layout.R + n.r + 6);
                const big = layout.metric(n) >= 0.4 * layout.maxM;
                const w = isNb ? weightTo(n.g) : undefined;
                return (
                  <g key={n.g} style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHover(n.g)} onMouseLeave={() => setHover(null)}
                    onClick={e => {
                      e.stopPropagation();
                      if (e.shiftKey && selected && selected !== n.g) setTrail([{ g: selected, add: false }, { g: n.g, add: true }]);
                      else setSelected(selected === n.g ? null : n.g);
                    }}
                    onDoubleClick={e => { e.stopPropagation(); setSelectedRaw(n.g); setTrail([{ g: n.g, add: false }]); }}>
                    <circle cx={n.x} cy={n.y} r={n.r} fill={col(n.hue, isActive ? 72 : 60)} stroke={isActive ? "#fff" : "none"} strokeWidth={2} opacity={dim ? 0.25 : 1} />
                    <text transform={`translate(${lx},${ly}) rotate(${left ? deg + 180 : deg})`} textAnchor={left ? "end" : "start"} dominantBaseline="middle"
                      fontSize={big ? 12 : n.r >= 5 ? 10.5 : 9.5} fontWeight={big ? 800 : 400}
                      fill={isActive ? "#fff" : dim ? "#555" : big ? "#fff" : SOFT}>
                      {n.g}{w ? ` · ${w}` : ""}
                    </text>
                  </g>
                );
              })}
            </g>
            <g>
              {layout.famLabels.map(f => (
                <text key={f.f} x={f.p[0]} y={f.p[1]} textAnchor="middle" fontSize={10} fontWeight={700} letterSpacing={1.5} fill={col(f.hue, 65, 55)} opacity={0.9}>
                  {f.name.toUpperCase()}
                </text>
              ))}
            </g>
          </svg>}
          <div style={{ position: "absolute", left: 14, bottom: 10, display: "flex", flexWrap: "wrap", gap: "4px 14px", color: SOFT, fontSize: 11, maxWidth: 520 }}>
            {data.families.map(f => (
              <span key={f.name} style={{ display: "flex", alignItems: "center", gap: 6 }}><span style={{ width: 9, height: 9, borderRadius: "50%", background: col(f.hue) }} />{f.name}</span>
            ))}
          </div>
          <div style={{ position: "absolute", right: 14, bottom: 10, color: MUTED, fontSize: 11, textAlign: "right", maxWidth: 360 }}>
            Dot = a genre, sized by {sizeBy}. Curve = {MIN_LINK}+ artists carry both tags; thicker is more. Click a genre, double-click to focus on it.
          </div>
        </div>

        {/* Side panel: a found artist */}
        {artist && layout && (
          <aside style={{ background: "#1b1b1b", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
              <div style={{ width: 64, height: 64, borderRadius: 8, background: "#2a2a2a", overflow: "hidden", flexShrink: 0 }}>
                {artUrl(artist.art_path) && <img src={artUrl(artist.art_path)!} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
              </div>
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 800, overflowWrap: "anywhere" }}>{artist.name}</span>
                <span style={{ color: MUTED, fontSize: 11 }}>{fmt(artist.plays)} plays · {artist.genres.length} genre{artist.genres.length === 1 ? "" : "s"}</span>
              </div>
              <div style={{ flexGrow: 1 }} />
              <button onClick={() => setArtistSel(null)} style={{ ...pill(false), padding: "2px 8px" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>GENRES</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {artist.genres.map(g => {
                  const node = layout.byG[g];
                  return (
                    <button key={g} onClick={() => node && setSelected(g)} title={node ? `Select ${g}` : `${g} is outside the top ${count}`}
                      style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, border: "none", background: "#242424", color: node ? col(node.hue) : MUTED, fontWeight: 700, cursor: node ? "pointer" : "default" }}>
                      {g}
                    </button>
                  );
                })}
              </div>
              {artist.genres.some(g => !layout.byG[g]) && <span style={{ color: MUTED, fontSize: 11 }}>Grey tags are outside the {count} genres on the ring.</span>}
            </div>
            <button onClick={() => openArtist(artist.name)}
              style={{ ...pill(true), padding: "6px 10px", alignSelf: "flex-start" }}>Open artist page →</button>
          </aside>
        )}

        {/* Side panel: a genre */}
        {sel && layout && (
          <aside style={{ background: "#1b1b1b", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: col(sel.hue), flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 18, fontWeight: 800 }}>{sel.g}</span>
                <span style={{ color: MUTED, fontSize: 11 }}>{data.families[sel.fam].name} · #{data.nodes.findIndex(n => n.g === sel.g) + 1} by hours</span>
              </div>
              <div style={{ flexGrow: 1 }} />
              <button onClick={() => setSelected(null)} style={{ ...pill(false), padding: "2px 8px" }}>✕</button>
            </div>
            <button onClick={() => setTrail([{ g: sel.g, add: false }])} style={{ ...pill(true), padding: "6px 10px", alignSelf: "flex-start" }}>
              Focus on {sel.g} → <span style={{ fontWeight: 400, color: MUTED }}>every connection, stack genres</span>
            </button>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8 }}>
              {[["HOURS", `${Math.round(sel.hours)}h`], ["PLAYS", fmt(sel.plays)], ["ARTISTS", fmt(sel.artists)]].map(([k, v]) => (
                <div key={k} style={{ background: "#222", borderRadius: 10, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ color: MUTED, fontSize: 9, fontWeight: 700, letterSpacing: 1.5 }}>{k}</span>
                  <span style={{ fontSize: 15, fontWeight: 800, whiteSpace: "nowrap" }}>{v}</span>
                </div>
              ))}
            </div>
            {data.years.length > 1 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>PLAYS BY YEAR</span>
                <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 44 }}>
                  {sel.by_year.map((v, i) => {
                    const mx = Math.max(1, ...sel.by_year);
                    return <span key={i} title={`${data.years[i]}: ${fmt(v)} plays`} style={{ flex: 1, borderRadius: 2, background: col(sel.hue, i === sel.by_year.length - 1 ? 60 : 38, i === sel.by_year.length - 1 ? 70 : 45), height: Math.max(2, Math.round((v / mx) * 44)) }} />;
                  })}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: MUTED, fontSize: 9 }}><span>{data.years[0]}</span><span>{data.years[data.years.length - 1]}</span></div>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>OFTEN WITH</span>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {(layout.neighbours[sel.g] || []).slice(0, 8).map(n => {
                  const other = layout.byG[n.g];
                  return (
                    <button key={n.g} onClick={() => other && setSelected(n.g)} title={other ? `Select ${n.g}` : `${n.g} is outside the top ${count}`}
                      style={{ padding: "2px 8px", borderRadius: 10, fontSize: 11, border: "none", background: "#242424", color: other ? col(other.hue) : MUTED, fontWeight: 700, cursor: other ? "pointer" : "default" }}>
                      {n.g} · {n.w}
                    </button>
                  );
                })}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>ARTISTS</span>
                <span style={{ color: MUTED, fontSize: 11 }}>most played first</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 6 }}>
                {sel.top_artists.slice(0, 16).map(a => {
                  const src = artUrl(a.art_path);
                  return (
                    <button key={a.name} onClick={() => openArtist(a.name)} title={`${a.name} · ${fmt(a.plays)} plays`}
                      style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0, padding: 0, border: "none", background: "transparent", color: SOFT, cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                      <div style={{ width: "100%", aspectRatio: "1", borderRadius: 6, background: "#2a2a2a", overflow: "hidden" }}>
                        {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
                      </div>
                      <span style={{ fontSize: 10, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>{a.name}</span>
                    </button>
                  );
                })}
              </div>
              {sel.artists > 16 && <span style={{ color: MUTED, fontSize: 11 }}>and {fmt(sel.artists - 16)} more</span>}
            </div>
          </aside>
        )}
      </div>}
    </div>
  );
}
