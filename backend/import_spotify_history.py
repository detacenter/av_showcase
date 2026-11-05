"""CLI: import a Spotify Extended Streaming History folder into the history store.

    AUDIOVAULT_DATA_DIR=... .venv/bin/python import_spotify_history.py <export dir> [--no-raw]

The cutoff is the start of AV's own log, so nothing is counted twice.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

from persistence.spotify_history import import_export
from persistence.storage import load_log


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print(__doc__)
        sys.exit(2)
    source = Path(args[0]).expanduser()
    log = load_log()
    starts = [datetime.fromisoformat(e["played_at"].replace("Z", "+00:00")) for e in log if e.get("played_at")]
    cutoff = min(starts) if starts else datetime.now(timezone.utc)
    summary = import_export(source, cutoff, copy_raw="--no-raw" not in sys.argv)
    for k, v in summary.items():
        print(f"{k}: {v}")


if __name__ == "__main__":
    main()
