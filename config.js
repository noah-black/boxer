// ── BOXER — Configuration, constants, palette, and utility functions ─────────

const BACKEND = window.location.hostname === 'localhost' ? 'http://localhost:8000' : '';
const N_CANDIDATES = 3;

// ── Drum and custom pad definitions ──────────────────────────────────────────
const DRUMS = [
  { id: 'kick',  label: 'KICK',   kbd: 'A', hue: 10  },
  { id: 'hihat', label: 'HI-HAT', kbd: 'S', hue: 42  },
  { id: 'snare', label: 'SNARE',  kbd: 'D', hue: 205 },
  { id: 'clap',  label: 'CLAP',   kbd: 'F', hue: 295 },
];

// Hues chosen so every horizontally/vertically adjacent pad pair differs by ≥90°.
const CUSTOM_DEFS = [
  { id: 'custom_0',  kbd: 'G', hue:  80 }, { id: 'custom_1',  kbd: 'H', hue: 170 },
  { id: 'custom_2',  kbd: 'J', hue: 260 }, { id: 'custom_3',  kbd: 'K', hue: 350 },
  { id: 'custom_4',  kbd: 'Z', hue: 260 }, { id: 'custom_5',  kbd: 'X', hue: 350 },
  { id: 'custom_6',  kbd: 'C', hue:  80 }, { id: 'custom_7',  kbd: 'V', hue: 170 },
  { id: 'custom_8',  kbd: 'B', hue: 260 }, { id: 'custom_9',  kbd: 'N', hue: 350 },
  { id: 'custom_10', kbd: 'M', hue:  80 }, { id: 'custom_11', kbd: ',', hue: 170 },
];

// ── Palette (HSB: hue/360, sat/100, brightness/100) ─────────────────────────
const BG        = [38,  5, 97];
const PANEL     = [0,   0, 100];
const INK       = [0,   0,   8];
const INK_DIM   = [0,   0,  48];
const INK_FAINT = [0,   0,  72];
const ACCENT    = [38, 80,  78];
const RED       = [0,  70,  72];
const DRUM_S = 70, DRUM_B = 60;
const DRUM_S_LITE = 35, DRUM_B_LITE = 90;

// ── Layout constants ─────────────────────────────────────────────────────────
const PAD_H         = 86;
const LYRICS_STRIP_H = 14;
const PAD_ROW_GAP   = 8;
const INPUT_H       = 26;
const TRIM_H        = 14;
const TRIM_GAP      = 0;
const SEQ_ROW_H_MIN = 13;
const SEQ_ROW_H_MAX = 28;
const SLOT_HDR_H    = 22;
const SLOT_GAP      = 0;
const SEQ_CTRL_H    = 28;
const FOOTER_H      = 16;
const HEADER_H      = 36;
const SEQ_MARGIN    = 56;
const SEQ_LABEL_W   = 68;
const VOL_TAB_W     = 36;
const CORNER_RADIUS = 5;
const MIN_WIDTH     = 700;

// ── Trimmer ──────────────────────────────────────────────────────────────────
const TRIM_MAX_SECS = 30;

// ── Sequencer timing ─────────────────────────────────────────────────────────
const LOOKAHEAD_MS   = 25;
const SCHEDULE_AHEAD = 0.10;
const LYRIC_POST_ROLL = 0.20;

// ── Utility functions ────────────────────────────────────────────────────────

/** Generate 32 zero-mean random values in [-1,1] for humanize timing jitter. */
function makeHumanizeSeeds() {
  const seeds = Array.from({length:32}, () => Math.random()*2-1);
  const mean = seeds.reduce((a,b)=>a+b,0)/seeds.length;
  return seeds.map(v => v-mean);
}

/** Wrap a raw DOM input element in a minimal interface matching p5 element API. */
function makeInputWrapper(domEl) {
  return {
    elt:   domEl,
    value: () => domEl.value,
    style: (prop, val) => { domEl.style[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = val; },
  };
}

/** Convert HSB (h/360, s/100, b/100) to HSL for CSS usage. */
function hsbToHsl(h, s, b) {
  const bn=b/100, sn=s/100, l=bn*(1-sn/2);
  const sl=(l===0||l===1)?0:(bn-l)/Math.min(l,1-l);
  return [h, Math.round(sl*100), Math.round(l*100)];
}

/** Truncate a string in the middle if it exceeds maxWidth pixels. */
function truncateMiddle(str, maxWidth) {
  if (!str) return ''; if (textWidth(str) <= maxWidth) return str;
  let len = str.length;
  while (len > 4) { len--; const h=Math.floor(len/2); const t=str.slice(0,h)+'\u2026'+str.slice(-(len-h)); if (textWidth(t)<=maxWidth) return t; }
  return str.slice(0,2)+'\u2026';
}

/** Look up a CUSTOM_DEFS entry by id. */
function getCustomDef(id) { return CUSTOM_DEFS.find(d => d.id === id); }

/** Check if an id belongs to a custom pad. */
function isCustomId(id) { return !!CUSTOM_DEFS.find(d => d.id === id); }

/** Create a new slot data structure with default values for all drums. */
function createSlot() {
  const slot = {
    drumCandidates: {}, drumIdx: {}, drumVolumes: {}, drumPitch: {},
    drumTrimStart: {}, drumTrimEnd: {},
    activePadIds: [],
    padLyricsMode: {}, padRecording: {}, padRecLabels: {}, padRecorders: {},
    sessionId: null, sourceBuffer: null,
    lyricsTranscript: [], transcriptLoaded: false,
    grid: { steps: 16, cells: {} }, gridVolume: 1.0, swing: 0, humanize: 0,
    humanizeSeeds: makeHumanizeSeeds(),
    fileName: null,
    hiddenDrumIds: new Set(),
    customInputEls: [], lyricsCheckEls: [], padFinalized: {},
  };
  DRUMS.forEach(drum => {
    slot.drumCandidates[drum.id] = []; slot.drumIdx[drum.id] = 0;
    slot.drumVolumes[drum.id] = 0.8; slot.drumPitch[drum.id] = 0;
    slot.drumTrimStart[drum.id] = 0; slot.drumTrimEnd[drum.id] = 1;
    slot.grid.cells[drum.id] = new Array(16).fill(false);
  });
  return slot;
}
