"""
Drum Extractor — FastAPI backend
Pipeline: audio → onset detection → CLAP embeddings → prototype nearest-neighbour
"""

import io
import os
import base64
import logging
import pathlib
import subprocess
import tempfile

import numpy as np
import librosa
import soundfile as sf
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from transformers import ClapModel, ClapProcessor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

MODEL_ID   = "laion/larger_clap_general"
SR         = 48_000
CLIP_PRE   = 0.06
CLIP_POST  = 0.45
MIN_GAP    = 0.07
MAX_CLIPS  = 150
BATCH_SIZE = 32
MAX_SECS   = 90
FFMPEG     = os.environ.get("FFMPEG_PATH", "ffmpeg")

DRUM_NAMES = ["kick", "snare", "hihat", "tom"]

DRUM_TEXT_QUERIES: dict[str, list[str]] = {
    "kick":  ["kick drum", "bass drum", "low thud", "deep boom", "low frequency drum hit"],
    "snare": ["snare drum", "snare hit", "snappy crack", "rimshot", "sharp drum crack"],
    "hihat": ["hi-hat", "closed hi-hat", "metallic tick", "cymbal click", "sharp metallic percussion"],
    "tom":   ["tom drum", "floor tom", "mid tom", "rack tom", "hollow drum hit"],
}

# Put your reference WAVs in boxer/references/kick/, boxer/references/snare/, etc.
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
        batch = arrays[i : i + BATCH_SIZE]
        inputs = clap_processor(
            audio=batch,
            sampling_rate=SR,
            return_tensors="pt",
            padding=True,
        )
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

def _build_prototypes() -> dict[str, np.ndarray]:
    prototypes: dict[str, np.ndarray] = {}

    for drum in DRUM_NAMES:
        ref_dir   = REFERENCES_DIR / drum
        wav_files = (sorted(ref_dir.glob("*.wav")) + sorted(ref_dir.glob("*.WAV"))) if ref_dir.exists() else []

        if wav_files:
            log.info(f"  {drum}: loading {len(wav_files)} reference files")
            clips = []
            for wav_path in wav_files:
                try:
                    audio, _ = librosa.load(str(wav_path), sr=SR, mono=True)
                    audio, _ = librosa.effects.trim(audio, top_db=30)
                    target   = int(CLIP_POST * SR)
                    audio    = audio[:target] if len(audio) > target else np.pad(audio, (0, target - len(audio)))
                    clips.append(audio)
                except Exception as e:
                    log.warning(f"    Skipping {wav_path.name}: {e}")

            if clips:
                embeds = _embed_audio_arrays(clips)
                proto  = embeds.mean(axis=0)
                proto  = proto / np.linalg.norm(proto)
                prototypes[drum] = proto
                log.info(f"  {drum}: prototype built from {len(clips)} files")
                continue

        log.warning(f"  {drum}: no reference audio in {ref_dir} -- using text fallback")
        embeds = _embed_texts(DRUM_TEXT_QUERIES[drum])
        proto  = embeds.mean(axis=0)
        proto  = proto / np.linalg.norm(proto)
        prototypes[drum] = proto

    return prototypes


log.info("Building drum prototypes...")
PROTOTYPES = _build_prototypes()
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
    hop    = 256
    frames = librosa.onset.onset_detect(y=audio, sr=SR, hop_length=hop, backtrack=False, units="frames")
    samples = librosa.frames_to_samples(frames, hop_length=hop)

    search_back = int(0.04 * SR)
    snapped = []
    for s in samples:
        lo     = max(0, s - search_back)
        window = audio[lo : s + 1]
        if len(window) == 0:
            snapped.append(int(s))
            continue
        peak      = np.max(np.abs(window))
        threshold = peak * 0.2
        true_start = s
        for j in range(len(window) - 1, -1, -1):
            if abs(window[j]) < threshold:
                true_start = lo + j
                break
        snapped.append(int(true_start))

    min_gap = int(MIN_GAP * SR)
    deduped: list[int] = []
    last = -min_gap
    for s in sorted(snapped):
        if s - last >= min_gap:
            deduped.append(int(s))
            last = s

    if not deduped:
        return np.array([], dtype=int)

    if len(deduped) > MAX_CLIPS:
        clip_len = int((CLIP_PRE + CLIP_POST) * SR)
        energies = [float(np.sqrt(np.mean(audio[max(0, s - int(CLIP_PRE*SR)) : max(0, s - int(CLIP_PRE*SR)) + clip_len] ** 2))) for s in deduped]
        order    = np.argsort(energies)[::-1][:MAX_CLIPS]
        deduped  = [deduped[i] for i in sorted(order)]

    return np.array(deduped, dtype=int)


def extract_clips(audio: np.ndarray, onsets: np.ndarray) -> tuple[list[np.ndarray], list[float]]:
    pre      = int(CLIP_PRE * SR)
    clip_len = int((CLIP_PRE + CLIP_POST) * SR)
    clips, times = [], []
    for onset in onsets:
        start = max(0, onset - pre)
        end   = start + clip_len
        if end > len(audio):
            end, start = len(audio), max(0, len(audio) - clip_len)
        clip = audio[start:end].copy()
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
async def analyze(file: UploadFile = File(...)):
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
    audio_embeds = _embed_audio_arrays(clips)              # (n_clips, D)
    proto_matrix = np.stack([PROTOTYPES[d] for d in DRUM_NAMES])  # (n_drums, D)
    scores       = audio_embeds @ proto_matrix.T           # (n_clips, n_drums)

    primary = np.argmax(scores, axis=1)
    groups: dict[str, list[tuple[float, int]]] = {d: [] for d in DRUM_NAMES}
    for clip_idx, drum_idx in enumerate(primary):
        drum = DRUM_NAMES[drum_idx]
        groups[drum].append((float(scores[clip_idx, drum_idx]), clip_idx))

    results: dict = {}
    for drum in DRUM_NAMES:
        if not groups[drum]:
            log.info(f"  {drum}: no clips matched")
            continue
        best_score, best_idx = max(groups[drum], key=lambda x: x[0])
        results[drum] = {
            "audio": clip_to_b64_wav(clips[best_idx]),
            "time":  round(times[best_idx], 3),
            "score": round(best_score, 4),
        }
        log.info(f"  {drum}: @{times[best_idx]:.2f}s  score={best_score:.3f}  ({len(groups[drum])} clips)")

    return {"drums": results, "onset_count": len(clips)}


# ── Serve frontend ─────────────────────────────────────────────────────────────

FRONTEND = pathlib.Path(__file__).resolve().parent
log.info(f"Serving frontend from: {FRONTEND}  (exists: {FRONTEND.exists()})")
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND), html=True), name="static")
