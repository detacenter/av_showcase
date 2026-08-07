import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

const VINYL_GOLD = "#c9a84c";

interface VinylTrack { position: string; title: string; duration: string; }
interface VinylRecord {
  release_id: number;
  title: string;
  artists: string[];
  art_filename: string | null;
  year: number | null;
  original_year: number | null;
  vinyl_type: string;
  labels: string[];
  catnos: string[];
  formats: string[];
  format_descriptions: string[];
  tracklist: VinylTrack[];
  genres: string[];
  styles: string[];
  community_rating_avg: number;
  community_rating_count: number;
  date_added: string | null;
}
interface VinylResponse { records: VinylRecord[]; }

function artUrl(f: string | null | undefined): string | null {
  if (!f) return null;
  // vinyl paths are relative (e.g. "vinyl/123.jpg"); other views have absolute paths
  return f.startsWith("/") ? `/artwork/${f.split("/").pop()}` : `/artwork/${f}`;
}

// ─── Detail view ──────────────────────────────────────────────────────────────

function VinylDetail({ record, onBack }: { record: VinylRecord; onBack: () => void }) {
  const url = artUrl(record.art_filename);
  const yearLabel = record.original_year && record.original_year !== record.year
    ? `${record.year}  (orig. ${record.original_year})`
    : String(record.year || record.original_year || "—");
  const fmt = [...(record.formats ?? []), ...(record.format_descriptions ?? [])
    .filter(d => !record.formats.includes(d))].join(", ") || "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        padding: "16px 16px 12px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        borderBottom: "1px solid #1e1e1e", background: "#0e0e0e", flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={onBack} style={{ background: "none", border: "none", color: "#888", fontSize: 20, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>‹</button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{record.title}</div>
            <div style={{ fontSize: 12, color: "#555", marginTop: 1 }}>{record.artists.join(", ")}</div>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {/* Art + meta */}
        <div style={{ display: "flex", gap: 14, padding: "16px 16px 12px" }}>
          <div style={{ width: 110, height: 110, borderRadius: 8, overflow: "hidden", background: "#2a2a2a", flexShrink: 0 }}>
            {url
              ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
              : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15 }}>◎</div>
            }
          </div>
          <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
            {[
              ["Type",   record.vinyl_type],
              ["Year",   yearLabel],
              ["Format", fmt],
              ["Label",  record.labels.slice(0, 2).join(", ") || "—"],
              ["Cat#",   record.catnos.join(", ") || "—"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", gap: 6, marginBottom: 3 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: "#444", letterSpacing: "0.5px", width: 46, flexShrink: 0, paddingTop: 1 }}>{k}</span>
                <span style={{ fontSize: 12, color: "#b3b3b3" }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div style={{ height: 1, background: "#1e1e1e", margin: "0 16px 8px" }} />

        {/* Tracklist */}
        {record.tracklist.length > 0 && (
          <div style={{ padding: "0 16px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: VINYL_GOLD, letterSpacing: "1.5px", marginBottom: 8 }}>TRACKLIST</div>
            {record.tracklist.map((t, i) => (
              <div key={i} style={{ display: "flex", gap: 8, paddingBottom: 6, alignItems: "baseline" }}>
                <span style={{ fontSize: 11, color: VINYL_GOLD, flexShrink: 0, width: 28 }}>{t.position}</span>
                <span style={{ flex: 1, fontSize: 13, color: "#fff" }}>{t.title}</span>
                <span style={{ fontSize: 11, color: "#444" }}>{t.duration}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export function VinylDetailView() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const record = state as VinylRecord | null;
  if (!record) { navigate("/vinyl", { replace: true }); return null; }
  return <VinylDetail record={record} onBack={() => navigate(-1)} />;
}

export function VinylView() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery<VinylResponse>({
    queryKey: ["vinyl"],
    queryFn: () => api.get("/api/vinyl"),
    staleTime: 120_000,
  });

  const records = (data?.records ?? []).filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.artists.join(" ").toLowerCase().includes(q);
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{
        padding: "16px 16px 10px",
        paddingTop: "calc(16px + env(safe-area-inset-top))",
        background: "#0e0e0e", flexShrink: 0, borderBottom: "1px solid #1e1e1e",
      }}>
        <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: "-0.02em", color: "#fff", marginBottom: 10 }}>Vinyl</div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search collection…"
          style={{
            width: "100%", boxSizing: "border-box",
            background: "#1e1e1e", border: "none", borderRadius: 10,
            color: "#fff", fontSize: 14, padding: "8px 12px", outline: "none",
          }}
        />
      </div>

      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isLoading && <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>Loading…</div>}
        {!isLoading && records.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#444", fontSize: 13 }}>No records found.</div>}
        {records.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, padding: 10 }}>
            {records.map(r => {
              const url = artUrl(r.art_filename);
              return (
                <div key={r.release_id} onClick={() => navigate(`/vinyl/${r.release_id}`, { state: r })} style={{ cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                  <div style={{ width: "100%", aspectRatio: "1", borderRadius: 8, overflow: "hidden", background: "#2a2a2a" }}>
                    {url
                      ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                      : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, opacity: 0.15 }}>◎</div>
                    }
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                    <div style={{ fontSize: 10, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{r.artists.join(", ")}</div>
                    <div style={{ fontSize: 10, color: VINYL_GOLD, fontWeight: 600, marginTop: 1 }}>{r.vinyl_type}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
