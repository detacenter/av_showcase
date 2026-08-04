import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// This demo has no live backend — sw.js intercepts every /api/* call and
// answers from bundled static snapshots (see PRJ-0005 notes.md "Phase 3
// scoping"). The app must not render before the worker is actually
// controlling this page, or its first API calls would hit the real network
// and 404 (no server is listening there in the deployed demo).
async function ensureMockApiReady(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.register('/sw.js');
  await navigator.serviceWorker.ready;
  if (navigator.serviceWorker.controller) return;
  // First-ever visit: the worker just activated but hasn't claimed this
  // client yet. clients.claim() in sw.js resolves this without a reload —
  // wait for the controllerchange event it triggers.
  await new Promise<void>((resolve) => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    // Safety net in case claim() already happened before we attached the listener.
    if (navigator.serviceWorker.controller) resolve();
  });
  void reg;
}

ensureMockApiReady().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
