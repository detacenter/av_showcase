import { useState, useEffect } from "react";

export interface FilterState {
  search: string;
  genres: string[];
  albumTypes: string[];
  yearFrom: string;
  yearTo: string;
}

export function emptyFilters(): FilterState {
  return { search: "", genres: [], albumTypes: [], yearFrom: "", yearTo: "" };
}

export function activeFilterCount(f: FilterState): number {
  let n = 0;
  if (f.search.trim()) n++;
  if (f.genres.length) n++;
  if (f.albumTypes.length) n++;
  if (f.yearFrom || f.yearTo) n++;
  return n;
}

// ─── Genre combobox ───────────────────────────────────────────────────────────

function GenreCombobox({ selected, available, onChange }: {
  selected: string[];
  available: string[];
  onChange: (genres: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const unselected = available.filter(g => !selected.includes(g));
  const q = query.trim();
  const matches = q ? unselected.filter(g => g.toLowerCase().includes(q.toLowerCase())) : [];

  const add = (g: string) => { onChange([...selected, g]); setQuery(""); };
  const remove = (g: string) => onChange(selected.filter(x => x !== g));

  const selectedChip = (g: string) => (
    <button
      key={g}
      onClick={() => remove(g)}
      style={{
        background: "var(--green, #1db954)", color: "#000",
        border: "none", borderRadius: 20, padding: "5px 10px",
        fontSize: 12, fontWeight: 600, cursor: "pointer", flexShrink: 0,
        display: "flex", alignItems: "center", gap: 5,
        WebkitTapHighlightColor: "transparent",
      } as React.CSSProperties}
    >{g}<span style={{ fontSize: 14, lineHeight: 1, opacity: 0.6 }}>×</span></button>
  );

  const optionChip = (g: string) => (
    <button
      key={g}
      onClick={() => add(g)}
      style={{
        background: "#1e1e1e", color: "#aaa",
        border: "1px solid #333", borderRadius: 20, padding: "5px 12px",
        fontSize: 12, cursor: "pointer", flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      } as React.CSSProperties}
    >{g}</button>
  );

  return (
    <div>
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {selected.map(g => selectedChip(g))}
        </div>
      )}
      <input
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder={selected.length ? "Add another…" : "Type to filter genres…"}
        style={{
          width: "100%", boxSizing: "border-box",
          background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: 8,
          color: "#fff", fontSize: 16, padding: "9px 12px", outline: "none",
        }}
      />
      {matches.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {matches.map(g => optionChip(g))}
        </div>
      )}
      {query.trim() && matches.length === 0 && (
        <div style={{ fontSize: 12, color: "#444", marginTop: 8 }}>No matching genres</div>
      )}
    </div>
  );
}

// ─── Main dialog ──────────────────────────────────────────────────────────────

interface FilterDialogProps {
  open: boolean;
  onClose: () => void;
  filters: FilterState;
  onChange: (f: FilterState) => void;
  availableGenres: string[];
  availableTypes?: string[];
  yearBounds?: { min: number; max: number } | null;
  searchPlaceholder?: string;
}

export function FilterDialog({
  open, onClose, filters, onChange,
  availableGenres, availableTypes, yearBounds,
  searchPlaceholder = "Name…",
}: FilterDialogProps) {
  const [local, setLocal] = useState<FilterState>(filters);

  useEffect(() => {
    if (open) setLocal(filters);
  }, [open]);

  const patch = (p: Partial<FilterState>) => setLocal(prev => ({ ...prev, ...p }));

  const toggleType = (t: string) =>
    setLocal(prev => ({
      ...prev,
      albumTypes: prev.albumTypes.includes(t) ? prev.albumTypes.filter(x => x !== t) : [...prev.albumTypes, t],
    }));

  const handleDone = () => { onChange(local); onClose(); };

  const handleClear = () => {
    const blank = emptyFilters();
    setLocal(blank);
    onChange(blank);
    onClose();
  };

  if (!open) return null;

  const sectionLabel = (text: string) => (
    <div style={{
      fontSize: 11, fontWeight: 600, color: "#555",
      textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8,
    }}>{text}</div>
  );

  const chip = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      style={{
        background: active ? "var(--green, #1db954)" : "#1e1e1e",
        color: active ? "#000" : "#aaa",
        border: `1px solid ${active ? "var(--green, #1db954)" : "#333"}`,
        borderRadius: 20, padding: "5px 12px",
        fontSize: 12, fontWeight: active ? 600 : 400,
        cursor: "pointer", flexShrink: 0,
        WebkitTapHighlightColor: "transparent",
      } as React.CSSProperties}
    >{label}</button>
  );

  const inputStyle: React.CSSProperties = {
    background: "#1e1e1e", border: "1px solid #2a2a2a", borderRadius: 8,
    color: "#fff", fontSize: 16, padding: "9px 12px", outline: "none",
  };

  return (
    <>
      <div onClick={handleDone} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 100 }} />
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0,
        background: "#141414", borderRadius: "16px 16px 0 0",
        padding: "0 16px",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        zIndex: 101, maxHeight: "82vh",
        overflowY: "auto", WebkitOverflowScrolling: "touch",
      } as React.CSSProperties}>

        <div style={{ display: "flex", justifyContent: "center", padding: "12px 0 8px" }}>
          <div style={{ width: 36, height: 4, borderRadius: 2, background: "#333" }} />
        </div>

        <div style={{ display: "flex", alignItems: "center", marginBottom: 18 }}>
          <span style={{ fontSize: 17, fontWeight: 700, color: "#fff" }}>Filter</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={handleClear}
            style={{ background: "none", border: "none", color: "#666", fontSize: 13, cursor: "pointer", padding: "4px 0" }}
          >Clear all</button>
        </div>

        {/* Search */}
        <div style={{ marginBottom: 20 }}>
          {sectionLabel("Search")}
          <input
            value={local.search}
            onChange={e => patch({ search: e.target.value })}
            placeholder={searchPlaceholder}
            autoFocus
            style={{ ...inputStyle, width: "100%", boxSizing: "border-box" }}
          />
        </div>

        {/* Genre */}
        {availableGenres.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {sectionLabel("Genre")}
            <GenreCombobox
              selected={local.genres}
              available={availableGenres}
              onChange={genres => patch({ genres })}
            />
          </div>
        )}

        {/* Album type */}
        {availableTypes && availableTypes.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            {sectionLabel("Type")}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {availableTypes.map(t => chip(t, local.albumTypes.includes(t), () => toggleType(t)))}
            </div>
          </div>
        )}

        {/* Year range */}
        {yearBounds && (
          <div style={{ marginBottom: 20 }}>
            {sectionLabel("Release Year")}
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                value={local.yearFrom}
                onChange={e => patch({ yearFrom: e.target.value })}
                placeholder={String(yearBounds.min)}
                style={{ ...inputStyle, flex: 1 }}
              />
              <span style={{ color: "#555", fontSize: 13, flexShrink: 0 }}>to</span>
              <input
                type="number"
                value={local.yearTo}
                onChange={e => patch({ yearTo: e.target.value })}
                placeholder={String(yearBounds.max)}
                style={{ ...inputStyle, flex: 1 }}
              />
            </div>
          </div>
        )}

        <button
          onClick={handleDone}
          style={{
            width: "100%", background: "var(--green, #1db954)", border: "none",
            borderRadius: 10, padding: 13, color: "#000", fontSize: 15, fontWeight: 700,
            cursor: "pointer", marginTop: 4,
          }}
        >Done</button>
      </div>
    </>
  );
}
