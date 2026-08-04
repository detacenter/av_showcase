"""
Phase 3: generates static API-response snapshots by running the real (sanitized)
backend once, locally, against the synthetic data/ directory, and saving each
in-scope GET endpoint's actual JSON response as a file the service worker serves.

This is a build-time-only tool. The backend it starts is never deployed and never
runs again after this script finishes — see PRJ-0005 notes.md "Phase 3 scoping"
for the full architecture rationale.

CRITICAL — two things this script guards against, both found the hard way in
session 4 (see PRJ-0005 session log for the full story):

1. Absolute local paths leaking into snapshots. The real backend's
   data_path()-derived fields (e.g. art_local_path) resolve to absolute local
   filesystem paths on whatever machine runs this script (e.g.
   "/Users/<you>/code/av_showcase/data/artwork/foo.jpg"). sanitize_paths()
   strips every such field down to just the filename before anything is
   written to disk.

2. The real backend mutating data/ as a side effect of merely starting up.
   state.py's get_state() runs artwork backfill, log deduplication, and
   album-alias remapping on every startup — none of which this tool wants,
   since data/ is supposed to be pure generator *input*, not something a
   build tool silently rewrites. Rather than chase every individual mutation
   path (more may exist that haven't been found yet), this script snapshots
   every JSON file under data/ (and the artwork/ filename list) before
   starting the backend, and force-restores them afterward, unconditionally.
   The backend is treated as a pure input->output function even though it
   isn't actually written as one.

It also refuses to start if something is already listening on its port,
instead of silently talking to a stray leftover process (which is exactly
what happened the first time this script ran against an unkilled process
from an earlier manual test — it looked like a success and wasn't).
"""
from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen
from urllib.error import URLError

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ARTWORK_DIR = DATA_DIR / "artwork"
OUT_DIR = ROOT / "frontend" / "public" / "mock-api"
BACKEND_DIR = ROOT / "backend"
PORT = 8123
BASE_URL = f"http://127.0.0.1:{PORT}"

ENDPOINTS = {
    "/api/recent/albums": "recent-albums.json",
    "/api/settings": "settings.json",
}

_ABS_PATH_RE = re.compile(r"^/[^\s]*/([^/\s]+)$")


def sanitize_paths(obj):
    if isinstance(obj, dict):
        return {k: sanitize_paths(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_paths(v) for v in obj]
    if isinstance(obj, str):
        m = _ABS_PATH_RE.match(obj)
        if m and ("/Users/" in obj or "/home/" in obj):
            return m.group(1)
    return obj


def port_in_use() -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("127.0.0.1", PORT)) == 0


def wait_for_own_server(proc: subprocess.Popen, timeout=15):
    start = time.time()
    while time.time() - start < timeout:
        if proc.poll() is not None:
            raise SystemExit(f"Backend subprocess exited early with code {proc.returncode}.")
        try:
            urlopen(f"{BASE_URL}/api/recent/albums", timeout=1)
            return
        except URLError:
            time.sleep(0.3)
    raise SystemExit("Backend didn't come up in time.")


def snapshot_data_state() -> dict:
    """Record everything under data/ well enough to force-restore it later:
    exact bytes for every top-level JSON file, and just the filename set for
    artwork/ (large binary files — restoring means deleting anything new,
    not re-copying originals that were never touched)."""
    json_files = {
        p.name: p.read_bytes()
        for p in DATA_DIR.glob("*.json")
    }
    artwork_names = set(p.name for p in ARTWORK_DIR.glob("*")) if ARTWORK_DIR.exists() else set()
    return {"json_files": json_files, "artwork_names": artwork_names}


def restore_data_state(before: dict) -> None:
    # Restore known JSON files to their exact original bytes.
    for name, content in before["json_files"].items():
        (DATA_DIR / name).write_bytes(content)
    # Delete any JSON file that didn't exist before (e.g. api_metrics.json,
    # a real-app instrumentation artifact triggered just by running it).
    for p in DATA_DIR.glob("*.json"):
        if p.name not in before["json_files"]:
            print(f"  restore: removing unexpected new file data/{p.name}")
            p.unlink()
    # Delete any artwork file that appeared during the run (a live Spotify
    # CDN download triggered by backfill finding a genuinely-missing local
    # file — legitimate content, but not something this tool should decide
    # to keep silently; re-bundle deliberately via export_catalog_seed.py
    # if broader artwork coverage is wanted).
    if ARTWORK_DIR.exists():
        for p in ARTWORK_DIR.glob("*"):
            if p.name not in before["artwork_names"]:
                print(f"  restore: removing unexpected new file data/artwork/{p.name}")
                p.unlink()


def main():
    venv_python = BACKEND_DIR / ".venv" / "bin" / "python3"
    if not venv_python.exists():
        raise SystemExit(f"No venv at {venv_python} — run: cd backend && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt")

    if port_in_use():
        raise SystemExit(
            f"Port {PORT} is already in use — refusing to start, since this script "
            "would silently talk to whatever's already there instead of its own "
            "subprocess. Find and stop it first (lsof -i :{PORT})."
        )

    before = snapshot_data_state()

    env = {**os.environ, "AUDIOVAULT_DATA_DIR": str(DATA_DIR)}
    proc = subprocess.Popen(
        [str(venv_python), "-m", "uvicorn", "app:app", "--port", str(PORT)],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    try:
        wait_for_own_server(proc)

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        for path, filename in ENDPOINTS.items():
            with urlopen(f"{BASE_URL}{path}", timeout=10) as resp:
                data = json.load(resp)
            clean = sanitize_paths(data)
            out_path = OUT_DIR / filename
            with out_path.open("w") as f:
                json.dump(clean, f, indent=2)
            print(f"{path} -> {out_path.relative_to(ROOT)}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=5)
        restore_data_state(before)


if __name__ == "__main__":
    main()
