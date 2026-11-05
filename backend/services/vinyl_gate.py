"""Start gate for the vinyl monitor: a session starts only after sustained signal, so the
needle lifting, putting a record away or switching the preamp off (a second or two of
pops) doesn't open a phantom session. Pure, so it can be tested without an audio device."""
from collections import deque


class StartGate:
    def __init__(self, need_seconds: float, window_seconds: float, block_seconds: float):
        self.need = need_seconds
        self.window = window_seconds
        self.block = block_seconds
        self.recent: deque[tuple[float, bool]] = deque()

    def feed(self, now: float, above: bool) -> float | None:
        """Record one block; return when the sound began once there's been enough of it."""
        self.recent.append((now, above))
        while self.recent and self.recent[0][0] < now - self.window:
            self.recent.popleft()
        heard = sum(1 for _, a in self.recent if a) * self.block
        if above and heard >= self.need:
            return next(t for t, a in self.recent if a)
        return None

    def reset(self) -> None:
        self.recent.clear()
