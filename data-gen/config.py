"""
All tunable parameters for the two-stage synthetic data pipeline live here.
Changing the sample size, weighting, timespan, or volume is a config edit + re-run,
never a code change. See ~/.engram/PRJ/PRJ-0005/notes.md for the design rationale.
"""

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
BEHAVIOR_SEED = 20260803

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


# Number of hand-written freeform notes to distribute across albums/vinyl records.
HANDWRITTEN_NOTES_COUNT = 12
