"""
Drum Extractor — FastAPI backend
Pipeline: audio -> onset detection -> CLAP embeddings -> prototype nearest-neighbour
"""

import io, os, base64, logging, pathlib, subprocess, tempfile
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
CLIP_POST_MAX = 0.45   # longest allowed post-roll
MIN_GAP       = 0.07   # minimum gap between onsets
MAX_CLIPS   = 150
BATCH_SIZE  = 32
MAX_SECS    = 90
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

# ── Model loading ──────────────────────────────────────────────────────────────

log.info("Loading CLAP model...")
clap_model     = ClapModel.from_pretrained(MODEL_ID)
clap_processor = ClapProcessor.from_pretrained(MODEL_ID)
clap_model.eval()
log.info("CLAP model ready.")

# ── Embedding helpers ──────────────────────────────────────────────────────────

def _embed_audio_arrays(arrays: list[np.ndarray]) -> np.ndarray:
    all_embeds = []
    for i in range(0, len(arrays), BATCH_SIZE):
        batch  = arrays[i : i + BATCH_SIZE]
        inputs = clap_processor(audio=batch, sampling_rate=SR, return_tensors="pt", padding=True)
        with torch.no_grad():
            out    = clap_model.audio_model(**inputs)
            embeds = clap_model.audio_projection(out.pooler_output)
            embeds = embeds / embeds.norm(dim=-1, keepdim=True)
        all_embeds.append(embeds.numpy())
    return np.vstack(all_embeds)


def _embed_texts(texts: list[str]) -> np.ndarray:
    inputs = clap_processor(text=texts, return_tensors="pt", padding=True)
    with torch.no_grad():
        out    = clap_model.text_model(**inputs)
        embeds = clap_model.text_projection(out.pooler_output)
        embeds = embeds / embeds.norm(dim=-1, keepdim=True)
    return embeds.numpy()

# ── Prototype computation ──────────────────────────────────────────────────────

def _load_wav_files(paths) -> list[np.ndarray]:
    """Load and silence-trim reference audio files.

    No length truncation — reference sounds should be embedded in full so
    CLAP sees the complete timbre, not an arbitrary slice of it.
    The processor handles variable-length input via internal padding/truncation
    (max ~10s for laion/larger_clap_general).
    """
    clips = []
    for p in paths:
        try:
            audio, _ = librosa.load(str(p), sr=SR, mono=True)
            audio, _ = librosa.effects.trim(audio, top_db=30)
            if len(audio) == 0:
                log.warning(f"    Skipping {p.name}: empty after trim")
                continue
            clips.append(audio)
        except Exception as e:
            log.warning(f"    Skipping {p.name}: {e}")
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
log.info("Prototypes ready.")

# ── FastAPI app ────────────────────────────────────────────────────────────────

app = FastAPI(title="Drum Extractor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

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

    search_back = int(0.04 * SR)
    snapped = []
    for s in samples:
        lo     = max(0, s - search_back)
        window = audio[lo : s + 1]
        if len(window) == 0:
            snapped.append(int(s)); continue
        peak      = np.max(np.abs(window))
        threshold = peak * 0.2
        true_start = s
        for j in range(len(window) - 1, -1, -1):
            if abs(window[j]) < threshold:
                true_start = lo + j; break
        snapped.append(int(true_start))

    min_gap = int(MIN_GAP * SR)
    deduped: list[int] = []
    last = -min_gap
    for s in sorted(snapped):
        if s - last >= min_gap:
            deduped.append(int(s)); last = s

    if not deduped:
        return np.array([], dtype=int)

    if len(deduped) > MAX_CLIPS:
        clip_len = int((CLIP_PRE + CLIP_POST_MAX) * SR)
        energies = [float(np.sqrt(np.mean(audio[max(0, s-int(CLIP_PRE*SR)) : max(0, s-int(CLIP_PRE*SR))+clip_len]**2))) for s in deduped]
        order    = np.argsort(energies)[::-1][:MAX_CLIPS]
        deduped  = [deduped[i] for i in sorted(order)]

    return np.array(deduped, dtype=int)


def extract_clips(audio: np.ndarray, onsets: np.ndarray):
    """Extract variable-length clips, each ending just before the next onset.

    For onset i the post-roll is:
        clip_post = clamp(next_onset - onset - CLIP_PRE, CLIP_POST_MIN, CLIP_POST_MAX)

    Subtracting CLIP_PRE from the gap ensures this clip's tail ends exactly
    where the next clip's pre-roll begins — no audio is shared between clips.
    For the last onset (no successor) we use CLIP_POST_MAX.
    """
    pre_samp     = int(CLIP_PRE * SR)
    post_min     = int(CLIP_POST_MIN * SR)
    post_max     = int(CLIP_POST_MAX * SR)
    clips, times = [], []

    for i, onset in enumerate(onsets):
        # How much room until the next onset's pre-roll begins?
        if i + 1 < len(onsets):
            gap      = int(onsets[i + 1]) - int(onset) - pre_samp
            post_smp = int(np.clip(gap, post_min, post_max))
        else:
            post_smp = post_max

        start    = max(0, onset - pre_samp)
        end      = min(len(audio), onset + post_smp)
        clip_len = end - start
        clip     = audio[start:end].copy()
        if len(clip) < clip_len:
            clip = np.pad(clip, (0, clip_len - len(clip)))
        peak = np.max(np.abs(clip))
        if peak > 1e-6:
            clip = clip / peak * 0.9
        clips.append(clip)
        times.append(float(start) / SR)

    return clips, times

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

    clips, times = extract_clips(audio, onsets)

    log.info(f"Embedding {len(clips)} clips...")
    audio_embeds = _embed_audio_arrays(clips)   # (n_clips, D)

    # Multi-prototype scoring: for each drum, score each clip against every
    # prototype for that drum and take the max.  This means a clip can match
    # via *any* style prototype (studio, beatbox, found-sound, …).
    scores = np.zeros((len(clips), len(DRUM_NAMES)), dtype=np.float32)
    for di, drum in enumerate(DRUM_NAMES):
        protos = PROTOTYPES[drum]                          # list of (D,) vectors
        proto_matrix = np.stack(protos)                   # (n_protos, D)
        per_proto    = audio_embeds @ proto_matrix.T      # (n_clips, n_protos)
        scores[:, di] = per_proto.max(axis=1)             # best proto wins

    # ── Two-pass assignment ────────────────────────────────────────────────────
    #
    # Pass 1 (clip-first): each clip votes for its top drum type.
    #   Group clips by their primary vote; each drum picks its best.
    #
    # Pass 2 (fallback): any drum that got zero votes in pass 1 gets the
    #   highest-scoring unused clip for that drum type, regardless of what
    #   that clip voted for. Ensures we always try to fill every slot.

    primary = np.argmax(scores, axis=1)   # (n_clips,) — each clip's top drum

    # Build per-drum sorted candidate lists (by that drum's score, descending)
    all_candidates: dict[str, list[tuple[float, int]]] = {
        d: sorted(
            [(float(scores[i, di]), i) for i in range(len(clips))],
            key=lambda x: -x[0]
        )
        for di, d in enumerate(DRUM_NAMES)
    }

    # Pass 1 — clip-first groups
    groups: dict[str, list[tuple[float, int]]] = {d: [] for d in DRUM_NAMES}
    for clip_idx, drum_idx in enumerate(primary):
        drum = DRUM_NAMES[drum_idx]
        groups[drum].append((float(scores[clip_idx, drum_idx]), clip_idx))

    # Select winners from pass 1
    winners: dict[str, tuple[float, int]] = {}   # drum -> (score, clip_idx)
    used: set[int] = set()
    for drum in DRUM_NAMES:
        if groups[drum]:
            best = max(groups[drum], key=lambda x: x[0])
            winners[drum] = best
            used.add(best[1])

    # Pass 2 — fallback for unmatched drums
    for drum in DRUM_NAMES:
        if drum not in winners:
            for score, clip_idx in all_candidates[drum]:
                if clip_idx not in used:
                    winners[drum] = (score, clip_idx)
                    used.add(clip_idx)
                    log.info(f"  {drum}: filled via fallback (score={score:.3f})")
                    break

    # Build results with top-N candidates per drum for runner-up swapping
    results: dict = {}
    for drum in DRUM_NAMES:
        if drum not in winners:
            log.info(f"  {drum}: could not fill (not enough distinct clips)")
            continue

        _, winner_idx = winners[drum]

        # Gather top-N candidates: winner first, then next best unused clips
        candidate_list = []
        seen_in_candidates: set[int] = {winner_idx}
        candidate_list.append(winner_idx)

        for score, clip_idx in all_candidates[drum]:
            if len(candidate_list) >= N_CANDIDATES:
                break
            if clip_idx not in seen_in_candidates:
                candidate_list.append(clip_idx)
                seen_in_candidates.add(clip_idx)

        candidates_out = []
        for clip_idx in candidate_list:
            candidates_out.append({
                "audio": clip_to_b64_wav(clips[clip_idx]),
                "time":  round(times[clip_idx], 3),
                "score": round(float(scores[clip_idx, DRUM_NAMES.index(drum)]), 4),
            })

        results[drum] = {"candidates": candidates_out}
        log.info(f"  {drum}: winner @{times[winner_idx]:.2f}s  score={scores[winner_idx, DRUM_NAMES.index(drum)]:.3f}  ({len(groups[drum])} primary clips)")

    # ── Custom text-query slots ────────────────────────────────────────────────
    import json as _json
    try:
        custom = _json.loads(custom_texts)   # {id: text, ...}
    except Exception:
        custom = {}

    for slot_id, query_text in custom.items():
        if not query_text or not query_text.strip():
            continue
        try:
            text_embed = _embed_texts([query_text.strip()])   # (1, D)
            sims       = (audio_embeds @ text_embed.T).squeeze()  # (n_clips,)
            if sims.ndim == 0:
                sims = sims.reshape(1)
            top_idx = np.argsort(sims)[::-1][:N_CANDIDATES]
            candidates_out = []
            for idx in top_idx:
                candidates_out.append({
                    "audio": clip_to_b64_wav(clips[int(idx)]),
                    "time":  round(float(times[int(idx)]), 3),
                    "score": round(float(sims[int(idx)]), 4),
                })
            results[slot_id] = {"candidates": candidates_out}
            log.info(f"  {slot_id} ('{query_text}'): top score={float(sims[top_idx[0]]):.3f}")
        except Exception as e:
            log.warning(f"  {slot_id}: text embedding failed: {e}")

    return {"drums": results, "onset_count": len(clips)}


# ── Serve frontend ─────────────────────────────────────────────────────────────

FRONTEND = pathlib.Path(__file__).resolve().parent
log.info(f"Serving frontend from: {FRONTEND}  (exists: {FRONTEND.exists()})")
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
