import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { artUrl, MUTED, SOFT } from "./periodsShared";
import type { RingPayload } from "./GenresRing";

// Stats › Genres › Ring › focus view: one genre (or a stack of them) in the middle, and every
// other genre their artists carry around it, in family slices, closer in the more artists share
// it. With a stack, everything is measured over the artists who carry all of the picked tags.

const col = (hue: number, l = 60, s = 70) => `hsl(${hue} ${s}% ${l}%)`;
const fmt = (n: number) => n.toLocaleString("en-US");
const ALWAYS_NAMED = 12;

interface Dot { g: string; w: number; fam: number; hue: number; ang: number; x: number; y: number; r: number; onRing: boolean; lab?: { x: number; y: number; left: boolean; inward: boolean; fs: number; txt: string } }

// Distance between two segments (0 when they cross); labels run along their spoke, so they
// are tested as thick segments at their real angle.
type P = [number, number];
function segDist(p1: P, p2: P, q1: P, q2: P): number {
  const d = (a: P, b: P, c: P) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], L = vx * vx + vy * vy || 1;
    const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * vx + (c[1] - a[1]) * vy) / L));
    return Math.hypot(a[0] + t * vx - c[0], a[1] + t * vy - c[1]);
  };
  const cross = (a: P, b: P, c: P) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inter = Math.sign(cross(p1, p2, q1)) !== Math.sign(cross(p1, p2, q2)) && Math.sign(cross(q1, q2, p1)) !== Math.sign(cross(q1, q2, p2));
  return inter ? 0 : Math.min(d(p1, p2, q1), d(p1, p2, q2), d(q1, q2, p1), d(q1, q2, p2));
}

export function GenresFocus({ data, stack, onRing, onFocus, onAdd, onRemove, onOpenArtist }: {
  data: RingPayload;
  stack: string[];
  onRing: Set<string>;
  onFocus: (g: string) => void;
  onAdd: (g: string) => void;
  onRemove: (g: string) => void;
  onOpenArtist: (name: string) => void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize(prev => (prev.w === width && prev.h === height ? prev : { w: width, h: height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [hover, setHover] = useState<string | null>(null);
  // The genre filter clears whenever the centre changes (adjusted during render, not in an effect).
  const [genreQ, setGenreQ] = useState("");
  const stackKey = stack.join("|");
  const [qFor, setQFor] = useState(stackKey);
  // Stacked panel: the artists in all of the stack, or how every artist with any of them splits up.
  const [panel, setPanel] = useState<"artists" | "overlap">("artists");
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [rowAll, setRowAll] = useState(false);
  if (qFor !== stackKey) { setQFor(stackKey); setGenreQ(""); setOpenRow(null); setRowAll(false); }
  const stacked = stack.length > 1;

  const famOf = (g: string) => data.genre_fams?.[g] ?? data.nodes.find(n => n.g === g)?.fam ?? 6;
  const hueOf = (g: string) => data.families[famOf(g)].hue;

  const { members, nb, all, singles, maxW } = useMemo(() => {
    const members = (data.artists ?? []).filter(a => stack.every(g => a.genres.includes(g)));
    const c = new Map<string, number>();
    for (const a of members) for (const o of a.genres) if (!stack.includes(o)) c.set(o, (c.get(o) ?? 0) + 1);
    const all = [...c.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]));
    // Every connection is drawn; genres sharing one artist end up as small dots on the rim.
    const nb = all;
    return { members, nb, all, singles: all.filter(([, w]) => w === 1).length, maxW: Math.max(1, nb[0]?.[1] ?? 1) };
  }, [data.artists, stack]);

  const layout = useMemo(() => {
    if (size.w < 200 || size.h < 200) return null;
    const W = size.w, H = size.h, CX = W / 2, CY = H / 2;
    const R1 = Math.max(120, Math.min(W, H) / 2 - 70), R0 = stacked ? Math.max(92, R1 * 0.29) : Math.max(64, R1 * 0.29);
    const groups = data.families.map((_, fam) => {
      const list = nb.filter(([g]) => famOf(g) === fam);
      return { fam, list, weight: list.reduce((s, [, w]) => s + w, 0) };
    }).filter(x => x.list.length);
    // Slices sized by shared artists, with a floor per dot so a crowded family keeps room.
    const gap = 0.05, usable = 2 * Math.PI - gap * groups.length, minPer = Math.min(0.022, (usable * 0.6) / Math.max(1, nb.length));
    const totW = groups.reduce((s, g) => s + g.weight, 0) || 1;
    let spans = groups.map(g => Math.max((usable * g.weight) / totW, g.list.length * minPer));
    const k = usable / spans.reduce((a, b) => a + b, 0);
    spans = spans.map(x => x * k);
    const dots: Dot[] = [], sectors: { fam: number; hue: number; a0: number; a1: number; n: number }[] = [];
    let a = -Math.PI / 2;
    groups.forEach((g, gi) => {
      const span = spans[gi], a0 = a, hue = data.families[g.fam].hue, n = g.list.length;
      sectors.push({ fam: g.fam, hue, a0, a1: a0 + span, n });
      // Small slices: strongest in the middle, alternating outwards. Big ones: strongest spread
      // evenly across the slice (golden-ratio steps), so the big dots and their names don't pile up.
      const slots = n <= 8
        ? g.list.map((_, i) => (i % 2 ? Math.floor(n / 2) - Math.ceil(i / 2) : Math.floor(n / 2) + i / 2))
        : (() => {
            const taken = new Array<boolean>(n).fill(false);
            return g.list.map((_, i) => {
              let p = Math.floor(((0.5 + i * 0.6180339887) % 1) * n);
              while (taken[p]) p = (p + 1) % n;
              taken[p] = true;
              return p;
            });
          })();
      g.list.forEach(([gname, w], i) => {
        const ang = a0 + (span * (slots[i] + 0.5)) / n;
        const rr = R0 + (1 - Math.pow(w / maxW, 0.45)) * (R1 - R0) + (i % 3) * 7;
        dots.push({ g: gname, w, fam: g.fam, hue, ang, x: CX + Math.cos(ang) * rr, y: CY + Math.sin(ang) * rr, r: 2.2 + Math.sqrt(w / maxW) * 13, onRing: onRing.has(gname) });
      });
      a = a0 + span + gap;
    });
    // Labels strongest first, kept only where they touch no placed label or other dot and stay
    // inside the family brackets; the strongest few are always named. A label that would run past
    // the brackets points inward instead (ending at its dot), as long as it clears the centre.
    const placed: { s0: P; s1: P; fs: number }[] = [];
    const centreR = stacked ? 64 : 36;
    const byW = dots.slice().sort((p, q) => q.w - p.w);
    const strongest = new Set(byW.slice(0, ALWAYS_NAMED).map(o => o.g));
    const bold = Math.max(2, maxW * 0.5);
    for (const o of byW) {
      const fs = o.w >= bold ? 11 : 9.5, txt = `${o.g} · ${o.w}`, len = txt.length * fs * 0.55;
      const fits = (inward: boolean) => {
        const sg = inward ? -1 : 1, ux = Math.cos(o.ang) * sg, uy = Math.sin(o.ang) * sg;
        const s0: P = [o.x + ux * (o.r + 4), o.y + uy * (o.r + 4)];
        const s1: P = [s0[0] + ux * len, s0[1] + uy * len];
        const far = Math.hypot(s1[0] - CX, s1[1] - CY);
        if (inward ? far < centreR + 8 || Math.hypot(s0[0] - s1[0], s0[1] - s1[1]) > Math.hypot(s0[0] - CX, s0[1] - CY) : far > R1 + 10) return null;
        if (placed.some(pl => segDist(s0, s1, pl.s0, pl.s1) < (fs + pl.fs) / 2 + 1)) return null;
        if (!strongest.has(o.g) && dots.some(d => d.g !== o.g && segDist(s0, s1, [d.x, d.y], [d.x, d.y]) < d.r + fs / 2)) return null;
        return { s0, s1 };
      };
      const out = fits(false), seg = out ?? fits(true);
      if (!seg) continue;
      placed.push({ ...seg, fs });
      o.lab = { x: seg.s0[0], y: seg.s0[1], left: Math.cos(o.ang) < 0, inward: !out, fs, txt };
    }
    const rings = [0.25, 0.5, 0.75]
      .map(q => ({ q, rr: R0 + (1 - Math.pow(q, 0.45)) * (R1 - R0), n: Math.round(q * maxW) }))
      .filter((r, i, arr) => r.n >= 1 && arr.findIndex(x => x.n === r.n) === i);
    return { W, H, CX, CY, R0, R1, dots, sectors, rings, bold, labelled: placed.length };
    // famOf only reads data, which is already a dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, nb, maxW, stacked, data, onRing]);

  // Family brackets: an arc just outside each slice, with the name written along it when it fits.
  const arcPath = (CX: number, CY: number, a0: number, a1: number, r: number) => {
    const flip = Math.sin((a0 + a1) / 2) > 0.05;   // bottom half reads left-to-right too
    const [s0, s1] = flip ? [a1, a0] : [a0, a1];
    return `M${CX + Math.cos(s0) * r},${CY + Math.sin(s0) * r} A${r},${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} ${flip ? 0 : 1} ${CX + Math.cos(s1) * r},${CY + Math.sin(s1) * r}`;
  };

  const dotClick = (e: MouseEvent, g: string) => {
    e.stopPropagation();
    if (stacked || e.shiftKey) onAdd(g); else onFocus(g);
  };
  const hv = layout?.dots.find(d => d.g === hover) ?? null;
  const hvShared = hv ? members.filter(a => a.genres.includes(hv.g)).sort((p, q) => q.plays - p.plays).slice(0, 3).map(a => a.name).join(", ") : "";
  const label = (t: string) => <span style={{ color: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: 1.5 }}>{t}</span>;
  const sorted = useMemo(() => members.slice().sort((p, q) => q.plays - p.plays), [members]);
  const head = stack[0];
  const headHue = hueOf(head);

  const genreRow = (g: string, w: number) => {
    const hue = hueOf(g), off = !onRing.has(g);
    const rowBtn: CSSProperties = { display: "grid", gridTemplateColumns: "minmax(0, 1fr) 64px 26px", gap: 8, alignItems: "center", fontSize: 11.5, width: "100%", padding: "2px 0", border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "inherit", color: "#fff" };
    return (
      <div key={g} style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <button onClick={e => dotClick(e, g)} onMouseEnter={() => setHover(g)} onMouseLeave={() => setHover(null)} style={rowBtn}
          title={stacked ? `Add ${g} to the stack` : `Focus on ${g} (shift-click to stack)`}>
          <span style={{ color: col(hue), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {g}{off && <span style={{ color: "#666", fontWeight: 400, fontSize: 10 }}> off ring</span>}
          </span>
          <span style={{ height: 5, background: "#262626", borderRadius: 3, overflow: "hidden" }}>
            <span style={{ display: "block", height: "100%", width: `${Math.max(4, Math.round((w / maxW) * 100))}%`, background: col(hue, off ? 45 : 60) }} />
          </span>
          <span style={{ textAlign: "right", color: SOFT, fontVariantNumeric: "tabular-nums" }}>{w}</span>
        </button>
        {!stacked && (
          <button onClick={() => onAdd(g)} title={`Stack: ${head} × ${g}`}
            style={{ border: "1px solid #2a2a2a", background: "transparent", color: MUTED, borderRadius: 8, fontSize: 11, lineHeight: "14px", padding: "0 5px", cursor: "pointer" }}>+</button>
        )}
      </div>
    );
  };
  const artistRow = (a: { name: string; plays: number; art_path: string | null }) => {
    const src = artUrl(a.art_path);
    return (
      <button key={a.name} onClick={() => onOpenArtist(a.name)}
        style={{ display: "grid", gridTemplateColumns: "24px minmax(0, 1fr) 44px", gap: 8, alignItems: "center", fontSize: 11.5, width: "100%", padding: 0, border: "none", background: "transparent", color: "#fff", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
        <span style={{ width: 24, height: 24, borderRadius: 4, background: "#2a2a2a", overflow: "hidden" }}>
          {src && <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
        </span>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.name}</span>
        <span style={{ textAlign: "right", color: MUTED, fontVariantNumeric: "tabular-nums" }}>{fmt(a.plays)}</span>
      </button>
    );
  };
  const famTotals = layout ? layout.sectors.map(s => ({ ...s, w: layout.dots.filter(d => d.fam === s.fam).reduce((t, d) => t + d.w, 0) })) : [];
  const maxFam = Math.max(1, ...famTotals.map(s => s.w));
  const nArtists = stacked ? 16 : 12;
  // Overlap rows: every artist carrying any stacked genre, grouped by exactly which ones.
  const overlap = useMemo(() => {
    if (!stacked) return [];
    const rows = new Map<string, { ks: string[]; list: { name: string; plays: number; art_path: string | null }[] }>();
    for (const a of data.artists ?? []) {
      const ks = stack.filter(g => a.genres.includes(g));
      if (!ks.length) continue;
      const k = ks.join("|");
      if (!rows.has(k)) rows.set(k, { ks, list: [] });
      rows.get(k)!.list.push(a);
    }
    return [...rows.entries()]
      .map(([k, r]) => ({ k, ...r, list: r.list.sort((p, q) => q.plays - p.plays) }))
      .sort((x, y) => y.ks.length - x.ks.length || y.list.length - x.list.length);
  }, [data.artists, stack, stacked]);
  const maxRow = Math.max(1, ...overlap.map(r => r.list.length));
  const rowName = (ks: string[]) => ks.length === stack.length ? `all ${stack.length === 2 ? "both" : stack.length === 3 ? "three" : stack.length}` : ks.length === 1 ? `${ks[0]} only` : ks.join(" + ");
  const rowLong = (ks: string[]) => ks.length === stack.length ? `in all ${stack.length}` : `${ks.join(" + ")}, not ${stack.filter(g => !ks.includes(g)).join(" or ")}`;
  const seg = (on: boolean): CSSProperties => ({ padding: "4px 12px", borderRadius: 12, border: "none", fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", fontWeight: on ? 800 : 500, background: on ? "#2a2a2a" : "transparent", color: on ? "#fff" : MUTED });
  const dotCols = `repeat(${stack.length}, 12px) 104px minmax(0, 1fr) 40px`;

  return (
    // Pinned inside a relative box so the long side panel scrolls instead of stretching the page.
    <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
    <div style={{ position: "absolute", inset: 0, display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gridTemplateRows: "minmax(0, 1fr)", gap: 12 }}>
      <div ref={stageRef} style={{ position: "relative", background: "#0f0f0f", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 18, overflow: "hidden", minHeight: 0 }}>
        {layout && (
          <svg width={layout.W} height={layout.H} style={{ display: "block", position: "absolute", inset: 0 }}>
            {layout.rings.map(r => (
              <g key={r.q}>
                <circle cx={layout.CX} cy={layout.CY} r={r.rr} fill="none" stroke="#1d1d1d" />
                <text x={layout.CX + 4} y={layout.CY - r.rr - 3} fontSize={8.5} fill="#444">{r.n} shared</text>
              </g>
            ))}
            {layout.dots.slice().reverse().map(o => {
              const t = Math.pow(o.w / maxW, 0.6), on = o.g === hover;
              return <line key={o.g} x1={layout.CX} y1={layout.CY} x2={o.x} y2={o.y} stroke={on ? "#fff" : col(o.hue)} strokeOpacity={on ? 0.8 : 0.08 + t * 0.5} strokeWidth={on ? 2 : 0.5 + t * 2.5} />;
            })}
            {layout.dots.map(o => (
              <g key={o.g} style={{ cursor: "pointer" }} onMouseEnter={() => setHover(o.g)} onMouseLeave={() => setHover(null)} onClick={e => dotClick(e, o.g)}>
                <circle cx={o.x} cy={o.y} r={Math.max(9, o.r + 3)} fill="transparent" />
                <circle cx={o.x} cy={o.y} r={o.r + (o.g === hover ? 2 : 0)} fill={col(o.hue, o.onRing ? 60 : 45)}
                  stroke={o.g === hover ? "#fff" : o.onRing ? "none" : col(o.hue, 65)} strokeWidth={o.g === hover ? 2 : 1} />
              </g>
            ))}
            {/* labels after every dot, with a dark outline, so no dot paints over a name */}
            {layout.dots.filter(o => o.lab).map(o => {
              const deg = (o.ang * 180) / Math.PI, lab = o.lab!;
              return (
                <text key={o.g} transform={`translate(${lab.x},${lab.y}) rotate(${lab.left ? deg + 180 : deg})`} textAnchor={lab.left !== lab.inward ? "end" : "start"} dominantBaseline="middle"
                  fontSize={lab.fs} fontWeight={o.w >= layout.bold ? 800 : 400} fill={o.w >= layout.bold || o.g === hover ? "#fff" : SOFT}
                  stroke="#0f0f0f" strokeWidth={3} paintOrder="stroke" style={{ pointerEvents: "none" }}>{lab.txt}</text>
              );
            })}
            {layout.sectors.map((s, i) => {
              const RB = layout.R1 + 34, len = (s.a1 - s.a0) * RB, name = `${data.families[s.fam].name.toUpperCase()} · ${s.n}`;
              const text = name.length * 6.4 < len - 6 ? name : `${s.n}`.length * 6.4 < len ? `${s.n}` : "";
              const flip = Math.sin((s.a0 + s.a1) / 2) > 0.05;
              return (
                <g key={s.fam}>
                  <path d={arcPath(layout.CX, layout.CY, s.a0 + 0.01, s.a1 - 0.01, layout.R1 + 18)} fill="none" stroke={col(s.hue, 55, 55)} strokeWidth={2} strokeLinecap="round" opacity={0.8} />
                  <path id={`gf-fam-${i}`} d={arcPath(layout.CX, layout.CY, s.a0, s.a1, flip ? RB + 8 : RB)} fill="none" />
                  {text && <text fontSize={9.5} fontWeight={700} letterSpacing={1.2} fill={col(s.hue, 65, 55)}><textPath href={`#gf-fam-${i}`} startOffset="50%" textAnchor="middle">{text}</textPath></text>}
                </g>
              );
            })}
            {stacked ? (
              <g>
                <circle cx={layout.CX} cy={layout.CY} r={64} fill="#141414" stroke="#fff" strokeWidth={2} />
                <text x={layout.CX} y={layout.CY - 2} textAnchor="middle" fontSize={30} fontWeight={800} fill="#fff">{members.length}</text>
                <text x={layout.CX} y={layout.CY + 15} textAnchor="middle" fontSize={9} fill={MUTED}>artists in all {stack.length}</text>
                <text x={layout.CX} y={layout.CY + 31} textAnchor="middle" fontSize={stack.length > 2 ? 9 : 10} fontWeight={700}>
                  {stack.map((g, i) => <tspan key={g}>{i > 0 && <tspan fill="#666"> × </tspan>}<tspan fill={col(hueOf(g), 70)}>{g}</tspan></tspan>)}
                </text>
              </g>
            ) : (
              <g>
                <circle cx={layout.CX} cy={layout.CY} r={36} fill={col(headHue, 62)} stroke="#fff" strokeWidth={2} />
                <text x={layout.CX} y={layout.CY + 4} textAnchor="middle" fontSize={Math.min(13, 62 / (head.length * 0.56))} fontWeight={800} fill="#111">{head}</text>
              </g>
            )}
            {hv && (() => {
              const x = Math.min(layout.W - 240, hv.x + 12), y = Math.max(10, hv.y - 64);
              return (
                <g transform={`translate(${x},${y})`} style={{ pointerEvents: "none" }}>
                  <rect width={228} height={56} rx={8} fill="#1f1f1f" stroke="#333" />
                  <text x={10} y={18} fontSize={11.5} fontWeight={800} fill={col(hv.hue, 70)}>{hv.g}</text>
                  <text x={10} y={33} fontSize={10} fill={SOFT}>
                    {stacked ? `${hv.w} of these ${members.length} artists · click to add` : `${hv.w} shared artist${hv.w === 1 ? "" : "s"} · click to focus, shift to stack`}
                  </text>
                  <text x={10} y={47} fontSize={9.5} fill={MUTED}>{hvShared.length > 44 ? hvShared.slice(0, 43) + "…" : hvShared}</text>
                </g>
              );
            })()}
          </svg>
        )}
        <div style={{ position: "absolute", left: 14, bottom: 10, color: MUTED, fontSize: 11, maxWidth: "70%" }}>
          {stacked
            ? `Closer in = more of these ${members.length} artists carry it · click a dot to add it · outlined = not on the ring`
            : "Closer in = more shared artists · click a dot to focus on it, shift-click to stack · outlined = not on the ring"}
        </div>
      </div>

      <aside style={{ background: "#1b1b1b", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto", minHeight: 0 }}>
        {stacked ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span style={{ fontSize: 18, fontWeight: 800, overflowWrap: "anywhere" }}>{stack.join(" × ")}</span>
            <span style={{ color: MUTED, fontSize: 11 }}>{fmt(members.length)} artist{members.length === 1 ? "" : "s"} carry all {stack.length} tags</span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
              {stack.map((g, i) => (
                <span key={g} style={{ display: "contents" }}>
                  {i > 0 && <span style={{ color: "#555", fontSize: 12 }}>×</span>}
                  <button onClick={() => onRemove(g)} title={`Remove ${g}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 6px 2px 9px", borderRadius: 11, border: `1px solid ${col(hueOf(g), 55)}`, background: "transparent", color: col(hueOf(g), 68), fontSize: 11.5, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    {g}<span style={{ color: "#777", fontWeight: 400 }}>✕</span>
                  </button>
                </span>
              ))}
            </div>
            <span style={{ color: MUTED, fontSize: 10.5 }}>
              ✕ widens: {stack.map(g => `without ${g} ${fmt((data.artists ?? []).filter(a => stack.every(s => s === g || a.genres.includes(s))).length)}`).join(" · ")}
            </span>
            <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 14, border: "1px solid #2a2a2a", alignSelf: "flex-start", marginTop: 4 }}>
              <button onClick={() => setPanel("artists")} style={seg(panel === "artists")}>Artists · {fmt(members.length)}</button>
              <button onClick={() => setPanel("overlap")} style={seg(panel === "overlap")}>Overlap</button>
            </div>
          </div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", background: col(headHue), flexShrink: 0 }} />
              <div style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ fontSize: 18, fontWeight: 800, overflowWrap: "anywhere" }}>{head}</span>
                <span style={{ color: MUTED, fontSize: 11 }}>{fmt(members.length)} artists · {nb.length} genres{singles ? ` · ${singles} of them share one artist` : ""}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {label("BY FAMILY")}
              <span style={{ color: MUTED, fontSize: 10.5, marginTop: -3 }}>shared artists, and how many genres</span>
              {famTotals.map(s => (
                <div key={s.fam} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 80px 54px", gap: 8, alignItems: "center", fontSize: 11.5 }}>
                  <span style={{ color: col(s.hue), fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{data.families[s.fam].name}</span>
                  <span style={{ height: 5, background: "#262626", borderRadius: 3, overflow: "hidden" }}><span style={{ display: "block", height: "100%", width: `${Math.round((s.w / maxFam) * 100)}%`, background: col(s.hue) }} /></span>
                  <span style={{ textAlign: "right", color: SOFT, fontVariantNumeric: "tabular-nums" }}>{s.w} · {s.n}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {stacked && panel === "overlap" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: MUTED, fontSize: 11 }}>Every artist with any of the {stack.length}, split by exactly which ones they carry. Click a row.</span>
            <div style={{ display: "grid", gridTemplateColumns: dotCols, gap: 6, alignItems: "end", padding: "4px 4px 0" }}>
              {stack.map(g => (
                <span key={g} title={g} style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontSize: 10, fontWeight: 700, color: col(hueOf(g)), maxHeight: 64, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g}</span>
              ))}
              <span /><span /><span />
            </div>
            {overlap.map(r => {
              const open = r.k === openRow, shown = open ? (rowAll ? r.list : r.list.slice(0, 12)) : [];
              return (
                <div key={r.k} style={{ display: "flex", flexDirection: "column" }}>
                  <button onClick={() => { setOpenRow(open ? null : r.k); setRowAll(false); }}
                    style={{ display: "grid", gridTemplateColumns: dotCols, gap: 6, alignItems: "center", padding: 4, borderRadius: 6, border: open ? "1px solid #3a3a3a" : "1px solid transparent", background: open ? "#262626" : "transparent", cursor: "pointer", fontFamily: "inherit", textAlign: "left" }}>
                    {stack.map(g => <span key={g} style={{ width: 10, height: 10, borderRadius: "50%", justifySelf: "center", background: r.ks.includes(g) ? col(hueOf(g)) : "#2a2a2a" }} />)}
                    <span style={{ fontSize: 11, color: open ? "#fff" : SOFT, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rowName(r.ks)}</span>
                    <span style={{ height: 8, background: "#262626", borderRadius: 4, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${Math.max(3, Math.round((r.list.length / maxRow) * 100))}%`, background: r.ks.length === stack.length ? "#fff" : "#8a8a8a" }} />
                    </span>
                    <span style={{ textAlign: "right", fontSize: 11.5, fontWeight: 700, color: "#fff", fontVariantNumeric: "tabular-nums" }}>{fmt(r.list.length)}</span>
                  </button>
                  {open && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "8px 4px 10px" }}>
                      <span style={{ color: "#fff", fontSize: 11.5, fontWeight: 700 }}>{rowLong(r.ks)}</span>
                      {shown.map(artistRow)}
                      {r.list.length > shown.length && (
                        <button onClick={() => setRowAll(true)} style={{ alignSelf: "flex-start", border: "none", background: "transparent", color: "var(--green)", fontSize: 11, padding: 0, cursor: "pointer", fontFamily: "inherit" }}>
                          show all {fmt(r.list.length)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {(!stacked || panel === "artists") && <>
        {/* Every genre these artists carry, not just the ones on the map, so any of them can be stacked. */}
        {all.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              {label(`${stacked ? "ADD NEXT" : "ALL GENRES"} · ${all.length}`)}
              <span style={{ color: MUTED, fontSize: 11 }}>{stacked ? `keeps n of ${members.length}` : "click to focus · + to stack"}</span>
            </div>
            {all.length > 12 && (
              <input value={genreQ} onChange={e => setGenreQ(e.target.value)} placeholder={`filter ${all.length} genres…`}
                onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); setGenreQ(""); } }}
                style={{ padding: "4px 9px", borderRadius: 12, border: "1px solid #2a2a2a", background: "#141414", color: "#fff", fontSize: 11.5 }} />
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
              {all.filter(([g]) => g.includes(genreQ.trim().toLowerCase())).map(([g, w]) => genreRow(g, w))}
            </div>
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>{label(stacked ? `IN ALL ${stack.length}` : "ARTISTS")}<span style={{ color: MUTED, fontSize: 11 }}>most played first</span></div>
          {sorted.slice(0, nArtists).map(artistRow)}
          {sorted.length > nArtists && <span style={{ color: MUTED, fontSize: 11 }}>and {fmt(sorted.length - nArtists)} more</span>}
        </div>
        </>}
      </aside>
    </div>
    </div>
  );
}
