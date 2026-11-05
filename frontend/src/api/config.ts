declare global {
  interface Window {
    electronConfig?: { apiBase: string };
    electronEvents?: { onCycleTab: (cb: (dir: number) => void) => void };
    electronAuth?: { reauth: (authorizeUrl: string) => Promise<{ code: string }> };
  }
}

// Served by the Pi under /desktop/ (the packaged Electron app on the Windows PC loads it
// from there): the API is the same origin and the router lives under /desktop.
const piHosted = window.location.pathname.startsWith("/desktop");

export const BASENAME = piHosted ? "/desktop" : "";

export const API_BASE: string = piHosted
  ? window.location.origin
  : window.electronConfig?.apiBase ?? import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";
