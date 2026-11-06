"""
All tunable parameters for the two-stage synthetic data pipeline live here.
Changing the sample size, weighting, timespan, or volume is a config edit + re-run,
never a code change. See ~/.engram/PRJ/PRJ-0005/notes.md for the design rationale.
"""

import os

# ── Stage 1: catalog seed selection (export_catalog_seed.py) ────────────────

# Fixed seed for reproducible sampling. Tied to the decision date for traceability.
CATALOG_SEED = 20260803

# How many real artists to pull into the synthetic catalog vocabulary.
# Agreed range: 150-250. Approved sample used 200.
# Set high enough to include every real artist (weighted_sample_without_replacement
# just returns everything available if this exceeds the real count) — session 5,
# fifth pass: capping this at 200 meant only ~1-12 artists were ever simultaneously
# eligible at any moment once the 90-day album cooldown was actually honored (most
# artists are single-album, so post-play they're cooldown-blocked ~90 of every ~91
# days) — a structural pool-crunch no amount of budget/cap tuning could fix.
ARTIST_SAMPLE_TARGET = 10_000

# Weight formula inputs: broader real catalog presence (distinct albums) weighted
# most, genre-tag presence as a smaller boost. See weight() in export_catalog_seed.py.
WEIGHT_ALBUMS_MULTIPLIER = 3.0
WEIGHT_GENRES_MULTIPLIER = 0.5
WEIGHT_BASE = 1.0

# ── Stage 2: synthetic behavior generation (generate_synthetic_data.py) ─────

# Fixed seed for reproducible synthetic behavior. Independent of CATALOG_SEED so
# re-rolling behavior doesn't require re-rolling which artists were selected.
# Overridable via env var so refresh_demo_data.sh can roll a fresh one without
# editing this file — every real-data exception (ratings/favorites/tops/Claudio)
# stays anchored to truth regardless of this value; only the synthetic scaffolding
# around it (session timing, discovery pacing, which of the eligible plays actually
# happened) changes.
BEHAVIOR_SEED = int(os.environ.get("BEHAVIOR_SEED", 20260803))

# Simulated history length, in months, ending "today" (relative to generation time).
TIMESPAN_MONTHS = 9

# Target average track plays per day across the whole timespan. This is a
# *budget*, not a guarantee — some of it structurally dead-ends (album-
# cooldown eligibility). Re-check `data-gen/generate_synthetic_data.py`'s
# "[debug] day-loop" print and the weekly-album-density bar (every week needs
# a full 16-album grid) after changing this or ARTIST_SAMPLE_TARGET.
AVG_PLAYS_PER_DAY = 60

# Zipf exponent for the artist play-frequency distribution (long-tail power law).
# ~1.0-1.2 is a standard long-tail shape; higher = more concentrated in top artists.
ARTIST_ZIPF_EXPONENT = 1.1

# Number of eras to split the timespan into for genre-drift modeling (each era
# shifts artist-selection weighting toward a different genre cluster).
GENRE_DRIFT_ERAS = 3


# The imported "Spotify history" that sits before AV's own log, as the real app has.
# It runs from this date up to the day the simulated AV log begins. The real app's
# import starts here too; only the span is shared, every play in it is synthetic.
HISTORY_START = "2017-03-17"

# Average plays per day across that archive, before yearly and monthly swings.
HISTORY_PLAYS_PER_DAY = 30

# Share of artists kept out of the archive entirely, so the AV era still has real
# first-time discoveries instead of every artist already being years old.
HISTORY_HOLDOUT_SHARE = 0.12

# Share of the catalog still in rotation during the AV era. Everything else was played
# during some stretch of the archive and then left alone, so "last played" spreads across
# the years the way a real library's does. The AV log only plays this share.
ROTATION_ALBUM_SHARE = 0.30

# Days before the AV log may repeat an album. This and ROTATION_ALBUM_SHARE trade off: a small
# pool with a long cooldown dead-ends and thins the weekly Periods grid, while a large pool
# piles last-played dates into the AV era (every album it plays counts as last played then).
# Tuned together on three seeds. 30 days at 0.50 put ~310 albums in the AV era. 14 days at
# 0.22 put ~140 there but thinned the grids. 10 days at 0.30, with ROTATION_QUIET_SHARE at 0.5,
# gives ~185 spread across every month, with almost no thin weeks. Judge changes by the real
# Periods tiles in the snapshots, not by counting albums per week: that count flatters.
ALBUM_COOLDOWN_DAYS = 10

# Share of those rotation albums that go quiet partway through the AV era instead of playing
# right up to today. Without it, nothing is ever last played in the middle of the AV era, and
# the Recent sort shows a hole between the archive's end and the last few weeks.
ROTATION_QUIET_SHARE = 0.5

# Number of hand-written freeform notes to distribute across albums/vinyl records.
HANDWRITTEN_NOTES_COUNT = 12
