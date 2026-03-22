"""
Integration tests — use the real CLAP model and run the full pipeline.

Marked with @pytest.mark.slow; skip in fast CI with:
    pytest -m "not slow"

These tests catch regressions in embedding quality and score thresholds
that unit tests with fake embeddings cannot detect.
"""

import numpy as np
import pytest

# conftest.py patches transformers before import, so we must undo that patch
# for integration tests that need the real model.
import sys
if "transformers" in sys.modules:
    # Only remove the stub — let the real transformers load on first import below.
    import importlib
    _stub = sys.modules.pop("transformers")
    try:
        import transformers  # real import
    except ImportError:
        sys.modules["transformers"] = _stub  # restore stub if not installed


@pytest.mark.slow
class TestRealClapIntegration:
    """Exercises the full pipeline with the real CLAP model loaded from disk.

    These tests are intentionally minimal — they assert structural correctness
    and that scores are above a meaningful threshold, not specific values.
    """

    @pytest.fixture(scope="class", autouse=True)
    def reload_main(self):
        """Reload main so it picks up the real transformers module."""
        import importlib
        if "main" in sys.modules:
            importlib.reload(sys.modules["main"])
        import main as m
        self.main = m
        yield

    def test_run_drum_assignment_returns_four_drums(self):
        from main import SR, detect_onsets, extract_clips, run_drum_assignment, DRUM_NAMES

        # 3-second audio with 4 clearly-spaced transients
        audio = np.zeros(int(3.0 * SR), dtype=np.float32)
        n, t  = 2048, np.arange(2048) / SR
        hit   = (np.sin(2 * np.pi * 440 * t) * np.exp(-t * 150)).astype(np.float32)
        for ts in [0.4, 0.9, 1.5, 2.2]:
            s = int(ts * SR)
            audio[s: s + n] += hit

        onsets = detect_onsets(audio)
        assert len(onsets) >= 4

        embed_clips, output_clips, times, clip_starts, clip_ends = extract_clips(audio, onsets)
        audio_embeds, drum_results, n_embedded = run_drum_assignment(
            audio, embed_clips, times, clip_starts, clip_ends
        )

        # All four drum slots should be filled
        assert set(drum_results.keys()) == set(DRUM_NAMES)

        # Every candidate must have a non-negative score
        for drum, info in drum_results.items():
            for c in info["candidates"]:
                assert c["score"] >= 0.0
                assert 0.0 <= c["trim_start"] < c["trim_end"] <= 1.0

        # audio_embeds must be a 2-D float array
        assert audio_embeds.ndim == 2
        assert audio_embeds.shape[1] == 512

    def test_prototype_scores_above_zero(self):
        """Real drum prototypes should score above 0 against genuine drum audio."""
        from main import PROTOTYPES, _embed_audio_arrays, SR, DRUM_NAMES

        audio = np.zeros(int(0.1 * SR), dtype=np.float32)
        n, t  = 2048, np.arange(2048) / SR
        hit   = (np.sin(2 * np.pi * 440 * t) * np.exp(-t * 150)).astype(np.float32)
        audio[: len(hit)] = hit

        embeds = _embed_audio_arrays([audio])   # (1, 512)
        for drum in DRUM_NAMES:
            protos  = np.stack(PROTOTYPES[drum])   # (n_protos, 512)
            scores  = embeds @ protos.T            # (1, n_protos)
            top_score = float(scores.max())
            # With real CLAP and real prototypes, any audio should score > 0
            assert top_score > 0.0, f"{drum} prototype scored {top_score:.3f}"
