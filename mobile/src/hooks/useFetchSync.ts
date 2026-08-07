import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export function useFetchSync() {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  useEffect(() => () => stopPolling(), []);

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      await api.post("/api/fetch");
    } catch {
      setSyncing(false);
      return;
    }

    pollRef.current = setInterval(async () => {
      try {
        const status = await api.get<{ fetching: boolean }>("/api/fetch/status");
        if (!status.fetching) {
          stopPolling();
          setSyncing(false);
          queryClient.invalidateQueries();
        }
      } catch {
        stopPolling();
        setSyncing(false);
      }
    }, 1500);
  };

  return { sync, syncing };
}
