# av: listening intelligence for your own music library

A portfolio demo of **Audiovault (`av`)**, a Spotify listening-history logger and analyzer
I built and use daily. This repo is a from-scratch, sanitized rebuild of the real app: real
architecture and API design, synthetic personal data.

**[Live demo →](https://av-showcase.vercel.app)**

![Stats view screenshot](#) <!-- TODO: add screenshot before flipping public -->

## What this is (and isn't)

`av` logs every track I play, cross-references it against my Discogs vinyl collection, and
turns the combined history into things Spotify itself doesn't show me: session-level
listening patterns, per-decade "tops," discovery-vs-comfort balance over time, and an
LLM-assisted recommendation engine (Claudio) tuned to my actual taste.

This repo is **not** a copy of that app's git history or its live backend. It's a separate
project, built to show the engineering behind it without exposing any of my real listening
data. Two exceptions, made deliberately: album star ratings and the vinyl collection are
real (they're curated opinions about public albums, not behavioral data), and Tops/Claudio
draw on my real per-decade picks and recommendation history for the same reason. Everything
else (every timestamp, session, favorite, and note) is synthetic, generated from real
catalog data (artists/albums/tracklists) run through a statistical model calibrated against
my actual listening patterns, not copied from them.

## Architecture

- **`frontend/`**: the real React/Vite UI, unmodified except for stripping Electron-only
  coupling (it degrades gracefully to a plain browser tab).
- **`backend/`**: the real FastAPI backend source: routers, insights/analytics modules,
  query engine. Included as **reference code you can read**, not something the live demo
  runs (see below).
- **`electron/`**: the real desktop shell source (`main.js`/`preload.js`), also included as
  inert reference, not runnable here.

The deployed demo is a **fully static site**: no live backend, nothing to host or pay for
beyond static hosting. A service worker (`frontend/public/sw.js`) intercepts every `/api/*`
call the real frontend makes and answers it from static JSON snapshots. Those snapshots
aren't hand-written: `data-gen/` actually runs the real (sanitized) backend once against a
synthetic dataset and captures its genuine responses, so the API shapes, computed stats, and
edge cases are all authentic, just frozen instead of live. For the full interactive
breakdown, see the **About** page in the running demo.

## Features

| View | What it shows |
|---|---|
| Recent | Live-scrolling play history, same as the real app's home view |
| Artists | Full library browser with per-artist stats |
| Albums | Album grid with ratings, favorites, notes |
| Stats | Sessions, Eras, Time-of-day, Trends, Periods, Discovery-vs-comfort |
| Tops | Real per-decade top-10 picks |
| Vinyl | Real Discogs collection, digital/vinyl session tracking |
| Playlists | Rule-based smart playlists |
| Revisit | Resurfaces older favorites |
| Claudio | LLM-assisted recommendations, built from real recommendation history |
| Settings | App configuration (trimmed of anything demo-irrelevant) |

Plus two demo-specific additions not in the real app: an interactive **About** page
(architecture walkthrough) and a live **API guide** (`/api-guide`) you can use to hit any
mocked endpoint directly and see real request/response shapes.

## Keyboard shortcuts

The UI is fully keyboard-navigable: vim-style (`h`/`j`/`k`/`l`) plus arrow keys throughout.

<details>
<summary><strong>Full shortcut reference</strong></summary>

**Global** (works on every view)

| Key | Action |
|---|---|
| `Cmd/Ctrl` + `[` / `]` | Cycle to previous / next nav tab |
| `Cmd/Ctrl` + `1`–`9`, `0` | Jump directly to nav tab N |
| `Cmd/Ctrl` + `R` | Trigger a library sync |

**Grid views** (shared pattern across Artists, Albums, Vinyl, Playlists)

| Key | Action |
|---|---|
| `/` | Open filter search bar |
| `j`/`k`/`h`/`l` or arrow keys | Move grid focus down/up/left/right |
| `Ctrl` + `↑` / `↓` | Jump to first / last item (Artists, Albums) |
| `Enter` | Open the focused item |
| `g` | Toggle genre filter palette (Artists, Albums, Vinyl) |
| `f` | Toggle "favorites only" filter (Artists, Albums) |
| `t` | Cycle type filter (Albums, Vinyl) |
| `y` | Toggle year filter (Albums) |
| `n` | Create a new playlist (Playlists) |
| `Cmd/Ctrl` + `F` | Toggle favorite on the focused item |
| `Cmd/Ctrl` + `O` | Open focused item in Spotify (Albums) |
| `Escape` | Staged back-out: close panel → clear search → clear focus |

**Genre filter palette** (sub-overlay, opened with `g`)

| Key | Action |
|---|---|
| `j`/`k`/`h`/`l` or arrows | Move between search pane / genre list / adjacent-genre list |
| `Enter` / `Space` | Toggle the focused genre |
| `Escape` | Step back a pane, or close if already on the search pane |

**Recent**

| Key | Action |
|---|---|
| `Ctrl` + `/` | Toggle filter/search bar |
| `h`/`l` or `←`/`→` | Select previous / next album |
| `j`/`k` or `↑`/`↓` | Move focused track within selected album |
| `Enter` | Go to the focused track's artist page |
| `Cmd/Ctrl` + `F` | Toggle favorite on focused track |
| `Cmd/Ctrl` + `O` | Open focused track in Spotify |
| `Cmd/Ctrl` + `D` | Toggle delete mode |
| `d` | (delete mode) Open confirm-delete dialog for focused track |
| `Escape` | Staged back-out: exit delete mode → clear search → close search |

**Artist detail**

| Key | Action |
|---|---|
| `j`/`l`/`↓`/`→` and `k`/`h`/`↑`/`←` | Select next / previous album or vinyl release |
| `n` | Open notes editor |
| `s` / `v` | Switch source view to Spotify / Vinyl |
| `Cmd/Ctrl` + `F` | Toggle favorite (syncs artist + album) |
| `Escape` | Back to Artists |

**Stats**

| Key | Action |
|---|---|
| `[` / `]` (no modifier) | Cycle Stats subtab (Sessions/Time/Periods/Eras/Trends/Genres/Overview/Vinyl) |

**Tops**

| Key | Action |
|---|---|
| `j`/`↓` and `k`/`↑` | Move decade-shelf focus down / up |

**Vinyl "now playing" match prompt** (overlay, appears when a vinyl side is detected)

| Key | Action |
|---|---|
| `↑` / `↓` | Move between candidate matches |
| `Enter` | Confirm the focused match |
| `Escape` | Dismiss the prompt |

</details>

## Run it locally

The demo only needs the frontend, with no backend process, no environment variables, and no
API keys:

```bash
cd frontend
npm install
npm run dev
```

`backend/` and `electron/` are included for reference and aren't meant to be run standalone
in this repo.

## Tech stack

React 19 · TypeScript · Vite · React Router · TanStack Query · FastAPI (reference) ·
Electron (reference) · deployed on Vercel

## License

MIT — see [LICENSE](LICENSE).
