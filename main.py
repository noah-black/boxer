"""
Drum Extractor — FastAPI backend (thin shim).

All logic lives in the backend/ package. This file exists so that
`uvicorn main:app` continues to work unchanged.
"""

import logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

from backend.app import app  # noqa: E402, F401 — re-export for uvicorn

# Re-export symbols used by tests (they `import main; main.load_audio` etc.)
from backend.constants import (  # noqa: E402, F401
    SAMPLE_RATE as SR,
    CLIP_PRE, CLIP_POST_MIN, CLIP_POST_MAX, EMBED_WINDOW,
    CLIP_MARGIN, MIN_GAP, MAX_CLIPS, MAX_SECS, N_CANDIDATES,
    DRUM_NAMES, SESSION_TTL,
)
from backend.dsp import (  # noqa: E402, F401
    load_audio, detect_onsets, extract_clips, clip_to_context_times as clip_to_ctx_times,
    clip_to_base64_wav as clip_to_b64_wav,
)
from backend.models import (  # noqa: E402, F401
    embed_audio_arrays as _embed_audio_arrays,
    embed_texts as _embed_texts,
    embed_audio_batch as _embed_batch,
    PROTOTYPES, VOCAB_EMBEDS, nearest_vocab,
    transcribe_audio,
)
from backend.analysis import (  # noqa: E402, F401
    run_drum_assignment, run_custom_text_queries,
)
from backend.app import _sessions, _new_session, _get_session  # noqa: E402, F401
