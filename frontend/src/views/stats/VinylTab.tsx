import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import { API_BASE } from "../../api/config";

const GOLD = "#c9a84c";

interface TopRecord {
  release_id: number;
  title: string;
  artists: string[];
  art_filename: string | null;
  year: number | null;
  sessions: number;
}

interface VinylStats {
  collection_size: number;
  played_count: number;
  unplayed_count: number;
  total_sessions: number;
  total_minutes: number;
  top_records: TopRecord[];
}

function artUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  return `${API_BASE}/artwork/${filename}`;
}

function fmtMinutes(m: number): string {
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return `${m}m`;
}

function RecordTile({ record, rank }: { record: TopRecord; rank: number }) {
  const url = artUrl(record.art_filename);
  const isHero = rank === 1;

  return (
    <div style={{
      position: "relative", flexShrink: 0,
      width: isHero ? 220 : 148, height: isHero ? 220 : 148,
      borderRadius: 10, overflow: "hidden", background: "#1a1a1a",
    }}>
      {url
        ? <img src={url} alt={record.title} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
        : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 36 }}>♪</div>
      }
      {/* Gradient overlay */}
      <div style={{
        position: "absolute", inset: 0,
        background: "linear-gradient(to top, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)",
      }} />
      {/* Session count badge */}
      {record.sessions > 1 && (
        <div style={{
          position: "absolute", top: 8, right: 8,
          background: "rgba(0,0,0,0.7)", color: GOLD,
          fontSize: 11, fontWeight: 700, padding: "2px 7px",
          borderRadius: 10, border: `1px solid ${GOLD}44`,
        }}>{record.sessions}×</div>
      )}
      {/* Rank */}
      <div style={{
        position: "absolute", top: 8, left: 8,
        color: "#ffffff55", fontSize: isHero ? 13 : 11, fontWeight: 800,
      }}>#{rank}</div>
      {/* Label */}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: isHero ? "0 10px 10px" : "0 8px 8px" }}>
        <div style={{
          fontSize: isHero ? 13 : 11, fontWeight: 700, color: "#fff",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{record.title}</div>
        <div style={{
          fontSize: isHero ? 11 : 10, color: "#aaa", marginTop: 1,
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{record.artists[0] ?? ""}{record.year ? ` · ${record.year}` : ""}</div>
      </div>
    </div>
  );
}

export function VinylTab() {
  const { data, isLoading } = useQuery<VinylStats>({
    queryKey: ["vinyl-stats"],
    queryFn: () => api.get("/api/vinyl/stats"),
    staleTime: 60_000,
  });

  if (isLoading || !data) {
    return <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 13 }}>Loading…</div>;
  }

  const playedPct = data.collection_size > 0
    ? Math.round((data.played_count / data.collection_size) * 100)
    : 0;

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "20px 24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

      {/* Played records — art forward */}
      {data.top_records.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#555", letterSpacing: "0.1em", textTransform: "uppercase" }}>
            Most played
          </div>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
            {data.top_records.map((r, i) => (
              <RecordTile key={r.release_id} record={r} rank={i + 1} />
            ))}
          </div>
        </div>
      )}

      {/* Stats strip */}
      <div style={{
        display: "flex", gap: 0,
        background: "#111", borderRadius: 14, overflow: "hidden",
      }}>
        {[
          { label: "Collection", value: data.collection_size, sub: "records" },
          { label: "Played", value: `${data.played_count}`, sub: `${playedPct}% heard` },
          { label: "Unplayed", value: data.unplayed_count, sub: "records" },
          { label: "Sessions", value: data.total_sessions, sub: "plays" },
          { label: "Time", value: fmtMinutes(data.total_minutes), sub: "total" },
          { label: "Avg", value: data.total_sessions > 0 ? fmtMinutes(Math.round(data.total_minutes / data.total_sessions)) : "—", sub: "per play" },
        ].map((s, i, arr) => (
          <div key={s.label} style={{
            flex: 1, padding: "16px 0", textAlign: "center",
            borderRight: i < arr.length - 1 ? "1px solid #1e1e1e" : "none",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", letterSpacing: "-0.02em" }}>{s.value}</div>
            <div style={{ fontSize: 10, color: "#444", marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Unplayed nudge */}
      {data.unplayed_count > 0 && (
        <div style={{
          background: "#111", borderRadius: 14, padding: "16px 20px",
          display: "flex", alignItems: "center", gap: 16,
        }}>
          <div style={{
            width: 48, height: 48, borderRadius: "50%", flexShrink: 0,
            background: "#1a1a1a", border: `3px solid #222`,
            display: "flex", alignItems: "center", justifyContent: "center",
            position: "relative",
          }}>
            <svg width={48} height={48} style={{ position: "absolute", inset: 0, transform: "rotate(-90deg)" }}>
              <circle cx={24} cy={24} r={20} fill="none" stroke="#1e1e1e" strokeWidth={4} />
              <circle cx={24} cy={24} r={20} fill="none" stroke={GOLD} strokeWidth={4}
                strokeDasharray={`${2 * Math.PI * 20 * playedPct / 100} ${2 * Math.PI * 20}`}
                strokeLinecap="round" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 800, color: GOLD, position: "relative" }}>{playedPct}%</span>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>
              {data.unplayed_count} records you haven't played yet
            </div>
            <div style={{ fontSize: 12, color: "#555", marginTop: 3 }}>
              {data.played_count} of {data.collection_size} records heard
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
