// ── BOXER — Configuration, constants, palette, and utility functions ─────────

const BACKEND = window.location.hostname === 'localhost' ? 'http://localhost:8000' : '';
const N_CANDIDATES = 3;

// ── Pad definitions ─────────────────────────────────────────────────────────
// Hues chosen so every horizontally/vertically adjacent pad pair differs by ≥90°.
const PAD_DEFS = [
  { id: 'pad_0',  kbd: 'A', hue: 10  }, { id: 'pad_1',  kbd: 'S', hue: 42  },
  { id: 'pad_2',  kbd: 'D', hue: 205 }, { id: 'pad_3',  kbd: 'F', hue: 295 },
  { id: 'pad_4',  kbd: 'G', hue: 80  }, { id: 'pad_5',  kbd: 'H', hue: 170 },
  { id: 'pad_6',  kbd: 'J', hue: 260 }, { id: 'pad_7',  kbd: 'K', hue: 350 },
  { id: 'pad_8',  kbd: 'Z', hue: 10  }, { id: 'pad_9',  kbd: 'X', hue: 42  },
  { id: 'pad_10', kbd: 'C', hue: 205 }, { id: 'pad_11', kbd: 'V', hue: 295 },
  { id: 'pad_12', kbd: 'B', hue: 80  }, { id: 'pad_13', kbd: 'N', hue: 170 },
  { id: 'pad_14', kbd: 'M', hue: 260 }, { id: 'pad_15', kbd: ',', hue: 350 },
];

function getPadDef(id) { return PAD_DEFS.find(d => d.id === id); }

let availablePrototypes = [];


// ── Palette (HSB: hue/360, sat/100, brightness/100) ─────────────────────────
// Editable via debug overlay (backtick key to toggle)
let _palette = {
  BG:           [191, 20, 100],
  PANEL:        [201, 10, 91],
  CTRL_PANEL:   [210, 16, 100],
  SEQ_CELL:     [201,  9, 98],
  SEQ_CELL_ALT: [212, 13, 90],
  INK:          [210,  8,  0],
  INK_DIM:      [210,  5,  0],
  INK_FAINT:    [210,  3,  0],
  ACCENT:       [205, 45, 75],
  SELECTED_HDR: [206,  8, 100],
  DRUM_S: 75, DRUM_B: 53,
  DRUM_S_LITE: 35, DRUM_B_LITE: 90,
};
// Live references — these arrays/values are updated in place by the debug overlay
const BG        = [191, 20, 100];
const PANEL     = [201, 10, 91];
const CTRL_PANEL = [210, 16, 100];
const SEQ_CELL  = [201,  9, 98];
const SEQ_CELL_ALT = [212, 13, 90];
const INK       = [210,  8,  0];
const INK_DIM   = [210,  5,  0];
const INK_FAINT = [210,  3,  0];
const ACCENT    = [205, 45, 75];
const RED       = [0,  55,  65];
const SELECTED_HDR = [206,  8, 100];
let DRUM_S = 75, DRUM_B = 53;
let DRUM_S_LITE = 35, DRUM_B_LITE = 90;
// Fixed measure tab colors (consistent across all sequencers)
const MEASURE_HUES = [205, 260, 160, 25, 330, 120, 45, 290];

// ── Debug overlay state ────────────────────────────────────────────────────
let _fontsReady = false;
let _debugOpen = false;
let _debugFont = 'Gill Sans';
let _debugFontSize = 2;

// ── UI scale ────────────────────────────────────────────────────────────────
const UI_SCALE = 1.25;
function mX() { return mouseX / UI_SCALE; }
function mY() { return mouseY / UI_SCALE; }
function cW() { return width  / UI_SCALE; }
function cH() { return height / UI_SCALE; }

// ── Layout constants ─────────────────────────────────────────────────────────
const PAD_H         = 86;    // legacy — used by control panel height
const LYRICS_STRIP_H = 14;   // legacy
const PAD_ROW_GAP   = 8;     // legacy
const INPUT_H       = 26;
const TRIM_H        = 22;
const TRIM_GAP      = 0;

// ── Keyboard grid + control panel ───────────────────────────────────────────
const KEY_W           = 36;
const KEY_H           = 28;
const KEY_GAP         = 3;
const KEY_ROW2_OFFSET = 15;
const CTRL_PANEL_MIN_W = 160;
const CTRL_PANEL_GAP  = 12;  // gap between key grid and control panel
const SEQ_ROW_H_MIN = 13;
const SEQ_ROW_H_MAX = 28;
let   SLOT_HDR_H    = 22;
const SLOT_GAP      = 0;
const SEQ_CTRL_H    = 28;
const FOOTER_H      = 16;
const HEADER_H      = 36;
const SEQ_MARGIN_MAX = 56;
const CONTENT_MIN_W = 604;
let SEQ_MARGIN      = 56;
const SEQ_LABEL_W   = 68;
const VOL_TAB_W     = 36;
const CORNER_RADIUS = 5;
const MIN_WIDTH     = 775;

// ── Trimmer ──────────────────────────────────────────────────────────────────
const TRIM_MAX_SECS = 30;

// ── EQ ────────────────────────────────────────────────────────────────────────
const EQ_LOW_FREQ  = 200;
const EQ_MID_FREQ  = 1000;
const EQ_HIGH_FREQ = 5000;
const EQ_MID_Q     = 1.0;
const EQ_GAIN_RANGE = 18;
// Log-spaced frequencies for curve drawing (20Hz–20kHz)
const EQ_CURVE_FREQS = new Float32Array(200);
for (let _i = 0; _i < 200; _i++) EQ_CURVE_FREQS[_i] = 20 * Math.pow(1000, _i / 199);

// ── Sequencer timing ─────────────────────────────────────────────────────────
const LOOKAHEAD_MS   = 25;
const SCHEDULE_AHEAD = 0.10;
const MAX_MEASURES   = 8;
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
  while (len > 4) { len--; const h=Math.floor(len/2); const t=str.slice(0,h).trimEnd()+'\u2026'+str.slice(-(len-h)).trimStart(); if (textWidth(t)<=maxWidth) return t; }
  return str.slice(0,2).trimEnd()+'\u2026';
}

/** Create a new slot data structure. Starts with no active pads. */
let _nextHueOffset = 0;
function createSlot() {
  const offset = _nextHueOffset;
  _nextHueOffset = (_nextHueOffset + 137) % 360; // golden-angle step for variety
  return {
    drumCandidates: {}, drumIdx: {}, drumVolumes: {}, drumPitch: {},
    drumTrimStart: {}, drumTrimEnd: {}, drumEQ: {},
    drumSpeed: {}, drumPitchSpeedLinked: {},
    activePadIds: [],
    padText: {}, padFinalized: {}, padMode: {}, padMenuOpen: {},
    sessionId: null, sourceBuffer: null, analyzeResults: {},
    lyricsTranscript: [], transcriptLoaded: false, analyzing: false, reuploadPending: false,
    grid: { steps: 16, measures: [{ cells: {}, cellPitch: {} }], editMeasure: 0 }, gridVolume: 1.0, swing: 0, humanize: 0, muted: false, soloed: false,
    humanizeSeeds: makeHumanizeSeeds(),
    hueOffset: offset,
    fileName: null,
  };
}
