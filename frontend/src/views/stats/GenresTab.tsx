import { API_BASE } from "../../api/config";

export function GenresTab() {
  return (
    <div style={{ flex: 1, overflow: "hidden", minHeight: 0 }}>
      <iframe
        src={`${API_BASE}/api/stats/genres-page`}
        style={{ width: "100%", height: "100%", border: "none", display: "block" }}
        title="Genre Network"
      />
    </div>
  );
}
