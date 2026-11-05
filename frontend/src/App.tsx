import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Sidebar } from "./components/Sidebar";
import { BASENAME } from "./api/config";
import { GenresFrameHost } from "./components/GenresFrameHost";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { RecentView } from "./views/RecentView";
import { ArtistsView } from "./views/ArtistsView";
import { ArtistDetailView } from "./views/ArtistDetailView";
import { AlbumsView } from "./views/AlbumsView";
import { PlaylistsView, PlaylistDetailView } from "./views/PlaylistsView";
import { VinylView } from "./views/VinylView";
import { SettingsView, applyAccent } from "./views/SettingsView";
import { StatsView } from "./views/StatsView";
import { TopsView } from "./views/TopsView";
import { VisualizerView } from "./views/VisualizerView";
import { ClaudioView } from "./views/ClaudioView";
import { RevisitView } from "./views/RevisitView";
import { AboutView } from "./views/AboutView";
import { APIGuideView } from "./views/APIGuideView";
import { ShortcutsView } from "./views/ShortcutsView";
import { MobilePreviewView } from "./views/MobilePreviewView";
import { RadarView } from "./views/RadarView";
import { VinylSessionPrompt } from "./components/VinylSessionPrompt";
import { SpotifyReauthBanner } from "./components/SpotifyReauthBanner";
import { SandboxBanner } from "./components/SandboxBanner";
import { api } from "./api/client";
import type { AppSettings } from "./api/types";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

function AccentLoader() {
  const { data } = useQuery<AppSettings>({
    queryKey: ["settings"],
    queryFn: () => api.get("/api/settings"),
    staleTime: 60_000,
  });
  useEffect(() => {
    if (data?.accent_color) applyAccent(data.accent_color);
  }, [data?.accent_color]);
  return null;
}

function Layout({ children }: { children: React.ReactNode }) {
  // Every route shares this same Layout/ErrorBoundary position in the tree,
  // so React reuses the same ErrorBoundary instance across route changes
  // instead of remounting it -- without a route-keyed reset, a crash on one
  // page would keep showing its fallback UI even after navigating away.
  const location = useLocation();
  return (
    <>
      <Sidebar />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <SpotifyReauthBanner />
        <SandboxBanner />
        <ErrorBoundary key={location.pathname}>{children}</ErrorBoundary>
      </main>
    </>
  );
}

export default function App() {
  // Popout is a brand-new OS window loading a real document from scratch, not a
  // client-side navigation — under file:// (production) there's no server to fall
  // back to index.html for an arbitrary path, and BrowserRouter's pushState-based
  // navigation means the main window's own window.location can no longer be
  // trusted to point at the real loaded file by the time this ever renders anyway.
  // So this check happens before BrowserRouter mounts at all, keyed only on a
  // query param on whatever file was actually loaded (see VisualizerView's
  // ENTRY_URL for the matching fix on the "open" side).
  const isPopout = new URLSearchParams(window.location.search).get("popout") === "1";
  if (isPopout) {
    return (
      <QueryClientProvider client={queryClient}>
        <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <ErrorBoundary><VisualizerView /></ErrorBoundary>
        </main>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={BASENAME}>
        <AccentLoader />
        <GenresFrameHost />
        <Routes>
          <Route path="/" element={<Navigate to="/recent" replace />} />
          <Route path="/recent" element={<Layout><RecentView /></Layout>} />
          <Route path="/artists" element={<Layout><ArtistsView /></Layout>} />
          <Route path="/artists/*" element={<Layout><ArtistDetailView /></Layout>} />
          <Route path="/albums" element={<Layout><AlbumsView /></Layout>} />
          <Route path="/playlists" element={<Layout><PlaylistsView /></Layout>} />
          <Route path="/playlists/:id" element={<Layout><PlaylistDetailView /></Layout>} />
          <Route path="/revisit" element={<Layout><RevisitView /></Layout>} />
          <Route path="/radar" element={<Layout><RadarView /></Layout>} />
          <Route path="/vinyl" element={<Layout><VinylView /></Layout>} />
          <Route path="/settings" element={<Layout><SettingsView /></Layout>} />
          <Route path="/stats" element={<Layout><StatsView /></Layout>} />
          <Route path="/tops" element={<Layout><TopsView /></Layout>} />
          <Route path="/claudio" element={<Layout><ClaudioView /></Layout>} />
          <Route path="/about" element={<Layout><AboutView /></Layout>} />
          <Route path="/api-guide" element={<Layout><APIGuideView /></Layout>} />
          <Route path="/shortcuts" element={<Layout><ShortcutsView /></Layout>} />
          <Route path="/mobile" element={<Layout><MobilePreviewView /></Layout>} />
          <Route path="/visualizer" element={<Layout><VisualizerView /></Layout>} />
          <Route path="*" element={<Layout><div style={{ padding: 24, color: "var(--dim)" }}>Coming soon</div></Layout>} />
        </Routes>
        <VinylSessionPrompt />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
