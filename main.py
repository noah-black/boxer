"""
Drum Extractor — FastAPI backend
Pipeline: audio -> onset detection -> CLAP embeddings -> prototype nearest-neighbour
"""

import io, json, os, base64, logging, pathlib, subprocess, tempfile
import numpy as np
import librosa
import soundfile as sf
import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from transformers import ClapModel, ClapProcessor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

MODEL_ID    = "laion/larger_clap_general"
SR          = 48_000
CLIP_PRE      = 0.06   # seconds of pre-roll before onset
CLIP_POST_MIN = 0.06   # shortest allowed post-roll
CLIP_POST_MAX = 2.0    # longest allowed post-roll for output clips
EMBED_WINDOW     = 0.15   # seconds fed to CLAP for classification (transient-focused)
CLIP_MARGIN      = 0.40   # extra audio on each side of clip for widening trim
LYRIC_POST_ROLL  = 0.20
MAX_LYRIC_WORDS  = 400
WHISPER_MODEL    = "base"
MIN_GAP       = 0.07   # minimum gap between onsets
MAX_CLIPS         = 600
BATCH_SIZE        = 32
MAX_SECS          = 600    # 10 minutes
EARLY_EXIT_THRESH = 0.82   # stop embedding once all drums hit this score
EARLY_EXIT_MIN    = 64     # always embed at least this many clips first
N_CANDIDATES = 3   # runner-up candidates to return per drum slot
FFMPEG      = os.environ.get("FFMPEG_PATH", "ffmpeg")

DRUM_NAMES = ["kick", "snare", "hihat", "clap"]

DRUM_TEXT_QUERIES: dict[str, list[str]] = {
    "kick":  ["kick drum", "bass drum", "low thud", "deep boom", "low frequency drum hit"],
    "snare": ["snare drum", "snare hit", "snappy crack", "rimshot", "sharp drum crack"],
    "hihat": ["hi-hat", "closed hi-hat", "metallic tick", "cymbal click", "sharp metallic percussion"],
    "clap":  ["clap", "hand clap", "finger snap", "rimshot clap", "percussive clap"],
}

REFERENCES_DIR = pathlib.Path(__file__).resolve().parent / "references"

# ── Device ─────────────────────────────────────────────────────────────────────

_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
log.info(f"Device: {_DEVICE}")

# ── Model loading ──────────────────────────────────────────────────────────────

log.info("Loading CLAP model...")
clap_model     = ClapModel.from_pretrained(MODEL_ID).to(_DEVICE)
clap_processor = ClapProcessor.from_pretrained(MODEL_ID)
clap_model.eval()
log.info("CLAP model ready.")

# ── Embedding helpers ──────────────────────────────────────────────────────────

def _embed_batch(arrays: list[np.ndarray]) -> np.ndarray:
    """Embed a single batch (no internal loop). Returns (n, D) ndarray."""
    inputs = clap_processor(audio=arrays, sampling_rate=SR, return_tensors="pt", padding=True)
    inputs = {k: v.to(_DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        out    = clap_model.audio_model(**inputs)
        embeds = clap_model.audio_projection(out.pooler_output)
        embeds = embeds / embeds.norm(dim=-1, keepdim=True)
    return embeds.cpu().numpy()

def _embed_audio_arrays(arrays: list[np.ndarray]) -> np.ndarray:
    return np.vstack([_embed_batch(arrays[i:i+BATCH_SIZE])
                      for i in range(0, len(arrays), BATCH_SIZE)])


def _embed_texts(texts: list[str]) -> np.ndarray:
    inputs = clap_processor(text=texts, return_tensors="pt", padding=True)
    inputs = {k: v.to(_DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        out    = clap_model.text_model(**inputs)
        embeds = clap_model.text_projection(out.pooler_output)
        embeds = embeds / embeds.norm(dim=-1, keepdim=True)
    return embeds.cpu().numpy()

# ── Prototype computation ──────────────────────────────────────────────────────

def _load_wav_files(paths) -> list[np.ndarray]:
    """Load and silence-trim reference audio files.

    No length truncation — reference sounds should be embedded in full so
    CLAP sees the complete timbre, not an arbitrary slice of it.
    The processor handles variable-length input via internal padding/truncation
    (max ~10s for laion/larger_clap_general).
    """
    clips = []
    for wav_path in paths:
        try:
            audio, _ = librosa.load(str(wav_path), sr=SR, mono=True)
            audio, _ = librosa.effects.trim(audio, top_db=30)
            if len(audio) == 0:
                log.warning(f"    Skipping {wav_path.name}: empty after trim")
                continue
            clips.append(audio)
        except Exception as e:
            log.warning(f"    Skipping {wav_path.name}: {e}")
    return clips


def _make_proto(clips: list[np.ndarray]) -> np.ndarray:
    embeds = _embed_audio_arrays(clips)
    proto  = embeds.mean(axis=0)
    return proto / np.linalg.norm(proto)


def _build_prototypes() -> dict[str, list[np.ndarray]]:
    """
    Returns dict { drum -> [proto1, proto2, ...] }.

    Folder layout (both are supported):

      Flat  — references/kick/*.wav          => one prototype for kick
      Multi — references/kick/studio/*.wav   => one prototype per subfolder
              references/kick/beatbox/*.wav

    Any .wav files sitting directly in references/kick/ are collected into
    their own "default" prototype alongside any subfolders.
    """
    prototypes: dict[str, list[np.ndarray]] = {}

    for drum in DRUM_NAMES:
        ref_dir = REFERENCES_DIR / drum
        drum_protos: list[np.ndarray] = []

        if ref_dir.exists():
            # Subfolders → one prototype each
            subfolders = [p for p in sorted(ref_dir.iterdir()) if p.is_dir()]
            for sub in subfolders:
                wavs = sorted(sub.glob("*.wav")) + sorted(sub.glob("*.WAV"))
                if not wavs:
                    continue
                clips = _load_wav_files(wavs)
                if clips:
                    drum_protos.append(_make_proto(clips))
                    log.info(f"  {drum}/{sub.name}: prototype from {len(clips)} files")

            # WAVs directly in the drum folder → one extra "flat" prototype
            flat_wavs = sorted(ref_dir.glob("*.wav")) + sorted(ref_dir.glob("*.WAV"))
            if flat_wavs:
                clips = _load_wav_files(flat_wavs)
                if clips:
                    drum_protos.append(_make_proto(clips))
                    log.info(f"  {drum}/. : prototype from {len(clips)} flat files")

        if drum_protos:
            prototypes[drum] = drum_protos
            log.info(f"  {drum}: {len(drum_protos)} prototype(s) total")
            continue

        # Fallback: text queries
        log.warning(f"  {drum}: no reference audio found -- using text fallback")
        embeds = _embed_texts(DRUM_TEXT_QUERIES[drum])
        proto  = embeds.mean(axis=0)
        prototypes[drum] = [proto / np.linalg.norm(proto)]

    return prototypes


log.info("Building drum prototypes...")
PROTOTYPES: dict[str, list[np.ndarray]] = _build_prototypes()

# ── Vocabulary embeddings (for custom pad nearest-neighbor labelling) ──────────

from vocabulary import VOCABULARY as _VOCAB

log.info(f"Embedding {len(_VOCAB)} vocabulary terms...")
_VOCAB_TERMS: list[str] = _VOCAB

# Embed in batches — text encoder is fast but vocab may be large
_vocab_batches = [_VOCAB_TERMS[i:i+256] for i in range(0, len(_VOCAB_TERMS), 256)]
_vocab_embeds_list = [_embed_texts(b) for b in _vocab_batches]
VOCAB_EMBEDS: np.ndarray = np.vstack(_vocab_embeds_list)   # (N, D)
log.info(f"Vocabulary ready: {VOCAB_EMBEDS.shape}")


def nearest_vocab(audio_embed: np.ndarray, top_k: int = 5) -> list[dict]:
    """Return top-k nearest vocabulary terms for a (1, D) or (D,) audio embedding."""
    q = audio_embed.reshape(1, -1)
    sims = (q @ VOCAB_EMBEDS.T).squeeze()          # (N,)
    idx  = np.argsort(sims)[::-1][:top_k]
    return [{"term": _VOCAB_TERMS[i], "score": round(float(sims[i]), 4)} for i in idx]

log.info("Prototypes ready.")

# Whisper lazy-load
_whisper_model = None
_STRIP_CHARS = '.,!?;:\'"()-\u2014\u2013[]'

def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        try:
            import whisper as _wlib
            log.info(f"Loading Whisper '{WHISPER_MODEL}' ...")
            _whisper_model = _wlib.load_model(WHISPER_MODEL)
            log.info("Whisper ready.")
        except ImportError:
            log.warning("openai-whisper not installed")
    return _whisper_model


def transcribe_audio(audio: np.ndarray) -> list[dict]:
    model = _get_whisper_model()
    if model is None:
        return []
    audio_16k = librosa.resample(audio, orig_sr=SR, target_sr=16_000)
    result = model.transcribe(
        audio_16k.astype(np.float32),
        word_timestamps=True,
        fp16=False,
        language="en",
    )
    words: list[dict] = []
    for seg in result.get("segments", []):
        for w in seg.get("words", []):
            raw   = w.get("word", "").strip()
            clean = raw.lower().strip(_STRIP_CHARS)
            if not clean:
                continue
            start_s = float(w["start"])
            end_s   = min(float(w["end"]) + LYRIC_POST_ROLL, len(audio) / SR)
            s_samp  = max(0, int(start_s * SR))
            e_samp  = min(len(audio), int(end_s * SR))
            clip    = audio[s_samp:e_samp].copy()
            peak    = np.max(np.abs(clip))
            if peak > 1e-6:
                clip = clip / peak * 0.9
            raw_end_s = float(w["end"])
            words.append({
                "word":          clean,
                "start":         round(start_s, 3),
                "end":           round(raw_end_s, 3),
                "raw_end_samps": int((raw_end_s - start_s) * SR),  # samples to keep when merging
                "audio":         clip_to_b64_wav(clip),
            })
            if len(words) >= MAX_LYRIC_WORDS:
                return words
    return words


# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="Drum Extractor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ── Session cache ─────────────────────────────────────────────────────────────

import time as _time, uuid as _uuid

SESSION_TTL = 1800
_sessions: dict = {}

def _new_session(audio_embeds, output_clips, times, transcript,
                  audio_raw, clip_starts, clip_ends) -> str:
    sid = str(_uuid.uuid4())
    _sessions[sid] = {
        "audio_embeds": audio_embeds,
        "output_clips": output_clips,
        "times":        times,
        "transcript":   transcript,
        "audio_raw":    audio_raw,
        "clip_starts":  clip_starts,
        "clip_ends":    clip_ends,
        "last_access":           _time.time(),
    }
    now = _time.time()
    for k in list(_sessions.keys()):
        if now - _sessions[k]["last_access"] > SESSION_TTL:
            del _sessions[k]
    return sid

def _get_session(sid: str):
    sess = _sessions.get(sid)
    if sess:
        sess["last_access"] = _time.time()
    return sess


# ── Audio I/O ──────────────────────────────────────────────────────────────────

def load_audio(data: bytes) -> np.ndarray:
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as tmp_in:
        tmp_in.write(data)
        tmp_in_path = tmp_in.name
    tmp_out_path = tmp_in_path + ".wav"
    try:
        result = subprocess.run(
            [FFMPEG, "-y", "-i", tmp_in_path, "-ar", str(SR), "-ac", "1", "-f", "wav", tmp_out_path],
            capture_output=True,
        )
        if result.returncode != 0:
            raise HTTPException(400, f"ffmpeg failed: {result.stderr.decode()[-300:]}")
        audio, _ = librosa.load(tmp_out_path, sr=SR, mono=True)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Could not decode audio: {e}")
    finally:
        os.unlink(tmp_in_path)
        if os.path.exists(tmp_out_path):
            os.unlink(tmp_out_path)
    return audio


def clip_to_b64_wav(clip: np.ndarray) -> str:
    buf = io.BytesIO()
    sf.write(buf, clip, SR, format="WAV", subtype="PCM_16")
    return base64.b64encode(buf.getvalue()).decode()

# ── DSP ────────────────────────────────────────────────────────────────────────

def detect_onsets(audio: np.ndarray) -> np.ndarray:
    hop     = 256
    frames  = librosa.onset.onset_detect(y=audio, sr=SR, hop_length=hop, backtrack=False, units="frames")
    samples = librosa.frames_to_samples(frames, hop_length=hop)

    # Scan back up to 60ms from each onset to find where energy first crosses
    # 5% of the local peak — catches fast transients that librosa's energy-based
    # backtrack misses because they precede the energy buildup.
    search_back = int(0.06 * SR)
    snapped = []
    for onset_samp in samples:
        lo     = max(0, onset_samp - search_back)
        window = audio[lo : onset_samp + int(0.02 * SR)]   # onset + 20ms for peak ref
        if len(window) == 0:
            snapped.append(int(onset_samp)); continue
        peak      = np.max(np.abs(window))
        threshold = peak * 0.05   # 5% of local peak — much more sensitive
        true_start = onset_samp
        for scan_i in range(len(window) - 1, -1, -1):
            if abs(window[scan_i]) < threshold:
                true_start = lo + scan_i; break
        snapped.append(int(true_start))

    min_gap = int(MIN_GAP * SR)
    deduped: list[int] = []
    last = -min_gap
    for samp in sorted(snapped):
        if samp - last >= min_gap:
            deduped.append(int(samp)); last = samp

    if not deduped:
        return np.array([], dtype=int)

    if len(deduped) > MAX_CLIPS:
        clip_len = int((CLIP_PRE + CLIP_POST_MAX) * SR)
        energies = [float(np.sqrt(np.mean(audio[max(0, samp-int(CLIP_PRE*SR)) : max(0, samp-int(CLIP_PRE*SR))+clip_len]**2))) for samp in deduped]
        order    = np.argsort(energies)[::-1][:MAX_CLIPS]
        deduped  = [deduped[i] for i in sorted(order)]

    return np.array(deduped, dtype=int)


def extract_clips(audio: np.ndarray, onsets: np.ndarray):
    """Extract two sets of clips per onset:

    embed_clips  — short EMBED_WINDOW window for CLAP classification.
                   Transient-focused; CLAP discriminates best on short windows.

    output_clips — full onset-bounded window for playback, up to CLIP_POST_MAX.
                   This is what the user hears and can trim.

    Both share the same pre-roll (CLIP_PRE) so the start time is identical.
    """
    pre_samp      = int(CLIP_PRE * SR)
    post_min      = int(CLIP_POST_MIN * SR)
    post_max      = int(CLIP_POST_MAX * SR)
    embed_samps   = int(EMBED_WINDOW * SR)
    embed_clips, output_clips, times, clip_starts, clip_ends = [], [], [], [], []

    for i, onset in enumerate(onsets):
        start = max(0, onset - pre_samp)

        # ── Output clip: onset-bounded, long tail ─────────────────────────────
        if i + 1 < len(onsets):
            gap      = int(onsets[i + 1]) - int(onset) - pre_samp
            post_smp = int(np.clip(gap, post_min, post_max))
        else:
            post_smp = post_max
        end    = min(len(audio), onset + post_smp)
        out_cl = audio[start:end].copy()
        peak   = np.max(np.abs(out_cl))
        if peak > 1e-6:
            out_cl = out_cl / peak * 0.9
        output_clips.append(out_cl)
        clip_starts.append(int(start))
        clip_ends.append(int(end))

        # ── Embed clip: fixed short window, same start ────────────────────────
        emb_end = min(len(audio), start + embed_samps)
        emb_cl  = audio[start:emb_end].copy()
        if len(emb_cl) < embed_samps:
            emb_cl = np.pad(emb_cl, (0, embed_samps - len(emb_cl)))
        # Normalise embed clip independently — CLAP is similarity-based
        peak2 = np.max(np.abs(emb_cl))
        if peak2 > 1e-6:
            emb_cl = emb_cl / peak2 * 0.9
        embed_clips.append(emb_cl)

        times.append(float(start) / SR)

    return embed_clips, output_clips, times, clip_starts, clip_ends

def build_context_clip(audio: np.ndarray, clip_start: int, clip_end: int):
    """Return a wider audio slice with CLIP_MARGIN on each side, plus the
    trim fractions that locate the original clip within it.
    The context clip is peak-normalised over the full context window.
    """
    margin  = int(CLIP_MARGIN * SR)
    ctx_s   = max(0, clip_start - margin)
    ctx_e   = min(len(audio), clip_end + margin)
    ctx     = audio[ctx_s:ctx_e].copy()
    peak    = np.max(np.abs(ctx))
    if peak > 1e-6:
        ctx = ctx / peak * 0.9
    ctx_len = len(ctx)
    t_start = (clip_start - ctx_s) / ctx_len
    t_end   = (clip_end   - ctx_s) / ctx_len
    return ctx, round(float(t_start), 4), round(float(t_end), 4)

# ── Analyze helpers ────────────────────────────────────────────────────────────

def run_drum_assignment(
    audio: np.ndarray,
    embed_clips: list[np.ndarray],
    times: list[float],
    clip_starts: list[int],
    clip_ends: list[int],
    can_early_exit: bool,
) -> tuple[np.ndarray, dict, int]:
    """Embed clips with CLAP, score against drum prototypes, assign via two-pass
    nearest-neighbour, and build the candidates_out payload for each drum slot.

    Returns (audio_embeds, drum_results, n_embedded).
    Caller should trim output_clips / times / clip_starts / clip_ends to
    [:n_embedded] — those lists are not modified here.
    """
    proto_matrices = {d: np.stack(PROTOTYPES[d]) for d in DRUM_NAMES}
    n_clips      = len(embed_clips)
    embeds_list: list[np.ndarray] = []
    n_embedded   = 0
    drums_locked: set[str] = set()

    log.info(
        f"Embedding up to {n_clips} clips ({EMBED_WINDOW*1000:.0f}ms windows)"
        f"{'  [early exit enabled]' if can_early_exit else '  [full scan — custom queries present]'}..."
    )

    for batch_start in range(0, n_clips, BATCH_SIZE):
        batch        = embed_clips[batch_start : batch_start + BATCH_SIZE]
        batch_embeds = _embed_batch(batch)
        bad = ~np.isfinite(batch_embeds).all(axis=1)
        if bad.any():
            log.warning(f"  {bad.sum()} degenerate embeddings in batch {batch_start}—replaced with zeros")
            batch_embeds[bad] = 0.0
        embeds_list.append(batch_embeds)
        n_embedded += len(batch)

        if can_early_exit and n_embedded >= EARLY_EXIT_MIN and len(drums_locked) < len(DRUM_NAMES):
            cur = np.vstack(embeds_list)
            for drum in DRUM_NAMES:
                if drum not in drums_locked:
                    if float((cur @ proto_matrices[drum].T).max()) >= EARLY_EXIT_THRESH:
                        drums_locked.add(drum)
            if len(drums_locked) == len(DRUM_NAMES):
                log.info(f"  Early exit after {n_embedded}/{n_clips} clips — all drums locked")
                break

    audio_embeds = np.vstack(embeds_list)
    log.info(f"  Embedded {n_embedded}/{n_clips} clips")

    # Score all embedded clips against all drum prototypes
    scores = np.zeros((n_embedded, len(DRUM_NAMES)), dtype=np.float32)
    for drum_idx, drum in enumerate(DRUM_NAMES):
        per_proto         = audio_embeds @ proto_matrices[drum].T
        scores[:, drum_idx] = per_proto.max(axis=1)

    # ── Two-pass assignment ────────────────────────────────────────────────────
    #
    # Pass 1 (clip-first): each clip votes for its top drum type.
    #   Group clips by their primary vote; each drum picks its best.
    #
    # Pass 2 (fallback): any drum that got zero votes in pass 1 gets the
    #   highest-scoring unused clip for that drum type, regardless of what
    #   that clip voted for. Ensures we always try to fill every slot.

    primary = np.argmax(scores, axis=1)

    all_candidates: dict[str, list[tuple[float, int]]] = {
        d: sorted(
            [(float(scores[i, drum_idx]), i) for i in range(n_embedded)],
            key=lambda x: -x[0],
        )
        for drum_idx, d in enumerate(DRUM_NAMES)
    }

    groups: dict[str, list[tuple[float, int]]] = {d: [] for d in DRUM_NAMES}
    for clip_idx, drum_idx in enumerate(primary):
        drum = DRUM_NAMES[drum_idx]
        groups[drum].append((float(scores[clip_idx, drum_idx]), clip_idx))

    winners: dict[str, tuple[float, int]] = {}
    used: set[int] = set()
    for drum in DRUM_NAMES:
        if groups[drum]:
            best = max(groups[drum], key=lambda x: x[0])
            winners[drum] = best
            used.add(best[1])

    for drum in DRUM_NAMES:
        if drum not in winners:
            for score, clip_idx in all_candidates[drum]:
                if clip_idx not in used:
                    winners[drum] = (score, clip_idx)
                    used.add(clip_idx)
                    log.info(f"  {drum}: filled via fallback (score={score:.3f})")
                    break

    drum_results: dict = {}
    for drum in DRUM_NAMES:
        if drum not in winners:
            log.info(f"  {drum}: could not fill (not enough distinct clips)")
            continue

        _, winner_idx = winners[drum]
        candidate_list: list[int] = [winner_idx]
        seen_in_candidates: set[int] = {winner_idx}
        for score, clip_idx in all_candidates[drum]:
            if len(candidate_list) >= N_CANDIDATES:
                break
            if clip_idx not in seen_in_candidates:
                candidate_list.append(clip_idx)
                seen_in_candidates.add(clip_idx)

        candidates_out = []
        for clip_idx in candidate_list:
            ctx, trim_start, trim_end = build_context_clip(
                audio, clip_starts[clip_idx], clip_ends[clip_idx]
            )
            candidates_out.append({
                "audio":      clip_to_b64_wav(ctx),
                "time":       round(times[clip_idx], 3),
                "score":      round(float(scores[clip_idx, DRUM_NAMES.index(drum)]), 4),
                "trim_start": trim_start,
                "trim_end":   trim_end,
            })

        drum_results[drum] = {"candidates": candidates_out}
        log.info(
            f"  {drum}: winner @{times[winner_idx]:.2f}s"
            f"  score={scores[winner_idx, DRUM_NAMES.index(drum)]:.3f}"
            f"  ({len(groups[drum])} primary clips)"
        )

    return audio_embeds, drum_results, n_embedded


def run_custom_text_queries(
    audio_embeds: np.ndarray,
    clip_starts: list[int],
    clip_ends: list[int],
    times: list[float],
    audio: np.ndarray,
    custom_dict: dict[str, str],
) -> dict:
    """CLAP text-query each custom slot against the session embeddings.

    Returns {slot_id: {"candidates": [...]}} for slots with non-empty queries.
    """
    results: dict = {}
    for slot_id, query_text in custom_dict.items():
        if not query_text or not query_text.strip():
            continue
        try:
            text_embed = _embed_texts([query_text.strip()])
            sims       = (audio_embeds @ text_embed.T).squeeze()
            if sims.ndim == 0:
                sims = sims.reshape(1)
            top_idx = np.argsort(sims)[::-1][:N_CANDIDATES]
            candidates_out = []
            for idx in top_idx:
                ctx, trim_start, trim_end = build_context_clip(
                    audio, clip_starts[int(idx)], clip_ends[int(idx)]
                )
                candidates_out.append({
                    "audio":      clip_to_b64_wav(ctx),
                    "time":       round(float(times[int(idx)]), 3),
                    "score":      round(float(sims[int(idx)]), 4),
                    "trim_start": trim_start,
                    "trim_end":   trim_end,
                })
            results[slot_id] = {"candidates": candidates_out}
            log.info(f"  {slot_id} ('{query_text}'): top score={float(sims[top_idx[0]]):.3f}")
        except Exception as e:
            log.warning(f"  {slot_id}: text embedding failed: {e}")
    return results


# ── Route ──────────────────────────────────────────────────────────────────────

@app.post("/analyze")
async def analyze(file: UploadFile = File(...), custom_texts: str = Form(default="{}")):
    raw      = await file.read()
    audio    = load_audio(raw)
    duration = len(audio) / SR
    log.info(f"Audio: {duration:.1f}s")

    if duration < 0.5:
        raise HTTPException(400, "Audio too short (minimum 0.5 s)")
    if duration > MAX_SECS:
        raise HTTPException(400, f"Audio too long (maximum {MAX_SECS} s)")

    onsets = detect_onsets(audio)
    log.info(f"Onsets: {len(onsets)}")
    if len(onsets) == 0:
        raise HTTPException(422, "No onsets detected")

    embed_clips, output_clips, times, clip_starts, clip_ends = extract_clips(audio, onsets)

    # Early exit is only safe when there are no custom CLAP text queries —
    # those need full coverage to find the best match anywhere in the song.
    try:
        custom_dict = json.loads(custom_texts) if custom_texts else {}
    except json.JSONDecodeError:
        custom_dict = {}
    can_early_exit = len(custom_dict) == 0

    audio_embeds, drum_results, n_embedded = run_drum_assignment(
        audio, embed_clips, times, clip_starts, clip_ends, can_early_exit
    )

    # Trim session-bound lists to the portion that was actually embedded
    output_clips = output_clips[:n_embedded]
    times        = times[:n_embedded]
    clip_starts  = clip_starts[:n_embedded]
    clip_ends    = clip_ends[:n_embedded]

    custom_results = run_custom_text_queries(
        audio_embeds, clip_starts, clip_ends, times, audio, custom_dict
    )
    drum_results.update(custom_results)

    log.info("Running Whisper...")
    transcript = transcribe_audio(audio)
    log.info(f"  Whisper: {len(transcript)} words")
    if transcript:
        lines = [f"    {w['start']:.2f}-{w['end']:.2f}  {w['word']}" for w in transcript]
        log.info("  Transcript:\n" + "\n".join(lines))

    sid = _new_session(audio_embeds, output_clips, times, transcript,
                       audio, clip_starts, clip_ends)
    return {"drums": drum_results, "onset_count": n_embedded,
            "transcript": transcript, "session_id": sid}




# ── Custom pad: record + embed + label ────────────────────────────────────────

@app.post("/record-custom")
async def record_custom(
    file:    UploadFile = File(...),
    slot_id: str        = Form(...),    # e.g. "custom_0"
    top_k:   int        = Form(default=5),
):
    """
    Receive a short audio clip recorded directly into a custom pad.
    Returns: the (trimmed, normalised) audio as base64 WAV + nearest vocab labels.
    No onset detection — the whole clip is treated as one sound.
    """
    raw   = await file.read()
    audio = load_audio(raw)

    # Strip only leading/trailing near-digital-silence using an absolute RMS
    # threshold — avoids the relative-trim bug where quiet sounds get eaten.
    frame  = 512
    rms    = np.array([
        np.sqrt(np.mean(audio[i:i+frame]**2))
        for i in range(0, len(audio)-frame, frame)
    ])
    floor  = max(rms) * 0.01   # 1% of peak RMS — absolute floor
    active = np.where(rms > floor)[0]
    if len(active) >= 2:
        s = max(0, active[0]*frame - frame)
        e = min(len(audio), (active[-1]+2)*frame)
        audio_trimmed = audio[s:e]
    else:
        audio_trimmed = audio
    if len(audio_trimmed) < int(SR * 0.02):
        audio_trimmed = audio

    # Peak-normalise
    peak = np.max(np.abs(audio_trimmed))
    if peak > 1e-6:
        audio_trimmed = audio_trimmed / peak * 0.9

    # Embed
    embed = _embed_audio_arrays([audio_trimmed])   # (1, D)

    # Nearest vocab labels
    labels = nearest_vocab(embed[0], top_k=top_k)

    log.info(f"  {slot_id}: recorded {len(audio_trimmed)/SR:.2f}s  "
             f"top label: {labels[0]['term']} ({labels[0]['score']:.3f})")

    return {
        "slot_id": slot_id,
        "audio":   clip_to_b64_wav(audio_trimmed),
        "labels":  labels,
    }

# ── Live custom pad re-query ──────────────────────────────────────────────────

@app.post("/query-custom")
async def query_custom(
    session_id: str = Form(...),
    text:       str = Form(...),
    mode:       str = Form(default="clap"),
    top_k:      int = Form(default=3),
):
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
        candidates = [{"audio": m["audio"], "time": m["start"], "score": 1.0}
                      for m in matches[:top_k]]
        log.info(f"  lyrics query '{needle}': {len(matches)} matches")
        return {"candidates": candidates, "mode": "lyrics", "matches": len(matches)}
    else:
        try:
            text_embed = torch.from_numpy(_embed_texts([text])).float()
            text_embed = text_embed / text_embed.norm(dim=-1, keepdim=True)
            audio_embeds_t = torch.from_numpy(sess["audio_embeds"]).float()
            sims = (audio_embeds_t @ text_embed.T).squeeze().numpy()
            if sims.ndim == 0:
                sims = sims.reshape(1)
            top_idx = np.argsort(sims)[::-1][:top_k]
            candidates = [{
                "audio": clip_to_b64_wav(sess["output_clips"][int(i)]),
                "time":  round(float(sess["times"][int(i)]), 3),
                "score": round(float(sims[int(i)]), 4),
            } for i in top_idx]
            return {"candidates": candidates, "mode": "clap"}
        except Exception as e:
            raise HTTPException(500, f"CLAP query failed: {e}")

# ── Serve frontend ─────────────────────────────────────────────────────────────

FRONTEND = pathlib.Path(__file__).resolve().parent
log.info(f"Serving frontend from: {FRONTEND}  (exists: {FRONTEND.exists()})")
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
