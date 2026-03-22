"""
DSP utilities: audio loading, onset detection, clip extraction, and context windowing.
"""

import io
import os
import base64
import subprocess
import tempfile

import numpy as np
import librosa
import soundfile as sf
from fastapi import HTTPException

from backend.constants import (
    SAMPLE_RATE, CLIP_PRE, CLIP_POST_MIN, CLIP_POST_MAX,
    EMBED_WINDOW, CLIP_MARGIN, MIN_GAP, MAX_CLIPS, MAX_SECS, FFMPEG,
)


def load_audio(data: bytes) -> np.ndarray:
    """Decode arbitrary audio bytes to a mono float32 numpy array at SAMPLE_RATE.

    Uses ffmpeg for format conversion. Raises HTTPException on failure.
    """
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp_in:
        tmp_in.write(data)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path + ".wav"
    try:
        result = subprocess.run(
            [FFMPEG, "-y", "-i", tmp_in_path, "-ar", str(SAMPLE_RATE), "-ac", "1", "-f", "wav", tmp_out_path],
            capture_output=True,
        )
        if result.returncode != 0:
            raise HTTPException(400, f"ffmpeg failed: {result.stderr.decode()[-300:]}")
        audio, _ = librosa.load(tmp_out_path, sr=SAMPLE_RATE, mono=True)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(400, f"Could not decode audio: {exc}")
    finally:
        os.unlink(tmp_in_path)
        if os.path.exists(tmp_out_path):
            os.unlink(tmp_out_path)
    return audio


def clip_to_base64_wav(clip: np.ndarray) -> str:
    """Encode a numpy audio clip as a base64-encoded WAV string."""
    buf = io.BytesIO()
    sf.write(buf, clip, SAMPLE_RATE, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()


def detect_onsets(audio: np.ndarray) -> np.ndarray:
    """Detect onset sample positions in audio with aggressive backtracking.

    Returns a sorted int array of sample indices. Applies:
    1. librosa onset detection (no built-in backtrack)
    2. Custom backtrack: scan back up to 60ms looking for 5% of local peak
    3. Deduplication with MIN_GAP minimum spacing
    4. Cap at MAX_CLIPS (keeps highest-energy onsets)
    """
    hop     = 256
    frames  = librosa.onset.onset_detect(y=audio, sr=SAMPLE_RATE, hop_length=hop,
                                          backtrack=False, units="frames")
    samples = librosa.frames_to_samples(frames, hop_length=hop)

    # Scan back up to 60ms from each onset to find where energy first crosses
    # 5% of the local peak — catches fast transients that librosa's energy-based
    # backtrack misses because they precede the energy buildup.
    search_back_samples = int(0.06 * SAMPLE_RATE)
    snapped = []
    for onset_sample in samples:
        window_start = max(0, onset_sample - search_back_samples)
        window = audio[window_start : onset_sample + int(0.02 * SAMPLE_RATE)]
        if len(window) == 0:
            snapped.append(int(onset_sample))
            continue
        peak      = np.max(np.abs(window))
        threshold = peak * 0.05
        true_start = onset_sample
        for scan_idx in range(len(window) - 1, -1, -1):
            if abs(window[scan_idx]) < threshold:
                true_start = window_start + scan_idx
                break
        snapped.append(int(true_start))

    # Deduplicate onsets closer than MIN_GAP
    min_gap_samples = int(MIN_GAP * SAMPLE_RATE)
    deduped: list[int] = []
    last_onset = -min_gap_samples
    for sample in sorted(snapped):
        if sample - last_onset >= min_gap_samples:
            deduped.append(int(sample))
            last_onset = sample

    if not deduped:
        return np.array([], dtype=int)

    # Cap at MAX_CLIPS, keeping highest-energy onsets
    if len(deduped) > MAX_CLIPS:
        clip_len = int((CLIP_PRE + CLIP_POST_MAX) * SAMPLE_RATE)
        energies = [
            float(np.sqrt(np.mean(
                audio[max(0, s - int(CLIP_PRE * SAMPLE_RATE)):
                      max(0, s - int(CLIP_PRE * SAMPLE_RATE)) + clip_len] ** 2
            )))
            for s in deduped
        ]
        order   = np.argsort(energies)[::-1][:MAX_CLIPS]
        deduped = [deduped[i] for i in sorted(order)]

    return np.array(deduped, dtype=int)


def extract_clips(audio: np.ndarray, onsets: np.ndarray):
    """Extract two sets of clips per onset for embedding and playback.

    Returns:
        embed_clips:  Short EMBED_WINDOW clips for CLAP classification (transient-focused).
        output_clips: Full onset-bounded clips for playback (up to CLIP_POST_MAX).
        times:        Start time in seconds for each clip.
        clip_starts:  Start sample index in original audio.
        clip_ends:    End sample index in original audio.

    Both clip types share the same pre-roll so start times are identical.
    """
    pre_samples      = int(CLIP_PRE * SAMPLE_RATE)
    post_min_samples = int(CLIP_POST_MIN * SAMPLE_RATE)
    post_max_samples = int(CLIP_POST_MAX * SAMPLE_RATE)
    embed_samples    = int(EMBED_WINDOW * SAMPLE_RATE)
    embed_clips, output_clips, times, clip_starts, clip_ends = [], [], [], [], []

    for i, onset in enumerate(onsets):
        start = max(0, onset - pre_samples)

        # Output clip: onset-bounded, long tail
        if i + 1 < len(onsets):
            gap = int(onsets[i + 1]) - int(onset) - pre_samples
            post_onset_samples = int(np.clip(gap, post_min_samples, post_max_samples))
        else:
            post_onset_samples = post_max_samples
        end = min(len(audio), onset + post_onset_samples)
        output_clip = audio[start:end].copy()
        peak = np.max(np.abs(output_clip))
        if peak > 1e-6:
            output_clip = output_clip / peak * 0.9
        output_clips.append(output_clip)
        clip_starts.append(int(start))
        clip_ends.append(int(end))

        # Embed clip: fixed short window, same start
        embed_end = min(len(audio), start + embed_samples)
        embedding_clip = audio[start:embed_end].copy()
        if len(embedding_clip) < embed_samples:
            embedding_clip = np.pad(embedding_clip, (0, embed_samples - len(embedding_clip)))
        embed_peak = np.max(np.abs(embedding_clip))
        if embed_peak > 1e-6:
            embedding_clip = embedding_clip / embed_peak * 0.9
        embed_clips.append(embedding_clip)

        times.append(float(start) / SAMPLE_RATE)

    return embed_clips, output_clips, times, clip_starts, clip_ends


def clip_to_context_times(audio: np.ndarray, clip_start: int, clip_end: int) -> dict:
    """Compute context window boundaries, trim fractions, and normalisation gain.

    The context window extends CLIP_MARGIN beyond each side of the original clip.
    The client uses trim_start/trim_end to locate the original clip within this
    wider window, and norm_gain to normalise playback volume.
    """
    margin_samples = int(CLIP_MARGIN * SAMPLE_RATE)
    ctx_start      = max(0, clip_start - margin_samples)
    ctx_end        = min(len(audio), clip_end + margin_samples)
    ctx_length     = ctx_end - ctx_start
    peak           = float(np.max(np.abs(audio[ctx_start:ctx_end]))) if ctx_length > 0 else 0.0
    norm_gain      = round(0.9 / peak, 4) if peak > 1e-6 else 1.0
    trim_start     = (clip_start - ctx_start) / ctx_length if ctx_length > 0 else 0.0
    trim_end       = (clip_end   - ctx_start) / ctx_length if ctx_length > 0 else 1.0
    return {
        "ctx_start_s": round(ctx_start / SAMPLE_RATE, 4),
        "ctx_end_s":   round(ctx_end / SAMPLE_RATE, 4),
        "trim_start":  round(float(trim_start), 4),
        "trim_end":    round(float(trim_end), 4),
        "norm_gain":   norm_gain,
    }
