# BOXER — Developer Briefing for Claude Code

This document captures the full architectural context, non-obvious decisions, known
fragile areas, and planned work for the BOXER project. Read this before touching
anything. It exists because the project was built iteratively in a chat session and
accumulated design rationale that isn't visible in the code itself.

---

## What this is

BOXER is a browser-based tool that takes any audio recording, extracts individual
sounds from it, and turns them into a playable drum kit. The user records or uploads
audio (drums, beatboxing, found sounds, entire songs), the backend runs onset
detection and CLAP embedding to classify and extract clips, and the frontend gives
them a pad-based sampler with a polymetric step sequencer.

It also supports lyrics mode: Whisper transcribes speech/sung audio, and custom pads
can be assigned to specific words or phrases from the transcript rather than acoustic
matches.

---

## File layout

```
boxer/
  backend/
    main.py          — FastAPI backend, all processing logic (~730 lines)
    vocabulary.py    — 259-term noun vocabulary for custom pad labelling
    requirements.txt
    references/      — reference audio for drum prototypes (NOT in repo, user provides)
      kick/
        studio/      — one subfolder per style, each containing .wav files
        beatbox/
      snare/...
      hihat/...
      clap/...
  frontend/
    index.html       — minimal shell, loads p5.js and defines 4 custom-input fields
    sketch.js        — entire frontend (~1550 lines, p5.js)
  CLAUDE.md          — this file
  README.md
  boxer-blog.md      — technical write-up of the classification approach
```

---

## Backend architecture

### Model loading (startup)

At startup, three things are loaded and stay in memory for the process lifetime:

1. **CLAP model** (`laion/larger_clap_general`) — ~600MB, loaded via HuggingFace
   Transformers. Used for both audio and text embedding.

2. **Drum prototypes** — for each drum type (`kick`, `snare`, `hihat`, `clap`), one
   numpy vector per style subfolder in `references/`. Built by embedding reference
   .wav files and averaging. At query time, scoring is `max(clip @ protos.T)` — the
   best prototype wins, so adding a new style is just adding a folder.

3. **Vocabulary embeddings** — 259 noun terms from `vocabulary.py`, embedded with
   CLAP's text encoder at startup, stored as `VOCAB_EMBEDS` (259, 512). Used for
   nearest-neighbor labelling of custom-recorded pads.

Whisper is lazy-loaded on first use (`WHISPER_MODEL = "base"`).

### Session cache

`_sessions` is an in-memory dict keyed by UUID. After each `/analyze` call, the
session stores:
- `audio_embeds` — (n_embedded, 512) array of CLAP embeddings for all embedded clips
- `output_clips` — list of numpy arrays (the audio sent to browser)
- `times` — list of float start times
- `transcript` — list of word dicts from Whisper
- `audio_raw` — the full original audio array (needed for context clip widening)
- `clip_starts`, `clip_ends` — sample indices for each clip in the original audio
- `ts` — last access time (TTL eviction at 30 min)

The session enables `/query-custom` to re-query without re-uploading, which powers
live re-querying as the user edits custom pad text fields.

### Key constants

```python
SR            = 48_000     # all audio resampled to this
CLIP_PRE      = 0.06       # pre-roll before each onset (seconds)
CLIP_POST_MIN = 0.06       # minimum clip post-roll
CLIP_POST_MAX = 2.0        # maximum clip post-roll (onset-bounded in practice)
EMBED_WINDOW  = 0.15       # window fed to CLAP for classification (transient-focused)
CLIP_MARGIN   = 0.40       # extra audio on each side of clip for trim widening
LYRIC_POST_ROLL = 0.20     # padding after each Whisper word timestamp
MAX_SECS      = 600        # 10 minutes
MAX_CLIPS     = 600        # max onsets to process
EARLY_EXIT_THRESH = 0.82   # stop CLAP embedding when all drums hit this score
EARLY_EXIT_MIN    = 64     # always embed at least this many clips before early exit
N_CANDIDATES  = 3          # runner-up candidates returned per drum slot
WHISPER_MODEL = "base"
SESSION_TTL   = 1800       # seconds before session eviction
```

### The two-clip system (important)

`extract_clips` returns **two** clip lists per onset, not one:

- `embed_clips` — 150ms window from onset start, independently normalised. Fed to
  CLAP. Short enough to be transient-focused; CLAP discriminates kick vs snare almost
  entirely on the first 80ms anyway.

- `output_clips` — full onset-bounded window (up to 2s), what gets sent to the
  browser. The user plays and trims this.

These have the same length and correspond by index. The session also stores
`clip_starts`/`clip_ends` (sample indices into the original audio) which are used by
`build_context_clip` to add margin.

### Context clips and trim widening

Each candidate sent to the browser is not the raw `output_clip` but a **context
clip**: `CLIP_MARGIN` (400ms) of audio on each side of the clip, built from
`audio_raw`. The candidate includes `trim_start` and `trim_end` fractions that
locate the original clip within this wider window. The frontend initialises trim
handles from these fractions, so the sound plays the same as before by default, but
the user can drag handles into the margin to widen the clip.

### Onset detection and backtracking

`detect_onsets` uses `librosa.onset.onset_detect` with `backtrack=False`, then does
its own backtrack: for each onset, scan back up to 60ms looking for the first frame
where amplitude crosses 5% of the local peak. This is more aggressive than librosa's
built-in backtrack, which uses 20% and misses fast transients.

**Do not revert to `librosa.effects.trim`** for silence stripping in
`record_custom` — it uses relative-to-peak threshold and silently eats quiet sounds.
The current code uses an absolute RMS floor.

### Early-exit CLAP embedding

The embedding loop runs in batches of 32. After each batch (once ≥64 clips are
embedded), it checks whether every drum type has a clip scoring above 0.82 against
its prototypes. If so, embedding stops. The remaining clips are unused for CLAP but
Whisper transcribes the full audio regardless (separate pipeline).

Early exit is disabled when custom CLAP text queries are present — those might need
to find a rare sound anywhere in the song.

### NaN sanitization

Some clips produce degenerate (NaN/inf) CLAP embeddings — very short or near-silent
clips after aggressive backtracking. After each batch, rows failing `np.isfinite` are
replaced with zero vectors. They score 0 against everything and can't pollute scoring.

### API endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `/analyze` | POST | Main pipeline: audio → drum candidates + transcript + session |
| `/record-custom` | POST | Record a single sound into a custom pad, label via vocab |
| `/query-custom` | POST | Re-query a custom pad against session data (CLAP or lyrics) |

`/analyze` accepts `file` (audio blob) and `custom_texts` (JSON dict of slot_id →
text for CLAP text-query matching).

`/query-custom` accepts `session_id`, `text`, `mode` (`clap` or `lyrics`), `top_k`.

---

## Frontend architecture

### Technology

p5.js for canvas rendering + Web Audio API for playback. All UI is drawn on a single
canvas except for HTML elements: 4 `<input type="text">` for custom pad descriptions,
4 `<label>/<input type="checkbox">` for lyrics mode toggles, one `<input type="number">`
for the add-grid step count, and a DOM div for the transcript picker modal.

The `drag` global handles all click-drag interactions (BPM slider, trim handles,
volume/pitch dials, sequencer paint stroke).

### Pad types

**Standard pads** (A S D F — kick, hi-hat, snare, clap): assigned by CLAP prototype
matching from the full recording. Show waveform in trim bar, support trim widening.

**Custom pads** (G H J K): two modes —
- *CLAP text mode*: type a description in the text field, gets matched against
  audio embeddings from the session. Field updates trigger live re-queries (400ms
  debounce, `/query-custom`).
- *Lyrics mode*: checkbox enables this. Opens transcript picker modal if transcript
  is loaded, otherwise does string-match against `lyricsTranscript`. Supports
  multi-word phrases by tokenizing query and finding consecutive runs in transcript.
  Per-pad record button (small dot in trim bar area) records a clip directly; labels
  it via vocabulary nearest-neighbor, populates text field with top label.

### Sequencer

4 grids by default (starts with 1; user adds more). Each grid is independently
configurable (2–32 steps). All grids share the same loop duration (4 beats at BPM),
so different step counts create polyrhythm. Single scanline across all grids.

**Scheduler** (critical — has been buggy, do not simplify): uses `setTimeout` loop
every 25ms. `_nextSteps[gi]` runs up to `g.steps * 2` (not just `g.steps`) — this
allows pre-scheduling step 0 of the next loop within the current lookahead window so
the loop boundary is seamless. On rebase, subtract `g.steps` from each counter rather
than resetting to 0, so pre-scheduled steps don't double-fire.

`loopFraction()` uses `((pos % dur) + dur) % dur / dur` — the double-modulo is
intentional, handles the brief negative `pos` that occurs when the scheduler
advances `_loopStartTime` 100ms before the loop actually ends.

**Sequencer drag-paint**: clicking a cell starts a `seqPaint` drag. `mouseDragged`
paints all cells between `lastS` and current step with the same on/off value as the
initial click. Guarded by `if(!pickerOpen)` so the transcript picker doesn't bleed
through.

### Audio playback

Each drum has a `GainNode` in the Web Audio graph. Trim is applied at `src.start()`
time via offset/duration args. Pitch is `src.playbackRate.value = 2^(semitones/12)`.

Candidates carry `trimStart` and `trimEnd` fractions. These are initialised from the
server's `trim_start`/`trim_end` values (which locate the original clip within the
wider context window). Swapping candidates with ↻ updates trim to the new candidate's
values.

### Transcript picker

DOM modal, floated near the custom pad that opened it. Shows all Whisper words as
chips. Click = select one word; shift-click = extend to contiguous range. "Use
selection" calls `mergeWordBuffers` and assigns the merged clip to the pad.

`mergeWordBuffers` trims each word except the last to `rawEndSamps` (stored from
`raw_end_samps` in the server response) before concatenation. This removes the 200ms
`LYRIC_POST_ROLL` tail from all but the final word, preventing an audible
double-repetition at word boundaries.

---

## Known fragile areas

**1. The analyze route is too long (~200 lines).** It should be split into
`run_drum_assignment()`, `run_custom_text_queries()`, and `build_session()` helper
functions. Currently everything is inline.

**2. Short variable names throughout.** `gi`, `di`, `ci`, `ri`, `si`, `ts`, `te`,
`s` mean different things in different scopes. Rename pass needed.

**3. `mousePressed` in sketch.js is ~150 lines** and handles everything from header
clicks to pad trim handles to grid cells. Needs splitting by region.

**4. drawPads is ~130 lines** and draws both standard and custom pads with shared
but slightly divergent logic. Should be split into `drawStandardPad` and
`drawCustomPad` calling shared helpers.

**5. `seqGrid` and `grids` are parallel arrays** (`grids[i].steps`,
`seqGrid[i][drumId]`). They should be a single array of objects:
`grids[i] = { steps: 16, cells: { kick: [...], snare: [...], ... } }`.

**6. HTML element positioning** (custom inputs, lyrics checkboxes, add-grid input,
transcript picker) is computed every frame in `draw()` via `positionCustomInputs()`
and `positionAddGridInput()`. This is fine for now but should move to
`windowResized()` only.

**7. `requirements.txt` has `torchaudio` listed** but it is no longer used (the
torchaudio-based Griffin-Lim transform route was removed). Safe to remove.

---

## Things tried and abandoned

**Embedding inversion / style transfer** — gradient descent on mel spectrogram to
move a sound's CLAP embedding toward a text keyword. Implemented and working but
the output sounded like "badly compressed teleconference." The Griffin-Lim inversion
step loses too much information. Removed entirely.

**`librosa.effects.trim` in record_custom** — caused quiet sounds to be trimmed to
near-silence because the threshold is relative to clip peak. Replaced with absolute
RMS floor.

**`torchaudio.transforms.InverseMelScale`** — uses `lstsq` which fails on
rank-deficient mel filterbanks (they always are). Was part of the style transfer
pipeline, gone with it.

**Inline loop rebase in scheduler** — tried rebasing `_loopStartTime` *inside* the
while loop to pre-schedule next-loop steps without waiting for a timeout tick.
Caused infinite loops with non-16-step grids (15 steps was the reproducer). Reverted
to reactive rebase at top of `scheduleLoop` with the `g.steps * 2` peek-ahead instead.

**CLAP text-to-audio for drum classification** — early version used text prompts
("kick drum", "snare hit") as queries. Replaced by audio-to-audio prototype matching
(reference .wav files → embeddings) because CLAP's audio-audio similarity is
substantially tighter than its text-audio similarity for this task.

**Timbral adjective vocabulary** — first vocabulary was ~500 terms including
adjectives like "sudden", "gradual", "aggressive". Replaced with 259 concrete nouns
only. Adjectives return unsatisfying labels; nouns match CLAP's training distribution
better.

---

## Planned work (priority order)

### 1. Refactor (before anything else)

- Rename short variables throughout both files
- Split `analyze` route into helper functions
- Split `mousePressed` and `drawPads` in sketch.js
- Merge `grids` and `seqGrid` into one data structure
- Move HTML element positioning out of `draw()` loop

### 2. Tests

- **DSP unit tests** (high value, no GPU needed): synthesize test audio with impulses
  at known times, assert onset detection accuracy, clip boundary correctness,
  backtrack behavior. Use pytest, pure numpy, runs in <1s.
- **Route tests with mocked models**: use pytest + httpx AsyncClient, mock
  `_embed_audio_arrays` and `transcribe_audio`. Catches endpoint signature bugs,
  JSON structure bugs, the `custom = _json_peek` class of mistake.
- **Integration tests** (slow, marked `@pytest.mark.slow`): real CLAP model, small
  reference audio, assert drum assignment scores above threshold.

### 3. Modal deployment

The backend needs to stay as a persistent process (session cache, loaded models).
Modal's `@modal.web_endpoint` with `keep_warm=1` is the right pattern. Key
considerations:
- CLAP and Whisper models should be baked into the Modal image (not downloaded at
  runtime) — use `modal.Image.from_registry(...).run_commands("python -c 'from
  transformers import ClapModel; ClapModel.from_pretrained(...)'")` pattern
- The frontend needs `BACKEND` updated from `localhost:8000` to the Modal URL
- Session cache works fine — Modal keeps the container warm between requests
- References directory needs to be in the Modal volume or baked into the image

### 4. Transcript picker improvements

- Currently shift-click only extends from anchor rightward/leftward. Should support
  discontiguous selection (ctrl-click to add individual words).
- No indication in the picker of which words are already assigned to other pads.
- The picker doesn't reopen when lyrics checkbox is already checked and user wants
  to reselect — need a "reopen picker" affordance.

### 5. Whisper model upgrade

`WHISPER_MODEL = "base"` trades accuracy for speed. For whole-song transcription,
`"small"` or `"medium"` gives meaningfully better word boundary accuracy, especially
for sung content. Should be a configurable parameter, not a constant.

---

## Product intent (aesthetic/UX notes)

The tone of the whole tool is dry and utilitarian — think fine-tip pen drawing on
cream paper, not a glossy DAW. The visual language: warm cream background (HSB
38,14,93), white panels, thin 1px near-black borders, IBM Plex Mono throughout,
Orbitron Bold only for the BOXER wordmark.

The user is a musician or sound designer who will use this to build unusual sample
kits — recording a trash can, beatboxing, singing, or uploading a full song. The
"custom pads" with CLAP text queries and lyrics mode are the most distinctive feature.
The polymetric sequencer (multiple grids with different step counts sharing a loop
duration) enables rhythm patterns that standard sequencers can't produce.

What the tool is *not*: it's not trying to be a DAW, not trying to be a drum machine
with preset kits, not trying to be a speech-to-MIDI thing.

The keyboard mapping is ASDF (standard pads) + GHJK (custom pads) — home row,
intentional. The sequencer record mode only writes into grid 0 (16-step) regardless
of how many grids exist, which is correct — the other grids are for manual programming.
