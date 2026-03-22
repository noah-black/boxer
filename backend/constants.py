"""
Constants shared across the BOXER backend.

All timing values are in seconds unless suffixed with _SAMPLES.
All audio is resampled to SR before processing.
"""

import os
import pathlib

# ── Audio ─────────────────────────────────────────────────────────────────────
MODEL_ID         = "laion/larger_clap_general"
SAMPLE_RATE      = 48_000
CLIP_PRE         = 0.06    # seconds of pre-roll before each detected onset
CLIP_POST_MIN    = 0.06    # shortest allowed post-roll after onset
CLIP_POST_MAX    = 2.0     # longest allowed post-roll (onset-bounded in practice)
EMBED_WINDOW     = 0.15    # seconds fed to CLAP for classification (transient-focused)
CLIP_MARGIN      = 0.40    # extra audio on each side of clip for trim widening
LYRIC_POST_ROLL  = 0.20    # padding appended after each Whisper word timestamp
MAX_LYRIC_WORDS  = 400
WHISPER_MODEL    = "base"
MIN_GAP          = 0.07    # minimum gap between onsets (deduplication threshold)
MAX_CLIPS        = 600     # max onsets to process per upload
BATCH_SIZE       = 32      # CLAP embedding batch size
MAX_SECS         = 30      # server-side audio duration cap (frontend trimmer enforces too)
EARLY_EXIT_THRESH = 0.82   # stop embedding once all drums hit this score
EARLY_EXIT_MIN   = 64      # always embed at least this many clips before early exit
N_CANDIDATES     = 3       # runner-up candidates returned per drum slot
SESSION_TTL      = 1800    # seconds before session eviction (30 min)

# ── Paths / tools ─────────────────────────────────────────────────────────────
FFMPEG         = os.environ.get("FFMPEG_PATH", "ffmpeg")
REFERENCES_DIR = pathlib.Path(__file__).resolve().parent.parent / "references"

# ── Drum definitions ──────────────────────────────────────────────────────────
DRUM_NAMES = ["kick", "snare", "hihat", "clap"]

DRUM_TEXT_QUERIES: dict[str, list[str]] = {
    "kick":  ["kick drum", "bass drum", "low thud", "deep boom", "low frequency drum hit"],
    "snare": ["snare drum", "snare hit", "snappy crack", "rimshot", "sharp drum crack"],
    "hihat": ["hi-hat", "closed hi-hat", "metallic tick", "cymbal click", "sharp metallic percussion"],
    "clap":  ["clap", "hand clap", "finger snap", "rimshot clap", "percussive clap"],
}
