#!/usr/bin/env bash
# Builds both the desktop app (frontend/) and the mobile PWA (mobile/) and
# merges mobile's output into frontend/dist/mobile-app/, so Vercel's single
# build (Root Directory = frontend, default `npm run build`) produces one
# deployable dist/ containing both apps.
#
# Vercel checks out the whole repo regardless of Root Directory — only the
# install/build *commands* run scoped to that directory — so this script,
# invoked as frontend's own "build" script, can still reach the sibling
# mobile/ directory to build it too.
#
# Usage: invoked via frontend/package.json's "build" script. Can also be run
# directly from the repo root: bash scripts/build-with-mobile.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Building desktop app (frontend/) =="
(cd "$ROOT/frontend" && npm run build:app)

echo "== Building mobile app (mobile/) =="
(cd "$ROOT/mobile" && npm ci && npm run build)

echo "== Merging mobile build into frontend/dist/mobile-app/ =="
rm -rf "$ROOT/frontend/dist/mobile-app"
cp -r "$ROOT/mobile/dist" "$ROOT/frontend/dist/mobile-app"

echo "== Done: frontend/dist/ now contains both apps =="
