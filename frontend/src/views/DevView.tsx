import { useState, useRef, useCallback, useEffect } from "react";
import { API_BASE } from "../api/config";

// ── Constants ─────────────────────────────────────────────────────────────────

const MODES = ["Query", "jq", "Storage", "API", "Utilities", "Logs", "System"] as const;
type Mode = typeof MODES[number];

const HELP_HTML = `
<b>Sources</b><br>
&nbsp;&nbsp;log · albums · artists · tracks<br><br>
<b>Syntax</b><br>
&nbsp;&nbsp;source &nbsp;[where field op value [and field op value]] &nbsp;[show field, field] &nbsp;[limit N]<br><br>
<b>Operators</b><br>
&nbsp;&nbsp;= &nbsp; != &nbsp; > &nbsp; < &nbsp; >= &nbsp; <= &nbsp; contains &nbsp; not contains &nbsp; starts with<br><br>
<b>Albums fields</b><br>
&nbsp;&nbsp;album_name · artist · type · album_type · release_year · play_count · rating · favorited · notes · album_id<br><br>
<b>Artists fields</b><br>
&nbsp;&nbsp;name · play_count · genres · favorited<br><br>
<b>Tracks fields</b><br>
&nbsp;&nbsp;track_name · artist · album_name · play_count · favorited · track_id<br><br>
<b>Log fields</b><br>
&nbsp;&nbsp;played_at · artist · track_name · album_name · album_type · device_name · context_type · album_id · track_id<br><br>
<b>Examples</b><br>
&nbsp;&nbsp;albums where album_type = compilation<br>
&nbsp;&nbsp;albums where rating > 8 show album_name, artist, rating<br>
&nbsp;&nbsp;albums where favorited = true<br>
&nbsp;&nbsp;artists where genres contains rock show name, genres, play_count<br>
&nbsp;&nbsp;log where artist contains Radiohead limit 50<br>
&nbsp;&nbsp;tracks where favorited = true<br>
&nbsp;&nbsp;log where device_name = iPhone<br>
&nbsp;&nbsp;albums where rating > 8 and favorited = true<br>
`.trim();

// ── Styles ────────────────────────────────────────────────────────────────────

const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  height: 36,
  background: "#0d0d0d",
  color: "var(--green)",
  border: "1px solid #2a2a2a",
  borderRadius: 6,
  padding: "0 12px",
  fontSize: 13,
  fontFamily: '"Menlo", "Monaco", monospace',
  outline: "none",
  boxSizing: "border-box",
};

const TH_STYLE: React.CSSProperties = {
  background: "#0d0d0d",
  color: "var(--green)",
  borderBottom: "1px solid #222",
  padding: "6px 10px",
  fontSize: 11,
  fontWeight: 600,
  fontFamily: "monospace",
  textAlign: "left",
  whiteSpace: "nowrap",
  position: "sticky",
  top: 0,
  zIndex: 1,
};

const TD_STYLE: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 12,
  fontFamily: '"Menlo", "Monaco", monospace',
  whiteSpace: "nowrap",
  borderBottom: "1px solid #0f0f0f",
};

// ── Mode toggle ───────────────────────────────────────────────────────────────

function ModeBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        height: 30,
        padding: "0 16px",
        borderRadius: 15,
        border: active ? "1px solid var(--green)" : "none",
        background: active ? "#1a2a1a" : "var(--surface)",
        color: active ? "var(--green)" : "#666",
        fontSize: 13,
        fontWeight: active ? 700 : 500,
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

// ── Query panel ───────────────────────────────────────────────────────────────

interface QueryResult {
  records: Record<string, unknown>[];
  columns: string[];
  status: string;
  error: string | null;
}

function QueryPanel() {
  const [inputVal, setInputVal]   = useState("");
  const [result, setResult]       = useState<QueryResult | null>(null);
  const [loading, setLoading]     = useState(false);
  const [showHelp, setShowHelp]   = useState(false);
  const [statusMsg, setStatusMsg] = useState("Enter a query above to explore your data.");
  const [isError, setIsError]     = useState(false);
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef(-1);
  const inputRef   = useRef<HTMLInputElement>(null);

  const runQuery = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed && (historyRef.current.length === 0 || historyRef.current[historyRef.current.length - 1] !== trimmed)) {
      historyRef.current.push(trimmed);
    }
    histIdxRef.current = -1;

    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dev/query?q=${encodeURIComponent(trimmed)}`);
      const data: QueryResult = await res.json();
      if (data.error) {
        setStatusMsg(`⚠  ${data.error}`);
        setIsError(true);
        setResult(null);
      } else {
        setStatusMsg(data.status);
        setIsError(false);
        setResult(data);
      }
    } catch {
      setStatusMsg("⚠  Failed to reach backend");
      setIsError(true);
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { runQuery(""); }, [runQuery]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      runQuery(inputVal);
    } else if (e.key === "Escape") {
      setInputVal("");
      runQuery("");
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = historyRef.current;
      if (!h.length) return;
      const next = histIdxRef.current === -1 ? h.length - 1 : Math.max(0, histIdxRef.current - 1);
      histIdxRef.current = next;
      setInputVal(h[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const h = historyRef.current;
      const next = histIdxRef.current + 1;
      if (next >= h.length) {
        histIdxRef.current = -1;
        setInputVal("");
      } else {
        histIdxRef.current = next;
        setInputVal(h[next]);
      }
    }
  };

  const copyTsv = () => {
    if (!result) return;
    const lines = [result.columns.join("\t")];
    for (const row of result.records) {
      lines.push(result.columns.map(c => String(row[c] ?? "")).join("\t"));
    }
    navigator.clipboard.writeText(lines.join("\n"));
  };

  const cellColor = (val: unknown): string => {
    if (typeof val === "boolean") return val ? "var(--green)" : "#555";
    if (val === "" || val === null || val === undefined) return "#444";
    return "#ccc";
  };

  const cellText = (val: unknown): string => {
    if (typeof val === "boolean") return val ? "yes" : "no";
    if (val === "" || val === null || val === undefined) return "—";
    if (typeof val === "number" && val === Math.floor(val as number)) return String(Math.floor(val as number));
    return String(val);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "hidden" }}>
      {/* Input row */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          ref={inputRef}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={e => (e.target.style.borderColor = "var(--green)")}
          onBlur={e => (e.target.style.borderColor = "#2a2a2a")}
          placeholder="albums where rating > 8   ·   log where artist contains Radiohead   ·   artists where favorited = true"
          style={INPUT_STYLE}
          spellCheck={false}
          autoComplete="off"
        />
        <button
          onClick={() => setShowHelp(h => !h)}
          style={{
            width: 36, height: 36, flexShrink: 0,
            background: showHelp ? "#1a2a1a" : "var(--surface)",
            color: showHelp ? "var(--green)" : "#666",
            border: "none", borderRadius: 6,
            fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >?</button>
      </div>

      {/* Help panel */}
      {showHelp && (
        <div
          style={{
            background: "#0d0d0d", border: "1px solid #222", borderRadius: 6,
            padding: "12px 16px", fontSize: 11, color: "#555",
            fontFamily: '"Menlo", "Monaco", monospace', lineHeight: 1.6,
          }}
          dangerouslySetInnerHTML={{ __html: HELP_HTML }}
        />
      )}

      {/* Status row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: isError ? "#e05050" : "#444", flex: 1 }}>
          {loading ? "Running…" : statusMsg}
        </span>
        {result && result.records.length > 0 && (
          <button
            onClick={copyTsv}
            style={{
              height: 24, padding: "0 10px",
              background: "transparent", color: "#555",
              border: "1px solid #333", borderRadius: 4,
              fontSize: 11, cursor: "pointer",
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.color = "#ccc"; (e.target as HTMLElement).style.borderColor = "#666"; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.color = "#555"; (e.target as HTMLElement).style.borderColor = "#333"; }}
          >
            Copy as TSV
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto", background: "#0d0d0d", borderRadius: 4 }}>
        {result && result.records.length > 0 ? (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {result.columns.map(col => (
                  <th key={col} style={TH_STYLE}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.records.map((row, ri) => (
                <tr key={ri} style={{ background: ri % 2 === 0 ? "#0d0d0d" : "#111" }}>
                  {result.columns.map(col => (
                    <td key={col} style={{ ...TD_STYLE, color: cellColor(row[col]) }}>
                      {cellText(row[col])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !loading && result !== null && (
            <div style={{ padding: "16px 12px", color: "#444", fontSize: 12, fontFamily: "monospace" }}>
              No results.
            </div>
          )
        )}
      </div>
    </div>
  );
}

// ── jq helpers ────────────────────────────────────────────────────────────────

const JQ_FILES = ["listening_log", "library", "catalog", "lastfm_genres"] as const;
type JqFile = typeof JQ_FILES[number];

const JQ_EXAMPLES: Record<JqFile, string[]> = {
  listening_log: [
    ".[:5]",
    ".[:5] | .[] | {played_at, track_name, artist_names}",
    '[.[] | select(.artist_names | contains(["Radiohead"]))] | .[:5]',
    ".[] | select(.device_name != null) | {played_at, device_name, track_name}",
    "[.[] | .artist_names[]] | unique | sort",
    '[.[] | select(.album_type == "compilation")] | length',
  ],
  library: [
    ".albums | to_entries[] | select(.value.rating >= 18) | {id: .key, rating: .value.rating}",
    ".albums | to_entries[] | select(.value.favorited == true) | .key",
    ".artists | to_entries[] | select(.value.favorited == true) | .key",
    ".albums | length",
  ],
  catalog: [
    ". | keys",
    ". | keys | length",
    '.["ALBUM_ID"] | .tracks | to_entries[] | .value.track_name',
  ],
  lastfm_genres: [
    ". | keys | length",
    '. | to_entries[] | select(.value | contains(["emo"])) | .key',
    '.["Artist Name"]',
  ],
};

interface Bookmark { name: string; query: string; file: JqFile; }

async function fetchBookmarks(): Promise<Bookmark[]> {
  try {
    const res = await fetch(`${API_BASE}/api/dev/jq-bookmarks`);
    return await res.json();
  } catch { return []; }
}

async function persistBookmarks(bms: Bookmark[]): Promise<void> {
  await fetch(`${API_BASE}/api/dev/jq-bookmarks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(bms),
  });
}

// Single-pass JSON syntax highlighter
function highlightJson(raw: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < raw.length) {
    // String token
    if (raw[i] === '"') {
      const start = i++;
      while (i < raw.length) {
        if (raw[i] === "\\") { i += 2; continue; }
        if (raw[i] === '"') { i++; break; }
        i++;
      }
      const str = raw.slice(start, i);
      const isKey = /^\s*:/.test(raw.slice(i));
      nodes.push(<span key={key++} style={{ color: isKey ? "#9cdcfe" : "#ce9178" }}>{str}</span>);
    }
    // Number
    else if (/\d/.test(raw[i]) || (raw[i] === "-" && i + 1 < raw.length && /\d/.test(raw[i + 1]))) {
      const start = i;
      if (raw[i] === "-") i++;
      while (i < raw.length && /[\d.eE+\-]/.test(raw[i])) i++;
      nodes.push(<span key={key++} style={{ color: "#b5cea8" }}>{raw.slice(start, i)}</span>);
    }
    // true / false
    else if (raw.slice(i, i + 4) === "true"  && !/\w/.test(raw[i + 4] ?? "")) {
      nodes.push(<span key={key++} style={{ color: "#569cd6" }}>true</span>); i += 4;
    }
    else if (raw.slice(i, i + 5) === "false" && !/\w/.test(raw[i + 5] ?? "")) {
      nodes.push(<span key={key++} style={{ color: "#569cd6" }}>false</span>); i += 5;
    }
    // null
    else if (raw.slice(i, i + 4) === "null"  && !/\w/.test(raw[i + 4] ?? "")) {
      nodes.push(<span key={key++} style={{ color: "#808080" }}>null</span>); i += 4;
    }
    // Punctuation
    else if ("{}[],:".includes(raw[i])) {
      nodes.push(<span key={key++} style={{ color: "#666666" }}>{raw[i]}</span>); i++;
    }
    // Default (whitespace, plain text, etc.)
    else {
      const start = i;
      while (
        i < raw.length &&
        raw[i] !== '"' &&
        !"{}[],:".includes(raw[i]) &&
        !/\d/.test(raw[i]) &&
        !(raw[i] === "-" && /\d/.test(raw[i + 1] ?? "")) &&
        raw.slice(i, i + 4) !== "true" &&
        raw.slice(i, i + 5) !== "false" &&
        raw.slice(i, i + 4) !== "null"
      ) i++;
      if (i > start) nodes.push(<span key={key++} style={{ color: "#d4d4d4" }}>{raw.slice(start, i)}</span>);
    }
  }
  return nodes;
}

// ── jq panel ──────────────────────────────────────────────────────────────────

function JqPanel() {
  const [file, setFile]           = useState<JqFile>("listening_log");
  const [inputVal, setInputVal]   = useState("");
  const [fileState, setFileState] = useState<Partial<Record<JqFile, string>>>({});
  const [output, setOutput]       = useState("");
  const [statusMsg, setStatusMsg] = useState("Select a file, enter a jq expression, press Enter.");
  const [isError, setIsError]     = useState(false);
  const [showHelp, setShowHelp]   = useState(false);
  const [showBm, setShowBm]       = useState(false);
  const [savingName, setSavingName] = useState("");
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const historyRef  = useRef<string[]>([]);

  useEffect(() => { fetchBookmarks().then(setBookmarks); }, []);
  const histIdxRef  = useRef(-1);
  const bmBtnRef    = useRef<HTMLButtonElement>(null);

  const runJq = useCallback(async (expr: string, currentFile: JqFile) => {
    if (!expr.trim()) {
      setOutput("");
      setStatusMsg("Select a file, enter a jq expression, press Enter.");
      setIsError(false);
      return;
    }
    if (!historyRef.current.length || historyRef.current[historyRef.current.length - 1] !== expr) {
      historyRef.current.push(expr);
    }
    histIdxRef.current = -1;
    try {
      const res = await fetch(
        `${API_BASE}/api/dev/jq?file=${encodeURIComponent(currentFile)}&expr=${encodeURIComponent(expr)}`
      );
      const data = await res.json();
      if (data.error) {
        setOutput(`jq error:\n${data.error}`);
        setStatusMsg("jq error — check expression");
        setIsError(true);
      } else {
        setOutput(data.output);
        setStatusMsg(`${data.lines} line${data.lines !== 1 ? "s" : ""}`);
        setIsError(false);
      }
    } catch {
      setOutput("");
      setStatusMsg("⚠  Failed to reach backend");
      setIsError(true);
    }
  }, []);

  const switchFile = (next: JqFile) => {
    setFileState(s => ({ ...s, [file]: inputVal }));
    setFile(next);
    const saved = fileState[next] ?? "";
    setInputVal(saved);
    if (saved) runJq(saved, next);
    else { setOutput(""); setStatusMsg("Select a file, enter a jq expression, press Enter."); setIsError(false); }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { runJq(inputVal, file); }
    else if (e.key === "Escape") { setInputVal(""); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = historyRef.current;
      if (!h.length) return;
      const next = histIdxRef.current === -1 ? h.length - 1 : Math.max(0, histIdxRef.current - 1);
      histIdxRef.current = next; setInputVal(h[next]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = histIdxRef.current + 1;
      if (next >= historyRef.current.length) { histIdxRef.current = -1; setInputVal(""); }
      else { histIdxRef.current = next; setInputVal(historyRef.current[next]); }
    }
  };

  const saveBookmark = (name: string) => {
    if (!name.trim()) return;
    const updated = [...bookmarks, { name: name.trim(), query: inputVal, file }];
    setBookmarks(updated); persistBookmarks(updated);
    setSavingName(""); setShowSaveInput(false);
  };

  const deleteBookmark = (idx: number) => {
    const updated = bookmarks.filter((_, i) => i !== idx);
    setBookmarks(updated); persistBookmarks(updated);
  };

  const loadBookmark = (bm: Bookmark) => {
    if (bm.file !== file) switchFile(bm.file);
    setInputVal(bm.query);
    runJq(bm.query, bm.file);
    setShowBm(false);
  };

  const fileBtnStyle = (f: JqFile): React.CSSProperties => ({
    height: 28, padding: "0 14px", borderRadius: 14,
    border: f === file ? "1px solid var(--green)" : "none",
    background: f === file ? "#1a2a1a" : "var(--surface)",
    color: f === file ? "var(--green)" : "#666",
    fontSize: 12, fontWeight: f === file ? 700 : 400,
    cursor: "pointer",
  });

  const helpHtml = `<b>Examples for ${file}</b><br>` +
    JQ_EXAMPLES[file].map(e => `&nbsp;&nbsp;${e.replace(/</g, "&lt;")}<br>`).join("");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "hidden" }}>
      {/* File picker */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {JQ_FILES.map(f => (
          <button key={f} onClick={() => switchFile(f)} style={fileBtnStyle(f)}>
            {f.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      {/* Input row */}
      <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
        <input
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={e => (e.target.style.borderColor = "var(--green)")}
          onBlur={e => (e.target.style.borderColor = "#2a2a2a")}
          placeholder='.[:10]   ·   .[] | select(.artist_names[] | contains("..."))'
          style={INPUT_STYLE}
          spellCheck={false}
          autoComplete="off"
        />
        {/* Bookmarks */}
        <div style={{ position: "relative" }}>
          <button
            ref={bmBtnRef}
            onClick={() => { setShowBm(v => !v); setShowSaveInput(false); setSavingName(""); }}
            style={{
              width: 36, height: 36, flexShrink: 0,
              background: showBm ? "#1a2a1a" : "var(--surface)",
              color: showBm ? "var(--green)" : "#666",
              border: "none", borderRadius: 6, fontSize: 14, cursor: "pointer",
            }}
          >☆</button>
          {showBm && (
            <div style={{
              position: "absolute", top: 40, right: 0, zIndex: 200,
              background: "#141414", border: "1px solid #2a2a2a", borderRadius: 8,
              width: 300, boxShadow: "0 8px 32px rgba(0,0,0,0.6)", padding: 8,
              display: "flex", flexDirection: "column", gap: 4,
            }}>
              {showSaveInput ? (
                <div style={{ display: "flex", gap: 4 }}>
                  <input
                    autoFocus
                    value={savingName}
                    onChange={e => setSavingName(e.target.value)}
                    onKeyDown={e => {
                      e.stopPropagation();
                      if (e.key === "Enter") saveBookmark(savingName);
                      if (e.key === "Escape") { setShowSaveInput(false); setSavingName(""); }
                    }}
                    placeholder="Query name…"
                    style={{
                      flex: 1, height: 28, background: "#0d0d0d", border: "1px solid #2a2a2a",
                      borderRadius: 5, color: "#fff", fontSize: 12, padding: "0 8px", outline: "none",
                    }}
                  />
                  <button
                    onClick={() => saveBookmark(savingName)}
                    style={{
                      height: 28, padding: "0 10px", background: "#1a2a1a", color: "var(--green)",
                      border: "1px solid var(--green)", borderRadius: 5, fontSize: 12, cursor: "pointer",
                    }}
                  >Save</button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSaveInput(true)}
                  style={{
                    height: 28, background: "#1a1a1a", color: "var(--green)",
                    border: "1px solid #2a2a2a", borderRadius: 5, fontSize: 12,
                    fontWeight: 700, cursor: "pointer", textAlign: "left", padding: "0 8px",
                  }}
                >＋  Save current query…</button>
              )}
              {bookmarks.length > 0 && <div style={{ height: 1, background: "#2a2a2a" }} />}
              {bookmarks.map((bm, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    onClick={() => loadBookmark(bm)}
                    style={{
                      flex: 1, height: 26, background: "transparent", color: "#ccc",
                      border: "none", fontSize: 12, textAlign: "left", padding: "0 6px",
                      cursor: "pointer",
                    }}
                  >{bm.name}</button>
                  <button
                    onClick={() => deleteBookmark(i)}
                    style={{
                      width: 22, height: 22, background: "transparent", color: "#555",
                      border: "none", fontSize: 10, cursor: "pointer", borderRadius: 4,
                    }}
                  >✕</button>
                </div>
              ))}
              {bookmarks.length === 0 && (
                <span style={{ color: "#444", fontSize: 11, padding: "4px 6px" }}>No saved queries yet.</span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => setShowHelp(h => !h)}
          style={{
            width: 36, height: 36, flexShrink: 0,
            background: showHelp ? "#1a2a1a" : "var(--surface)",
            color: showHelp ? "var(--green)" : "#666",
            border: "none", borderRadius: 6, fontSize: 14, fontWeight: 700, cursor: "pointer",
          }}
        >?</button>
      </div>

      {/* Help panel */}
      {showHelp && (
        <div
          style={{
            background: "#0d0d0d", border: "1px solid #222", borderRadius: 6,
            padding: "12px 16px", fontSize: 11, color: "#555",
            fontFamily: '"Menlo", "Monaco", monospace', lineHeight: 1.6, flexShrink: 0,
          }}
          dangerouslySetInnerHTML={{ __html: helpHtml }}
        />
      )}

      {/* Status row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: isError ? "#e05050" : "#444", flex: 1 }}>
          {statusMsg}
        </span>
        {output && !isError && (
          <button
            onClick={() => navigator.clipboard.writeText(output)}
            style={{
              height: 24, padding: "0 10px", background: "transparent", color: "#555",
              border: "1px solid #333", borderRadius: 4, fontSize: 11, cursor: "pointer",
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.color = "#ccc"; (e.target as HTMLElement).style.borderColor = "#666"; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.color = "#555"; (e.target as HTMLElement).style.borderColor = "#333"; }}
          >Copy</button>
        )}
      </div>

      {/* Output */}
      <div style={{ flex: 1, overflow: "auto", background: "#0d0d0d", borderRadius: 4, padding: 8 }}>
        <pre style={{ margin: 0, fontSize: 12, fontFamily: '"Menlo", "Monaco", monospace', lineHeight: 1.5 }}>
          {output ? highlightJson(output) : null}
        </pre>
      </div>
    </div>
  );
}

// ── Storage panel ─────────────────────────────────────────────────────────────

interface StorageRow { name: string; bytes: number; size: string; share: number; color: string; }
interface StorageData {
  summary: string;
  data_rows: StorageRow[];
  data_total: string;
  system_rows: StorageRow[];
  system_total: string;
}

function DonutChart({ rows, total, label }: { rows: StorageRow[]; total: string; label: string }) {
  const R = 100, cx = 120, cy = 120, size = 240;
  const holeR = R * 0.46;
  const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);

  if (totalBytes === 0) return (
    <svg width={size} height={size}>
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="middle" fill="#444" fontSize={12}>No data</text>
    </svg>
  );

  // Build arc paths (clockwise from 12 o'clock)
  let angle = -Math.PI / 2;
  const slices = rows.filter(r => r.bytes > 0).map(r => {
    const span = (r.bytes / totalBytes) * 2 * Math.PI;
    const a0 = angle, a1 = angle + span;
    angle = a1;
    const x0 = cx + R * Math.cos(a0), y0 = cy + R * Math.sin(a0);
    const x1 = cx + R * Math.cos(a1), y1 = cy + R * Math.sin(a1);
    const ix0 = cx + holeR * Math.cos(a0), iy0 = cy + holeR * Math.sin(a0);
    const ix1 = cx + holeR * Math.cos(a1), iy1 = cy + holeR * Math.sin(a1);
    const large = span > Math.PI ? 1 : 0;
    const d = `M ${ix0} ${iy0} L ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1} L ${ix1} ${iy1} A ${holeR} ${holeR} 0 ${large} 0 ${ix0} ${iy0} Z`;
    return { d, color: r.color };
  });

  return (
    <svg width={size} height={size}>
      {slices.map((s, i) => <path key={i} d={s.d} fill={s.color} stroke="#0d0d0d" strokeWidth={2} />)}
      <circle cx={cx} cy={cy} r={holeR - 1} fill="#0d0d0d" />
      <text x={cx} y={cy - 10} textAnchor="middle" fill="#fff" fontSize={13} fontWeight={700} fontFamily="Menlo, Monaco, monospace">{label}</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill="var(--green)" fontSize={12} fontFamily="Menlo, Monaco, monospace">{total}</text>
    </svg>
  );
}

function StorageTable({ rows }: { rows: StorageRow[] }) {
  return (
    <div style={{ flex: 1, overflow: "auto", background: "#0d0d0d", borderRadius: 4 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["name","size","share"].map(h => <th key={h} style={TH_STYLE}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? "#0d0d0d" : "#111" }}>
              <td style={{ ...TD_STYLE, color: row.color }}>{row.name}</td>
              <td style={{ ...TD_STYLE, color: "var(--green)" }}>{row.size}</td>
              <td style={{ ...TD_STYLE, color: "#ccc" }}>{row.share.toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StoragePanel() {
  const [data, setData]       = useState<StorageData | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dev/storage`);
      setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "hidden" }}>
      {/* Summary row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#444", flex: 1 }}>
          {loading ? "Calculating storage footprint…" : (data?.summary ?? "—")}
        </span>
        <button
          onClick={refresh}
          style={{
            height: 24, padding: "0 10px", background: "transparent", color: "#555",
            border: "1px solid #333", borderRadius: 4, fontSize: 11, cursor: "pointer",
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = "#ccc"; (e.target as HTMLElement).style.borderColor = "#666"; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = "#555"; (e.target as HTMLElement).style.borderColor = "#333"; }}
        >Refresh</button>
      </div>

      {/* Two sections */}
      {data && (
        <div style={{ flex: 1, display: "flex", gap: 20, overflow: "hidden" }}>
          {/* Data */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
            <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>Data</span>
            <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>Your saved app data footprint</span>
            <DonutChart rows={data.data_rows} total={data.data_total} label="Data" />
            <StorageTable rows={data.data_rows} />
          </div>
          {/* System */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8, overflow: "hidden" }}>
            <span style={{ color: "#fff", fontSize: 14, fontWeight: 700, flexShrink: 0 }}>System</span>
            <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>Repo + runtime footprint outside saved data</span>
            <DonutChart rows={data.system_rows} total={data.system_total} label="System" />
            <StorageTable rows={data.system_rows} />
          </div>
        </div>
      )}
      <span style={{ color: "#444", fontSize: 10, flexShrink: 0 }}>
        Data shows what grows with usage. System shows environment and code footprint like .venv and .git.
      </span>
    </div>
  );
}

// ── API panel ─────────────────────────────────────────────────────────────────

type ApiScope = "all" | "7d" | "today" | "session";

interface PartnerRow {
  service: string;
  calls: number;
  errors: number;
  avg_ms: number;
  last_status: string;
  color: string;
}

interface OperationRow {
  service: string;
  operation: string;
  method: string;
  calls: number;
  errors: number;
  avg_ms: number;
  last_status: string;
}

interface ErrorEvent {
  timestamp: string;
  service: string;
  operation: string;
  status: string | number;
  error_body: string;
}

interface ApiMetrics {
  summary: string;
  partner_rows: PartnerRow[];
  operation_rows: OperationRow[];
  error_events: ErrorEvent[];
}

const API_SCOPES: { key: ApiScope; label: string }[] = [
  { key: "all",     label: "All"     },
  { key: "7d",      label: "7d"      },
  { key: "today",   label: "Today"   },
  { key: "session", label: "Session" },
];

function ApiBars({ rows }: { rows: PartnerRow[] }) {
  const maxCalls = Math.max(1, ...rows.map(r => r.calls));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 240 }}>
      {rows.map(r => (
        <div key={r.service} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 72, fontSize: 11, fontFamily: "monospace",
            color: r.color, textAlign: "right", flexShrink: 0, overflow: "hidden",
            textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{r.service}</span>
          <div style={{ flex: 1, height: 10, background: "#1a1a1a", borderRadius: 3, overflow: "hidden" }}>
            <div style={{
              width: `${(r.calls / maxCalls) * 100}%`,
              height: "100%", background: r.color, borderRadius: 3,
              transition: "width 0.3s",
            }} />
          </div>
          <span style={{ width: 36, fontSize: 11, fontFamily: "monospace", color: "var(--green)", flexShrink: 0 }}>
            {r.calls}
          </span>
        </div>
      ))}
    </div>
  );
}

function ApiPanel() {
  const [scope, setScope] = useState<ApiScope>("all");
  const [data, setData]   = useState<ApiMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const sessionStartRef = useRef(new Date().toISOString());

  const refresh = useCallback(async (s: ApiScope) => {
    setLoading(true);
    try {
      const since = s === "session" ? `&since=${encodeURIComponent(sessionStartRef.current)}` : "";
      const res = await fetch(`${API_BASE}/api/dev/api-metrics?scope=${s}${since}`);
      setData(await res.json());
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { refresh(scope); }, [refresh, scope]);

  const scopeBtnStyle = (s: ApiScope): React.CSSProperties => ({
    height: 28, padding: "0 14px", borderRadius: 14,
    border: s === scope ? "1px solid var(--green)" : "none",
    background: s === scope ? "#1a2a1a" : "var(--surface)",
    color: s === scope ? "var(--green)" : "#666",
    fontSize: 12, fontWeight: s === scope ? 700 : 400, cursor: "pointer",
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, flex: 1, overflow: "hidden" }}>
      {/* Scope + refresh */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        {API_SCOPES.map(({ key, label }) => (
          <button key={key} onClick={() => setScope(key)} style={scopeBtnStyle(key)}>{label}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={() => refresh(scope)}
          style={{
            height: 24, padding: "0 10px", background: "transparent", color: "#555",
            border: "1px solid #333", borderRadius: 4, fontSize: 11, cursor: "pointer",
          }}
          onMouseEnter={e => { (e.target as HTMLElement).style.color = "#ccc"; (e.target as HTMLElement).style.borderColor = "#666"; }}
          onMouseLeave={e => { (e.target as HTMLElement).style.color = "#555"; (e.target as HTMLElement).style.borderColor = "#333"; }}
        >Refresh</button>
      </div>

      {/* Summary */}
      <span style={{ fontSize: 11, fontFamily: "monospace", color: "#444", flexShrink: 0 }}>
        {loading ? "Loading…" : (data?.summary ?? "—")}
      </span>

      {data && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>
          {/* Top row: bars + partner table */}
          <div style={{ display: "flex", gap: 20, alignItems: "flex-start", flexShrink: 0 }}>
            {data.partner_rows.length > 0 && <ApiBars rows={data.partner_rows} />}
            <div style={{ flex: 1, background: "#0d0d0d", borderRadius: 4, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["service","calls","errors","avg ms","last status"].map(h => (
                      <th key={h} style={TH_STYLE}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.partner_rows.map((row, ri) => (
                    <tr key={ri} style={{ background: row.errors > 0 ? "#ff6b6b12" : ri % 2 === 0 ? "#0d0d0d" : "#111" }}>
                      <td style={{ ...TD_STYLE, color: row.color }}>{row.service}</td>
                      <td style={{ ...TD_STYLE, color: "var(--green)" }}>{row.calls}</td>
                      <td style={{ ...TD_STYLE, color: row.errors > 0 ? "#ff6b6b" : "#444" }}>{row.errors}</td>
                      <td style={{ ...TD_STYLE, color: "#ccc" }}>{row.avg_ms}</td>
                      <td style={{ ...TD_STYLE, color: "#555" }}>{row.last_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Operations table */}
          <div style={{ flexShrink: 0 }}>
            <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, display: "block", marginBottom: 6 }}>Operations</span>
            <div style={{ background: "#0d0d0d", borderRadius: 4, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {["service","operation","method","calls","errors","avg ms","last status"].map(h => (
                      <th key={h} style={TH_STYLE}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.operation_rows.map((row, ri) => (
                    <tr key={ri} style={{ background: row.errors > 0 ? "#ff6b6b12" : ri % 2 === 0 ? "#0d0d0d" : "#111" }}>
                      <td style={{ ...TD_STYLE, color: "#8ecae6" }}>{row.service}</td>
                      <td style={{ ...TD_STYLE, color: "#ccc" }}>{row.operation}</td>
                      <td style={{ ...TD_STYLE, color: "#555" }}>{row.method}</td>
                      <td style={{ ...TD_STYLE, color: "var(--green)" }}>{row.calls}</td>
                      <td style={{ ...TD_STYLE, color: row.errors > 0 ? "#ff6b6b" : "#444" }}>{row.errors}</td>
                      <td style={{ ...TD_STYLE, color: "#ccc" }}>{row.avg_ms}</td>
                      <td style={{ ...TD_STYLE, color: "#555" }}>{row.last_status}</td>
                    </tr>
                  ))}
                  {data.operation_rows.length === 0 && (
                    <tr>
                      <td colSpan={7} style={{ ...TD_STYLE, color: "#444", textAlign: "center", padding: "12px 10px" }}>
                        No operations logged yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Error events */}
          {data.error_events?.length > 0 && (
            <div style={{ flexShrink: 0 }}>
              <span style={{ color: "#ff6b6b", fontSize: 13, fontWeight: 700, display: "block", marginBottom: 6 }}>
                Recent Errors ({data.error_events.length})
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {data.error_events.map((ev, i) => (
                  <div key={i} style={{
                    background: "#1a0a0a", border: "1px solid #ff6b6b22",
                    borderRadius: 6, padding: "8px 12px",
                  }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: ev.error_body ? 4 : 0 }}>
                      <span style={{ color: "#ff6b6b", fontFamily: "monospace", fontSize: 12, fontWeight: 700 }}>{ev.status}</span>
                      <span style={{ color: "#c4a96e", fontSize: 12 }}>{ev.service}</span>
                      <span style={{ color: "#888", fontSize: 12 }}>{ev.operation}</span>
                      <span style={{ color: "#444", fontSize: 11, marginLeft: "auto" }}>{ev.timestamp}</span>
                    </div>
                    {ev.error_body && (
                      <div style={{
                        fontFamily: "monospace", fontSize: 11, color: "#ff9999",
                        background: "#110808", borderRadius: 4, padding: "4px 8px",
                        whiteSpace: "pre-wrap", wordBreak: "break-all",
                      }}>{ev.error_body}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Utilities panel ───────────────────────────────────────────────────────────

const VINYL_COLOR = "#c4a96e";

interface VinylSide {
  release_id: number;
  title: string;
  artists: string[];
  year: number | null;
  labels: string[];
  art_url: string | null;
}

interface AlbumSide {
  album_id: string;
  album_name: string;
  artist: string;
  release_year: number | null;
  art_url: string | null;
}

interface VinylCandidate {
  vinyl: VinylSide;
  album: AlbumSide;
  artist_sim: number;
  title_sim: number;
  confidence: number;
}

function ReviewDialog({
  candidates,
  startIdx,
  onClose,
}: {
  candidates: VinylCandidate[];
  startIdx: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIdx);

  const advance = () => {
    if (idx + 1 >= candidates.length) { onClose(); return; }
    setIdx(idx + 1);
  };

  const link = async () => {
    const c = candidates[idx];
    await fetch(`${API_BASE}/api/dev/vinyl-matcher/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release_id: c.vinyl.release_id, album_id: c.album.album_id }),
    });
    advance();
  };

  const skip = () => advance();

  const dismiss = async () => {
    const c = candidates[idx];
    await fetch(`${API_BASE}/api/dev/vinyl-matcher/dismiss`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ release_id: c.vinyl.release_id, album_id: c.album.album_id }),
    });
    advance();
  };

  if (idx >= candidates.length) return null;
  const c = candidates[idx];
  const pct = Math.round(c.confidence * 100);
  const aPct = Math.round(c.artist_sim * 100);
  const tPct = Math.round(c.title_sim * 100);

  const colStyle: React.CSSProperties = {
    flex: 1, display: "flex", flexDirection: "column", gap: 6,
  };
  const artStyle: React.CSSProperties = {
    width: 80, height: 80, borderRadius: 4, objectFit: "cover",
    background: "#1a1a1a", flexShrink: 0,
  };
  const artPlaceholder: React.CSSProperties = {
    ...artStyle, display: "flex", alignItems: "center", justifyContent: "center",
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 1000,
      background: "rgba(0,0,0,0.72)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--surface)", borderRadius: 12,
        padding: "24px", minWidth: 580, maxWidth: 680,
        display: "flex", flexDirection: "column", gap: 16,
        boxShadow: "0 16px 64px rgba(0,0,0,0.7)",
      }}>
        {/* Progress */}
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#555" }}>
          {idx + 1} of {candidates.length}
        </span>

        {/* Card */}
        <div style={{
          background: "var(--card)", borderRadius: 8,
          padding: "16px 20px", display: "flex", gap: 24,
        }}>
          {/* Vinyl side */}
          <div style={colStyle}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: VINYL_COLOR }}>VINYL</span>
            {c.vinyl.art_url
              ? <img src={`${API_BASE}${c.vinyl.art_url}`} style={artStyle} alt="" />
              : <div style={artPlaceholder} />
            }
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>{c.vinyl.title}</span>
            <span style={{ fontSize: 12, color: "#888" }}>{c.vinyl.artists.join(", ")}</span>
            <span style={{ fontSize: 11, color: "#555" }}>
              {[c.vinyl.year, c.vinyl.labels.join(" · ")].filter(Boolean).join("  ")}
            </span>
          </div>

          {/* Divider */}
          <div style={{ width: 1, background: "#333", flexShrink: 0 }} />

          {/* Album side */}
          <div style={colStyle}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: "var(--green)" }}>SPOTIFY ALBUM</span>
            {c.album.art_url
              ? <img src={`${API_BASE}${c.album.art_url}`} style={artStyle} alt="" />
              : <div style={artPlaceholder} />
            }
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff", lineHeight: 1.3 }}>{c.album.album_name}</span>
            <span style={{ fontSize: 12, color: "#888" }}>{c.album.artist}</span>
            <span style={{ fontSize: 11, color: "#555" }}>{c.album.release_year ?? ""}</span>
          </div>
        </div>

        {/* Confidence */}
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "#555", textAlign: "center" }}>
          Confidence {pct}%  ·  artist {aPct}%  ·  title {tPct}%
        </span>

        {/* Buttons */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={link}
            style={{
              height: 34, padding: "0 20px", borderRadius: 17,
              border: "none", background: VINYL_COLOR, color: "#1a1000",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >✓  Link</button>
          <button
            onClick={skip}
            style={{
              height: 34, padding: "0 20px", borderRadius: 17,
              border: "none", background: "var(--surface)", color: "#888",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >↷  Skip</button>
          <button
            onClick={dismiss}
            style={{
              height: 34, padding: "0 20px", borderRadius: 17,
              border: "none", background: "var(--surface)", color: "#555",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
            }}
          >✕  Never match</button>
        </div>
      </div>
    </div>
  );
}

interface BackupStat { label: string; total: number; diff: number | null; always: boolean; }
interface BackupStatus { last_run: string | null; success: boolean | null; stats: BackupStat[]; }

function BackupStatusBar() {
  const [data, setData] = useState<BackupStatus | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/dev/backup-status`)
      .then(r => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const statusColor = data?.success === true ? "var(--green)" : data?.success === false ? "#ff6b6b" : "#555";
  const statusLabel = data?.success === true ? "✓ OK" : data?.success === false ? "✗ Failed" : "–";

  return (
    <div style={{
      flexShrink: 0, background: "#0d0d0d", border: "1px solid #1e1e1e",
      borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", letterSpacing: "0.04em" }}>BACKUP</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: statusColor }}>{statusLabel}</span>
        {data?.last_run && (
          <span style={{ fontSize: 10, color: "#444", fontFamily: "monospace", marginLeft: 4 }}>{data.last_run}</span>
        )}
      </div>
      {data?.stats && data.stats.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 20px" }}>
          {data.stats.map(s => {
            const diffColor = s.diff === null ? "#555" : s.diff > 0 ? "var(--green)" : s.diff < 0 ? "#ff6b6b" : "#444";
            const diffStr   = s.diff === null ? "" : s.diff > 0 ? `+${s.diff}` : String(s.diff);
            return (
              <span key={s.label} style={{ fontSize: 11, color: "#666", fontFamily: "monospace", whiteSpace: "nowrap" }}>
                <span style={{ color: "#888" }}>{s.label}: </span>
                {diffStr && <span style={{ color: diffColor, fontWeight: 700 }}>{diffStr} </span>}
                <span style={{ color: "#555" }}>({s.total.toLocaleString()})</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

const SPOTIFY_COLOR = "#1DB954";

function SpotifyAuthTest() {
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const simulate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/auth/simulate-expired`, { method: "POST" });
      if (!res.ok) throw new Error();
      setStatus("needs_reauth flag set — the desktop reconnect banner should appear within a minute.");
    } catch {
      setStatus("⚠  Failed to reach backend");
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ background: "var(--card)", borderRadius: 8, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Spotify Auth</span>
      <span style={{ fontSize: 12, color: "#888", lineHeight: 1.5, maxWidth: 480 }}>
        Force the app into the "needs reconnect" state without waiting for a real refresh
        token to expire — lets you exercise the full reconnect flow (banner → Spotify
        popup → token exchange) end to end.
      </span>
      {status && (
        <span style={{ fontSize: 11, color: status.startsWith("⚠") ? "#555" : SPOTIFY_COLOR, fontWeight: 700 }}>
          {status}
        </span>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          onClick={simulate}
          disabled={loading}
          style={{
            height: 32, padding: "0 18px", borderRadius: 16,
            border: "none", background: loading ? "#0f7a38" : SPOTIFY_COLOR,
            color: "#04170b", fontSize: 12, fontWeight: 700,
            cursor: loading ? "default" : "pointer",
          }}
        >{loading ? "Working…" : "Force reauth (testing)"}</button>
      </div>
    </div>
  );
}

function UtilitiesPanel() {
  const [status, setStatus]           = useState<string | null>(null);
  const [statusGold, setStatusGold]   = useState(false);
  const [candidates, setCandidates]   = useState<VinylCandidate[] | null>(null);
  const [loading, setLoading]         = useState(false);
  const [reviewing, setReviewing]     = useState(false);

  const findMatches = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/dev/vinyl-matcher/candidates`);
      const data = await res.json();
      if (data.status === "no_vinyl") {
        setStatus("No vinyl collection found — sync first."); setStatusGold(false); setCandidates(null);
      } else if (data.status === "no_albums") {
        setStatus("No album data — load the app fully first."); setStatusGold(false); setCandidates(null);
      } else if (data.candidates.length === 0) {
        setStatus("No unreviewed candidates found."); setStatusGold(false); setCandidates(null);
      } else {
        const n = data.candidates.length;
        setStatus(`${n} candidate${n !== 1 ? "s" : ""} found.`);
        setStatusGold(true);
        setCandidates(data.candidates);
      }
    } catch {
      setStatus("⚠  Failed to reach backend"); setStatusGold(false); setCandidates(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const n = candidates?.length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1, overflow: "auto" }}>
      {/* Vinyl Matcher section */}
      <div style={{ background: "var(--card)", borderRadius: 8, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Vinyl Matcher</span>
        <span style={{ fontSize: 12, color: "#888", lineHeight: 1.5, maxWidth: 480 }}>
          Cross-reference your vinyl collection against Spotify albums.
          Strips edition suffixes (Remastered, Deluxe, etc.) before matching,
          then asks you to confirm or dismiss each candidate pair.
        </span>
        {status && (
          <span style={{ fontSize: 11, color: statusGold ? VINYL_COLOR : "#555", fontWeight: statusGold ? 700 : 400 }}>
            {status}
          </span>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            onClick={findMatches}
            disabled={loading}
            style={{
              height: 32, padding: "0 18px", borderRadius: 16,
              border: "none", background: loading ? "#8a7040" : VINYL_COLOR,
              color: "#1a1000", fontSize: 12, fontWeight: 700,
              cursor: loading ? "default" : "pointer",
            }}
          >{loading ? "Searching…" : "Find Matches"}</button>
          {candidates && n > 0 && (
            <button
              onClick={() => setReviewing(true)}
              style={{
                height: 32, padding: "0 18px", borderRadius: 16,
                border: `1px solid ${VINYL_COLOR}`, background: "transparent",
                color: VINYL_COLOR, fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >Review {n} Candidate{n !== 1 ? "s" : ""}</button>
          )}
        </div>
      </div>

      {reviewing && candidates && (
        <ReviewDialog
          candidates={candidates}
          startIdx={0}
          onClose={() => { setReviewing(false); findMatches(); }}
        />
      )}

      <GenreConsolidation />
      <SpotifyAuthTest />
    </div>
  );
}

// ── Genre Consolidation ───────────────────────────────────────────────────────

interface GenreVariant { genre: string; count: number; }
interface GenreCluster {
  variants: GenreVariant[];
  suggested_canonical: string;
  confidence: "high" | "medium";
}

function GenreConsolidation() {
  const [clusters, setClusters] = useState<GenreCluster[] | null>(null);
  const [existingAliases, setExistingAliases] = useState<Record<string, string>>({});
  const [dismissalCount, setDismissalCount] = useState(0);
  // per-cluster local variant lists (chips removed by ×)
  const [localVariants, setLocalVariants] = useState<Record<number, GenreVariant[]>>({});
  const [canonicals, setCanonicals] = useState<Record<number, string>>({});
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const findClusters = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/dev/genre-consolidation/clusters`);
      const data = await res.json();
      setClusters(data.clusters);
      setExistingAliases(data.existing_aliases ?? {});
      setDismissalCount(data.dismissal_count ?? 0);
      const initCanonicals: Record<number, string> = {};
      const initVariants: Record<number, GenreVariant[]> = {};
      (data.clusters as GenreCluster[]).forEach((c, i) => {
        initCanonicals[i] = c.suggested_canonical;
        initVariants[i] = c.variants;
      });
      setCanonicals(initCanonicals);
      setLocalVariants(initVariants);
      setStatus(data.clusters.length === 0 ? "No duplicate genres found." : null);
    } catch {
      setStatus("⚠  Failed to reach backend");
    } finally {
      setLoading(false);
    }
  };

  const removeCluster = (i: number) => {
    setClusters(prev => prev ? prev.filter((_, j) => j !== i) : prev);
    setCanonicals(prev => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
    setLocalVariants(prev => {
      const next: Record<number, GenreVariant[]> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
  };

  const mergeOne = async (i: number) => {
    if (!clusters) return;
    setBusyIdx(i);
    const variants = localVariants[i] ?? clusters[i].variants;
    const canonical = canonicals[i] ?? clusters[i].suggested_canonical;
    const aliases: Record<string, string> = { ...existingAliases };
    variants.forEach(v => { if (v.genre !== canonical) aliases[v.genre] = canonical; });
    try {
      await fetch(`${API_BASE}/api/dev/genre-consolidation/aliases`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aliases }),
      });
      setExistingAliases(aliases);
      removeCluster(i);
    } catch {
      setStatus("⚠  Failed to save");
    } finally {
      setBusyIdx(null);
    }
  };

  const dismissOne = async (i: number) => {
    if (!clusters) return;
    setBusyIdx(i);
    const variants = localVariants[i] ?? clusters[i].variants;
    try {
      await fetch(`${API_BASE}/api/dev/genre-consolidation/dismiss`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genres: variants.map(v => v.genre) }),
      });
      setDismissalCount(n => n + 1);
      removeCluster(i);
    } catch {
      setStatus("⚠  Failed to save");
    } finally {
      setBusyIdx(null);
    }
  };

  // Remove a single chip, dismiss it against the remaining variants
  const removeChip = async (clusterIdx: number, genre: string) => {
    const variants = localVariants[clusterIdx] ?? clusters![clusterIdx].variants;
    const remaining = variants.filter(v => v.genre !== genre);
    // Dismiss the removed genre against all remaining
    if (remaining.length >= 1) {
      await fetch(`${API_BASE}/api/dev/genre-consolidation/dismiss`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genres: [genre, ...remaining.map(v => v.genre)] }),
      });
      setDismissalCount(n => n + 1);
    }
    if (remaining.length < 2) {
      removeCluster(clusterIdx);
    } else {
      setLocalVariants(prev => ({ ...prev, [clusterIdx]: remaining }));
      // If we just removed the canonical, reset it to the top remaining
      if ((canonicals[clusterIdx] ?? clusters![clusterIdx].suggested_canonical) === genre) {
        setCanonicals(prev => ({ ...prev, [clusterIdx]: remaining[0].genre }));
      }
    }
  };

  return (
    <div style={{ background: "var(--card)", borderRadius: 8, padding: "16px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#fff" }}>Genre Consolidation</span>
        {Object.keys(existingAliases).length > 0 && (
          <span style={{ fontSize: 11, color: "#555" }}>{Object.keys(existingAliases).length} aliases</span>
        )}
        {dismissalCount > 0 && (
          <span style={{ fontSize: 11, color: "#555" }}>{dismissalCount} dismissed</span>
        )}
        {clusters && clusters.length > 0 && (
          <span style={{ fontSize: 11, color: "#555" }}>{clusters.length} remaining</span>
        )}
      </div>
      <span style={{ fontSize: 12, color: "#888", lineHeight: 1.5, maxWidth: 520 }}>
        Finds near-duplicate genres and lets you merge or dismiss them. × on a chip removes it from the group and remembers never to pair it with the rest.
      </span>

      <button onClick={findClusters} disabled={loading} style={{
        alignSelf: "flex-start", height: 32, padding: "0 18px", borderRadius: 16, border: "none",
        background: loading ? "#333" : "var(--green)", color: "#0a0a0a",
        fontSize: 12, fontWeight: 700, cursor: loading ? "default" : "pointer",
      }}>{loading ? "Scanning…" : clusters ? "Rescan" : "Find Duplicates"}</button>

      {status && (
        <span style={{ fontSize: 11, color: status.startsWith("⚠") ? "#ff6b6b" : "#555" }}>{status}</span>
      )}

      {clusters && clusters.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
          {clusters.map((c, i) => {
            const variants = localVariants[i] ?? c.variants;
            const canonical = canonicals[i] ?? c.suggested_canonical;
            const isBusy = busyIdx === i;
            return (
              <div key={i} style={{
                background: "#141414",
                border: `1px solid ${c.confidence === "high" ? "#2a3a2a" : "#2a2a2a"}`,
                borderRadius: 6, padding: "8px 12px",
                display: "flex", alignItems: "center", gap: 10,
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                  background: c.confidence === "high" ? "var(--green)" : "#555",
                }} title={c.confidence === "high" ? "Exact duplicate" : "Fuzzy match"} />

                {/* variant chips with × */}
                <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
                  {variants.map(v => (
                    <span key={v.genre} style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      fontSize: 12, padding: "2px 4px 2px 7px", borderRadius: 4,
                      background: v.genre === canonical ? "#1a2a1a" : "#1e1e1e",
                      color: v.genre === canonical ? "var(--green)" : "#777",
                      border: v.genre === canonical ? "1px solid var(--green)" : "1px solid #2a2a2a",
                    }}>
                      {v.genre} <span style={{ color: "#444", fontSize: 10 }}>{v.count}</span>
                      <button onClick={() => removeChip(i, v.genre)} style={{
                        width: 14, height: 14, borderRadius: 2, border: "none",
                        background: "transparent", color: "#555", fontSize: 10,
                        cursor: "pointer", padding: 0, lineHeight: 1, flexShrink: 0,
                      }} title="Remove from group (remembers never to pair this with the rest)">×</button>
                    </span>
                  ))}
                  <span style={{ fontSize: 11, color: "#333" }}>→</span>
                </div>

                {/* canonical input */}
                <input
                  value={canonical}
                  onChange={e => setCanonicals(prev => ({ ...prev, [i]: e.target.value }))}
                  style={{
                    width: 140, height: 26, background: "#0d0d0d", color: "var(--green)",
                    border: "1px solid #2a2a2a", borderRadius: 4, padding: "0 8px",
                    fontSize: 12, fontFamily: "monospace", outline: "none", flexShrink: 0,
                  }}
                  onFocus={e => (e.target.style.borderColor = "var(--green)")}
                  onBlur={e => (e.target.style.borderColor = "#2a2a2a")}
                />

                <button onClick={() => mergeOne(i)} disabled={isBusy} style={{
                  height: 26, padding: "0 11px", borderRadius: 13, flexShrink: 0,
                  border: "1px solid var(--green)", background: "transparent",
                  color: "var(--green)", fontSize: 11, fontWeight: 700,
                  cursor: isBusy ? "default" : "pointer", opacity: isBusy ? 0.5 : 1,
                }}>{isBusy ? "…" : "Merge"}</button>

                <button onClick={() => dismissOne(i)} disabled={isBusy} title="Not related — never group these again" style={{
                  height: 26, padding: "0 11px", borderRadius: 13, flexShrink: 0,
                  border: "1px solid #333", background: "transparent",
                  color: "#555", fontSize: 11, fontWeight: 700,
                  cursor: isBusy ? "default" : "pointer",
                }}>Dismiss</button>
              </div>
            );
          })}
        </div>
      )}
      {clusters && clusters.length === 0 && (
        <span style={{ fontSize: 12, color: "var(--green)" }}>✓ All done — no duplicates remaining.</span>
      )}
    </div>
  );
}

// ── System panel ─────────────────────────────────────────────────────────────

interface ServiceInfo { name: string; label: string; active: boolean; state: string; uptime: string | null; pid: string | null; }
interface Vitals { mem_total_mb?: number; mem_used_mb?: number; mem_pct?: number; disk_total?: string; disk_used?: string; disk_free?: string; disk_pct?: string; load_avg?: string; uptime?: string; cpu_temp?: string; }
interface SystemData { services: ServiceInfo[]; vitals: Vitals; }

function SystemPanel() {
  const [data, setData]         = useState<SystemData | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/dev/system`);
      setData(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const restart = async (name: string) => {
    setRestarting(name);
    try {
      await fetch(`${API_BASE}/api/dev/service/${name}/restart`, { method: "POST" });
      await new Promise(r => setTimeout(r, 2000));
      await load();
    } finally { setRestarting(null); }
  };

  const v = data?.vitals ?? {};

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 16, overflow: "auto" }}>

      {/* Services */}
      <div style={{ background: "var(--card)", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>SERVICES</span>
        </div>
        {(data?.services ?? []).map(svc => {
          const dot = svc.active ? "var(--green)" : "#ff6b6b";
          const isRestarting = restarting === svc.name;
          return (
            <div key={svc.name} style={{
              display: "flex", alignItems: "center", gap: 12,
              padding: "12px 16px", borderBottom: "1px solid #111",
            }}>
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: dot, flexShrink: 0 }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{svc.label}</div>
                <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                  {svc.active ? `running · uptime ${svc.uptime ?? "?"}` : `stopped · last active ${svc.uptime ?? "unknown"} ago`}
                  {svc.pid && svc.active && <span style={{ color: "#333", marginLeft: 8 }}>pid {svc.pid}</span>}
                </div>
              </div>
              <button
                onClick={() => restart(svc.name)}
                disabled={!!restarting}
                style={{
                  padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                  border: `1px solid ${svc.active ? "#2a2a2a" : "var(--green)"}`,
                  background: "none",
                  color: isRestarting ? "#555" : svc.active ? "#555" : "var(--green)",
                  cursor: restarting ? "default" : "pointer",
                }}
              >{isRestarting ? "…" : svc.active ? "Restart" : "Start"}</button>
            </div>
          );
        })}
        {!data && <div style={{ padding: 16, fontSize: 12, color: "#444" }}>Loading…</div>}
      </div>

      {/* Pi Vitals */}
      {data && (
        <div style={{ background: "var(--card)", borderRadius: 8, overflow: "hidden" }}>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a1a" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#fff", letterSpacing: "0.06em" }}>PI VITALS</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "#111" }}>
            {[
              ["Uptime",    v.uptime    ?? "–"],
              ["Load",      v.load_avg  ?? "–"],
              ["CPU Temp",  v.cpu_temp  ?? "–"],
              ["Memory",    v.mem_pct != null ? `${v.mem_pct}%  (${v.mem_used_mb} / ${v.mem_total_mb} MB)` : "–"],
              ["Disk Used", v.disk_used ?? "–"],
              ["Disk Free", v.disk_free ? `${v.disk_free}  (${v.disk_pct} used)` : "–"],
            ].map(([label, val]) => (
              <div key={label} style={{ background: "var(--card)", padding: "10px 16px" }}>
                <div style={{ fontSize: 10, color: "#444", fontWeight: 700, letterSpacing: "0.05em", marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 12, color: "#bbb", fontFamily: "monospace" }}>{val}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Logs panel ────────────────────────────────────────────────────────────────

type LogLevel = "all" | "warn+" | "error";

const isError = (line: string) => /429|error|exception|traceback/i.test(line);
const isWarn  = (line: string) => /warn/i.test(line);

function colorFor(line: string): string {
  if (isError(line)) return "#ff6b6b";
  if (isWarn(line))  return "#ffd166";
  if (/new_plays|started|deployed/i.test(line)) return "#06d6a0";
  return "#888";
}

function matchesLevel(line: string, level: LogLevel): boolean {
  if (level === "all")   return true;
  if (level === "error") return isError(line);
  return isError(line) || isWarn(line);
}

function LogsPanel() {
  const [logLines, setLogLines] = useState<string[]>([]);
  const [loading, setLoading]   = useState(false);
  const [level, setLevel]       = useState<LogLevel>("all");
  const [search, setSearch]     = useState("");
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/dev/logs?lines=500`);
      const data = await res.json();
      setLogLines((data.lines ?? []).reverse());
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    intervalRef.current = setInterval(load, 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [load]);

  const needle = search.trim().toLowerCase();
  const visible = logLines.filter(line =>
    matchesLevel(line, level) &&
    (needle === "" || line.toLowerCase().includes(needle))
  );

  const PILLS: [LogLevel, string][] = [["all", "All"], ["warn+", "Warn+"], ["error", "Error"]];

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", gap: 8 }}>
      <BackupStatusBar />
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {PILLS.map(([key, label]) => (
          <button key={key} onClick={() => setLevel(key)} style={{
            background: level === key ? (key === "error" ? "#3a1a1a" : key === "warn+" ? "#2a2200" : "#1a2a1a") : "#1e1e1e",
            color:      level === key ? (key === "error" ? "#ff6b6b" : key === "warn+" ? "#ffd166" : "var(--green)") : "#555",
            border:     `1px solid ${level === key ? (key === "error" ? "#ff6b6b44" : key === "warn+" ? "#ffd16644" : "var(--green)") : "#2a2a2a"}`,
            borderRadius: 4, padding: "3px 12px", fontSize: 12, cursor: "pointer",
          }}>{label}</button>
        ))}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="filter…"
          style={{
            ...INPUT_STYLE, height: 26, flex: 1, maxWidth: 260,
            fontSize: 12, padding: "0 10px",
          }}
        />
        <span style={{ fontSize: 11, color: "#444", marginLeft: 2 }}>
          {visible.length}/{logLines.length}
        </span>
        <button onClick={load} disabled={loading} style={{
          marginLeft: "auto", background: "none", border: "1px solid #333",
          color: loading ? "#444" : "#666", borderRadius: 4,
          padding: "3px 10px", fontSize: 12, cursor: "pointer",
        }}>↺ Refresh</button>
      </div>

      {/* log output */}
      <div style={{
        flex: 1, overflowY: "auto", background: "#0a0a0a",
        borderRadius: 6, padding: "10px 14px",
        fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
      }}>
        {visible.map((line, i) => (
          <div key={i} style={{ color: colorFor(line), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export function DevView() {
  const [mode, setMode] = useState<Mode>("Query");

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || (e.key !== "[" && e.key !== "]")) return;
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      e.preventDefault();
      setMode(cur => {
        const idx = MODES.indexOf(cur);
        const next = e.key === "]" ? (idx + 1) % MODES.length : (idx - 1 + MODES.length) % MODES.length;
        return MODES[next];
      });
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: "20px 24px 16px", gap: 10 }}>
      <span style={{ fontSize: 20, fontWeight: 800, color: "var(--white)", letterSpacing: "-0.02em", flexShrink: 0 }}>Dev Console</span>

      {/* Mode toggle */}
      <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
        {MODES.map(m => (
          <ModeBtn key={m} label={m} active={mode === m} onClick={() => setMode(m)} />
        ))}
      </div>

      {/* Panel */}
      {mode === "Query"   && <QueryPanel />}
      {mode === "jq"      && <JqPanel />}
      {mode === "Storage" && <StoragePanel />}
      {mode === "API"       && <ApiPanel />}
      {mode === "Utilities" && <UtilitiesPanel />}
      {mode === "Logs"      && <LogsPanel />}
      {mode === "System"    && <SystemPanel />}
    </div>
  );
}
