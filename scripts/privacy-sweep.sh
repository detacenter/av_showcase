#!/usr/bin/env bash
# Repeatable privacy sweep for av_showcase — codifies the manual grep sequence used
# during Phase 1 (PRJ-0005 session 2-4) into one script, so re-running it before every
# commit and before the final public flip doesn't depend on remembering every check.
#
# Usage:
#   scripts/privacy-sweep.sh                # sweep this repo (default: repo root)
#   scripts/privacy-sweep.sh /path/to/dir   # sweep an arbitrary directory
#
# Exit code 0 = clean, 1 = at least one finding (see output for detail).
set -uo pipefail

TARGET="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
FOUND=0

section() { echo; echo "── $1 ──"; }

check() {
    local label="$1"
    local pattern="$2"
    local matches
    matches=$(grep -rnE "$pattern" "$TARGET" \
        --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=.venv \
        --exclude-dir=artwork --exclude-dir=__pycache__ --exclude="*.pyc" \
        --exclude="privacy-sweep.sh" 2>/dev/null)
    if [ -n "$matches" ]; then
        echo "FOUND ($label):"
        echo "$matches" | head -20
        FOUND=1
    else
        echo "clean: $label"
    fi
}

section "Known specific patterns (from the real ~/code/av scrub list)"
check "home LAN IP"       '192\.168\.1\.164'
check "Tailscale IP"      '100\.101\.183\.53'
check "real Discogs username" '"detaels"'

section "Generic patterns (catch anything new)"
check "home directory paths"  '/Users/[a-zA-Z0-9_.-]+|/home/[a-zA-Z0-9_.-]+'
check "private LAN IP ranges" '(192\.168\.|10\.[0-9]+\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)[0-9]+\.[0-9]+'
check "Tailscale CGNAT range" '100\.(6[4-9]|[7-9][0-9]|1[0-1][0-9]|12[0-7])\.[0-9]+\.[0-9]+'
check "email addresses"       '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}'

section "Result"
if [ "$FOUND" -eq 0 ]; then
    echo "Clean. No findings across $TARGET."
else
    echo "Findings above need review before this can be committed/made public."
fi

exit "$FOUND"
