import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

const SPOTIFY_COLOR = "#1DB954";

export function SpotifyReauthBanner() {
  const qc = useQueryClient();
  const [reconnecting, setReconnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data } = useQuery<{ needs_reauth: boolean }>({
    queryKey: ["auth-status"],
    queryFn: () => api.get("/api/auth/status"),
    refetchInterval: 60_000,
    staleTime: 0,
  });

  if (!data?.needs_reauth) return null;

  const canReconnect = !!window.electronAuth;

  const reconnect = async () => {
    if (!window.electronAuth) return;
    setReconnecting(true);
    setError(null);
    try {
      const { url } = await api.get<{ url: string }>("/api/auth/authorize-url");
      const { code } = await window.electronAuth.reauth(url);
      await api.post("/api/auth/callback", { code });
      qc.invalidateQueries({ queryKey: ["auth-status"] });
      qc.invalidateQueries({ queryKey: ["fetchStatus"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reconnect failed");
    } finally {
      setReconnecting(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "8px 20px",
        background: "rgba(29, 185, 84, 0.12)",
        borderBottom: `1px solid ${SPOTIFY_COLOR}`,
        fontSize: 12,
        color: "#fff",
        flexShrink: 0,
      }}
    >
      <span style={{ fontWeight: 700, color: SPOTIFY_COLOR }}>Spotify disconnected</span>
      <span style={{ color: "#aaa" }}>
        {error ?? "Listening history has stopped syncing until you reconnect."}
      </span>
      <button
        onClick={reconnect}
        disabled={!canReconnect || reconnecting}
        title={canReconnect ? undefined : "Reconnect from the desktop app"}
        style={{
          marginLeft: "auto",
          height: 26,
          padding: "0 14px",
          borderRadius: 13,
          border: "none",
          background: !canReconnect || reconnecting ? "#0f7a38" : SPOTIFY_COLOR,
          color: "#04170b",
          fontSize: 11,
          fontWeight: 700,
          cursor: !canReconnect || reconnecting ? "default" : "pointer",
        }}
      >
        {reconnecting ? "Connecting…" : "Reconnect"}
      </button>
    </div>
  );
}
