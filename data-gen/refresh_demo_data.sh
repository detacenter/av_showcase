#!/usr/bin/env bash
# Re-rolls the demo's synthetic listening data with a fresh random seed, so the
# site shows a different (but still plausible, still real-catalog-grounded) history
# each time this is run. Run this from time to time to keep the demo feeling fresh.
#
# Real-data exceptions (album/track/artist ratings & favorites, vinyl collection,
# Tops picks, Claudio recommendations) are re-pulled from the actual av data
# directory each time too — Stage 1 always reflects current truth, only the
# synthetic scaffolding around it (timestamps, sessions, discovery pacing) varies.
#
# Usage: data-gen/refresh_demo_data.sh
# Leaves everything staged for review — does NOT commit or push. Check `git diff`
# and the local preview before pushing to keep the live site in sync.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

export BEHAVIOR_SEED="$(date +%s)"
echo "== Using BEHAVIOR_SEED=$BEHAVIOR_SEED =="

echo "== Stage 1: pulling real catalog + real-data exceptions =="
(cd data-gen && python3 export_catalog_seed.py)

echo "== Stage 2: generating fresh synthetic behavior =="
(cd data-gen && python3 generate_synthetic_data.py)

echo "== Regenerating API snapshots =="
(cd data-gen && python3 generate_api_snapshots.py)

echo "== Privacy sweep =="
# Always exits non-zero when it finds anything, including the one standing
# accepted false positive (a public npm maintainer email in
# electron/package-lock.json) — don't let that abort the whole refresh, but do
# surface the output so a NEW, real finding still gets seen before committing.
bash scripts/privacy-sweep.sh || true

echo "== Rebuilding frontend =="
(cd frontend && npm run build)

cat <<EOF

== Done ==
Fresh data generated with BEHAVIOR_SEED=$BEHAVIOR_SEED.
Review with: git status / git diff
Preview locally: cd frontend && npm run preview
When it looks right: git add -A, commit, and push to trigger the Vercel deploy.
EOF
