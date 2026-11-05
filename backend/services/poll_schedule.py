"""When the next Spotify auto-poll happens. Gaps are random so there's no fixed cadence:
short while something is playing (Spotify only remembers the last 50 plays, ~2.5 h), long
while nothing is. Within each range a minute isn't reused until every other minute has come
up (a shuffled bag), and seconds are random on top. Pure, so it can be tested on its own."""
import random

LISTENING_MINUTES = range(10, 20)   # 10:00 to 19:59 between polls while playing
IDLE_MINUTES = range(45, 75)        # 45:00 to 74:59 while nothing is playing


class PollSchedule:
    def __init__(self, rng: random.Random | None = None):
        self.rng = rng or random.Random()
        self.bags: dict[bool, list[int]] = {True: [], False: []}

    def next_wait(self, playing: bool) -> float:
        """Seconds until the next poll."""
        bag = self.bags[playing]
        if not bag:
            bag.extend(LISTENING_MINUTES if playing else IDLE_MINUTES)
            self.rng.shuffle(bag)
        return bag.pop() * 60 + self.rng.uniform(0, 60)
