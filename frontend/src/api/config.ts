declare global {
  interface Window {
    electronConfig?: { apiBase: string };
    electronEvents?: { onCycleTab: (cb: (dir: number) => void) => void };
    electronAuth?: { reauth: (authorizeUrl: string) => Promise<{ code: string }> };
  }
}

export const API_BASE: string =
  window.electronConfig?.apiBase ??
  import.meta.env.VITE_API_BASE_URL ??
  "http://localhost:8000";
