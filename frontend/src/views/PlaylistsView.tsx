import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import type { Playlist, PlaylistTrack, Condition, RuleGroup, SessionInfo } from "../api/types";

// ── API ───────────────────────────────────────────────────────────────────────

const fetchPlaylists = () =>
  api.get<{ playlists: Playlist[]; all_genres: string[] }>("/api/playlists");

const fetchSessions = () =>
  api.get<SessionInfo[]>("/api/playlists/sessions");

const apiCreatePlaylist = (name: string) =>
  api.post<Playlist>("/api/playlists", { name });

const apiSavePlaylist = (id: string, data: Partial<Playlist>) =>
  api.put<Playlist>(`/api/playlists/${id}`, data);

const apiDeletePlaylist = (id: string) =>
  api.del<{ ok: boolean }>(`/api/playlists/${id}`);

const apiEvaluate = (id: string) =>
  api.get<{ tracks: PlaylistTrack[] }>(`/api/playlists/${id}/evaluate`);

// ── PillInput ─────────────────────────────────────────────────────────────────

function PillInput({ values, onChange, suggestions = [], placeholder = "type & Enter" }: {
  values: string[];
  onChange: (v: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [input, setInput] = useState("");
  const [open, setOpen] = useState(false);

  const filtered = useMemo(
    () => suggestions.filter(s => s.toLowerCase().includes(input.toLowerCase()) && !values.includes(s)).slice(0, 12),
    [suggestions, input, values],
  );

  const add = (v: string) => {
    const t = v.trim();
    if (t && !values.includes(t)) onChange([...values, t]);
    setInput("");
    setOpen(false);
  };

  const remove = (v: string) => onChange(values.filter(x => x !== v));

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, flex: 1, alignItems: "center", minWidth: 0 }}>
      {values.map(v => (
        <span key={v} style={{
          background: "#2a2a2a", border: "1px solid #444", borderRadius: 3,
          padding: "1px 4px 1px 7px", fontSize: 11, color: "#ddd",
          display: "flex", alignItems: "center", gap: 3,
        }}>
          {v}
          <span onClick={() => remove(v)} style={{ cursor: "pointer", color: "#666", lineHeight: 1 }}>×</span>
        </span>
      ))}
      <div style={{ position: "relative" }}>
        <input
          value={input}
          onChange={e => { setInput(e.target.value); setOpen(true); }}
          onKeyDown={e => {
            if (e.key === "Enter") { e.preventDefault(); add(input); }
            if (e.key === "Escape") { setOpen(false); setInput(""); }
            if (e.key === "Backspace" && !input && values.length > 0) remove(values[values.length - 1]);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={values.length === 0 ? placeholder : ""}
          style={{
            background: "transparent", border: "none", color: "#fff",
            fontSize: 12, outline: "none",
            width: input.length > 0 ? Math.max(80, input.length * 8) : 100,
          }}
        />
        {open && filtered.length > 0 && (
          <div style={{
            position: "absolute", top: "100%", left: 0,
            background: "#1c1c1c", border: "1px solid #333", borderRadius: 4,
            zIndex: 200, maxHeight: 160, overflowY: "auto", width: 200,
          }}>
            {filtered.map(s => (
              <div
                key={s}
                onMouseDown={e => { e.preventDefault(); add(s); }}
                style={{ padding: "4px 10px", fontSize: 12, cursor: "pointer", color: "#ccc" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >{s}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── MonthPicker ───────────────────────────────────────────────────────────────

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function MonthPicker({ values, onChange }: { values: string[]; onChange: (v: string[]) => void }) {
  const toggle = (m: string) =>
    values.includes(m) ? onChange(values.filter(x => x !== m)) : onChange([...values, m]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {MONTHS.map((m, i) => (
        <button key={m} onClick={() => toggle(m)} style={{
          padding: "2px 6px", fontSize: 11, cursor: "pointer", borderRadius: 3,
          border: "1px solid #444",
          background: values.includes(m) ? "#1a3a1a" : "#2a2a2a",
          color: values.includes(m) ? "var(--green)" : "#aaa",
        }}>{MONTH_SHORT[i]}</button>
      ))}
    </div>
  );
}

// ── ConditionRow ──────────────────────────────────────────────────────────────

const FIELD_LABELS: Record<string, string> = {
  artist: "Artist", album: "Album", genre: "Genre", track: "Track",
  favorited: "Favorited", session_id: "Session", release_year: "Year", month: "Month",
};

const MULTI_FIELDS = ["artist", "album", "genre", "track"];

function defaultCondition(field: string): Condition {
  if (MULTI_FIELDS.includes(field)) return { field, op: "in", values: [] };
  if (field === "release_year") return { field, op: "range", from: 2000, to: new Date().getFullYear() };
  if (field === "favorited") return { field, op: "eq", value: true };
  if (field === "month") return { field, op: "in", values: [] };
  return { field, op: "eq", value: "" };
}

const sel: React.CSSProperties = {
  background: "#232323", border: "1px solid #3a3a3a", borderRadius: 4,
  color: "#ccc", fontSize: 12, padding: "3px 6px", cursor: "pointer",
};

const inp: React.CSSProperties = {
  background: "#232323", border: "1px solid #3a3a3a", borderRadius: 4,
  color: "#fff", fontSize: 12, padding: "3px 8px", outline: "none", width: 80,
};

function ConditionRow({ condition, onChange, onRemove, allGenres, sessions }: {
  condition: Condition;
  onChange: (c: Condition) => void;
  onRemove: () => void;
  allGenres: string[];
  sessions: SessionInfo[];
}) {
  const { field, op } = condition;
  const vals = (condition as any).values as string[] | undefined;
  const val = (condition as any).value;
  const from = (condition as any).from as number | undefined;
  const to = (condition as any).to as number | undefined;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", flexWrap: "wrap" }}>
      <select value={field} onChange={e => onChange(defaultCondition(e.target.value))} style={sel}>
        {Object.entries(FIELD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>

      {MULTI_FIELDS.includes(field) && (
        <select value={op} onChange={e => onChange({ ...condition, op: e.target.value })} style={sel}>
          <option value="in">any of</option>
          <option value="all">all of</option>
        </select>
      )}

      {field === "release_year" && (
        <select value={op} onChange={e => onChange({ ...condition, op: e.target.value })} style={sel}>
          <option value="range">between</option>
          <option value="eq">is</option>
        </select>
      )}

      {MULTI_FIELDS.includes(field) && (
        <PillInput
          values={vals || []}
          onChange={v => onChange({ ...condition, values: v })}
          suggestions={field === "genre" ? allGenres : []}
          placeholder={`add ${field}…`}
        />
      )}

      {field === "release_year" && op === "range" && (
        <>
          <input type="number" value={from ?? ""} onChange={e => onChange({ ...condition, from: +e.target.value } as Condition)} style={inp} />
          <span style={{ color: "#555", fontSize: 12 }}>to</span>
          <input type="number" value={to ?? ""} onChange={e => onChange({ ...condition, to: +e.target.value } as Condition)} style={inp} />
        </>
      )}

      {field === "release_year" && op === "eq" && (
        <input type="number" value={val ?? ""} onChange={e => onChange({ ...condition, value: +e.target.value } as Condition)} style={inp} />
      )}

      {field === "favorited" && (
        <span style={{ color: "var(--green)", fontSize: 12 }}>yes</span>
      )}

      {field === "session_id" && (
        <select value={(val as string) || ""} onChange={e => onChange({ ...condition, value: e.target.value } as Condition)}
          style={{ ...sel, maxWidth: 300, fontSize: 11 }}>
          <option value="">— select session —</option>
          {sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      )}

      {field === "month" && (
        <MonthPicker values={vals || []} onChange={v => onChange({ ...condition, values: v } as Condition)} />
      )}

      <button onClick={onRemove} style={{
        background: "none", border: "none", color: "#444", cursor: "pointer",
        fontSize: 15, padding: "0 4px", marginLeft: "auto", flexShrink: 0,
      }}>×</button>
    </div>
  );
}

// ── GroupWidget ───────────────────────────────────────────────────────────────

function GroupWidget({ group, isFirst, onChange, onRemove, allGenres, sessions }: {
  group: RuleGroup;
  isFirst: boolean;
  onChange: (g: RuleGroup) => void;
  onRemove: () => void;
  allGenres: string[];
  sessions: SessionInfo[];
}) {
  const updateCond = (i: number, c: Condition) => {
    const conditions = [...group.conditions];
    conditions[i] = c;
    onChange({ ...group, conditions });
  };

  const removeCond = (i: number) =>
    onChange({ ...group, conditions: group.conditions.filter((_, j) => j !== i) });

  const addCond = () =>
    onChange({ ...group, conditions: [...group.conditions, defaultCondition("artist")] });

  return (
    <div style={{ border: "1px solid #222", borderRadius: 6, padding: "10px 14px", background: "#111", marginBottom: 8 }}>
      {!isFirst && (
        <div style={{ fontSize: 10, color: "#444", marginBottom: 6, fontWeight: 700, letterSpacing: 1 }}>OR</div>
      )}
      {group.conditions.map((c, i) => (
        <div key={i}>
          {i > 0 && <div style={{ fontSize: 10, color: "#383838", margin: "0 0 0 6px" }}>AND</div>}
          <ConditionRow
            condition={c}
            onChange={nc => updateCond(i, nc)}
            onRemove={() => removeCond(i)}
            allGenres={allGenres}
            sessions={sessions}
          />
        </div>
      ))}
      <div style={{ display: "flex", marginTop: 6, gap: 8 }}>
        <button onClick={addCond} style={{
          background: "none", border: "1px solid #2a2a2a", borderRadius: 4,
          color: "#666", cursor: "pointer", fontSize: 11, padding: "3px 10px",
        }}>+ condition</button>
        <button onClick={onRemove} style={{
          background: "none", border: "none", color: "#3a3a3a", cursor: "pointer",
          fontSize: 11, marginLeft: "auto",
        }}>remove group</button>
      </div>
    </div>
  );
}

// ── RuleBuilder ───────────────────────────────────────────────────────────────

function RuleBuilder({ groups, onChange, allGenres, sessions }: {
  groups: RuleGroup[];
  onChange: (g: RuleGroup[]) => void;
  allGenres: string[];
  sessions: SessionInfo[];
}) {
  const updateGroup = (i: number, g: RuleGroup) => {
    const next = [...groups]; next[i] = g; onChange(next);
  };
  const removeGroup = (i: number) => onChange(groups.filter((_, j) => j !== i));
  const addGroup = () => onChange([...groups, { conditions: [defaultCondition("artist")] }]);

  return (
    <div>
      {groups.length === 0 ? (
        <div style={{ color: "#444", fontSize: 12, padding: "6px 0" }}>
          No rules — only pinned tracks will appear.
        </div>
      ) : (
        groups.map((g, i) => (
          <GroupWidget
            key={i}
            group={g}
            isFirst={i === 0}
            onChange={gg => updateGroup(i, gg)}
            onRemove={() => removeGroup(i)}
            allGenres={allGenres}
            sessions={sessions}
          />
        ))
      )}
      <button onClick={addGroup} style={{
        background: "none", border: "1px solid #2a2a2a", borderRadius: 4,
        color: "#666", cursor: "pointer", fontSize: 11, padding: "4px 12px", marginTop: 4,
      }}>+ add group (OR)</button>
    </div>
  );
}

// ── TracksTable ───────────────────────────────────────────────────────────────

type SortKey = "track_name" | "artist" | "album_name" | "release_year" | "_play_count";

function TracksTable({ tracks, pinnedIds, onPin, onExclude }: {
  tracks: PlaylistTrack[];
  pinnedIds: string[];
  onPin: (id: string) => void;
  onExclude: (id: string) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("artist");
  const [sortAsc, setSortAsc] = useState(true);
  const [ctx, setCtx] = useState<{ x: number; y: number; id: string } | null>(null);

  const sorted = useMemo(() => {
    const key = (t: PlaylistTrack): string | number => {
      if (sortKey === "artist") return (t.artist_names[0] || "").toLowerCase();
      if (sortKey === "track_name") return t.track_name.toLowerCase();
      if (sortKey === "album_name") return t.album_name.toLowerCase();
      if (sortKey === "release_year") return t.release_year ?? 0;
      return t._play_count;
    };
    return [...tracks].sort((a, b) => {
      const av = key(a), bv = key(b);
      return av < bv ? (sortAsc ? -1 : 1) : av > bv ? (sortAsc ? 1 : -1) : 0;
    });
  }, [tracks, sortKey, sortAsc]);

  const handleHeader = (k: SortKey) => {
    if (sortKey === k) setSortAsc(a => !a);
    else { setSortKey(k); setSortAsc(true); }
  };

  const th = (k: SortKey, width?: number): React.CSSProperties => ({
    padding: "6px 10px", fontSize: 11, fontWeight: 600,
    color: sortKey === k ? "#999" : "#555",
    textAlign: "left", cursor: "pointer", userSelect: "none",
    borderBottom: "1px solid #1e1e1e",
    ...(width ? { width } : {}),
  });

  const arrow = (k: SortKey) => sortKey === k ? (sortAsc ? " ↑" : " ↓") : "";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }} onClick={() => setCtx(null)}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>Tracks</span>
        <span style={{ fontSize: 12, color: "#555" }}>({tracks.length})</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={th("track_name")} onClick={() => handleHeader("track_name")}>Track{arrow("track_name")}</th>
              <th style={th("artist")} onClick={() => handleHeader("artist")}>Artist{arrow("artist")}</th>
              <th style={th("album_name")} onClick={() => handleHeader("album_name")}>Album{arrow("album_name")}</th>
              <th style={th("release_year", 60)} onClick={() => handleHeader("release_year")}>Year{arrow("release_year")}</th>
              <th style={th("_play_count", 55)} onClick={() => handleHeader("_play_count")}>Plays{arrow("_play_count")}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(t => (
              <tr
                key={t.track_id}
                onContextMenu={e => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, id: t.track_id }); }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "#181818"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                <td style={{ padding: "5px 10px", color: t._pinned ? "var(--green)" : "#ddd" }}>
                  {t._pinned ? "📌 " : ""}{t.track_name}
                </td>
                <td style={{ padding: "5px 10px", color: "#999" }}>{t.artist_names.join(", ")}</td>
                <td style={{ padding: "5px 10px", color: "#777" }}>{t.album_name}</td>
                <td style={{ padding: "5px 10px", color: "#555" }}>{t.release_year ?? "—"}</td>
                <td style={{ padding: "5px 10px", color: "#555" }}>{t._play_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ctx && (
        <div
          style={{
            position: "fixed", top: ctx.y, left: ctx.x, background: "#1e1e1e",
            border: "1px solid #333", borderRadius: 4, zIndex: 1000, padding: "4px 0", minWidth: 160,
          }}
          onClick={e => e.stopPropagation()}
        >
          <div
            onClick={() => { onPin(ctx.id); setCtx(null); }}
            style={{ padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#ccc" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            {pinnedIds.includes(ctx.id) ? "Unpin track" : "📌 Pin track"}
          </div>
          <div
            onClick={() => { onExclude(ctx.id); setCtx(null); }}
            style={{ padding: "7px 14px", fontSize: 12, cursor: "pointer", color: "#ccc" }}
            onMouseEnter={e => (e.currentTarget.style.background = "#2a2a2a")}
            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
          >
            ✕ Exclude track
          </div>
        </div>
      )}
    </div>
  );
}

// ── PlaylistDetailView ────────────────────────────────────────────────────────

export function PlaylistDetailView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: listData } = useQuery({ queryKey: ["playlists"], queryFn: fetchPlaylists });
  const { data: evalData, isLoading: evalLoading } = useQuery({
    queryKey: ["playlist-eval", id],
    queryFn: () => apiEvaluate(id!),
    enabled: !!id,
  });
  const { data: sessions = [] } = useQuery({ queryKey: ["playlist-sessions"], queryFn: fetchSessions });

  const allGenres = listData?.all_genres ?? [];
  const serverPlaylist = listData?.playlists.find(p => p.id === id);

  const [draft, setDraft] = useState<Playlist | null>(null);
  const [dirty, setDirty] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameInput, setNameInput] = useState("");

  // Reset when navigating to a different playlist
  useEffect(() => {
    setDraft(null);
    setDirty(false);
    setRulesOpen(false);
    setRenaming(false);
  }, [id]);

  // Initialize draft once
  useEffect(() => {
    if (serverPlaylist && !draft) {
      setDraft(serverPlaylist);
      setRulesOpen(serverPlaylist.rule_groups.length === 0);
    }
  }, [serverPlaylist, draft]);

  const saveMutation = useMutation({
    mutationFn: (data: Partial<Playlist>) => apiSavePlaylist(id!, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      qc.invalidateQueries({ queryKey: ["playlist-eval", id] });
      setDirty(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiDeletePlaylist(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["playlists"] });
      navigate("/playlists");
    },
  });

  const handleSave = () => {
    if (!draft) return;
    saveMutation.mutate({
      name: draft.name,
      rule_groups: draft.rule_groups,
      pinned_track_ids: draft.pinned_track_ids,
      excluded_track_ids: draft.excluded_track_ids,
    });
  };

  const handleDelete = () => {
    if (!window.confirm(`Delete "${draft?.name}"?`)) return;
    deleteMutation.mutate();
  };

  const handleCreate = async () => {
    const p = await apiCreatePlaylist("Untitled");
    qc.invalidateQueries({ queryKey: ["playlists"] });
    navigate(`/playlists/${p.id}`);
  };

  const handlePin = (trackId: string) => {
    if (!draft) return;
    const pinned = draft.pinned_track_ids.includes(trackId)
      ? draft.pinned_track_ids.filter(x => x !== trackId)
      : [...draft.pinned_track_ids, trackId];
    const next = { ...draft, pinned_track_ids: pinned };
    setDraft(next);
    saveMutation.mutate({ name: next.name, rule_groups: next.rule_groups, pinned_track_ids: pinned, excluded_track_ids: next.excluded_track_ids });
  };

  const handleExclude = (trackId: string) => {
    if (!draft) return;
    const excluded = [...draft.excluded_track_ids, trackId];
    const next = { ...draft, excluded_track_ids: excluded };
    setDraft(next);
    saveMutation.mutate({ name: next.name, rule_groups: next.rule_groups, pinned_track_ids: next.pinned_track_ids, excluded_track_ids: excluded });
  };

  const updateDraft = (update: Partial<Playlist>) => {
    setDraft(d => d ? { ...d, ...update } : d);
    setDirty(true);
  };

  if (!draft) {
    return <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Loading…</div>;
  }

  const btnBase: React.CSSProperties = {
    borderRadius: 4, cursor: "pointer", fontSize: 12, padding: "4px 12px",
  };

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Top bar */}
      <div style={{
        display: "flex", alignItems: "center", gap: 8, flexShrink: 0,
        padding: "11px 20px", borderBottom: "1px solid #1e1e1e",
      }}>
        <button
          onClick={() => navigate("/playlists")}
          style={{ background: "none", border: "none", color: "#555", cursor: "pointer", fontSize: 13, padding: "0 6px 0 0" }}
        >← Playlists</button>
        <div style={{ width: 1, height: 14, background: "#2a2a2a" }} />

        {renaming ? (
          <input
            autoFocus
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { updateDraft({ name: nameInput.trim() || draft.name }); setRenaming(false); }
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={() => { updateDraft({ name: nameInput.trim() || draft.name }); setRenaming(false); }}
            style={{
              background: "#1e1e1e", border: "1px solid #444", borderRadius: 4,
              color: "#fff", fontSize: 14, fontWeight: 600, padding: "3px 8px", outline: "none",
            }}
          />
        ) : (
          <span
            style={{ fontSize: 14, fontWeight: 600, color: "#fff", cursor: "text" }}
            onDoubleClick={() => { setNameInput(draft.name); setRenaming(true); }}
          >{draft.name}</span>
        )}

        {dirty && <span style={{ fontSize: 11, color: "#666" }}>● unsaved</span>}

        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={() => { setNameInput(draft.name); setRenaming(true); }}
            style={{ ...btnBase, background: "#1e1e1e", border: "1px solid #333", color: "#888" }}
          >Rename</button>
          <button
            onClick={handleSave}
            disabled={!dirty || saveMutation.isPending}
            style={{
              ...btnBase,
              background: dirty ? "#142814" : "#111",
              border: `1px solid ${dirty ? "#2a4a2a" : "#222"}`,
              color: dirty ? "var(--green)" : "#3a5a3a",
              cursor: dirty ? "pointer" : "default",
            }}
          >Save</button>
          <button
            onClick={handleCreate}
            style={{ ...btnBase, background: "#1e1e1e", border: "1px solid #333", color: "#888" }}
          >+ New</button>
          <button
            onClick={handleDelete}
            style={{ ...btnBase, background: "none", border: "1px solid #3a1a1a", color: "#7a3333" }}
          >Delete</button>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "16px 20px", gap: 14 }}>
        {/* Rules section */}
        <div style={{ flexShrink: 0 }}>
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", marginBottom: rulesOpen ? 10 : 0 }}
            onClick={() => setRulesOpen(o => !o)}
          >
            <span style={{ fontSize: 11, color: "#555" }}>{rulesOpen ? "▾" : "▸"}</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: "#777" }}>Rules</span>
            <span style={{ fontSize: 11, color: "#444" }}>
              {draft.rule_groups.length === 0 ? "none" : `${draft.rule_groups.length} group${draft.rule_groups.length > 1 ? "s" : ""}`}
            </span>
          </div>
          {rulesOpen && (
            <RuleBuilder
              groups={draft.rule_groups}
              onChange={groups => updateDraft({ rule_groups: groups })}
              allGenres={allGenres}
              sessions={sessions}
            />
          )}
        </div>

        {/* Tracks */}
        {evalLoading ? (
          <div style={{ color: "#444", fontSize: 12 }}>Evaluating…</div>
        ) : (
          <TracksTable
            tracks={evalData?.tracks ?? []}
            pinnedIds={draft.pinned_track_ids}
            onPin={handlePin}
            onExclude={handleExclude}
          />
        )}
      </div>
    </div>
  );
}

// ── ArtMosaic ─────────────────────────────────────────────────────────────────

import { API_BASE as ART_BASE } from "../api/config";

function ArtMosaic({ filenames }: { filenames: string[] }) {
  const slots = [0, 1, 2, 3];
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2,
      borderRadius: 6, overflow: "hidden", marginBottom: 12,
      aspectRatio: "1", background: "#0a0a0a",
    }}>
      {slots.map(i =>
        filenames[i] ? (
          <img
            key={i}
            src={`${ART_BASE}/artwork/${filenames[i]}`}
            style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block" }}
          />
        ) : (
          <div key={i} style={{ background: "#1a1a1a", aspectRatio: "1" }} />
        )
      )}
    </div>
  );
}

// ── PlaylistsView (landing) ───────────────────────────────────────────────────

export function PlaylistsView() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [focused, setFocused] = useState(0);

  const { data, isLoading } = useQuery({ queryKey: ["playlists"], queryFn: fetchPlaylists });

  const playlists = useMemo(
    () => [...(data?.playlists ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [data],
  );

  const handleCreate = async () => {
    const p = await apiCreatePlaylist("Untitled");
    qc.invalidateQueries({ queryKey: ["playlists"] });
    navigate(`/playlists/${p.id}`);
  };

  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  // Refs so the single-mount handler always reads current values
  const playlistsRef = useRef(playlists);
  const focusedRef = useRef(focused);
  playlistsRef.current = playlists;
  focusedRef.current = focused;

  useEffect(() => {
    cardRefs.current[focused]?.scrollIntoView({ block: "nearest" });
  }, [focused]);

  const COLS = 3;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const list = playlistsRef.current;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setFocused(i => Math.min(i + COLS, list.length - 1));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setFocused(i => Math.max(0, i - COLS));
      } else if (e.key === "h" || e.key === "ArrowLeft") {
        e.preventDefault();
        setFocused(i => Math.max(0, i - 1));
      } else if (e.key === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        setFocused(i => Math.min(i + 1, list.length - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const p = list[focusedRef.current];
        if (p) navigate(`/playlists/${p.id}`);
      } else if (e.key === "n") {
        handleCreate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) return <div style={{ padding: 24, color: "#555", fontSize: 13 }}>Loading…</div>;

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
        <span style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>Playlists</span>
        <span style={{ fontSize: 12, color: "#555" }}>{playlists.length} playlist{playlists.length !== 1 ? "s" : ""}</span>
        <button
          onClick={handleCreate}
          style={{
            marginLeft: "auto", background: "#142814", border: "1px solid #2a4a2a",
            borderRadius: 4, color: "var(--green)", cursor: "pointer", fontSize: 12, padding: "5px 14px",
          }}
        >+ New playlist</button>
      </div>

      {playlists.length === 0 ? (
        <div style={{ color: "#444", fontSize: 13, textAlign: "center", marginTop: 60 }}>
          No playlists yet.
          <div style={{ marginTop: 10, fontSize: 12, color: "#333" }}>
            Press <kbd style={{ background: "#222", padding: "1px 5px", borderRadius: 3, fontSize: 11, border: "1px solid #333" }}>n</kbd> or click "+ New playlist" to create one.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {playlists.map((p, i) => (
            <div
              key={p.id}
              ref={el => { cardRefs.current[i] = el; }}
              onClick={() => navigate(`/playlists/${p.id}`)}
              onMouseEnter={() => setFocused(i)}
              style={{
                background: "#141414",
                border: i === focused ? "2px solid var(--green)" : "2px solid transparent",
                borderRadius: 8, padding: "12px", cursor: "pointer",
                transition: "border-color 0.1s",
              }}
            >
              <ArtMosaic filenames={p.art_filenames ?? []} />
              <div style={{ fontSize: 14, fontWeight: 600, color: "#fff", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {p.name}
              </div>
              <div style={{ fontSize: 12, color: "#555" }}>
                {p.track_count} track{p.track_count !== 1 ? "s" : ""}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
