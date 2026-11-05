import { useQuery } from "@tanstack/react-query";
import { api } from "./client";

export interface HistoryInfo {
  av_began: string | null;          // first play in AV's own log
  newest_play: string | null;       // latest play anywhere in Stats' history
  oldest_play: string | null;       // earliest play (Spotify history or AV)
  imported_plays: number;           // Spotify export plays before that
  imported_first_play: string | null;
  imported_at: string | null;
}

// Where AV's own log begins vs. the imported Spotify history; for "AV began" markers.
export function useHistoryInfo() {
  return useQuery<HistoryInfo>({
    queryKey: ["stats-history-info"],
    queryFn: () => api.get("/api/stats/history"),
    staleTime: 5 * 60_000,
  });
}

export function avBeganDate(info?: HistoryInfo): Date | null {
  return info?.av_began ? new Date(info.av_began) : null;
}

export function historyBounds(info?: HistoryInfo): { min: Date; max: Date } {
  const max = info?.newest_play ? new Date(info.newest_play) : new Date();
  const min = info?.oldest_play ? new Date(info.oldest_play) : new Date(max.getFullYear(), 0, 1);
  return { min, max };
}
