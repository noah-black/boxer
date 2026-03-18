"""
Stubs out the CLAP model before main.py is imported so that:
  - DSP unit tests load in <1 s (no model download or GPU warm-up)
  - Route tests run fast (embed calls return random unit vectors)

The sys.modules patches at module level take effect during pytest collection,
before any test file does `import main`.
"""

import sys
import os
from unittest.mock import MagicMock

import numpy as np
import torch

# ── Make main.py importable from the repo root ────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# ── Fake CLAP model / processor ───────────────────────────────────────────────

_D = 512  # CLAP embedding dimension


class _FakeModelOutput:
    """Minimal stand-in for HuggingFace model output."""
    def __init__(self, batch_size: int):
        self.pooler_output = torch.randn(batch_size, _D)


def _batch_size_from_kwargs(kw: dict) -> int:
    for v in kw.values():
        if hasattr(v, "shape") and len(v.shape) >= 1:
            return int(v.shape[0])
        if hasattr(v, "__len__"):
            return len(v)
    return 1


def _fake_processor_call(audio=None, text=None, sampling_rate=None,
                          return_tensors=None, padding=None, **kw):
    """Return a plain dict so **inputs unpacking works in _embed_batch."""
    n = len(audio) if audio is not None else len(text)
    return {"placeholder": torch.zeros(n, 1)}


_fake_model = MagicMock()
_fake_model.eval.return_value = _fake_model
_fake_model.to.return_value   = _fake_model   # .to(device) must return self
_fake_model.audio_model.side_effect = lambda **kw: _FakeModelOutput(_batch_size_from_kwargs(kw))
_fake_model.text_model.side_effect  = lambda **kw: _FakeModelOutput(_batch_size_from_kwargs(kw))
_fake_model.audio_projection.side_effect = lambda x: x   # identity; x is a real torch.Tensor
_fake_model.text_projection.side_effect  = lambda x: x

_fake_processor = MagicMock()
_fake_processor.side_effect = _fake_processor_call

_transformers_stub = MagicMock()
_transformers_stub.ClapModel.from_pretrained.return_value    = _fake_model
_transformers_stub.ClapProcessor.from_pretrained.return_value = _fake_processor

sys.modules["transformers"] = _transformers_stub
