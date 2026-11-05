import { useState } from "react";
import { api } from "../api/client";

// Opens the album's Discogs master page filtered to vinyl pressings. The Pi finds the
// master the first time (then caches it); unmatched albums open a Discogs search instead.
export function OpenInDiscogs({ artist, title, albumId, style }: {
  artist: string;
  title: string;
  albumId?: string;
  style?: React.CSSProperties;
}) {
  const [finding, setFinding] = useState(false);

  const open = async () => {
    if (finding) return;
    setFinding(true);
    try {
      const params = new URLSearchParams({ artist, title, album_id: albumId ?? "" });
      const { url } = await api.get<{ url: string }>(`/api/vinyl/discogs-link?${params}`);
      window.open(url, "_blank");
    } finally {
      setFinding(false);
    }
  };

  return (
    <button onClick={open} style={{ ...style, whiteSpace: "nowrap", cursor: finding ? "default" : "pointer" }}>
      {finding ? "Finding on Discogs…" : "↗ Open in Discogs"}
    </button>
  );
}
