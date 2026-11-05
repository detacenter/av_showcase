"""
Monitors the USB audio interface for vinyl playback.
Detects signal start (record playing) and silence (record stopped).
Notifies the backend API to trigger the session prompt.
"""

import logging
import time

import numpy as np
import requests
import sounddevice as sd

from vinyl_gate import StartGate   # run as a script from backend/, so services/ is on the path

# ── Config ────────────────────────────────────────────────────────────────────

DEVICE_INDEX       = 0       # USB Audio CODEC is card 0
SAMPLE_RATE        = 44100
BLOCK_SIZE         = 4096    # samples per chunk (~93ms)
SIGNAL_THRESHOLD   = 0.01    # RMS above this = audio playing
SILENCE_SECONDS    = 50      # silence before a session ends. Logged side flips take 15-29 s and a
                             # record swap ~105 s (2026-10-31); a slower flip is merged back on confirm.
API_BASE           = "http://localhost:8000"
LEVEL_LOG_SECONDS  = 30      # log RMS stats this often, to tune SIGNAL_THRESHOLD
START_SECONDS      = 5       # signal needed within START_WINDOW before a session starts. After a
START_WINDOW       = 10      # record ends, handling and the preamp switching off gave 0.3-2.6 s
                             # bursts that each opened a <1 min session (2026-11-03); music is
                             # above threshold nearly every block.

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

session_active   = False
silence_since    = None

# ── Helpers ───────────────────────────────────────────────────────────────────

def rms(block):
    return float(np.sqrt(np.mean(block ** 2)))

RETRY_SECONDS      = 5       # re-send a failed start/end until the backend is back

pending: list[str] = []      # API calls that failed (backend restarting); retried in order
last_retry = 0.0


def post(path):
    try:
        requests.post(f"{API_BASE}{path}", timeout=3)
        return True
    except Exception as e:
        log.warning(f"API call failed, will retry: {e}")
        pending.append(path)
        return False


def retry_pending():
    global last_retry
    if not pending or time.time() - last_retry < RETRY_SECONDS:
        return
    last_retry = time.time()
    path = pending[0]
    try:
        requests.post(f"{API_BASE}{path}", timeout=3)
        pending.pop(0)
        log.info("Retried %s OK", path)
    except Exception:
        pass

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    global session_active, silence_since

    log.info("Vinyl monitor started — listening on device %d", DEVICE_INDEX)

    with sd.InputStream(device=DEVICE_INDEX, channels=2,
                        samplerate=SAMPLE_RATE, blocksize=BLOCK_SIZE,
                        dtype="float32") as stream:
        window: list[float] = []
        window_start = time.time()
        gate = StartGate(START_SECONDS, START_WINDOW, BLOCK_SIZE / SAMPLE_RATE)
        while True:
            block, _ = stream.read(BLOCK_SIZE)
            level = rms(block)
            retry_pending()

            # Diagnostics: the idle noise floor vs. music levels, to pick a threshold.
            window.append(level)
            if time.time() - window_start >= LEVEL_LOG_SECONDS:
                w = np.array(window)
                log.info("Levels %ds: min %.4f p50 %.4f p90 %.4f max %.4f · above threshold %d/%d · session %s",
                         LEVEL_LOG_SECONDS, w.min(), np.median(w), np.percentile(w, 90), w.max(),
                         int((w > SIGNAL_THRESHOLD).sum()), len(w), "on" if session_active else "off")
                window, window_start = [], time.time()

            began = gate.feed(time.time(), level > SIGNAL_THRESHOLD)
            if level > SIGNAL_THRESHOLD:
                silence_since = None
                if not session_active and began is not None:
                    session_active = True
                    gate.reset()
                    log.info("Signal sustained %ds (RMS %.4f) — session started, back-dated %.0fs",
                             START_SECONDS, level, time.time() - began)
                    post(f"/api/vinyl/session/start?started_at={began:.1f}")
            else:
                if session_active:
                    if silence_since is None:
                        silence_since = time.time()
                    elif time.time() - silence_since >= SILENCE_SECONDS:
                        session_active = False
                        silence_since  = None
                        log.info("Silence for %ds — session ended", SILENCE_SECONDS)
                        post("/api/vinyl/session/end")

if __name__ == "__main__":
    main()
