"""
FastAPI application: routes, CORS, session cache, and static file serving.
"""

import json
import logging
import pathlib
import time as _time
import uuid as _uuid

import numpy as np
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.constants import SAMPLE_RATE, SESSION_TTL, N_CANDIDATES
from backend.models import (
    embed_audio_arrays, embed_texts, nearest_vocab, transcribe_audio,
)
from backend.dsp import load_audio, clip_to_base64_wav, detect_onsets, extract_clips, clip_to_context_times
from backend.analysis import run_drum_assignment, run_custom_text_queries

log = logging.getLogger(__name__)

# ── FastAPI app ───────────────────────────────────────────────────────────────
app = FastAPI(title="Drum Extractor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Session cache ─────────────────────────────────────────────────────────────
_sessions: dict = {}


def _new_session(audio_embeds, times, transcript,
                  audio_raw, clip_starts, clip_ends) -> str:
    """Create a new session and evict expired ones. Returns session ID."""
    session_id = str(_uuid.uuid4())
    _sessions[session_id] = {
        "audio_embeds": audio_embeds,
        "times":        times,
        "transcript":   transcript,
        "audio_raw":    audio_raw,
        "clip_starts":  clip_starts,
        "clip_ends":    clip_ends,
        "last_access":  _time.time(),
    }
    now = _time.time()
    for key in list(_sessions.keys()):
        if now - _sessions[key]["last_access"] > SESSION_TTL:
            del _sessions[key]
    return session_id


def _get_session(session_id: str):
    """Look up a session by ID, updating its last-access timestamp."""
    sess = _sessions.get(session_id)
    if sess:
        sess["last_access"] = _time.time()
    return sess


# ── Routes ────────────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(file: UploadFile = File(...), custom_texts: str = Form(default="{}")):
    """Main pipeline: audio → onset detection → CLAP embeddings → drum candidates + session."""
    import time as _t
    t0 = _t.perf_counter()
    raw   = await file.read()
    audio = load_audio(raw)
    duration = len(audio) / SAMPLE_RATE
    t_load = _t.perf_counter()
    log.info(f"Audio: {duration:.1f}s  load={t_load-t0:.2f}s")
    if duration < 0.5:
        raise HTTPException(400, "Audio too short (minimum 0.5 s)")
    from backend.constants import MAX_SECS
    if duration > MAX_SECS:
        raise HTTPException(400, f"Audio too long (maximum {MAX_SECS} s)")

    onsets = detect_onsets(audio)
    t_onsets = _t.perf_counter()
    log.info(f"Onsets: {len(onsets)}  onset_detect={t_onsets-t_load:.2f}s")
    if len(onsets) == 0:
        raise HTTPException(422, "No onsets detected")

    embed_clips, output_clips, times, clip_starts, clip_ends = extract_clips(audio, onsets)

    try:
        custom_dict = json.loads(custom_texts) if custom_texts else {}
    except json.JSONDecodeError:
        custom_dict = {}

    audio_embeds, drum_results, n_embedded = run_drum_assignment(
        audio, embed_clips, times, clip_starts, clip_ends
    )
    t_clap = _t.perf_counter()
    log.info(f"CLAP done  clap={t_clap-t_onsets:.2f}s")

    # Trim lists to embedded count (early exit may have stopped before all clips)
    times       = times[:n_embedded]
    clip_starts = clip_starts[:n_embedded]
    clip_ends   = clip_ends[:n_embedded]

    custom_results = run_custom_text_queries(
        audio_embeds, clip_starts, clip_ends, times, audio, custom_dict
    )
    drum_results.update(custom_results)

    session_id = _new_session(audio_embeds, times, [], audio, clip_starts, clip_ends)
    log.info(f"TOTAL={_t.perf_counter()-t0:.2f}s  (load={t_load-t0:.2f}  onsets={t_onsets-t_load:.2f}  clap={t_clap-t_onsets:.2f})")
    return {"drums": drum_results, "onset_count": n_embedded, "session_id": session_id}


@app.post("/transcribe")
async def transcribe_route(file: UploadFile = File(...)):
    """Transcribe audio using Whisper and return word-level timestamps."""
    import time as _t
    t0  = _t.perf_counter()
    raw = await file.read()
    audio = load_audio(raw)
    log.info(f"Transcribe: {len(audio)/SAMPLE_RATE:.1f}s")
    words = transcribe_audio(audio)
    log.info(f"  {len(words)} words  whisper={_t.perf_counter()-t0:.2f}s")
    return {"words": words}


@app.post("/record-custom")
async def record_custom(
    file:    UploadFile = File(...),
    slot_id: str        = Form(...),
    top_k:   int        = Form(default=5),
):
    """Receive a short audio clip recorded into a custom pad.

    Returns the trimmed/normalised audio as base64 WAV + nearest vocabulary labels.
    No onset detection — the whole clip is treated as one sound.
    """
    raw   = await file.read()
    audio = load_audio(raw)

    # Strip only leading/trailing near-digital-silence using an absolute RMS
    # threshold — avoids the relative-trim bug where quiet sounds get eaten.
    frame_size = 512
    rms = np.array([
        np.sqrt(np.mean(audio[i:i+frame_size]**2))
        for i in range(0, len(audio)-frame_size, frame_size)
    ])
    floor = max(rms) * 0.01   # 1% of peak RMS — absolute floor
    active_frames = np.where(rms > floor)[0]
    if len(active_frames) >= 2:
        trim_start = max(0, active_frames[0] * frame_size - frame_size)
        trim_end   = min(len(audio), (active_frames[-1] + 2) * frame_size)
        audio_trimmed = audio[trim_start:trim_end]
    else:
        audio_trimmed = audio
    if len(audio_trimmed) < int(SAMPLE_RATE * 0.02):
        audio_trimmed = audio

    # Peak-normalise
    peak = np.max(np.abs(audio_trimmed))
    if peak > 1e-6:
        audio_trimmed = audio_trimmed / peak * 0.9

    # Embed and label
    embed  = embed_audio_arrays([audio_trimmed])   # (1, D)
    labels = nearest_vocab(embed[0], top_k=top_k)

    log.info(f"  {slot_id}: recorded {len(audio_trimmed)/SAMPLE_RATE:.2f}s  "
             f"top label: {labels[0]['term']} ({labels[0]['score']:.3f})")

    return {
        "slot_id": slot_id,
        "audio":   clip_to_base64_wav(audio_trimmed),
        "labels":  labels,
    }


@app.post("/query-custom")
async def query_custom(
    session_id: str = Form(...),
    text:       str = Form(...),
    mode:       str = Form(default="clap"),
    top_k:      int = Form(default=3),
):
    """Re-query a custom pad against session data (CLAP text or lyrics mode)."""
    sess = _get_session(session_id)
    if sess is None:
        raise HTTPException(404, "Session expired — please re-upload audio")
    text = text.strip()
    if not text:
        raise HTTPException(400, "text is required")

    if mode == "lyrics":
        needle = text.lower().strip(".,!?;:\'\"()-\u2014\u2013[]")
        matches = [w for w in sess["transcript"] if w["word"] == needle]
        if not matches:
            matches = [w for w in sess["transcript"] if w["word"].startswith(needle)]
        candidates = [{"word": m["word"], "start": m["start"], "end": m["end"]}
                      for m in matches[:top_k]]
        log.info(f"  lyrics query '{needle}': {len(matches)} matches")
        return {"candidates": candidates, "mode": "lyrics", "matches": len(matches)}
    else:
        try:
            # Pure numpy — no need for torch conversion (embed_texts returns numpy)
            text_embed = embed_texts([text])
            similarity_scores = (sess["audio_embeds"] @ text_embed.T).squeeze()
            if similarity_scores.ndim == 0:
                similarity_scores = similarity_scores.reshape(1)
            top_indices = np.argsort(similarity_scores)[::-1][:top_k]
            candidates = []
            for idx in top_indices:
                ctx = clip_to_context_times(
                    sess["audio_raw"],
                    sess["clip_starts"][int(idx)],
                    sess["clip_ends"][int(idx)],
                )
                candidates.append({
                    "time":  round(float(sess["times"][int(idx)]), 3),
                    "score": round(float(similarity_scores[int(idx)]), 4),
                    **ctx,
                })
            return {"candidates": candidates, "mode": "clap"}
        except Exception as exc:
            raise HTTPException(500, f"CLAP query failed: {exc}")


# ── Serve frontend ────────────────────────────────────────────────────────────
FRONTEND = pathlib.Path(__file__).resolve().parent.parent
log.info(f"Serving frontend from: {FRONTEND}  (exists: {FRONTEND.exists()})")
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
