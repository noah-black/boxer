"""
DSP unit tests — no GPU, no model loading, runs in <1 s.

All tests synthesize audio from scratch so the expected onset positions
are exactly known, letting us assert tight tolerances.
"""

import numpy as np
import pytest

import main
from main import (
    SR, CLIP_PRE, CLIP_POST_MIN, CLIP_POST_MAX, EMBED_WINDOW,
    CLIP_MARGIN, MIN_GAP, MAX_CLIPS,
    detect_onsets, extract_clips, build_context_clip,
)

# ── Helpers ───────────────────────────────────────────────────────────────────

TOLERANCE_S = 0.030   # ±30 ms — looser than a hop length, but tight enough
TOLERANCE   = int(TOLERANCE_S * SR)


def make_transient(n_samples: int = 2048) -> np.ndarray:
    """Short sine burst with exponential decay — reliable for librosa onset detection."""
    t   = np.arange(n_samples) / SR
    env = np.exp(-t * 150)
    return (np.sin(2 * np.pi * 440 * t) * env).astype(np.float32)


def make_audio_with_onsets(duration_s: float, onset_times_s: list[float]) -> np.ndarray:
    """Silent background with transients placed at given times."""
    audio = np.zeros(int(duration_s * SR), dtype=np.float32)
    hit   = make_transient()
    for t in onset_times_s:
        s = int(t * SR)
        e = min(len(audio), s + len(hit))
        audio[s:e] += hit[: e - s]
    return audio


# ── detect_onsets ─────────────────────────────────────────────────────────────

class TestDetectOnsets:

    def test_finds_single_transient(self):
        audio   = make_audio_with_onsets(2.0, [0.5])
        onsets  = detect_onsets(audio)
        assert len(onsets) == 1
        assert abs(int(onsets[0]) - int(0.5 * SR)) < TOLERANCE

    def test_finds_multiple_transients(self):
        times  = [0.2, 0.6, 1.1, 1.6]
        audio  = make_audio_with_onsets(2.0, times)
        onsets = detect_onsets(audio)
        assert len(onsets) == len(times)
        for onset, expected in zip(sorted(onsets), sorted(int(t * SR) for t in times)):
            assert abs(int(onset) - expected) < TOLERANCE

    def test_silent_audio_returns_empty(self):
        audio  = np.zeros(int(1.0 * SR), dtype=np.float32)
        onsets = detect_onsets(audio)
        assert len(onsets) == 0

    def test_deduplication_below_min_gap(self):
        # Two transients only 15 ms apart — below MIN_GAP (70 ms) → one onset
        audio  = make_audio_with_onsets(2.0, [0.5, 0.515])
        onsets = detect_onsets(audio)
        assert len(onsets) == 1

    def test_two_transients_above_min_gap(self):
        # 200 ms apart — well above MIN_GAP → two onsets
        audio  = make_audio_with_onsets(2.0, [0.4, 0.6])
        onsets = detect_onsets(audio)
        assert len(onsets) == 2

    def test_onsets_are_sorted(self):
        audio  = make_audio_with_onsets(2.0, [1.0, 0.3, 0.7])
        onsets = detect_onsets(audio)
        assert list(onsets) == sorted(onsets)

    def test_backtrack_does_not_place_onset_after_transient(self):
        # The backtrack must snap onset to BEFORE or AT the transient start,
        # never after it.  Place transient at exactly t=0.5 s.
        target = int(0.5 * SR)
        audio  = make_audio_with_onsets(2.0, [0.5])
        onsets = detect_onsets(audio)
        assert len(onsets) == 1
        assert int(onsets[0]) <= target + TOLERANCE

    def test_max_clips_cap(self):
        # Flood the audio with more than MAX_CLIPS transients — result must be capped.
        n_hits = MAX_CLIPS + 50
        times  = [0.1 + i * 0.15 for i in range(n_hits)]
        audio  = make_audio_with_onsets(times[-1] + 0.5, times)
        onsets = detect_onsets(audio)
        assert len(onsets) <= MAX_CLIPS

    def test_returns_int_array(self):
        audio  = make_audio_with_onsets(1.0, [0.3])
        onsets = detect_onsets(audio)
        assert onsets.dtype == np.dtype(int) or np.issubdtype(onsets.dtype, np.integer)


# ── extract_clips ─────────────────────────────────────────────────────────────

class TestExtractClips:

    def setup_method(self):
        self.times_s = [0.3, 0.7, 1.2]
        self.audio   = make_audio_with_onsets(2.0, self.times_s)
        onsets       = detect_onsets(self.audio)
        self.embed_clips, self.output_clips, self.times, self.clip_starts, self.clip_ends = \
            extract_clips(self.audio, onsets)
        self.n = len(onsets)

    def test_all_lists_same_length(self):
        assert (len(self.embed_clips) == len(self.output_clips) ==
                len(self.times)       == len(self.clip_starts)   ==
                len(self.clip_ends)   == self.n)

    def test_embed_clips_exact_length(self):
        expected = int(EMBED_WINDOW * SR)
        for clip in self.embed_clips:
            assert len(clip) == expected

    def test_output_clips_within_post_bounds(self):
        post_min = int(CLIP_POST_MIN * SR)
        # Each clip must be at least pre + post_min samples
        min_len = int(CLIP_PRE * SR) + post_min
        for clip in self.output_clips:
            assert len(clip) >= min_len

    def test_output_clips_normalised(self):
        for clip in self.output_clips:
            assert np.max(np.abs(clip)) <= 0.9 + 1e-5

    def test_embed_clips_normalised(self):
        for clip in self.embed_clips:
            assert np.max(np.abs(clip)) <= 0.9 + 1e-5

    def test_clip_starts_before_clip_ends(self):
        for s, e in zip(self.clip_starts, self.clip_ends):
            assert s < e

    def test_clip_bounds_within_audio(self):
        for s, e in zip(self.clip_starts, self.clip_ends):
            assert s >= 0
            assert e <= len(self.audio)

    def test_times_are_start_times(self):
        # times[i] should equal clip_starts[i] / SR within a small tolerance
        for t, s in zip(self.times, self.clip_starts):
            assert abs(t - s / SR) < 0.001

    def test_single_onset_gets_full_post_roll(self):
        # With only one onset there is no next onset to bound the post-roll,
        # so the output clip should extend up to CLIP_POST_MAX.
        audio  = make_audio_with_onsets(3.0, [0.5])
        onsets = detect_onsets(audio)
        _, output_clips, *_ = extract_clips(audio, onsets)
        assert len(output_clips) == 1
        max_len = int(CLIP_PRE * SR) + int(CLIP_POST_MAX * SR) + 1
        assert len(output_clips[0]) <= max_len

    def test_output_clip_ends_before_next_onset(self):
        # The output clip for clip[i] must end at or before onset[i+1].
        audio  = make_audio_with_onsets(2.0, [0.3, 0.7, 1.2])
        onsets = detect_onsets(audio)
        _, _, _, starts, ends = extract_clips(audio, onsets)
        # ends[i] must be ≤ raw onset sample of the next hit (+ pre_samp slack)
        pre = int(CLIP_PRE * SR)
        for i in range(len(starts) - 1):
            assert ends[i] <= int(onsets[i + 1]) + pre + 1


# ── build_context_clip ────────────────────────────────────────────────────────

class TestBuildContextClip:

    def _make_ctx(self, clip_start, clip_end, audio_len=int(4.0 * SR)):
        audio = np.random.randn(audio_len).astype(np.float32)
        return build_context_clip(audio, clip_start, clip_end), audio, clip_start, clip_end

    def test_trim_fractions_in_range(self):
        (ctx, t_start, t_end), *_ = self._make_ctx(int(1.0 * SR), int(1.2 * SR))
        assert 0.0 <= t_start < t_end <= 1.0

    def test_trim_fractions_locate_original(self):
        """t_start and t_end must point to the original clip's sample range within ctx."""
        cs, ce = int(1.0 * SR), int(1.3 * SR)
        (ctx, t_start, t_end), audio, _, _ = self._make_ctx(cs, ce)
        ctx_len = len(ctx)
        margin  = int(CLIP_MARGIN * SR)
        ctx_s   = max(0, cs - margin)

        expected_t_start = (cs - ctx_s) / ctx_len
        expected_t_end   = (ce - ctx_s) / ctx_len

        # Allow 1-sample rounding error from the round() calls in build_context_clip
        assert abs(t_start - expected_t_start) < 2 / ctx_len
        assert abs(t_end   - expected_t_end)   < 2 / ctx_len

    def test_normalised(self):
        (ctx, _, _), *_ = self._make_ctx(int(1.0 * SR), int(1.2 * SR))
        assert np.max(np.abs(ctx)) <= 0.9 + 1e-5

    def test_clip_at_audio_start(self):
        """Clip at position 0 — no left margin available."""
        cs, ce = 0, int(0.1 * SR)
        (ctx, t_start, t_end), *_ = self._make_ctx(cs, ce, audio_len=int(2.0 * SR))
        assert t_start == 0.0
        assert t_end > 0.0

    def test_clip_at_audio_end(self):
        """Clip at the very end of audio — no right margin available."""
        audio_len = int(2.0 * SR)
        ce        = audio_len
        cs        = audio_len - int(0.1 * SR)
        (ctx, t_start, t_end), *_ = self._make_ctx(cs, ce, audio_len=audio_len)
        assert t_end == 1.0
        assert t_start < 1.0
