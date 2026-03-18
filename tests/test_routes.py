"""
Route tests with mocked ML models.

- load_audio is mocked to return synthetic numpy audio (no ffmpeg dependency).
- transcribe_audio is mocked to return an empty transcript (no Whisper).
- _embed_batch uses the fake CLAP model from conftest.py (fast, no GPU).

These tests catch endpoint signature bugs, JSON structure bugs, and session
handling issues without any ML overhead.
"""

import io
import json
import base64

import numpy as np
import soundfile as sf
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

import main
from main import app, SR

client = TestClient(app, raise_server_exceptions=True)

# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_audio(duration_s: float = 2.0, onset_times_s: list[float] = None) -> np.ndarray:
    """Synthetic audio with sine-burst transients at given onset times."""
    if onset_times_s is None:
        onset_times_s = [0.3, 0.7, 1.2]
    audio = np.zeros(int(duration_s * SR), dtype=np.float32)
    n     = 2048
    t     = np.arange(n) / SR
    hit   = (np.sin(2 * np.pi * 440 * t) * np.exp(-t * 150)).astype(np.float32)
    for ts in onset_times_s:
        s = int(ts * SR)
        e = min(len(audio), s + n)
        audio[s:e] += hit[: e - s]
    return audio


def _audio_to_wav_bytes(audio: np.ndarray) -> bytes:
    buf = io.BytesIO()
    sf.write(buf, audio, SR, format="WAV")
    return buf.getvalue()


def _post_analyze(audio: np.ndarray, custom_texts: dict = None):
    """POST /analyze with mock load_audio bypassing ffmpeg."""
    wav = _audio_to_wav_bytes(audio)
    with patch.object(main, "load_audio", return_value=audio):
        data = {}
        if custom_texts:
            data["custom_texts"] = json.dumps(custom_texts)
        return client.post("/analyze", files={"file": ("audio.wav", wav, "audio/wav")}, data=data)


def _post_transcribe(audio: np.ndarray):
    """POST /transcribe with mock load_audio bypassing ffmpeg."""
    wav = _audio_to_wav_bytes(audio)
    with patch.object(main, "load_audio", return_value=audio), \
         patch.object(main, "transcribe_audio", return_value=[
             {"word": "kick", "start": 0.1, "end": 0.3},
             {"word": "snare", "start": 0.5, "end": 0.7},
         ]):
        return client.post("/transcribe", files={"file": ("audio.wav", wav, "audio/wav")})


# ── /analyze ──────────────────────────────────────────────────────────────────

class TestAnalyze:

    def test_happy_path_response_structure(self):
        audio = _make_audio()
        resp  = _post_analyze(audio)
        assert resp.status_code == 200
        body = resp.json()
        assert "drums"        in body
        assert "onset_count"  in body
        assert "session_id"   in body
        assert "transcript" not in body
        assert isinstance(body["session_id"], str)
        assert isinstance(body["onset_count"], int)
        assert body["onset_count"] > 0

    def test_drum_slots_have_candidates(self):
        audio = _make_audio()
        resp  = _post_analyze(audio)
        drums = resp.json()["drums"]
        for slot_id, info in drums.items():
            assert "candidates" in info
            cands = info["candidates"]
            assert len(cands) >= 1
            for c in cands:
                assert "audio"      not in c
                assert "score"      in c
                assert "time"       in c
                assert "ctx_start_s" in c
                assert "ctx_end_s"   in c
                assert "trim_start"  in c
                assert "trim_end"    in c
                assert "norm_gain"   in c

    def test_candidate_trim_fractions_in_range(self):
        audio = _make_audio()
        resp  = _post_analyze(audio)
        for slot_id, info in resp.json()["drums"].items():
            for c in info["candidates"]:
                assert 0.0 <= c["trim_start"] < c["trim_end"] <= 1.0

    def test_candidate_ctx_times_in_range(self):
        audio = _make_audio()
        resp  = _post_analyze(audio)
        duration = len(audio) / main.SR
        for slot_id, info in resp.json()["drums"].items():
            for c in info["candidates"]:
                assert c["ctx_start_s"] >= 0.0
                assert c["ctx_end_s"]   <= duration + 0.001
                assert c["norm_gain"]   > 0.0

    def test_session_id_is_stored(self):
        audio = _make_audio()
        resp  = _post_analyze(audio)
        sid   = resp.json()["session_id"]
        assert sid in main._sessions

    def test_too_short_returns_400(self):
        # 0.2 s — below the 0.5 s minimum
        audio = np.zeros(int(0.2 * SR), dtype=np.float32)
        with patch.object(main, "load_audio", return_value=audio):
            resp = client.post("/analyze",
                               files={"file": ("a.wav", b"x", "audio/wav")})
        assert resp.status_code == 400

    def test_no_onsets_returns_422(self):
        # Pure silence — no transients
        audio = np.zeros(int(1.5 * SR), dtype=np.float32)
        with patch.object(main, "load_audio", return_value=audio):
            resp = client.post("/analyze",
                               files={"file": ("a.wav", b"x", "audio/wav")})
        assert resp.status_code == 422

    def test_custom_texts_creates_custom_slots(self):
        audio  = _make_audio()
        custom = {"custom_0": "wood block", "custom_1": "cowbell"}
        resp   = _post_analyze(audio, custom_texts=custom)
        assert resp.status_code == 200
        drums  = resp.json()["drums"]
        assert "custom_0" in drums
        assert "custom_1" in drums

    def test_custom_texts_empty_string_skipped(self):
        audio  = _make_audio()
        custom = {"custom_0": "", "custom_1": "cowbell"}
        resp   = _post_analyze(audio, custom_texts=custom)
        assert resp.status_code == 200
        drums  = resp.json()["drums"]
        assert "custom_0" not in drums
        assert "custom_1" in drums

    def test_malformed_custom_texts_still_returns_200(self):
        # An invalid JSON string in custom_texts shouldn't crash the server.
        # (json.loads raises — route should handle or default to {})
        audio = _make_audio()
        wav   = _audio_to_wav_bytes(audio)
        with patch.object(main, "load_audio", return_value=audio):
            resp = client.post("/analyze",
                               files={"file": ("a.wav", wav, "audio/wav")},
                               data={"custom_texts": "{bad json"})
        # Either 200 (graceful default) or 400/422 — must not be 500
        assert resp.status_code != 500

    def test_transcript_not_in_response(self):
        audio = _make_audio()
        resp  = _post_analyze(audio)
        assert "transcript" not in resp.json()


# ── /record-custom ────────────────────────────────────────────────────────────

class TestRecordCustom:

    def test_happy_path_response_structure(self):
        audio = _make_audio(duration_s=0.5, onset_times_s=[0.1])
        wav   = _audio_to_wav_bytes(audio)
        with patch.object(main, "load_audio", return_value=audio):
            resp = client.post("/record-custom",
                               files={"file": ("rec.wav", wav, "audio/wav")},
                               data={"slot_id": "custom_2"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["slot_id"] == "custom_2"
        assert "audio"  in body
        assert "labels" in body
        base64.b64decode(body["audio"])

    def test_labels_have_term_and_score(self):
        audio = _make_audio(duration_s=0.5, onset_times_s=[0.1])
        wav   = _audio_to_wav_bytes(audio)
        with patch.object(main, "load_audio", return_value=audio):
            resp = client.post("/record-custom",
                               files={"file": ("rec.wav", wav, "audio/wav")},
                               data={"slot_id": "custom_0", "top_k": "3"})
        labels = resp.json()["labels"]
        assert len(labels) == 3
        for label in labels:
            assert "term"  in label
            assert "score" in label

    def test_default_top_k_is_five(self):
        audio = _make_audio(duration_s=0.5, onset_times_s=[0.1])
        wav   = _audio_to_wav_bytes(audio)
        with patch.object(main, "load_audio", return_value=audio):
            resp = client.post("/record-custom",
                               files={"file": ("rec.wav", wav, "audio/wav")},
                               data={"slot_id": "custom_1"})
        assert len(resp.json()["labels"]) == 5


# ── /query-custom ─────────────────────────────────────────────────────────────

class TestQueryCustom:

    def _make_session(self, n_clips: int = 5) -> str:
        """Insert a synthetic session directly into _sessions."""
        import uuid, time
        D     = 512
        sid   = str(uuid.uuid4())
        audio = _make_audio()
        main._sessions[sid] = {
            "audio_embeds": np.random.randn(n_clips, D).astype(np.float32),
            "times":        [i * 0.3 for i in range(n_clips)],
            "transcript": [
                {"word": "kick",  "start": 0.1, "end": 0.3},
                {"word": "snare", "start": 0.5, "end": 0.7},
            ],
            "audio_raw":   audio,
            "clip_starts": [int(i * 0.3 * SR) for i in range(n_clips)],
            "clip_ends":   [int(i * 0.3 * SR) + int(0.1 * SR) for i in range(n_clips)],
            "last_access": time.time(),
        }
        return sid

    def test_clap_mode_returns_candidates(self):
        sid  = self._make_session()
        resp = client.post("/query-custom",
                           data={"session_id": sid, "text": "wood block", "mode": "clap"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["mode"] == "clap"
        assert len(body["candidates"]) >= 1
        for c in body["candidates"]:
            assert "audio"      not in c
            assert "score"      in c
            assert "time"       in c
            assert "ctx_start_s" in c
            assert "ctx_end_s"   in c
            assert "trim_start"  in c
            assert "trim_end"    in c
            assert "norm_gain"   in c

    def test_lyrics_mode_returns_transcript_match(self):
        sid  = self._make_session()
        resp = client.post("/query-custom",
                           data={"session_id": sid, "text": "kick", "mode": "lyrics"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["mode"]    == "lyrics"
        assert body["matches"] >= 1
        assert len(body["candidates"]) >= 1
        for c in body["candidates"]:
            assert "word"  in c
            assert "start" in c
            assert "end"   in c
            assert "audio" not in c

    def test_lyrics_mode_no_match_returns_empty(self):
        sid  = self._make_session()
        resp = client.post("/query-custom",
                           data={"session_id": sid, "text": "xyzzyx", "mode": "lyrics"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["matches"]      == 0
        assert body["candidates"]   == []

    def test_expired_session_returns_404(self):
        resp = client.post("/query-custom",
                           data={"session_id": "does-not-exist",
                                 "text": "kick", "mode": "clap"})
        assert resp.status_code == 404

    def test_empty_text_returns_400(self):
        sid  = self._make_session()
        resp = client.post("/query-custom",
                           data={"session_id": sid, "text": "  ", "mode": "clap"})
        assert resp.status_code == 400

    def test_top_k_respected(self):
        sid  = self._make_session(n_clips=10)
        resp = client.post("/query-custom",
                           data={"session_id": sid, "text": "clap",
                                 "mode": "clap", "top_k": "2"})
        assert resp.status_code == 200
        assert len(resp.json()["candidates"]) <= 2


# ── /transcribe ───────────────────────────────────────────────────────────────

class TestTranscribe:

    def test_transcribe_returns_words_list(self):
        audio = _make_audio()
        resp  = _post_transcribe(audio)
        assert resp.status_code == 200
        body = resp.json()
        assert "words" in body
        assert isinstance(body["words"], list)

    def test_transcribe_words_have_correct_fields(self):
        audio = _make_audio()
        resp  = _post_transcribe(audio)
        for w in resp.json()["words"]:
            assert "word"  in w
            assert "start" in w
            assert "end"   in w

    def test_transcribe_no_audio_in_words(self):
        audio = _make_audio()
        resp  = _post_transcribe(audio)
        for w in resp.json()["words"]:
            assert "audio" not in w

    def test_transcribe_empty_audio_returns_empty_words(self):
        audio = _make_audio()
        wav   = _audio_to_wav_bytes(audio)
        with patch.object(main, "load_audio", return_value=audio), \
             patch.object(main, "transcribe_audio", return_value=[]):
            resp = client.post("/transcribe", files={"file": ("audio.wav", wav, "audio/wav")})
        assert resp.status_code == 200
        assert resp.json()["words"] == []
