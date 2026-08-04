import { useEffect, useRef, useState } from "react";
import { API_BASE } from "../api/config";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

interface Rec {
  album: string;
  artist: string;
  year: number;
  genres: string[];
  track_count: number;
  why_you: string;
  blurb: string;
  sounds_like: string[];
  spotify_uri?: string;
  art_local_path?: string;
  feedback: "up" | "down" | null;
}

interface Batch {
  generated_at: string;
  recommendations: Rec[];
}

function timeAgo(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ArtImage({ path, size = 110 }: { path?: string; size?: number }) {
  const [err, setErr] = useState(false);
  const src = path && !err ? `${API_BASE}/artwork/${path.split("/artwork/")[1]}` : undefined;
  return (
    <div style={{
      width: size, height: size, flexShrink: 0,
      borderRadius: 10,
      background: "var(--card)",
      overflow: "hidden",
    }}>
      {src && <img src={src} onError={() => setErr(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
    </div>
  );
}

const UP_PATH =
  "M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z";
const DN_PATH =
  "M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.36-.36.58-.86.58-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z";

function ThumbBtn({ kind, active, onClick }: { kind: "up" | "down"; active: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const color = active ? (kind === "up" ? "var(--green)" : "#e74c3c") : hovered ? "var(--white)" : "var(--dim)";
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 2, lineHeight: 1, display: "flex" }}
      title={kind === "up" ? "Thumbs up" : "Thumbs down"}
    >
      <svg viewBox="0 0 24 24" width={18} height={18} fill={color}>
        <path d={kind === "up" ? UP_PATH : DN_PATH} />
      </svg>
    </button>
  );
}

function RecCard({ rec, batchIdx, recIdx, onFeedback }: {
  rec: Rec;
  batchIdx: number;
  recIdx: number;
  onFeedback: (batchIdx: number, recIdx: number, feedback: "up" | "down" | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const toggleFeedback = (kind: "up" | "down") => {
    onFeedback(batchIdx, recIdx, rec.feedback === kind ? null : kind);
  };

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        background: expanded ? "var(--surface)" : "var(--card)",
        borderRadius: 12,
        padding: "14px 16px",
        cursor: "pointer",
        display: "flex",
        gap: 16,
        transition: "background 0.15s",
      }}
    >
      <ArtImage path={rec.art_local_path} />

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--white)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {rec.album}
          </span>
          <span style={{ fontSize: 12, color: "var(--dim)", flexShrink: 0 }}>{rec.year}</span>
          {rec.spotify_uri && (
            <a
              href={rec.spotify_uri}
              onClick={e => e.stopPropagation()}
              style={{ color: "var(--green)", fontSize: 14, fontWeight: 700, textDecoration: "none", flexShrink: 0 }}
              title="Open on Spotify"
            >↗</a>
          )}
        </div>

        <div style={{ fontSize: 13, color: "var(--gray)" }}>{rec.artist}</div>

        <div style={{ fontSize: 11, color: "var(--dim)" }}>
          {[...rec.genres, `${rec.track_count} tracks`].join("  ·  ")}
        </div>

        <div style={{ fontSize: 12, color: "var(--gray)", fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: expanded ? "normal" : "nowrap" }}>
          {rec.why_you}
        </div>

        {expanded && (
          <>
            <div style={{ height: 1, background: "var(--border)", margin: "6px 0" }} />
            <div style={{ fontSize: 13, color: "var(--gray)", lineHeight: 1.5 }}>{rec.blurb}</div>
            {rec.sounds_like?.length > 0 && (
              <div style={{ fontSize: 12, color: "var(--dim)" }}>
                Sounds like: {rec.sounds_like.join(",  ")}
              </div>
            )}
          </>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 4 }}>
          <ThumbBtn kind="up" active={rec.feedback === "up"} onClick={() => toggleFeedback("up")} />
          <ThumbBtn kind="down" active={rec.feedback === "down"} onClick={() => toggleFeedback("down")} />
        </div>
      </div>
    </div>
  );
}

const STEPS = [
  "Analysing your listening profile…",
  "Identifying taste signals…",
  "Asking Claude for picks…",
  "Verifying albums on Spotify…",
  "Almost there…",
];

function GeneratingIndicator() {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setStep(s => (s + 1) % STEPS.length), 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={{
      flex: 1, display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 20,
    }}>
      <div style={{ display: "flex", gap: 6 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--green)",
            animation: `pulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <div style={{ fontSize: 13, color: "var(--dim)", transition: "opacity 0.4s" }}>
        {STEPS[step]}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.25; transform: scale(0.8); }
          50%       { opacity: 1;    transform: scale(1.1); }
        }
      `}</style>
    </div>
  );
}

export function ClaudioView() {
  const qc = useQueryClient();
  const [batchIdx, setBatchIdx] = useState<number | null>(null);

  const { data: history } = useQuery<{ batches: Batch[] }>({
    queryKey: ["claudio-history"],
    queryFn: () => api.get("/api/claudio/history"),
    staleTime: 10_000,
  });

  const { data: status } = useQuery<{ generating: boolean; error: string | null }>({
    queryKey: ["claudio-status"],
    queryFn: () => api.get("/api/claudio/status"),
    refetchInterval: (query) => query.state.data?.generating ? 1500 : false,
    staleTime: 0,
  });

  const prevGenerating = useRef(false);
  useEffect(() => {
    if (prevGenerating.current && !status?.generating) {
      qc.invalidateQueries({ queryKey: ["claudio-history"] });
    }
    prevGenerating.current = status?.generating ?? false;
  }, [status?.generating, qc]);

  // Auto-select latest batch
  useEffect(() => {
    if (history?.batches?.length) {
      setBatchIdx(history.batches.length - 1);
    }
  }, [history?.batches?.length]);

  const generate = useMutation({
    mutationFn: () => api.post("/api/claudio/generate"),
  });

  const feedbackMutation = useMutation({
    mutationFn: (body: { batch_idx: number; rec_idx: number; feedback: "up" | "down" | null }) =>
      api.post("/api/claudio/feedback", body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["claudio-history"] }),
  });

  const batches = history?.batches ?? [];
  const currentBatch = batchIdx !== null ? batches[batchIdx] : null;
  const recs = currentBatch?.recommendations ?? [];
  const isLatest = batchIdx === batches.length - 1;
  const generating = status?.generating ?? false;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "20px 24px 12px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        <span style={{ fontWeight: 700, fontSize: 20, color: "var(--white)" }}>Claudio</span>

        {batches.length > 0 && (
          <>
            <button
              onClick={() => setBatchIdx(i => Math.max(0, (i ?? 0) - 1))}
              disabled={batchIdx === 0}
              style={{ background: "none", border: "none", color: batchIdx === 0 ? "var(--dim)" : "var(--gray)", cursor: batchIdx === 0 ? "default" : "pointer", fontSize: 18, padding: "0 4px" }}
            >‹</button>

            <span style={{ fontSize: 12, color: "var(--dim)", minWidth: 120, textAlign: "center" }}>
              {currentBatch && (
                isLatest
                  ? `${formatDate(currentBatch.generated_at)} · ${timeAgo(currentBatch.generated_at)}`
                  : `${formatDate(currentBatch.generated_at)}  (${(batchIdx ?? 0) + 1}/${batches.length})`
              )}
            </span>

            <button
              onClick={() => setBatchIdx(i => Math.min(batches.length - 1, (i ?? 0) + 1))}
              disabled={isLatest}
              style={{ background: "none", border: "none", color: isLatest ? "var(--dim)" : "var(--gray)", cursor: isLatest ? "default" : "pointer", fontSize: 18, padding: "0 4px" }}
            >›</button>
          </>
        )}

        <div style={{ flex: 1 }} />

        <button
          disabled={generating}
          onClick={() => generate.mutate()}
          style={{
            background: generating ? "var(--surface)" : "var(--green)",
            color: generating ? "var(--dim)" : "#000",
            border: "none", borderRadius: 16, padding: "0 18px", height: 32,
            fontSize: 13, fontWeight: 600, cursor: generating ? "default" : "pointer",
          }}
        >
          {generating ? "Generating…" : "Generate recommendations"}
        </button>
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflow: "auto", padding: "12px 24px 24px", display: "flex", flexDirection: "column", gap: 8 }}>
        {status?.error && (
          <div style={{ color: "#e74c3c", fontSize: 13, padding: "8px 0" }}>Error: {status.error}</div>
        )}

        {generating && (
          <GeneratingIndicator />
        )}

        {recs.length === 0 && !generating && (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--dim)", fontSize: 13 }}>
            Click "Generate recommendations" to get your picks.
          </div>
        )}

        {!generating && recs.map((rec, i) => (
          <RecCard
            key={i}
            rec={rec}
            batchIdx={batchIdx ?? 0}
            recIdx={i}
            onFeedback={(bi, ri, fb) => feedbackMutation.mutate({ batch_idx: bi, rec_idx: ri, feedback: fb })}
          />
        ))}
      </div>
    </div>
  );
}
