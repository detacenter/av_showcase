import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

// This demo has no live backend — sw.js intercepts every /api/* call and
// answers from bundled static snapshots, same mock layer the desktop app
// uses (see PRJ-0005 notes.md "Phase 3 scoping"). The app must not render
// before the worker is actually controlling this page, or its first API
// calls would hit the real network and 404.
async function ensureMockApiReady(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  await new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    if (navigator.serviceWorker.controller) resolve();
  });
  void reg;
}

ensureMockApiReady().finally(() => {
  const root = document.getElementById("root")!;
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        {/* basename: this app is nested under /mobile/ in the showcase deploy,
            so internal routes (e.g. /artists) must resolve to /mobile/artists,
            not collide with the desktop app's own root-level routes. */}
        <BrowserRouter basename="/mobile">
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>
  );
});
