"""
BOXER — Modal deployment

Image bakes in CLAP + Whisper at build time so there's no download on cold start.
Reference WAV files are copied into the image from the local references/ directory.
min_containers=1 keeps one container alive so the session cache and loaded models
survive between requests.
"""

import modal

# ── Image ─────────────────────────────────────────────────────────────────────

MODEL_ID     = "laion/larger_clap_general"
WHISPER_MODEL = "base"

image = (
    modal.Image.debian_slim(python_version="3.10")
    .apt_install("ffmpeg")
    .pip_install(
        "fastapi>=0.100.0",
        "uvicorn[standard]>=0.23.0",
        "python-multipart>=0.0.6",
        "librosa>=0.10.0",
        "soundfile>=0.12.0",
        "numpy>=1.24.0",
        "torch>=2.0.0",
        "transformers>=4.35.0",
        "accelerate>=0.24.0",
        "openai-whisper",
    )
    # Bake CLAP into the image so cold starts don't re-download 600 MB
    .run_commands(
        f"python -c \""
        f"from transformers import ClapModel, ClapProcessor; "
        f"ClapModel.from_pretrained('{MODEL_ID}'); "
        f"ClapProcessor.from_pretrained('{MODEL_ID}'); "
        f"print('CLAP cached')"
        f"\""
    )
    # Bake Whisper base model
    .run_commands(
        f"python -c \""
        f"import whisper; "
        f"whisper.load_model('{WHISPER_MODEL}'); "
        f"print('Whisper cached')"
        f"\""
    )
    # Copy reference WAVs into the image
    .add_local_dir("references", "/app/references")
    # Copy backend source
    .add_local_file("main.py",       "/app/main.py")
    .add_local_file("vocabulary.py", "/app/vocabulary.py")
    # Copy frontend files
    .add_local_file("index.html",    "/app/index.html")
    .add_local_file("sketch.js",     "/app/sketch.js")
)

app = modal.App("boxer", image=image)

# ── ASGI entrypoint ───────────────────────────────────────────────────────────

@app.function(
    gpu="T4",            # CLAP + Whisper inference; T4 has 16 GB VRAM
    cpu=2,
    memory=4096,         # audio processing + numpy; models live in GPU VRAM
    timeout=600,         # 10-minute max for long uploads
    min_containers=1,    # keep one container alive for session cache
    scaledown_window=300,
)
@modal.concurrent(max_inputs=10)
@modal.asgi_app()
def fastapi_app():
    import sys
    sys.path.insert(0, "/app")
    import os
    os.chdir("/app")
    # Set references dir so main.py finds it
    from main import app as fastapi_app
    return fastapi_app
