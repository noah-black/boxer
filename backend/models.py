"""
Model loading, embedding helpers, drum prototypes, and vocabulary embeddings.

Loaded once at import time and kept in memory for the process lifetime.
"""

import logging

import numpy as np
import torch
from transformers import ClapModel, ClapProcessor

from backend.constants import (
    MODEL_ID, SAMPLE_RATE, BATCH_SIZE, DRUM_NAMES, DRUM_TEXT_QUERIES,
    REFERENCES_DIR, WHISPER_MODEL, MAX_LYRIC_WORDS,
)

log = logging.getLogger(__name__)

# ── Device ────────────────────────────────────────────────────────────────────
_DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
log.info(f"Device: {_DEVICE}")

# ── CLAP model ────────────────────────────────────────────────────────────────
log.info("Loading CLAP model...")
clap_model     = ClapModel.from_pretrained(MODEL_ID).to(_DEVICE)
clap_processor = ClapProcessor.from_pretrained(MODEL_ID)
clap_model.eval()
log.info("CLAP model ready.")


# ── Embedding helpers ─────────────────────────────────────────────────────────

def embed_audio_batch(arrays: list[np.ndarray]) -> np.ndarray:
    """Embed a single batch of audio arrays. Returns (batch_size, embedding_dim) ndarray."""
    inputs = clap_processor(audio=arrays, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
    inputs = {k: v.to(_DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        output = clap_model.audio_model(**inputs)
        embeds = clap_model.audio_projection(output.pooler_output)
        embeds = embeds / embeds.norm(dim=-1, keepdim=True)
    return embeds.cpu().numpy()


def embed_audio_arrays(arrays: list[np.ndarray]) -> np.ndarray:
    """Embed a list of audio arrays in batches. Returns (n_arrays, embedding_dim) ndarray."""
    return np.vstack([embed_audio_batch(arrays[i:i+BATCH_SIZE])
                      for i in range(0, len(arrays), BATCH_SIZE)])


def embed_texts(texts: list[str]) -> np.ndarray:
    """Embed a list of text strings via CLAP's text encoder. Returns (n_texts, embedding_dim)."""
    inputs = clap_processor(text=texts, return_tensors="pt", padding=True)
    inputs = {k: v.to(_DEVICE) for k, v in inputs.items()}
    with torch.no_grad():
        output = clap_model.text_model(**inputs)
        embeds = clap_model.text_projection(output.pooler_output)
        embeds = embeds / embeds.norm(dim=-1, keepdim=True)
    return embeds.cpu().numpy()


# ── Drum prototypes ───────────────────────────────────────────────────────────

def _load_reference_wavs(paths) -> list[np.ndarray]:
    """Load and silence-trim reference audio files.

    No length truncation — reference sounds are embedded in full so CLAP sees the
    complete timbre. The processor handles variable-length input via internal
    padding/truncation (max ~10s for laion/larger_clap_general).
    """
    import librosa
    clips = []
    for wav_path in paths:
        try:
            audio, _ = librosa.load(str(wav_path), sr=SAMPLE_RATE, mono=True)
            audio, _ = librosa.effects.trim(audio, top_db=30)
            if len(audio) == 0:
                log.warning(f"    Skipping {wav_path.name}: empty after trim")
                continue
            clips.append(audio)
        except Exception as exc:
            log.warning(f"    Skipping {wav_path.name}: {exc}")
    return clips


def _make_prototype(clips: list[np.ndarray]) -> np.ndarray:
    """Average CLAP embeddings of reference clips into a single unit-normalised prototype."""
    embeds = embed_audio_arrays(clips)
    proto  = embeds.mean(axis=0)
    return proto / np.linalg.norm(proto)


def build_prototypes() -> dict[str, list[np.ndarray]]:
    """Build drum prototypes from reference audio folders.

    Folder layout (both are supported):
      Flat  — references/kick/*.wav          => one prototype for kick
      Multi — references/kick/studio/*.wav   => one prototype per subfolder

    Any .wav files sitting directly in references/kick/ are collected into
    their own "default" prototype alongside any subfolders.
    """
    prototypes: dict[str, list[np.ndarray]] = {}

    for drum_name in DRUM_NAMES:
        ref_dir = REFERENCES_DIR / drum_name
        drum_protos: list[np.ndarray] = []

        if ref_dir.exists():
            subfolders = [p for p in sorted(ref_dir.iterdir()) if p.is_dir()]
            for subfolder in subfolders:
                wavs = sorted(subfolder.glob("*.wav")) + sorted(subfolder.glob("*.WAV"))
                if not wavs:
                    continue
                clips = _load_reference_wavs(wavs)
                if clips:
                    drum_protos.append(_make_prototype(clips))
                    log.info(f"  {drum_name}/{subfolder.name}: prototype from {len(clips)} files")

            flat_wavs = sorted(ref_dir.glob("*.wav")) + sorted(ref_dir.glob("*.WAV"))
            if flat_wavs:
                clips = _load_reference_wavs(flat_wavs)
                if clips:
                    drum_protos.append(_make_prototype(clips))
                    log.info(f"  {drum_name}/. : prototype from {len(clips)} flat files")

        if drum_protos:
            prototypes[drum_name] = drum_protos
            log.info(f"  {drum_name}: {len(drum_protos)} prototype(s) total")
            continue

        # Fallback: text queries when no reference audio is available
        log.warning(f"  {drum_name}: no reference audio found -- using text fallback")
        embeds = embed_texts(DRUM_TEXT_QUERIES[drum_name])
        proto  = embeds.mean(axis=0)
        prototypes[drum_name] = [proto / np.linalg.norm(proto)]

    return prototypes


log.info("Building drum prototypes...")
PROTOTYPES: dict[str, list[np.ndarray]] = build_prototypes()

# ── Vocabulary embeddings (for custom pad nearest-neighbor labelling) ─────────

from vocabulary import VOCABULARY as _VOCAB

log.info(f"Embedding {len(_VOCAB)} vocabulary terms...")
VOCAB_TERMS: list[str] = _VOCAB
_vocab_batches = [VOCAB_TERMS[i:i+256] for i in range(0, len(VOCAB_TERMS), 256)]
_vocab_embeds_list = [embed_texts(batch) for batch in _vocab_batches]
VOCAB_EMBEDS: np.ndarray = np.vstack(_vocab_embeds_list)   # (n_terms, embedding_dim)
log.info(f"Vocabulary ready: {VOCAB_EMBEDS.shape}")


def nearest_vocab(audio_embed: np.ndarray, top_k: int = 5) -> list[dict]:
    """Return top-k nearest vocabulary terms for a (1, D) or (D,) audio embedding."""
    query = audio_embed.reshape(1, -1)
    similarity_scores = (query @ VOCAB_EMBEDS.T).squeeze()   # (n_terms,)
    top_indices = np.argsort(similarity_scores)[::-1][:top_k]
    return [{"term": VOCAB_TERMS[i], "score": round(float(similarity_scores[i]), 4)}
            for i in top_indices]

log.info("Prototypes ready.")


# ── Whisper (lazy-loaded) ─────────────────────────────────────────────────────

_whisper_model = None
_STRIP_CHARS = '.,!?;:\'"()-\u2014\u2013[]'


def _get_whisper_model():
    """Lazy-load the Whisper model on first transcription request."""
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
    """Transcribe audio using Whisper and return a list of word dicts.

    Each dict has keys: word (str), start (float seconds), end (float seconds).
    """
    import librosa
    model = _get_whisper_model()
    if model is None:
        return []
    audio_16k = librosa.resample(audio, orig_sr=SAMPLE_RATE, target_sr=16_000)
    result = model.transcribe(
        audio_16k.astype(np.float32),
        word_timestamps=True,
        fp16=torch.cuda.is_available(),
        language="en",
    )
    words: list[dict] = []
    for segment in result.get("segments", []):
        for whisper_word in segment.get("words", []):
            raw_text  = whisper_word.get("word", "").strip()
            clean     = raw_text.lower().strip(_STRIP_CHARS)
            if not clean:
                continue
            start_sec   = float(whisper_word["start"])
            raw_end_sec = float(whisper_word["end"])
            words.append({
                "word":  clean,
                "start": round(start_sec, 3),
                "end":   round(raw_end_sec, 3),
            })
            if len(words) >= MAX_LYRIC_WORDS:
                return words
    return words
