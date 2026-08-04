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
ARTIST_SAMPLE_TARGET = 200

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

# Target average track plays per day across the whole timespan.
AVG_PLAYS_PER_DAY = 20

# Zipf exponent for the artist play-frequency distribution (long-tail power law).
# ~1.0-1.2 is a standard long-tail shape; higher = more concentrated in top artists.
ARTIST_ZIPF_EXPONENT = 1.1

# Number of eras to split the timespan into for genre-drift modeling (each era
# shifts artist-selection weighting toward a different genre cluster).
GENRE_DRIFT_ERAS = 3

# Fraction of selected albums that get a library.json rating (1-5, skewed positive).
ALBUM_RATING_FRACTION = 0.35

# Fraction of selected albums that get a synthetic vinyl/Discogs record.
VINYL_COVERAGE_FRACTION = 0.25

# Number of hand-written freeform notes to distribute across albums/vinyl records.
HANDWRITTEN_NOTES_COUNT = 12
