import { useState, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { API_BASE } from "../api/config";
import type { VinylRecord, VinylResponse } from "../api/types";

const GOLD = "#c8a84b";
const POLL_MS = 4000;

function artUrl(f: string | null | undefined) {
  return f ? `${API_BASE}/artwork/${f}` : null;
}

interface SessionState {
  active: boolean;
  session_id?: string;
  started_at?: number;
  show_prompt?: boolean;
  confirmed?: boolean;
  release_id?: string | null;
}

export function VinylSessionPrompt() {
  const qc = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [reconfirmId, setReconfirmId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [focused, setFocused] = useState(0);
  const [confirmed, setConfirmed] = useState<VinylRecord | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: session } = useQuery<SessionState>({
    queryKey: ["vinyl-session"],
    queryFn: () => api.get("/api/vinyl/session/current"),
    refetchInterval: POLL_MS,
    staleTime: 0,
  });

  const { data: vinylData } = useQuery<VinylResponse>({
    queryKey: ["vinyl"],
    queryFn: () => api.get("/api/vinyl"),
    staleTime: 60_000,
  });

  // Open for active session
  useEffect(() => {
    if (session?.show_prompt) {
      setVisible(true);
      setReconfirmId(null);
      setFilter("");
      setFocused(0);
      setConfirmed(null);
      setTimeout(() => filterRef.current?.focus(), 50);
    } else if (!session?.active) {
      setVisible(false);
      setConfirmed(null);
    }
  }, [session?.show_prompt, session?.active]);

  // Listen for re-confirm requests from SessionsTab
  useEffect(() => {
    const handler = (e: Event) => {
      const { sessionId } = (e as CustomEvent).detail;
      setReconfirmId(sessionId);
      setVisible(true);
      setFilter("");
      setFocused(0);
      setConfirmed(null);
      setTimeout(() => filterRef.current?.focus(), 50);
    };
    window.addEventListener("vinyl-reconfirm", handler);
    return () => window.removeEventListener("vinyl-reconfirm", handler);
  }, []);

  const records = vinylData?.records ?? [];
  const filtered = filter.trim()
    ? records.filter(r =>
        r.title.toLowerCase().includes(filter.toLowerCase()) ||
        r.artists.join(" ").toLowerCase().includes(filter.toLowerCase())
      )
    : records;

  useEffect(() => { setFocused(0); }, [filter]);

  useEffect(() => {
    const el = listRef.current?.querySelectorAll<HTMLDivElement>("[data-row]")[focused];
    el?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown") { e.preventDefault(); setFocused(f => Math.min(f + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setFocused(f => Math.max(f - 1, 0)); }
      else if (e.key === "Enter") { e.preventDefault(); if (filtered[focused]) confirm(filtered[focused]); }
      else if (e.key === "Escape") { e.preventDefault(); dismiss(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, focused, filtered]);

  useEffect(() => {
    if (!confirmed) return;
    const t = setTimeout(() => setConfirmed(null), 2000);
    return () => clearTimeout(t);
  }, [confirmed]);

  async function confirm(r: VinylRecord) {
    const body = {
      release_id: String(r.release_id),
      title: r.title,
      artists: r.artists,
      art_filename: r.art_filename ?? null,
    };
    if (reconfirmId) {
      await api.post(`/api/vinyl/sessions/${reconfirmId}/confirm`, body);
      qc.invalidateQueries({ queryKey: ["vinyl-sessions"] });
    } else {
      await api.post("/api/vinyl/session/confirm", body);
      qc.invalidateQueries({ queryKey: ["vinyl-session"] });
    }
    setConfirmed(r);
    setReconfirmId(null);
    setVisible(false);
  }

  async function dismiss() {
    if (!reconfirmId) {
      await api.post("/api/vinyl/session/dismiss");
      qc.invalidateQueries({ queryKey: ["vinyl-session"] });
    }
    setReconfirmId(null);
    setVisible(false);
  }

  if (!visible && !confirmed) return null;

  if (confirmed) {
    return (
      <div style={overlayStyle} onClick={() => setConfirmed(null)}>
        <div style={{ ...panelStyle, maxWidth: 360, textAlign: "center", padding: "32px 24px" }}>
          {artUrl(confirmed.art_filename)
            ? <img src={artUrl(confirmed.art_filename)!} style={{ width: 80, height: 80, borderRadius: 8, objectFit: "cover", marginBottom: 12 }} />
            : <div style={{ fontSize: 36, marginBottom: 12 }}>🎵</div>
          }
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 }}>{confirmed.title}</div>
          <div style={{ fontSize: 13, color: "#888" }}>{confirmed.artists.join(", ")}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlayStyle} onClick={e => { if (e.target === e.currentTarget) dismiss(); }}>
      <div style={panelStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <span style={{ fontSize: 11, color: GOLD, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
              {reconfirmId ? "Confirm Session" : "Now Playing"}
            </span>
            <div style={{ fontSize: 17, fontWeight: 700, color: "#fff", marginTop: 2 }}>What are you listening to?</div>
          </div>
          <button onClick={dismiss} style={closeBtnStyle}>✕</button>
        </div>

        <input
          ref={filterRef}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Search your collection…"
          style={inputStyle}
        />

        <div ref={listRef} style={{ overflowY: "auto", maxHeight: 340, marginTop: 10 }}>
          {filtered.length === 0 && (
            <div style={{ color: "#555", fontSize: 13, padding: "12px 0", textAlign: "center" }}>No matches</div>
          )}
          {filtered.map((r, i) => {
            const url = artUrl(r.art_filename);
            return (
              <div
                key={r.release_id}
                data-row
                onClick={() => confirm(r)}
                onMouseEnter={() => setFocused(i)}
                style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "7px 8px",
                  borderRadius: 6, cursor: "pointer",
                  background: i === focused ? "#2a2a2a" : "transparent",
                }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: "#111" }}>
                  {url
                    ? <img src={url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    : <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "#333", fontSize: 16 }}>♪</div>
                  }
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.title}</div>
                  <div style={{ fontSize: 11, color: "#666", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.artists.join(", ")}</div>
                </div>
                <div style={{ fontSize: 11, color: GOLD, fontWeight: 600, flexShrink: 0 }}>{r.vinyl_type}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10000,
  background: "rgba(0,0,0,0.6)",
  display: "flex", alignItems: "center", justifyContent: "center",
};

const panelStyle: React.CSSProperties = {
  background: "#171717", borderRadius: 12, padding: "20px 20px 16px",
  width: 440, boxShadow: "0 24px 64px rgba(0,0,0,0.8)",
  border: "1px solid #2a2a2a",
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  background: "#222", border: "1px solid #333", borderRadius: 7,
  color: "#fff", fontSize: 13, padding: "8px 12px",
  outline: "none",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#555", fontSize: 16,
  cursor: "pointer", padding: "2px 6px", borderRadius: 4,
};
