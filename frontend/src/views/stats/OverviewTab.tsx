import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../../api/config";

interface Artist {
  name: string;
  count: number;
  art_path: string | null;
  album_title: string;
  release_year: number | null;
}

interface OverviewData {
  play_count: number;
  total_ms: number;
  days_span: number;
  top_artists: Artist[];
  top_tracks: [string, number][];
  by_decade: [string, number][];
  by_genre: [string, number][];
}

function artUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const filename = (path.split("/").pop() || "").split("\\").pop() || "";
  if (!filename) return null;
  return `${API_BASE}/artwork/${encodeURIComponent(filename)}`;
}

function fmtMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  const totalMin = Math.floor(s / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function hsvToHex(h: number, s: number, v: number): string {
  const s1 = s / 255, v1 = v / 255;
  const c = v1 * s1;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v1 - c;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  const toHex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Metrics card ──────────────────────────────────────────────────────────────

function MetricsCard({ play_count, total_ms, days_span }: Pick<OverviewData, "play_count" | "total_ms" | "days_span">) {
  const cells = [
    { label: "Plays",    value: play_count.toLocaleString() },
    { label: "Time",     value: fmtMs(total_ms) },
    { label: "Avg/day",  value: days_span ? fmtMs(Math.floor(total_ms / days_span)) : "—" },
    { label: "Avg/week", value: days_span ? fmtMs(Math.floor(total_ms * 7 / days_span)) : "—" },
  ];
  return (
    <div style={{ background: "#141414", borderRadius: 18, padding: "20px 28px", display: "flex", alignItems: "stretch" }}>
      {cells.map(({ label, value }, i) => (
        <div key={label} style={{ display: "flex", alignItems: "stretch", flex: 1 }}>
          {i > 0 && <div style={{ width: 1, background: "#2a2a2a", marginRight: 28, flexShrink: 0 }} />}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1 }}>
            <span style={{ color: "#555", fontSize: 9, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase" }}>{label}</span>
            <span style={{ color: "#fff", fontSize: 24, fontWeight: 800 }}>{value}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Artist row ────────────────────────────────────────────────────────────────

function ArtistRow({ row, maxCount, rank }: { row: Artist; maxCount: number; rank: number }) {
  const url = artUrl(row.art_path);
  const pct = maxCount > 0 ? (row.count / maxCount) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 50 }}>
      <span style={{ width: 22, color: "#2e2e2e", fontSize: 11, fontWeight: 700, textAlign: "right", flexShrink: 0 }}>#{rank}</span>
      <div style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 6, overflow: "hidden", background: "#202020", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {url
          ? <img src={url} alt={row.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          : <span style={{ color: "#444", fontSize: 14 }}>♪</span>
        }
      </div>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, paddingTop: 5, paddingBottom: 5, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.name}</span>
          <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>{row.count}</span>
        </div>
        <div style={{ height: 3, background: "#222", borderRadius: 2, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "linear-gradient(to right, #1ddbd1, #13c4a3)", borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

// ── Track row ─────────────────────────────────────────────────────────────────

function TrackRow({ label, count, maxCount, rank }: { label: string; count: number; maxCount: number; rank: number }) {
  const parts = label.split("  —  ");
  const trackName = parts[0]?.trim() ?? label;
  const artistName = parts[1]?.trim() ?? "";
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 50 }}>
      <span style={{ width: 22, color: "#2e2e2e", fontSize: 11, fontWeight: 700, textAlign: "right", flexShrink: 0 }}>#{rank}</span>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, paddingTop: 4, paddingBottom: 4, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: "#fff", fontSize: 12, fontWeight: 700, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{trackName}</span>
          <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>{count}</span>
        </div>
        {artistName && <span style={{ color: "#555", fontSize: 10 }}>{artistName}</span>}
        <div style={{ height: 3, background: "#222", borderRadius: 2, position: "relative" }}>
          <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "linear-gradient(to right, #4e8cff, #7b5ea7)", borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

// ── Decade row ────────────────────────────────────────────────────────────────

function DecadeRow({ label, count, maxCount, idx, total }: { label: string; count: number; maxCount: number; idx: number; total: number }) {
  const t = total > 1 ? idx / (total - 1) : 0;
  const hue = Math.round(t * 270);
  const topCol  = hsvToHex(hue, 195, 215);
  const fadeCol = hsvToHex(hue, 140, 100);
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 32 }}>
      <span style={{ width: 44, color: "#fff", fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, height: 6, background: "#1e1e1e", borderRadius: 3, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: `linear-gradient(to right, ${topCol}, ${fadeCol})`, borderRadius: 3 }} />
      </div>
      <span style={{ width: 32, color: "#444", fontSize: 10, textAlign: "right", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

// ── Genre row ─────────────────────────────────────────────────────────────────

function GenreRow({ label, count, maxCount }: { label: string; count: number; maxCount: number }) {
  const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, height: 30 }}>
      <span style={{ width: 110, color: "#fff", fontSize: 11, fontWeight: 500, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      <div style={{ flex: 1, height: 3, background: "#222", borderRadius: 2, position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, width: `${pct}%`, background: "linear-gradient(to right, #1ddbd1, #13c4a3)", borderRadius: 2 }} />
      </div>
      <span style={{ width: 32, color: "#444", fontSize: 10, textAlign: "right", flexShrink: 0 }}>{count}</span>
    </div>
  );
}

// ── Section card ──────────────────────────────────────────────────────────────

function SectionCard({ title, data }: { title: string; data: OverviewData }) {
  const cardStyle: React.CSSProperties = {
    background: "#141414", borderRadius: 18, padding: "16px 18px 18px",
    display: "flex", flexDirection: "column", gap: 6, flex: 1,
  };
  const header = (
    <span style={{ color: "#555", fontSize: 10, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase" }}>{title}</span>
  );

  if (title === "Top Artists") {
    const rows = data.top_artists.slice(0, 6);
    const max = Math.max(...rows.map(r => r.count), 1);
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ height: 8 }} />
        {rows.map((row, i) => <ArtistRow key={row.name} row={row} maxCount={max} rank={i + 1} />)}
      </div>
    );
  }

  if (title === "Top Tracks") {
    const rows = data.top_tracks.slice(0, 6);
    const max = Math.max(...rows.map(([, c]) => c), 1);
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ height: 8 }} />
        {rows.map(([label, count], i) => <TrackRow key={label} label={label} count={count} maxCount={max} rank={i + 1} />)}
      </div>
    );
  }

  if (title === "By Decade") {
    const rows = data.by_decade;
    const max = Math.max(...rows.map(([, c]) => c), 1);
    return (
      <div style={cardStyle}>
        {header}
        <div style={{ height: 8 }} />
        {rows.map(([label, count], i) => <DecadeRow key={label} label={label} count={count} maxCount={max} idx={i} total={rows.length} />)}
      </div>
    );
  }

  // By Genre
  const rows = data.by_genre.slice(0, 10);
  const max = Math.max(...rows.map(([, c]) => c), 1);
  return (
    <div style={cardStyle}>
      {header}
      <div style={{ height: 8 }} />
      {rows.map(([label, count]) => <GenreRow key={label} label={label} count={count} maxCount={max} />)}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export function OverviewTab() {
  const { data, isLoading, isError } = useQuery<OverviewData>({
    queryKey: ["overview"],
    queryFn: () => fetch(`${API_BASE}/api/stats/overview?days=0`).then(r => r.json()),
  });

  if (isLoading) return <div style={{ padding: 32, color: "#555", fontSize: 13 }}>Loading…</div>;
  if (isError || !data) return <div style={{ padding: 32, color: "#555", fontSize: 13 }}>No data</div>;

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "12px 24px 24px", display: "flex", flexDirection: "column", gap: 12 }}>
      <MetricsCard play_count={data.play_count} total_ms={data.total_ms} days_span={data.days_span} />
      <div style={{ display: "flex", gap: 12 }}>
        <SectionCard title="Top Artists" data={data} />
        <SectionCard title="Top Tracks" data={data} />
      </div>
      <div style={{ display: "flex", gap: 12 }}>
        <SectionCard title="By Decade" data={data} />
        <SectionCard title="By Genre" data={data} />
      </div>
    </div>
  );
}
