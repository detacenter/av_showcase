import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Sidebar } from "./components/Sidebar";
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
  return (
    <>
      <Sidebar />
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <SpotifyReauthBanner />
        <SandboxBanner />
        {children}
      </main>
    </>
  );
}

function VisualizerRoute() {
  const isPopout = new URLSearchParams(window.location.search).get("popout") === "1";
  if (isPopout) {
    return (
      <main style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <VisualizerView />
      </main>
    );
  }
  return <Layout><VisualizerView /></Layout>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AccentLoader />
        <Routes>
          <Route path="/" element={<Navigate to="/recent" replace />} />
          <Route path="/recent" element={<Layout><RecentView /></Layout>} />
          <Route path="/artists" element={<Layout><ArtistsView /></Layout>} />
          <Route path="/artists/*" element={<Layout><ArtistDetailView /></Layout>} />
          <Route path="/albums" element={<Layout><AlbumsView /></Layout>} />
          <Route path="/playlists" element={<Layout><PlaylistsView /></Layout>} />
          <Route path="/playlists/:id" element={<Layout><PlaylistDetailView /></Layout>} />
          <Route path="/revisit" element={<Layout><RevisitView /></Layout>} />
          <Route path="/vinyl" element={<Layout><VinylView /></Layout>} />
          <Route path="/settings" element={<Layout><SettingsView /></Layout>} />
          <Route path="/stats" element={<Layout><StatsView /></Layout>} />
          <Route path="/tops" element={<Layout><TopsView /></Layout>} />
          <Route path="/claudio" element={<Layout><ClaudioView /></Layout>} />
          <Route path="/about" element={<Layout><AboutView /></Layout>} />
          <Route path="/api-guide" element={<Layout><APIGuideView /></Layout>} />
          <Route path="/shortcuts" element={<Layout><ShortcutsView /></Layout>} />
          <Route path="/visualizer" element={<VisualizerRoute />} />
          <Route path="*" element={<Layout><div style={{ padding: 24, color: "var(--dim)" }}>Coming soon</div></Layout>} />
        </Routes>
        <VinylSessionPrompt />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
