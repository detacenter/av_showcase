"""
Monitors the USB audio interface for vinyl playback.
Detects signal start (record playing) and silence (record stopped).
Notifies the backend API to trigger the session prompt.
"""

import time
import logging
import requests
import numpy as np
import sounddevice as sd

# ── Config ────────────────────────────────────────────────────────────────────

DEVICE_INDEX       = 0       # USB Audio CODEC is card 0
SAMPLE_RATE        = 44100
BLOCK_SIZE         = 4096    # samples per chunk (~93ms)
SIGNAL_THRESHOLD   = 0.01    # RMS above this = audio playing
SILENCE_SECONDS    = 120     # seconds of silence before session ends
API_BASE           = "http://localhost:8000"

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
log = logging.getLogger(__name__)

# ── State ─────────────────────────────────────────────────────────────────────

session_active   = False
silence_since    = None

# ── Helpers ───────────────────────────────────────────────────────────────────

def rms(block):
    return float(np.sqrt(np.mean(block ** 2)))

def post(path):
    try:
        requests.post(f"{API_BASE}{path}", timeout=3)
    except Exception as e:
        log.warning(f"API call failed: {e}")

# ── Main loop ─────────────────────────────────────────────────────────────────

def main():
    global session_active, silence_since

    log.info("Vinyl monitor started — listening on device %d", DEVICE_INDEX)

    with sd.InputStream(device=DEVICE_INDEX, channels=2,
                        samplerate=SAMPLE_RATE, blocksize=BLOCK_SIZE,
                        dtype="float32") as stream:
        while True:
            block, _ = stream.read(BLOCK_SIZE)
            level = rms(block)

            if level > SIGNAL_THRESHOLD:
                silence_since = None
                if not session_active:
                    session_active = True
                    log.info("Signal detected (RMS %.4f) — session started", level)
                    post("/api/vinyl/session/start")
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
