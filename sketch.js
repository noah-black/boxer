// ─────────────────────────────────────────────────────────────────────────────
// BOXER — drum extractor + polymetric sequencer
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = 'https://noahblack--boxer-fastapi-app.modal.run';
const N_CANDIDATES = 3;

// Standard audio-extracted drums (top row: A S D F)
const DRUMS = [
  { id: 'kick',  label: 'KICK',   kbd: 'A', hue: 10  },
  { id: 'hihat', label: 'HI-HAT', kbd: 'S', hue: 42  },
  { id: 'snare', label: 'SNARE',  kbd: 'D', hue: 205 },
  { id: 'clap',  label: 'CLAP',   kbd: 'F', hue: 295 },
];

// Text-query drums (bottom row: G H J K)
const CUSTOM_DRUMS = [
  { id: 'custom_0', kbd: 'G', hue: 155 },
  { id: 'custom_1', kbd: 'H', hue: 175 },
  { id: 'custom_2', kbd: 'J', hue: 225 },
  { id: 'custom_3', kbd: 'K', hue: 260 },
];

const ALL_DRUMS = [...DRUMS, ...CUSTOM_DRUMS];

// ── Palette ───────────────────────────────────────────────────────────────────
const BG        = [38, 14, 93];
const PANEL     = [0,   0, 100];
const INK       = [0,   0,   8];
const INK_DIM   = [0,   0,  48];
const INK_FAINT = [0,   0,  72];
const ACCENT    = [38, 80,  78];
const RED       = [0,  70,  72];
const DRUM_S = 70, DRUM_B = 60;
const DRUM_S_LITE = 35, DRUM_B_LITE = 90;

// ── App state ─────────────────────────────────────────────────────────────────
let phase = 'ready';

let drumCandidates = {};
let drumIdx        = {};
let drumVolumes    = {};
let drumPitch      = {};   // semitones, -12..+12
let drumTrimStart  = {};
let drumTrimEnd    = {};
let gainNodes      = {};
let padFlash       = {};
let padHeld        = {};
let drag           = null;

let seqBPM         = 120;
let seqPlaying     = false;
let seqRecording   = false;
let scheduleTimer  = null;
let _loopStartTime = 0;
let _nextSteps     = [];
const LOOKAHEAD_MS   = 25;
const SCHEDULE_AHEAD = 0.10;

let tapTimes = [];

let mediaRecorder = null;
let recChunks     = [];
let recStream     = null;
let recStart      = 0;
let analyserNode  = null;
let waveformData  = null;

let audioCtx = null;
let uploadEl = null;
let customInputEls = [];
let lyricsCheckEls  = [];   // 4 checkboxes, one per custom pad
let lyricsTranscript = [];  // [{word, start, end, buffer}] decoded after analyze
let padLyricsMode   = {};   // id -> bool
let sessionId       = null; // server session token for live re-querying

// Transcript picker state
let pickerOpen      = false;   // is the picker panel visible?
let pickerPadId     = null;    // which custom pad id it's targeting
let pickerPadCustomIdx = null;    // index into CUSTOM_DRUMS
let pickerSel       = [];      // array of selected word indices (consecutive)
let pickerAnchor    = null;    // index of first selected word (for shift-click range)
let pickerEl        = null;    // the DOM panel element
let addGridInputEl = null;   // HTML input for new-grid step count

let errorMsg  = '';
let spinAngle = 0;

// Per-custom-pad recording state
let padRecording   = {};   // id -> bool (mic open)
let padRecLabels   = {};   // id -> [{term, score}, ...]
let padRecorders   = {};   // id -> {mediaRecorder, chunks, stream}

// ── Layout ────────────────────────────────────────────────────────────────────
const PAD_H         = 112;
const INPUT_H       = 26;
const TRIM_H        = 14;
const TRIM_GAP      = 5;
const SEQ_ROW_H_MIN = 13;
const SEQ_ROW_H_MAX = 28;
const GRID_GAP      = 8;
const SEQ_CTRL_H    = 40;
const FOOTER_H      = 16;
const HEADER_H      = 52;
const SEQ_MARGIN    = 56;
const SEQ_LABEL_W   = 68;
const STEP_TAB_W    = 36;
const CLR_TAB_W     = 42;
const R             = 5;

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('IBM Plex Mono');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  uploadEl = select('#upload-input');
  uploadEl.changed(onFileSelected);

  customInputEls = [0,1,2,3].map(i => {
    const el = select(`#custom-${i}`);
    el.elt.addEventListener('keydown', e => {
      e.stopPropagation();
    });
    // Live lyrics re-query on input change
    el.elt.addEventListener('input', () => {
      const d = CUSTOM_DRUMS[i];
      if(padLyricsMode[d.id]){
        applyLyricsQuery(d.id, i);
      } else if(sessionId){
        queryClapLive(d.id, i);
      }
    });
    return el;
  });

  // Lyrics mode checkboxes (one per custom pad)
  lyricsCheckEls = CUSTOM_DRUMS.map((d, i) => {
    const wrap = document.createElement('label');
    wrap.style.cssText = [
      'position:absolute','display:none','align-items:center',
      'gap:3px','font-family:IBM Plex Mono,monospace','font-size:9px',
      'color:rgba(0,0,0,0.6)','cursor:pointer','pointer-events:auto',
      'white-space:nowrap'
    ].join(';');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.style.cssText = 'margin:0;cursor:pointer;width:11px;height:11px';
    cb.addEventListener('change', () => {
      padLyricsMode[d.id] = cb.checked;
      if(cb.checked){
        if(lyricsTranscript.length > 0) openPicker(d.id, i);
        else applyLyricsQuery(d.id, i);
      } else {
        closePicker();
      }
    });
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode('lyrics'));
    document.body.appendChild(wrap);
    wrap._cb = cb;
    return wrap;
  });

  // Transcript picker panel
  pickerEl = document.createElement('div');
  pickerEl.style.cssText = [
    'position:fixed','display:none','z-index:100',
    'background:rgba(248,244,236,0.97)',
    'border:1px solid rgba(0,0,0,0.5)','border-radius:6px',
    'box-shadow:0 4px 24px rgba(0,0,0,0.18)',
    'padding:10px 12px 12px','max-width:420px','min-width:220px',
    'max-height:340px','overflow-y:auto',
    'font-family:IBM Plex Mono,monospace',
    'pointer-events:auto',
  ].join(';');

  // Header row
  const pickerHeader = document.createElement('div');
  pickerHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
  const pickerTitle = document.createElement('span');
  pickerTitle.textContent = 'pick words';
  pickerTitle.style.cssText = 'font-size:10px;color:rgba(0,0,0,0.5);letter-spacing:0.05em;';
  const pickerOk = document.createElement('button');
  pickerOk.textContent = 'use selection';
  pickerOk.style.cssText = [
    'font-family:IBM Plex Mono,monospace','font-size:9px',
    'border:1px solid rgba(0,0,0,0.5)','border-radius:3px',
    'background:white','cursor:pointer','padding:2px 7px',
  ].join(';');
  pickerOk.addEventListener('click', commitPickerSelection);
  const pickerClose = document.createElement('button');
  pickerClose.textContent = '✕';
  pickerClose.style.cssText = [
    'font-family:IBM Plex Mono,monospace','font-size:10px',
    'border:none','background:none','cursor:pointer',
    'color:rgba(0,0,0,0.4)','padding:0 0 0 6px',
  ].join(';');
  pickerClose.addEventListener('click', closePicker);
  pickerHeader.appendChild(pickerTitle);
  const pickerBtns = document.createElement('div');
  pickerBtns.appendChild(pickerOk); pickerBtns.appendChild(pickerClose);
  pickerHeader.appendChild(pickerBtns);
  pickerEl.appendChild(pickerHeader);

  // Word chips container
  const pickerChips = document.createElement('div');
  pickerChips.id = 'picker-chips';
  pickerChips.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
  pickerEl.appendChild(pickerChips);
  document.body.appendChild(pickerEl);

  // Add-grid input
  addGridInputEl = document.createElement('input');
  addGridInputEl.type = 'number';
  addGridInputEl.min  = '2';
  addGridInputEl.max  = '32';
  addGridInputEl.value = '16';
  addGridInputEl.style.cssText = [
    'position:absolute','width:38px','height:20px',
    'font-family:IBM Plex Mono,monospace','font-size:10px',
    'text-align:center','border:1px solid rgba(0,0,0,0.45)',
    'border-radius:3px','background:white','outline:none',
    'padding:0 2px','display:none','box-sizing:border-box'
  ].join(';');
  addGridInputEl.addEventListener('keydown', e => {
    e.stopPropagation();
    if(e.key==='Enter') addGrid();
  });
  document.body.appendChild(addGridInputEl);

  CUSTOM_DRUMS.forEach(d => {
    padLyricsMode[d.id] = false;
    padRecording[d.id] = false;
    padRecLabels[d.id] = [];
    padRecorders[d.id] = null;
  });

  ALL_DRUMS.forEach(d => {
    padFlash[d.id]       = -9999;
    padHeld[d.id]        = false;
    drumVolumes[d.id]    = 0.8;
    drumPitch[d.id]     = 0;
    drumTrimStart[d.id]  = 0;
    drumTrimEnd[d.id]    = 1;
    drumCandidates[d.id] = [];
    drumIdx[d.id]        = 0;
    const g = audioCtx.createGain();
    g.gain.value = 0.8;
    g.connect(audioCtx.destination);
    gainNodes[d.id] = g;
  });

  // Start with one 16-step grid; more can be added at runtime
  _nextSteps[0] = 0;
  ALL_DRUMS.forEach(d => { grids[0].cells[d.id] = new Array(16).fill(false); });

  // Initial positioning — windowResized() is not called on first load
  positionCustomInputs();
  positionAddGridInput();
  updateElementVisibility();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  positionCustomInputs();
  positionAddGridInput();
  updateElementVisibility();
}

function loopDuration() { return 4 * (60.0 / seqBPM); }
function loopFraction() {
  if (!seqPlaying) return 0;
  const dur = loopDuration();
  const pos = audioCtx.currentTime - _loopStartTime;
  // pos can be slightly negative when scheduler just advanced _loopStartTime
  // JS % preserves sign, so we normalise explicitly
  return ((pos % dur) + dur) % dur / dur;
}

let grids = [{steps:16, cells:{}}];

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw() {
  background(...BG);
  drawHeader();
  spinAngle += 0.04;
  drawPads();
  drawSequencer();
  if      (phase === 'recording')  drawRecordingOverlay();
  else if (phase === 'processing') drawProcessingOverlay();
  else if (phase === 'error')      drawErrorOverlay();
}

// ── Header ────────────────────────────────────────────────────────────────────

function drawHeader() {
  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(0, 0, width, HEADER_H);

  textFont('Orbitron');
  textStyle(BOLD); textSize(22); textAlign(LEFT, CENTER);
  fill(...INK); noStroke();
  text('BOXER', 24, HEADER_H/2);
  textFont('IBM Plex Mono'); textStyle(NORMAL);

  const recX = 168, recY = HEADER_H/2, recR = 13;
  const isRec  = phase === 'recording';
  const recHov = dist(mouseX,mouseY,recX,recY) < recR;
  if(isRec){
    noFill(); stroke(...RED,(sin(frameCount*0.15)*0.5+0.5)*40); strokeWeight(4);
    circle(recX,recY,recR*2+10);
  }
  fill(isRec?RED:recHov?RED:[0,50,90]); stroke(...INK); strokeWeight(1);
  circle(recX,recY,recR*2);
  fill(...PANEL); noStroke();
  if(isRec){ rectMode(CENTER); rect(recX,recY,8,8,1); rectMode(CORNER); }
  else      { circle(recX,recY,7); }

  const upX = recX+recR+10;
  const upHov = mouseX>upX && mouseX<upX+80 && abs(mouseY-recY)<10;
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER);
  text('upload file', upX, recY);

  cursor(recHov||upHov ? HAND : ARROW);
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function getPadLayout() {
  const n=8, gap=9;
  const padW  = min(112, (width-60-gap*(n-1))/n);
  const total = padW*n + gap*(n-1);
  const startX = (width-total)/2;
  const padY   = HEADER_H + 10 + TRIM_H + TRIM_GAP;
  return { padW, gap, startX, padY };
}

function getSeqLayout() {
  const { padY } = getPadLayout();
  const seqTop  = padY + PAD_H + INPUT_H + 14;
  const seqW    = width - SEQ_MARGIN*2 - SEQ_LABEL_W;
  const gridTop = seqTop + SEQ_CTRL_H;
  const totalRows = grids.length * ALL_DRUMS.length;
  const available = height - gridTop - FOOTER_H - 6;
  const rowH = constrain(
    floor((available - (grids.length-1)*GRID_GAP) / totalRows),
    SEQ_ROW_H_MIN, SEQ_ROW_H_MAX
  );
  return { seqTop, seqW, rowH, ctrlY: seqTop, gridTop,
           gridLeft: SEQ_MARGIN + SEQ_LABEL_W };
}

function gridY(gridIdx, gridTop, rowH) {
  return gridTop + gridIdx*(ALL_DRUMS.length*rowH + GRID_GAP);
}

function trimBarRegion(x, y, padW) {
  return { x, y: y-TRIM_H-TRIM_GAP, w: padW, h: TRIM_H };
}
function dialCenter(x, y, padW, padH, idx) {
  // idx 0 = volume, idx 1 = pitch; two small dials side by side at pad bottom
  const spacing = padW / 3;
  return { cx: x + spacing*(idx+1) - spacing*0.05, cy: y+padH-22, r: 10 };
}
function swapBtnRegion(x, y, padW) {
  return { x: x+padW-24, y: y+9, w: 13, h: 13 };
}
function trimHandleX(x, padW, id) {
  return {
    startPx: x + drumTrimStart[id]*padW,
    endPx:   x + drumTrimEnd[id]*padW,
  };
}

function positionAddGridInput() {
  const { gridTop, rowH } = getSeqLayout();
  const totalH = grids.length*(ALL_DRUMS.length*rowH+GRID_GAP)-GRID_GAP;
  const below  = gridTop + totalH + 6;
  const bx     = SEQ_MARGIN + SEQ_LABEL_W;
  addGridInputEl.style.left = bx + 'px';
  addGridInputEl.style.top  = below + 'px';
}

function positionCustomInputs() {
  const { padW, gap, startX, padY } = getPadLayout();
  CUSTOM_DRUMS.forEach((d, i) => {
    const el  = customInputEls[i];
    const col = DRUMS.length + i;
    const px  = startX + col*(padW+gap);
    const py  = padY + PAD_H + 4;
    // Text input: narrower to leave room for checkbox
    const inputW = padW - 44;
    el.style('left',      px + 'px');
    el.style('top',       py + 'px');
    el.style('width',     inputW + 'px');
    el.style('font-size', '10px');

    // Lyrics checkbox: right of text input
    const wrap = lyricsCheckEls[i];
    wrap.style.left = (px + inputW + 4) + 'px';
    wrap.style.top  = (py + 2) + 'px';
  });
}

function updateElementVisibility() {
  const show = (phase === 'ready' || phase === 'recording');
  customInputEls.forEach((el, i) => {
    el.elt.style.display = show ? 'block' : 'none';  // el.show() only clears inline style, reverting to CSS display:none
    lyricsCheckEls[i].style.display = show ? 'flex' : 'none';
  });
  addGridInputEl.style.display = show ? 'block' : 'none';
}

function setPhase(p) { phase = p; updateElementVisibility(); }

// ── PADS ──────────────────────────────────────────────────────────────────────

// Shared: waveform, trim overlays, original-clip tick marks, drag handles
function drawTrimBar(d, x, y, padW) {
  const tb      = trimBarRegion(x, y, padW);
  const has     = drumCandidates[d.id].length > 0;
  const curCand = drumCandidates[d.id][drumIdx[d.id]];
  const overTb  = mouseX>tb.x && mouseX<tb.x+tb.w && mouseY>tb.y && mouseY<tb.y+tb.h;

  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(tb.x, tb.y, tb.w, tb.h, 3);
  if(has && curCand){
    const buf  = curCand.buffer;
    const chan  = buf.getChannelData(0);
    const step  = max(1, Math.floor(chan.length / tb.w));
    for(let pixelX=0; pixelX<tb.w; pixelX++){
      const frac      = pixelX / tb.w;
      const inTrim    = frac >= drumTrimStart[d.id] && frac <= drumTrimEnd[d.id];
      let peak = 0;
      const sampleIdx = Math.floor(frac * chan.length);
      for(let samp=sampleIdx; samp<min(sampleIdx+step, chan.length); samp++) peak = max(peak, abs(chan[samp]));
      const bh = peak * (tb.h-4) * 0.9;
      stroke(d.hue, inTrim?DRUM_S:22, inTrim?DRUM_B:80); strokeWeight(1);
      line(tb.x+pixelX, tb.y+tb.h/2-bh/2, tb.x+pixelX, tb.y+tb.h/2+bh/2);
    }
    noStroke(); fill(...BG, 55);
    rect(tb.x+1, tb.y+1, drumTrimStart[d.id]*(tb.w-2), tb.h-2, 2,0,0,2);
    const ef = drumTrimEnd[d.id];
    rect(tb.x+1+ef*(tb.w-2), tb.y+1, (1-ef)*(tb.w-2), tb.h-2, 0,2,2,0);
    // Faint tick marks showing original clip boundaries within context window
    const origS = (curCand.trimStart??0) * tb.w;
    const origE = (curCand.trimEnd??1)   * tb.w;
    stroke(d.hue, 30, 45, 60); strokeWeight(1);
    line(tb.x+origS, tb.y+1, tb.x+origS, tb.y+tb.h-1);
    line(tb.x+origE, tb.y+1, tb.x+origE, tb.y+tb.h-1);
    const {startPx, endPx} = trimHandleX(x, padW, d.id);
    const nearS = abs(mouseX-startPx)<8 && overTb;
    const nearE = abs(mouseX-endPx)<8   && overTb;
    fill(d.hue, nearS?80:DRUM_S, nearS?65:DRUM_B); noStroke();
    rect(startPx-1.5, tb.y, 3, tb.h, 1);
    fill(d.hue, nearE?80:DRUM_S, nearE?65:DRUM_B);
    rect(endPx-1.5, tb.y, 3, tb.h, 1);
  }
}

// Shared: pad rectangle, key label, sublabel, dials, swap button, cursor
function drawPadBody(d, x, y, padW, sublabel, active, padLive, isCustom, hasText) {
  const has    = drumCandidates[d.id].length > 0;
  const cands  = drumCandidates[d.id];
  const tb     = trimBarRegion(x, y, padW);
  const swp    = swapBtnRegion(x, y, padW);
  const dVol   = dialCenter(x, y, padW, PAD_H, 0);
  const dPitch = dialCenter(x, y, padW, PAD_H, 1);
  const overTb    = mouseX>tb.x  && mouseX<tb.x+tb.w  && mouseY>tb.y  && mouseY<tb.y+tb.h;
  const overVol   = dist(mouseX,mouseY,dVol.cx,dVol.cy)    < dVol.r+4;
  const overPitch = dist(mouseX,mouseY,dPitch.cx,dPitch.cy) < dPitch.r+4;
  const overSwap  = mouseX>swp.x && mouseX<swp.x+swp.w && mouseY>swp.y && mouseY<swp.y+swp.h;
  const overPad   = mouseX>x && mouseX<x+padW && mouseY>y && mouseY<y+PAD_H && !overVol && !overPitch && !overSwap;

  if(active)                    fill(d.hue, DRUM_S, DRUM_B+8);
  else if(overPad && padLive)   fill(d.hue, DRUM_S_LITE+10, DRUM_B_LITE-5);
  else if(isCustom && !hasText) fill(...BG, 40);
  else                          fill(...PANEL);
  stroke(...INK); strokeWeight(active ? 2 : 1);
  rect(x, y, padW, PAD_H, R);
  fill(d.hue, DRUM_S, DRUM_B, padLive?85:25); noStroke();
  rect(x+1, y+1, padW-2, 5, R,R,0,0);

  fill(active?[0,0,98]:padLive?[d.hue,DRUM_S,DRUM_B]:INK_FAINT);
  noStroke(); textSize(32); textStyle(BOLD); textAlign(CENTER,CENTER);
  text(d.kbd, x+padW/2, y+PAD_H/2-22);
  textStyle(NORMAL);

  fill(active?[0,0,95]:has?INK:INK_FAINT); textSize(8); textAlign(CENTER);
  let sl = sublabel.toUpperCase();
  while(sl.length > 1 && textWidth(sl) > padW - 12) sl = sl.slice(0,-1);
  text(sl, x+padW/2, y+PAD_H/2+2);

  drawDial(d, x, y, padW, PAD_H, 0, drumVolumes[d.id], 0,   1,   has, active);
  drawDial(d, x, y, padW, PAD_H, 1, drumPitch[d.id],  -12,  12,  has, active);

  if(cands.length > 1){
    const hov = mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
    fill(hov?ACCENT:PANEL); stroke(...INK); strokeWeight(1);
    circle(swp.x+swp.w/2, swp.y+swp.h/2, swp.w);
    fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
    text('↻', swp.x+swp.w/2, swp.y+swp.h/2+1);
    fill(...INK); textSize(8); textStyle(BOLD); textAlign(RIGHT);
    text(`${drumIdx[d.id]+1}/${cands.length}`, swp.x-4, swp.y+swp.h/2+2);
    textStyle(NORMAL);
  }

  const {startPx, endPx} = trimHandleX(x, padW, d.id);
  const nearH = has && overTb && (abs(mouseX-startPx)<8 || abs(mouseX-endPx)<8);
  cursor(nearH||overVol||overPitch||(overSwap&&cands.length>1)||(overPad&&padLive) ? HAND : ARROW);
}

// Custom-only: record dot drawn in the trim bar area
function drawCustomRecordBtn(d, x, y, padW) {
  const isRec     = padRecording[d.id];
  const recBtnX   = x + padW/2;
  const recBtnY   = y - TRIM_GAP - TRIM_H/2;
  const recBtnR   = 6;
  const recBtnHov = dist(mouseX,mouseY,recBtnX,recBtnY) < recBtnR+3;
  if(isRec){
    noFill(); stroke(d.hue,70,65,(sin(frameCount*0.15)*0.5+0.5)*45); strokeWeight(3);
    circle(recBtnX,recBtnY,recBtnR*2+8);
  }
  fill(isRec ? [d.hue,70,62] : recBtnHov ? [d.hue,50,80] : [0,0,94]);
  stroke(...INK); strokeWeight(1); circle(recBtnX,recBtnY,recBtnR*2);
  fill(isRec ? [0,0,98] : [d.hue,DRUM_S,DRUM_B]); noStroke();
  if(isRec){ rectMode(CENTER); rect(recBtnX,recBtnY,4,4,1); rectMode(CORNER); }
  else     { circle(recBtnX,recBtnY,4); }
}

function drawStandardPad(d, x, y, padW) {
  const has    = drumCandidates[d.id].length > 0;
  const ago    = millis() - padFlash[d.id];
  const active = (max(0, 1-ago/110) > 0) || padHeld[d.id];
  drawTrimBar(d, x, y, padW);
  drawPadBody(d, x, y, padW, (d.label || d.kbd), active, has, false, false);
}

function drawCustomPad(d, x, y, padW, customIdx) {
  const has     = drumCandidates[d.id].length > 0;
  const ago     = millis() - padFlash[d.id];
  const active  = (max(0, 1-ago/110) > 0) || padHeld[d.id];
  const tv      = customInputEls[customIdx] ? customInputEls[customIdx].value().trim() : '';
  const hasText = tv !== '';
  drawTrimBar(d, x, y, padW);
  drawPadBody(d, x, y, padW, (tv || d.kbd), active, (has || hasText), true, hasText);
  drawCustomRecordBtn(d, x, y, padW);
}

function drawPads() {
  const { padW, gap, startX, padY } = getPadLayout();
  DRUMS.forEach((d, i) => {
    drawStandardPad(d, startX + i*(padW+gap), padY, padW);
  });
  CUSTOM_DRUMS.forEach((d, i) => {
    drawCustomPad(d, startX + (DRUMS.length + i)*(padW+gap), padY, padW, i);
  });
}

// ── Dials ─────────────────────────────────────────────────────────────────────

function drawDial(d, x, y, padW, padH, idx, val, vmin, vmax, has, active) {
  const {cx, cy, r} = dialCenter(x, y, padW, padH, idx);
  const isPitch = (idx === 1);

  // Normalised 0-1 position
  const t = (val - vmin) / (vmax - vmin);

  // Arc: 7 o'clock to 5 o'clock (220° sweep), centered at bottom
  const startA = HALF_PI + radians(110);   // 7 o'clock (220° from top)
  const endA   = HALF_PI - radians(110);   // 5 o'clock
  const sweep  = TWO_PI - radians(220);    // 300° (wrong way; use angle math)
  // Simpler: map t to angle going clockwise from 7 o'clock
  const minA = PI*0.75;    // ~7 o'clock
  const maxA = PI*2.25;    // ~5 o'clock (crosses 0)
  const valA = minA + t*(maxA-minA);

  // Track arc (full range)
  stroke(0,0,has?80:88); strokeWeight(2); noFill();
  arc(cx,cy,r*2,r*2, minA, maxA);

  // Value arc
  if(has){
    stroke(d.hue, active?DRUM_S+10:DRUM_S, active?DRUM_B+5:DRUM_B); strokeWeight(2);
    if(isPitch && val >= 0) arc(cx,cy,r*2,r*2, PI*1.5, valA);
    else if(isPitch)        arc(cx,cy,r*2,r*2, valA, PI*1.5);
    else                    arc(cx,cy,r*2,r*2, minA, valA);
  }

  // Dial face
  fill(active?[d.hue,DRUM_S,DRUM_B+8]:PANEL); stroke(...INK); strokeWeight(1);
  circle(cx,cy,r*2);

  // Indicator line
  const lx = cx + cos(valA)*(r-2);
  const ly = cy + sin(valA)*(r-2);
  stroke(has?[d.hue,DRUM_S,DRUM_B]:INK_FAINT); strokeWeight(1.5);
  line(cx,cy,lx,ly);

  // Label above
  fill(...INK_DIM); noStroke(); textSize(8); textAlign(CENTER,BOTTOM);
  text(isPitch ? 'PITCH' : 'VOL', cx, cy-r-2);
  // Value below
  fill(...INK_FAINT); noStroke(); textSize(7); textAlign(CENTER,TOP);
  const labelStr = isPitch
    ? (val===0 ? '0' : (val>0?'+':'')+Math.round(val)+'st')
    : Math.round(val*100)+'%';
  text(labelStr, cx, cy+r+1);
}

// ── Dynamic sequencer grid management ─────────────────────────────────────────

function addGrid() {
  const steps = constrain(parseInt(addGridInputEl.value)||16, 2, 32);
  const cells = {};
  ALL_DRUMS.forEach(d => { cells[d.id] = new Array(steps).fill(false); });
  grids.push({steps, cells});
  _nextSteps[grids.length-1] = 0;
  positionAddGridInput();
}

function swapGrids(a, b) {
  if(a < 0 || b >= grids.length) return;
  [grids[a], grids[b]]           = [grids[b], grids[a]];
  [_nextSteps[a], _nextSteps[b]] = [_nextSteps[b], _nextSteps[a]];
}

function removeGrid(gridIdx) {
  if(grids.length <= 1) return;   // always keep at least one
  grids.splice(gridIdx, 1);
  _nextSteps.splice(gridIdx, 1);
  positionAddGridInput();
}

// ── Overlays ──────────────────────────────────────────────────────────────────

function drawRecordingOverlay() {
  // No full-screen scrim — UI stays fully visible.
  // Compact waveform + timer bar pinned just below the header.
  const bw=min(420,width-80), bh=36, bx=(width-bw)/2, by=HEADER_H+6;

  fill(...PANEL,92); stroke(...INK,60); strokeWeight(1); rect(bx,by,bw,bh,R);

  if(analyserNode&&waveformData){
    analyserNode.getByteTimeDomainData(waveformData);
    stroke(0,65,50,80); strokeWeight(1.5); noFill(); beginShape();
    for(let i=0;i<waveformData.length;i++)
      vertex(bx+8+map(i,0,waveformData.length-1,0,bw-16), by+map(waveformData[i],0,255,bh-4,4));
    endShape();
  }

  const elapsed=((millis()-recStart)/1000).toFixed(1);
  // Pulsing red dot
  fill(0,70,62,70+sin(frameCount*0.15)*25); noStroke();
  circle(bx+14, by+bh/2, 7);

  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER);
  text(elapsed+'s', bx+22, by+bh/2);
  fill(...INK_DIM); textAlign(RIGHT,CENTER); textSize(8);
  text('R or ● to stop', bx+bw-8, by+bh/2);
}

function drawProcessingOverlay() {
  noStroke(); fill(...BG,88); rect(0,HEADER_H,width,height-HEADER_H);
  const cx=width/2, cy=height/2, ticks=16;
  for(let i=0;i<ticks;i++){
    const a=(i/ticks)*TWO_PI+spinAngle;
    stroke(...ACCENT,pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*70+5); strokeWeight(2);
    line(cx+cos(a)*32,cy+sin(a)*32,cx+cos(a)*46,cy+sin(a)*46);
  }
  fill(...ACCENT); noStroke(); circle(cx,cy,7);
  fill(...INK); textSize(11); textAlign(CENTER); text('ANALYSING…',cx,cy+60);
  fill(...INK_DIM); textSize(9); text('running CLAP embeddings',cx,cy+76);
}

function drawErrorOverlay() {
  noStroke(); fill(...BG,88); rect(0,HEADER_H,width,height-HEADER_H);
  const cx=width/2, cy=height/2;
  fill(...RED); textSize(11); textAlign(CENTER); text('ERROR',cx,cy-16);
  fill(...INK_DIM); textSize(9); text(errorMsg,cx,cy+2);
  const hov=abs(mouseX-cx)<50&&abs(mouseY-(cy+22))<10;
  fill(hov?INK:INK_FAINT); textSize(9); text('dismiss',cx,cy+22);
  cursor(hov?HAND:ARROW);
}

// ── Sequencer ─────────────────────────────────────────────────────────────────

function drawSequencer() {
  const { seqTop, seqW, rowH, ctrlY, gridTop, gridLeft } = getSeqLayout();
  const ctrlMid = ctrlY + SEQ_CTRL_H/2;

  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(SEQ_MARGIN, ctrlY, width-SEQ_MARGIN*2, SEQ_CTRL_H, R);

  const playX = SEQ_MARGIN + SEQ_LABEL_W;

  // Play/stop
  const playR=12, playHov=dist(mouseX,mouseY,playX,ctrlMid)<playR;
  fill(seqPlaying?[120,55,70]:playHov?ACCENT:PANEL);
  stroke(...INK); strokeWeight(1); circle(playX,ctrlMid,playR*2);
  fill(seqPlaying?[0,0,98]:INK); noStroke();
  if(seqPlaying){
    rectMode(CENTER); rect(playX-3,ctrlMid,3,9,1); rect(playX+3,ctrlMid,3,9,1); rectMode(CORNER);
  } else {
    triangle(playX-4,ctrlMid-6,playX-4,ctrlMid+6,playX+7,ctrlMid);
  }

  // Seq record
  const recBtnX=playX+playR*2+16, recBtnR=9;
  const recHov2=dist(mouseX,mouseY,recBtnX,ctrlMid)<recBtnR;
  if(seqRecording){
    noFill(); stroke(...RED,(sin(frameCount*0.15)*0.5+0.5)*40); strokeWeight(3);
    circle(recBtnX,ctrlMid,recBtnR*2+10);
  }
  fill(seqRecording?RED:recHov2?RED:[0,30,94]);
  stroke(...INK); strokeWeight(1); circle(recBtnX,ctrlMid,recBtnR*2);
  fill(seqRecording?[0,0,98]:INK); noStroke(); circle(recBtnX,ctrlMid,4);

  // BPM
  const bpmLX=recBtnX+recBtnR+12, bpmSX=bpmLX+28, bpmSW=100;
  fill(...INK_DIM); noStroke(); textSize(8); textAlign(LEFT,CENTER); text('BPM',bpmLX,ctrlMid);
  fill(...BG); stroke(...INK); strokeWeight(1); rect(bpmSX,ctrlMid-4,bpmSW,8,4);
  const bpmN=(seqBPM-40)/200;
  fill(...ACCENT,80); noStroke(); rect(bpmSX,ctrlMid-4,bpmSW*bpmN,8,4);
  const tX=bpmSX+bpmSW*bpmN, tHov=abs(mouseX-tX)<8&&abs(mouseY-ctrlMid)<10;
  fill(tHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); circle(tX,ctrlMid,11);
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER);
  text(Math.round(seqBPM), bpmSX+bpmSW+8, ctrlMid);

  // Tap
  const tapX=bpmSX+bpmSW+36, tapW=34, tapH=20;
  const tapHov=mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2;
  fill(tapHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(tapX,ctrlMid-tapH/2,tapW,tapH,R);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('TAP',tapX+tapW/2,ctrlMid);

  // CLR ALL
  const clrAX=tapX+tapW+10, clrAW=50, clrAH=20;
  const clrAHov=mouseX>clrAX&&mouseX<clrAX+clrAW&&mouseY>ctrlMid-clrAH/2&&mouseY<ctrlMid+clrAH/2;
  fill(clrAHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(clrAX,ctrlMid-clrAH/2,clrAW,clrAH,R);
  fill(clrAHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('CLR ALL',clrAX+clrAW/2,ctrlMid);

  // Grids
  const frac   = loopFraction();
  const scanX  = gridLeft + frac*seqW;
  const totalH = grids.length*(ALL_DRUMS.length*rowH+GRID_GAP)-GRID_GAP;

  grids.forEach((g, gridIdx) => {
    const gTop  = gridY(gridIdx, gridTop, rowH);
    const gridH = ALL_DRUMS.length*rowH;
    const cellW = seqW / g.steps;

    // Step-count tab with −, ↑, ↓ controls
    const tabX = SEQ_MARGIN - STEP_TAB_W - 1;
    fill(...PANEL); stroke(...INK); strokeWeight(1);
    rect(tabX, gTop, STEP_TAB_W, gridH, R,0,0,R);
    fill(...INK); noStroke(); textSize(13); textStyle(BOLD); textAlign(CENTER,CENTER);
    text(g.steps, tabX+STEP_TAB_W/2, gTop+gridH/2 + (grids.length>1?5:0));
    textStyle(NORMAL);
    if(grids.length > 1){
      // Minus button (top-left)
      const mBx=tabX+2, mBy=gTop+2, mBw=14, mBh=12;
      const mHov=mouseX>mBx&&mouseX<mBx+mBw&&mouseY>mBy&&mouseY<mBy+mBh;
      fill(mHov?RED:BG); stroke(...INK); strokeWeight(1); rect(mBx,mBy,mBw,mBh,2);
      fill(mHov?[0,0,98]:INK_DIM); noStroke(); textSize(10); textAlign(CENTER,CENTER);
      text('−', mBx+mBw/2, mBy+mBh/2);
      // ↑ ↓ side by side, centred near bottom of tab, away from border
      const arrowBtnW=13, arrowBtnH=13, arrowGap=3;
      const arrowTotalW = arrowBtnW*2 + arrowGap;
      const arrowBx = tabX + (STEP_TAB_W - arrowTotalW)/2;
      const arrowBy = gTop + gridH - arrowBtnH - 5;
      if(gridIdx > 0){
        const uHov=mouseX>arrowBx&&mouseX<arrowBx+arrowBtnW&&mouseY>arrowBy&&mouseY<arrowBy+arrowBtnH;
        fill(uHov?ACCENT:BG); stroke(...INK); strokeWeight(1); rect(arrowBx,arrowBy,arrowBtnW,arrowBtnH,2);
        fill(uHov?[0,0,98]:INK_DIM); noStroke(); textSize(9); textAlign(CENTER,CENTER);
        text('↑', arrowBx+arrowBtnW/2, arrowBy+arrowBtnH/2);
      }
      if(gridIdx < grids.length-1){
        const dBx2=arrowBx+arrowBtnW+arrowGap;
        const dHov=mouseX>dBx2&&mouseX<dBx2+arrowBtnW&&mouseY>arrowBy&&mouseY<arrowBy+arrowBtnH;
        fill(dHov?ACCENT:BG); stroke(...INK); strokeWeight(1); rect(dBx2,arrowBy,arrowBtnW,arrowBtnH,2);
        fill(dHov?[0,0,98]:INK_DIM); noStroke(); textSize(9); textAlign(CENTER,CENTER);
        text('↓', dBx2+arrowBtnW/2, arrowBy+arrowBtnH/2);
      }
    }

    // Main panel
    fill(...PANEL); stroke(...INK); strokeWeight(1);
    rect(SEQ_MARGIN, gTop, width-SEQ_MARGIN*2, gridH, 0,R,R,0);

    // Clear tab
    const clrX2 = width-SEQ_MARGIN+1;
    const clrHov2 = mouseX>clrX2&&mouseX<clrX2+CLR_TAB_W&&mouseY>gTop&&mouseY<gTop+gridH;
    fill(clrHov2?[0,80,75]:RED); stroke(...INK); strokeWeight(1);
    rect(clrX2, gTop, CLR_TAB_W, gridH, 0,R,R,0);
    fill(...PANEL); noStroke(); textSize(11); textAlign(CENTER,CENTER);
    text('✕', clrX2+CLR_TAB_W/2, gTop+gridH/2);

    // Column bands
    for(let step=0; step<g.steps; step++){
      const cellX = gridLeft + step*cellW;
      fill(Math.floor(step/4)%2===0?[0,0,91]:[0,0,85]); noStroke();
      rect(max(cellX,gridLeft),gTop+1,min(cellW,gridLeft+seqW-max(cellX,gridLeft))-1,gridH-2);
    }

    // Separator audio/custom
    const sepY = gTop + DRUMS.length*rowH;
    stroke(0,0,55); strokeWeight(1); line(gridLeft,sepY,gridLeft+seqW,sepY);

    ALL_DRUMS.forEach((d, rowIdx) => {
      const ry       = gTop + rowIdx*rowH;
      const isCustom = rowIdx >= DRUMS.length;
      if(isCustom){ fill(0,0,95,50); noStroke(); rect(gridLeft,ry,seqW,rowH); }

      if(rowIdx>0 && rowIdx!==DRUMS.length){
        stroke(0,0,isCustom?65:58); strokeWeight(1);
        line(gridLeft,ry,gridLeft+seqW,ry);
      }

      fill(drumCandidates[d.id].length>0?[d.hue,DRUM_S,DRUM_B]:INK_FAINT);
      noStroke(); textSize(7); textStyle(BOLD); textAlign(RIGHT,CENTER);
      let rowLabel = d.label || d.kbd;
      if(isCustom){
        const customIdx = rowIdx - DRUMS.length;
        const tf = customInputEls[customIdx];
        const tv = tf ? tf.value().trim() : '';
        rowLabel = tv || d.kbd;
      }
      // Truncate to fit label column
      while(rowLabel.length > 1 && textWidth(rowLabel) > SEQ_LABEL_W - 12)
        rowLabel = rowLabel.slice(0, -1);
      text(rowLabel, gridLeft-8, ry+rowH/2);
      textStyle(NORMAL);

      for(let step=0; step<g.steps; step++){
        const cellX  = gridLeft + step*cellW;
        const on     = g.cells[d.id][step];
        const cFracS = step/g.steps, cFracE=(step+1)/g.steps;
        const isHead = seqPlaying && frac>=cFracS && frac<cFracE;
        const cHov   = mouseX>cellX+1&&mouseX<cellX+cellW-1&&mouseY>ry+1&&mouseY<ry+rowH-1;
        const pad2   = 1.5;

        if(isHead&&on)    fill(d.hue,DRUM_S+8,DRUM_B+10);
        else if(isHead)   fill(d.hue,DRUM_S_LITE,DRUM_B_LITE-10);
        else if(on)       fill(d.hue,DRUM_S,DRUM_B,cHov?100:90);
        else if(cHov)     fill(d.hue,20,85,50);
        else              noFill();
        noStroke();
        if(on||isHead||cHov) rect(cellX+pad2,ry+pad2,cellW-pad2*2,rowH-pad2*2,2);

        if(!on&&!isHead){
          const isBeat=step%4===0;
          fill(d.hue,28,isBeat?60:80,75); noStroke();
          circle(cellX+cellW/2,ry+rowH/2,isBeat?3:1.8);
        }
      }
    });

    for(let step=1; step<g.steps; step++){
      const cellX=gridLeft+step*cellW;
      stroke(0,0,step%4===0?28:58); strokeWeight(1);
      line(cellX,gTop+1,cellX,gTop+gridH-1);
    }
  });

  if(seqPlaying){
    stroke(...ACCENT,22); strokeWeight(6); line(scanX,gridTop,scanX,gridTop+totalH);
    stroke(...INK,60);    strokeWeight(1); line(scanX,gridTop,scanX,gridTop+totalH);
  }

  // Add-grid widget below the stacked grids
  const addY  = gridTop + totalH + 6;
  const addBx = SEQ_MARGIN + SEQ_LABEL_W + 44;   // leaves room for input
  const addBw = 44, addBh = 20;
  const addHov= mouseX>addBx&&mouseX<addBx+addBw&&mouseY>addY&&mouseY<addY+addBh;
  fill(addHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(addBx,addY,addBw,addBh,R);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('+ grid', addBx+addBw/2, addY+addBh/2);

  if(seqRecording){
    fill(0,65,55,65+sin(frameCount*0.15)*18);
    textSize(8); textAlign(RIGHT,TOP); noStroke();
    text('● REC', width-SEQ_MARGIN-CLR_TAB_W-6, gridTop+4);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startSequencer() {
  if(audioCtx.state==='suspended') audioCtx.resume();
  grids.forEach((_,gridIdx)=>{ _nextSteps[gridIdx]=0; });
  _loopStartTime = audioCtx.currentTime+0.05;
  seqPlaying = true;
  scheduleLoop();
}

function stopSequencer() {
  seqPlaying=false; seqRecording=false;
  if(scheduleTimer){ clearTimeout(scheduleTimer); scheduleTimer=null; }
}

function scheduleLoop() {
  if(!seqPlaying) return;
  const now=audioCtx.currentTime, loopDur=loopDuration();

  // Rebase: advance clock past completed loops, translating _nextSteps so that
  // any steps peeked into the next epoch don't get double-scheduled.
  while(now >= _loopStartTime + loopDur){
    _loopStartTime += loopDur;
    grids.forEach((g,gridIdx)=>{
      _nextSteps[gridIdx] = Math.max(0, _nextSteps[gridIdx] - g.steps);
    });
    if(seqRecording) scheduleMetronomeClick(_loopStartTime, true);
  }

  grids.forEach((g,gridIdx)=>{
    const sDur = loopDur / g.steps;
    // Allow _nextSteps to run up to g.steps*2: indices [0..g.steps-1] are the
    // current loop, [g.steps..g.steps*2-1] are the next loop (pre-scheduled).
    // This ensures step 0 of the next loop is always scheduled with full
    // lookahead instead of being scheduled only after the rebase fires.
    while(_nextSteps[gridIdx] < g.steps * 2){
      const stepInLoop = _nextSteps[gridIdx] % g.steps;
      const loopBase   = _loopStartTime + Math.floor(_nextSteps[gridIdx] / g.steps) * loopDur;
      const t          = loopBase + stepInLoop * sDur;
      if(t > now + SCHEDULE_AHEAD) break;
      ALL_DRUMS.forEach(d=>{ if(g.cells[d.id][stepInLoop]) triggerDrumAtTime(d.id,t); });
      if(gridIdx===0 && seqRecording && stepInLoop%4===0 && stepInLoop>0)
        scheduleMetronomeClick(t, false);
      _nextSteps[gridIdx]++;
    }
  });
  scheduleTimer=setTimeout(scheduleLoop,LOOKAHEAD_MS);
}

function triggerDrumAtTime(id, when) {
  const cands=drumCandidates[id]; if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]]; if(!cand) return;
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer; src.connect(gainNodes[id]);
  const dur=cand.buffer.duration;
  src.playbackRate.value = Math.pow(2, drumPitch[id]/12);
  src.start(when,drumTrimStart[id]*dur,(drumTrimEnd[id]-drumTrimStart[id])*dur);
}

function scheduleMetronomeClick(when, isDownbeat) {
  const osc=audioCtx.createOscillator(), env=audioCtx.createGain();
  osc.connect(env); env.connect(audioCtx.destination);
  osc.frequency.value=isDownbeat?1200:800; osc.type='sine';
  env.gain.setValueAtTime(0.3,when);
  env.gain.exponentialRampToValueAtTime(0.001,when+0.04);
  osc.start(when); osc.stop(when+0.05);
}

function quantizeToGrid0(id) {
  const now=audioCtx.currentTime, loopDur=loopDuration();
  let pos=(now-_loopStartTime)%loopDur; if(pos<0) pos+=loopDur;
  const step=Math.round((pos/loopDur)*16)%16;
  grids[0].cells[id][step]=!grids[0].cells[id][step];
}

// ── Mouse ─────────────────────────────────────────────────────────────────────

function onHeaderClick() {
  const recX=168, recY=HEADER_H/2, recR=13;
  if(dist(mouseX,mouseY,recX,recY)<recR){
    if(phase==='recording') stopRecording();
    else if(phase==='ready') startRecording();
    return true;
  }
  const upX=recX+recR+10;
  if(mouseX>upX&&mouseX<upX+80&&abs(mouseY-recY)<12&&phase==='ready'){
    uploadEl.elt.click(); return true;
  }
  return false;
}

function onErrorClick() {
  const cx=width/2, cy=height/2;
  if(abs(mouseX-cx)<50&&abs(mouseY-(cy+22))<14) setPhase('ready');
}

function onSeqControlsClick() {
  const { rowH, ctrlY, gridTop } = getSeqLayout();
  const ctrlMid=ctrlY+SEQ_CTRL_H/2;
  const playX=SEQ_MARGIN+SEQ_LABEL_W;
  const recBtnX=playX+12*2+16;

  if(dist(mouseX,mouseY,playX,ctrlMid)<12){
    seqPlaying?stopSequencer():startSequencer(); return true;
  }
  if(dist(mouseX,mouseY,recBtnX,ctrlMid)<9){
    if(!seqPlaying) startSequencer();
    seqRecording=!seqRecording; return true;
  }
  const bpmLX=recBtnX+9+12, bpmSX=bpmLX+28;
  const bpmN=(seqBPM-40)/200, thumbX2=bpmSX+100*bpmN;
  if(abs(mouseX-thumbX2)<10&&abs(mouseY-ctrlMid)<10){
    drag={type:'bpm',sliderX:bpmSX,sliderW:100}; return true;
  }
  const tapX=bpmSX+100+36, tapW=34, tapH=20;
  if(mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2){
    handleTap(); return true;
  }
  const clrAX=tapX+tapW+10, clrAW=50, clrAH=20;
  if(mouseX>clrAX&&mouseX<clrAX+clrAW&&mouseY>ctrlMid-clrAH/2&&mouseY<ctrlMid+clrAH/2){
    grids.forEach(g=>ALL_DRUMS.forEach(d=>g.cells[d.id].fill(false)));
    return true;
  }
  // Add-grid button
  const totalHClick = grids.length*(ALL_DRUMS.length*rowH+GRID_GAP)-GRID_GAP;
  const addYClick   = gridTop + totalHClick + 6;
  const addBxClick  = SEQ_MARGIN + SEQ_LABEL_W + 44;
  if(mouseX>addBxClick&&mouseX<addBxClick+44&&mouseY>addYClick&&mouseY<addYClick+20){
    addGrid(); return true;
  }
  return false;
}

function onSeqGridTabsClick() {
  const { rowH, gridTop } = getSeqLayout();
  grids.forEach((g,gridIdx)=>{
    const gTop=gridY(gridIdx,gridTop,rowH), gridH=ALL_DRUMS.length*rowH;
    const clrX2=width-SEQ_MARGIN+1;
    if(mouseX>clrX2&&mouseX<clrX2+CLR_TAB_W&&mouseY>gTop&&mouseY<gTop+gridH)
      ALL_DRUMS.forEach(d=>g.cells[d.id].fill(false));
    // Minus, up, down buttons on step-count tab
    if(grids.length>1){
      const tabX=SEQ_MARGIN-STEP_TAB_W-1;
      const mBx=tabX+2, mBy=gTop+2, mBw=14, mBh=12;
      if(mouseX>mBx&&mouseX<mBx+mBw&&mouseY>mBy&&mouseY<mBy+mBh){
        removeGrid(gridIdx); return;
      }
      {
        const arrowBtnW=13, arrowBtnH=13, arrowGap=3;
        const arrowTotalW=arrowBtnW*2+arrowGap;
        const arrowBx=tabX+(STEP_TAB_W-arrowTotalW)/2;
        const arrowBy=gTop+gridH-arrowBtnH-5;
        if(gridIdx>0 && mouseX>arrowBx&&mouseX<arrowBx+arrowBtnW&&mouseY>arrowBy&&mouseY<arrowBy+arrowBtnH){
          swapGrids(gridIdx, gridIdx-1); return;
        }
        const dBx2=arrowBx+arrowBtnW+arrowGap;
        if(gridIdx<grids.length-1 && mouseX>dBx2&&mouseX<dBx2+arrowBtnW&&mouseY>arrowBy&&mouseY<arrowBy+arrowBtnH){
          swapGrids(gridIdx, gridIdx+1); return;
        }
      }
    }
  });
}

function onSeqCellsClick() {
  const { seqW, rowH, gridTop, gridLeft } = getSeqLayout();
  grids.forEach((g,gridIdx)=>{
    const gTop=gridY(gridIdx,gridTop,rowH), gridH=ALL_DRUMS.length*rowH;
    const cellW=seqW/g.steps;
    if(mouseY<gTop||mouseY>gTop+gridH||mouseX<gridLeft||mouseX>gridLeft+seqW) return;
    const stepIdx=floor((mouseX-gridLeft)/cellW);
    if(stepIdx<0||stepIdx>=g.steps) return;
    ALL_DRUMS.forEach((d,rowIdx)=>{
      const ry=gTop+rowIdx*rowH;
      if(mouseY>=ry&&mouseY<ry+rowH){
        const newVal = !g.cells[d.id][stepIdx];
        g.cells[d.id][stepIdx] = newVal;
        // Start a paint drag so moving left/right continues the stroke
        drag = {type:'seqPaint', gridIdx, drumId:d.id, cellW, gridLeft,
                gTop, rowH, rowIdx, value:newVal, lastS:stepIdx};
      }
    });
  });
}

function onPadsClick() {
  const { padW, gap, startX, padY } = getPadLayout();
  ALL_DRUMS.forEach((d, i) => {
    const x   = startX + i*(padW+gap);
    const y   = padY;
    const has = drumCandidates[d.id].length > 0;
    const tb  = trimBarRegion(x,y,padW);
    const swp = swapBtnRegion(x,y,padW);

    if(has && mouseY>tb.y && mouseY<tb.y+tb.h){
      const {startPx,endPx}=trimHandleX(x,padW,d.id);
      if(abs(mouseX-startPx)<10){ drag={type:'trimStart',id:d.id,barX:tb.x,barW:tb.w}; return; }
      if(abs(mouseX-endPx)<10)  { drag={type:'trimEnd',  id:d.id,barX:tb.x,barW:tb.w}; return; }
    }
    const dv2 = dialCenter(x,y,padW,PAD_H,0);
    const dp2 = dialCenter(x,y,padW,PAD_H,1);
    if(dist(mouseX,mouseY,dv2.cx,dv2.cy)<dv2.r+4){
      drag={type:'dial',param:'vol',  id:d.id,startY:mouseY,startVal:drumVolumes[d.id]}; return;
    }
    if(dist(mouseX,mouseY,dp2.cx,dp2.cy)<dp2.r+4){
      drag={type:'dial',param:'pitch',id:d.id,startY:mouseY,startVal:drumPitch[d.id]}; return;
    }
    if(mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h){
      const cands=drumCandidates[d.id];
      if(cands.length>1){
        drumIdx[d.id]=(drumIdx[d.id]+1)%cands.length;
        const nc=cands[drumIdx[d.id]];
        drumTrimStart[d.id]=nc.trimStart??0; drumTrimEnd[d.id]=nc.trimEnd??1;
        padFlash[d.id]=millis(); triggerDrum(d.id);
      }
      return;
    }
    const isCustom = i >= DRUMS.length;
    const focused  = isCustom && customInputEls[i-DRUMS.length] &&
                     customInputEls[i-DRUMS.length].elt.matches(':focus');

    // Custom pad record button (in trim bar area)
    if(isCustom){
      const recBtnX = x+padW/2, recBtnY = y-TRIM_GAP-TRIM_H/2;
      if(dist(mouseX,mouseY,recBtnX,recBtnY)<9){
        if(padRecording[d.id]) stopPadRecording(d.id);
        else                   startPadRecording(d.id);
        return;
      }
    }

    if(mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H&&!focused) triggerDrum(d.id);
  });
}

function mousePressed() {
  if(audioCtx.state==='suspended') audioCtx.resume();
  if(onHeaderClick()) return;
  if(phase==='error') { onErrorClick(); return; }
  if(phase!=='ready') return;
  if(onSeqControlsClick()) return;
  onSeqGridTabsClick();
  onSeqCellsClick();
  onPadsClick();
}

function mouseDragged() {
  if(!drag) return;
  if(drag.type==='seqPaint'){
    const g = grids[drag.gridIdx];
    if(!g) return;
    const stepIdx = constrain(floor((mouseX-drag.gridLeft)/drag.cellW), 0, g.steps-1);
    if(stepIdx === drag.lastS) return;
    // Paint all steps between lastS and stepIdx
    const lo=min(stepIdx,drag.lastS), hi=max(stepIdx,drag.lastS);
    for(let i=lo;i<=hi;i++) grids[drag.gridIdx].cells[drag.drumId][i]=drag.value;
    drag.lastS=stepIdx;
    return;
  }
  if(drag.type==='dial'){
    const dy = drag.startY - mouseY;   // drag up = increase
    if(drag.param==='vol'){
      const v = constrain(drag.startVal + dy/80, 0, 1);
      drumVolumes[drag.id]=v; gainNodes[drag.id].gain.value=v;
    } else {
      drumPitch[drag.id] = constrain(drag.startVal + dy/4, -12, 12);
    }
  } else if(drag.type==='trimStart'){
    drumTrimStart[drag.id]=constrain((mouseX-drag.barX)/drag.barW,0,drumTrimEnd[drag.id]-0.02);
  } else if(drag.type==='trimEnd'){
    drumTrimEnd[drag.id]=constrain((mouseX-drag.barX)/drag.barW,drumTrimStart[drag.id]+0.02,1);
  } else if(drag.type==='bpm'){
    seqBPM=constrain(map(mouseX,drag.sliderX,drag.sliderX+drag.sliderW,40,240),40,240);
  }
}
function mouseReleased() { drag=null; }

// ── Keyboard ──────────────────────────────────────────────────────────────────

const kbdMap = Object.fromEntries(ALL_DRUMS.map(d=>[d.kbd.toLowerCase(),d.id]));

function keyPressed() {
  if(document.activeElement&&document.activeElement.classList.contains('custom-input')) return;
  // R toggles recording regardless of phase
  if(key==='r'||key==='R'){
    if(phase==='recording') stopRecording();
    else if(phase==='ready') startRecording();
    return;
  }
  if(phase==='ready'){
    const id=kbdMap[key.toLowerCase()];
    if(id){ triggerDrum(id); padHeld[id]=true;
      if(seqRecording&&seqPlaying) quantizeToGrid0(id);
    }
    if(key===' '){ seqPlaying?stopSequencer():startSequencer(); }
    if(key==='u'||key==='U') uploadEl.elt.click();
  }
}
function keyReleased() {
  if(document.activeElement&&document.activeElement.classList.contains('custom-input')) return;
  const id=kbdMap[key.toLowerCase()];
  if(id) padHeld[id]=false;
}

// ── Tap tempo ─────────────────────────────────────────────────────────────────

function handleTap() {
  const now=millis();
  tapTimes.push(now);
  tapTimes=tapTimes.filter(t=>now-t<3000).slice(-8);
  if(tapTimes.length>=2){
    const iv=[]; for(let i=1;i<tapTimes.length;i++) iv.push(tapTimes[i]-tapTimes[i-1]);
    seqBPM=constrain(60000/(iv.reduce((a,b)=>a+b,0)/iv.length),40,240);
  }
}

// ── Recording pipeline ────────────────────────────────────────────────────────

async function startRecording() {
  try { recStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); }
  catch(e){ errorMsg='Microphone access denied'; setPhase('error'); return; }
  const src=audioCtx.createMediaStreamSource(recStream);
  analyserNode=audioCtx.createAnalyser(); analyserNode.fftSize=512;
  waveformData=new Uint8Array(analyserNode.frequencyBinCount);
  src.connect(analyserNode);
  recChunks=[]; mediaRecorder=new MediaRecorder(recStream);
  mediaRecorder.ondataavailable=e=>{ if(e.data.size>0) recChunks.push(e.data); };
  mediaRecorder.onstop=onRecordingStop;
  mediaRecorder.start(100); recStart=millis(); setPhase('recording');
}

function stopRecording() {
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){
    mediaRecorder.stop(); recStream.getTracks().forEach(t=>t.stop()); analyserNode=null;
  }
}

function onRecordingStop() { submitAudio(new Blob(recChunks,{type:'audio/webm'})); }
function onFileSelected()  { const f=uploadEl.elt.files[0]; if(f) submitAudio(f); }

async function submitAudio(blob) {
  if(!blob) return;
  setPhase('processing');
  const form=new FormData();
  form.append('file', blob, 'audio');
  const customTexts={};
  CUSTOM_DRUMS.forEach((d,i)=>{
    const v=customInputEls[i].value().trim();
    if(v) customTexts[d.id]=v;
  });
  form.append('custom_texts', JSON.stringify(customTexts));
  let data;
  try {
    const resp=await fetch(`${BACKEND}/analyze`,{method:'POST',body:form});
    if(!resp.ok){const e=await resp.json().catch(()=>({detail:resp.statusText}));throw new Error(e.detail||resp.statusText);}
    data=await resp.json();
  } catch(e){ errorMsg=e.message; setPhase('error'); return; }
  // Store session token for live re-querying
  sessionId = data.session_id || null;

  ALL_DRUMS.forEach(d=>{
    drumCandidates[d.id]=[]; drumIdx[d.id]=0;
    drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;
  });
  for(const [id,info] of Object.entries(data.drums)){
    const decoded=[];
    for(const cand of info.candidates){
      try{
        const bin=atob(cand.audio), bytes=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        const buf=await audioCtx.decodeAudioData(bytes.buffer.slice(0));
        decoded.push({buffer:buf,score:cand.score,time:cand.time,
               trimStart:cand.trim_start??0, trimEnd:cand.trim_end??1});
      } catch(e){ console.warn(`decode ${id}:`,e); }
    }
    drumCandidates[id]=decoded;
    // Initialise trim handles from the first candidate's context window
    if(decoded.length > 0){
      drumTrimStart[id] = decoded[0].trimStart;
      drumTrimEnd[id]   = decoded[0].trimEnd;
    }
  }

  // Decode transcript audio buffers for lyrics mode
  console.log('[analyze] transcript words from server:', (data.transcript||[]).length);
  lyricsTranscript = [];
  for(const w of (data.transcript || [])){
    try{
      const bin=atob(w.audio), bytes=new Uint8Array(bin.length);
      for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      const buf=await audioCtx.decodeAudioData(bytes.buffer.slice(0));
      lyricsTranscript.push({word:w.word, start:w.start, end:w.end, buffer:buf,
               rawEndSamps: w.raw_end_samps ?? buf.length});
    } catch(e){ console.warn('transcript decode:', e); }
  }

  console.log('[analyze] lyricsTranscript decoded:', lyricsTranscript.length, 'sessionId:', sessionId);
  // Re-apply lyrics queries for any pads in lyrics mode
  CUSTOM_DRUMS.forEach((d,i) => {
    if(padLyricsMode[d.id]) applyLyricsQuery(d.id, i);
  });

  setPhase('ready');
}

// ── Per-pad recording ────────────────────────────────────────────────────────

async function startPadRecording(id) {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio:true,video:false}); }
  catch(e){ errorMsg='Microphone access denied'; setPhase('error'); return; }

  const chunks = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = e => { if(e.data.size>0) chunks.push(e.data); };
  mr.onstop = () => submitPadRecording(id, new Blob(chunks,{type:'audio/webm'}));
  mr.start(100);

  padRecorders[id] = { mediaRecorder: mr, chunks, stream };
  padRecording[id] = true;
}

function stopPadRecording(id) {
  const rec = padRecorders[id];
  if(!rec) return;
  rec.mediaRecorder.stop();
  rec.stream.getTracks().forEach(t => t.stop());
  padRecording[id] = false;
}

async function submitPadRecording(id, blob) {
  const form = new FormData();
  form.append('file',    blob, 'pad.webm');
  form.append('slot_id', id);
  form.append('top_k',   '5');

  try {
    const resp = await fetch(`${BACKEND}/record-custom`, {method:'POST', body:form});
    if(!resp.ok){ const e=await resp.json().catch(()=>({detail:resp.statusText})); throw new Error(e.detail||resp.statusText); }
    const data = await resp.json();

    // Decode audio and set as sole candidate
    const bin  = atob(data.audio), bytes = new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const buf  = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    drumCandidates[id] = [{buffer:buf, score:1.0, time:0}];
    drumIdx[id]        = 0;
    drumTrimStart[id]  = 0;
    drumTrimEnd[id]    = 1;

    padRecLabels[id] = data.labels;
    // Populate the text field with the top label
    if(data.labels && data.labels.length > 0){
      const customIdx = CUSTOM_DRUMS.findIndex(d => d.id === id);
      if(customIdx >= 0 && customInputEls[customIdx]){
        customInputEls[customIdx].elt.value = data.labels[0].term;
      }
    }
    padFlash[id]     = millis();
    triggerDrum(id);
  } catch(e) {
    errorMsg = e.message; setPhase('error');
  }
}

// ── Transcript picker ────────────────────────────────────────────────────────

function openPicker(padId, customIdx) {
  pickerOpen         = true;
  pickerPadId        = padId;
  pickerPadCustomIdx = customIdx;
  pickerSel          = [];
  pickerAnchor       = null;

  // Position near the custom pad
  const { padW, gap, startX, padY } = getPadLayout();
  const col = DRUMS.length + customIdx;
  const px  = startX + col*(padW+gap);
  const py  = padY + PAD_H + INPUT_H + 14;
  pickerEl.style.left    = Math.min(px, windowWidth-430) + 'px';
  pickerEl.style.top     = py + 'px';
  pickerEl.style.display = 'block';

  renderPickerChips();
}

function closePicker() {
  pickerOpen  = false;
  pickerPadId = null;
  pickerEl.style.display = 'none';
  // Uncheck the checkbox too
  CUSTOM_DRUMS.forEach((d,i) => {
    if(padLyricsMode[d.id] && lyricsCheckEls[i]._cb.checked &&
       pickerPadId === null){
      // leave checkbox state — user may have already committed
    }
  });
}

function renderPickerChips() {
  const container = document.getElementById('picker-chips');
  container.innerHTML = '';
  lyricsTranscript.forEach((w, idx) => {
    const chip = document.createElement('span');
    chip.textContent = w.word;
    const sel = pickerSel.includes(idx);
    chip.style.cssText = [
      'display:inline-block','padding:3px 7px',
      'border-radius:3px','cursor:pointer',
      'font-size:10px','line-height:1.4',
      'user-select:none',
      sel
        ? 'background:rgba(60,120,100,0.85);color:white;border:1px solid rgba(0,0,0,0.3)'
        : 'background:white;color:rgba(0,0,0,0.75);border:1px solid rgba(0,0,0,0.2)',
      'transition:background 0.08s',
    ].join(';');
    chip.addEventListener('click', (e) => {
      if(e.shiftKey && pickerAnchor !== null){
        // Extend selection to a contiguous range
        const lo = Math.min(pickerAnchor, idx);
        const hi = Math.max(pickerAnchor, idx);
        pickerSel = [];
        for(let i=lo;i<=hi;i++) pickerSel.push(i);
      } else {
        pickerAnchor = idx;
        pickerSel    = [idx];
      }
      renderPickerChips();
    });
    container.appendChild(chip);
  });
}

async function commitPickerSelection() {
  if(pickerSel.length === 0 || pickerPadId === null) return;
  // Sort selection and merge buffers
  const sorted  = [...pickerSel].sort((a,b)=>a-b);
  const words   = sorted.map(i => lyricsTranscript[i]);
  const merged  = await mergeWordBuffers(words);
  if(!merged) return;

  const cand = {
    buffer:     merged,
    score:      1.0,
    time:       words[0].start,
    trimStart:  0,
    trimEnd:    1,
  };
  drumCandidates[pickerPadId] = [cand];
  drumIdx[pickerPadId]        = 0;
  drumTrimStart[pickerPadId]  = 0;
  drumTrimEnd[pickerPadId]    = 1;
  padFlash[pickerPadId]       = millis();
  triggerDrum(pickerPadId);

  // Populate the text field with the selected words
  const text = words.map(w=>w.word).join(' ');
  if(customInputEls[pickerPadCustomIdx]) customInputEls[pickerPadCustomIdx].elt.value = text;

  closePicker();
}

// ── Live CLAP re-query (uses session cache) ───────────────────────────────────

let _clapQueryTimers = {};   // debounce per pad

function queryClapLive(id, customIdx) {
  // Debounce: wait 400ms after last keystroke before firing
  clearTimeout(_clapQueryTimers[id]);
  _clapQueryTimers[id] = setTimeout(async () => {
    const text = customInputEls[customIdx] ? customInputEls[customIdx].value().trim() : '';
    if(!text || !sessionId) return;
    try {
      const form = new FormData();
      form.append('session_id', sessionId);
      form.append('text',       text);
      form.append('mode',       'clap');
      form.append('top_k',      '3');
      const resp = await fetch(`${BACKEND}/query-custom`, {method:'POST', body:form});
      if(!resp.ok) return;
      const data = await resp.json();
      const decoded = [];
      for(const cand of data.candidates){
        try{
          const bin=atob(cand.audio), bytes=new Uint8Array(bin.length);
          for(let k=0;k<bin.length;k++) bytes[k]=bin.charCodeAt(k);
          const buf=await audioCtx.decodeAudioData(bytes.buffer.slice(0));
          decoded.push({buffer:buf, score:cand.score, time:cand.time});
        } catch(e){}
      }
      if(decoded.length > 0){
        drumCandidates[id] = decoded;
        drumIdx[id] = 0;
        drumTrimStart[id] = 0;
        drumTrimEnd[id] = 1;
        padFlash[id] = millis();
      }
    } catch(e){ console.warn('CLAP live query failed:', e); }
  }, 400);
}

// ── Lyrics query ─────────────────────────────────────────────────────────────

// Merge consecutive transcript word objects into one AudioBuffer.
// All words except the last are trimmed to their raw (pre-post-roll) length
// so the 200ms tail of word[i] doesn't overlap with word[i+1]'s start.
async function mergeWordBuffers(words) {
  if(words.length === 0) return null;
  if(words.length === 1) return words[0].buffer;
  const sr = words[0].buffer.sampleRate;
  // Compute trimmed lengths: raw for all but last, full for last
  const lens = words.map((w, i) =>
    i < words.length-1
      ? Math.min(w.rawEndSamps ?? w.buffer.length, w.buffer.length)
      : w.buffer.length
  );
  const total = lens.reduce((a,b)=>a+b, 0);
  const out   = audioCtx.createBuffer(1, total, sr);
  const ch    = out.getChannelData(0);
  let pos = 0;
  words.forEach((w, i) => {
    const src = w.buffer.getChannelData(0);
    ch.set(src.subarray(0, lens[i]), pos);
    pos += lens[i];
  });
  return out;
}

function applyLyricsQuery(id, customIdx) {
  const raw   = customInputEls[customIdx] ? customInputEls[customIdx].value().trim() : '';
  const query = raw.toLowerCase().replace(/[.,!?;:'"()\-\u2014\u2013]/g,'').trim();
  if(!query){ drumCandidates[id]=[]; drumIdx[id]=0; return; }

  if(lyricsTranscript.length === 0){
    if(!sessionId) return;
    // No local transcript yet — fall back to server
    (async()=>{
      try{
        const form=new FormData();
        form.append('session_id',sessionId); form.append('text',query);
        form.append('mode','lyrics'); form.append('top_k','3');
        const resp=await fetch(`${BACKEND}/query-custom`,{method:'POST',body:form});
        const data=await resp.json();
        const decoded=[];
        for(const c of (data.candidates||[])){
          const bin=atob(c.audio),bytes=new Uint8Array(bin.length);
          for(let k=0;k<bin.length;k++) bytes[k]=bin.charCodeAt(k);
          const buf=await audioCtx.decodeAudioData(bytes.buffer.slice(0));
          decoded.push({buffer:buf,score:1.0,time:c.time,trimStart:c.trim_start??0,trimEnd:c.trim_end??1});
        }
        drumCandidates[id]=decoded; drumIdx[id]=0;
        if(decoded.length>0){ drumTrimStart[id]=decoded[0].trimStart; drumTrimEnd[id]=decoded[0].trimEnd; padFlash[id]=millis(); }
      }catch(e){ console.error('[lyrics] server query failed:',e); }
    })();
    return;
  }

  // Local search — support multi-word sequences
  const tokens = query.split(/\s+/).filter(Boolean);
  const n      = tokens.length;
  const T      = lyricsTranscript;
  const hits   = [];   // [{words: [...], start, end}]

  for(let i=0; i<=T.length-n; i++){
    // Check if tokens match at position i (exact then prefix on last token)
    let ok = true;
    for(let j=0;j<n-1;j++) if(T[i+j].word !== tokens[j]){ ok=false; break; }
    if(ok && !T[i+n-1].word.startsWith(tokens[n-1])) ok=false;
    if(ok) hits.push({words: T.slice(i,i+n), start: T[i].start, end: T[i+n-1].end});
  }

  const candidates = hits.slice(0, N_CANDIDATES);
  (async()=>{
    const decoded=[];
    for(const hit of candidates){
      const buf = await mergeWordBuffers(hit.words);
      if(buf) decoded.push({buffer:buf,score:1.0,time:hit.start,trimStart:0,trimEnd:1});
    }
    drumCandidates[id]=decoded; drumIdx[id]=0;
    drumTrimStart[id]=0; drumTrimEnd[id]=1;
    if(decoded.length>0) padFlash[id]=millis();
  })();
}

// ── Playback ──────────────────────────────────────────────────────────────────

function triggerDrum(id) {
  const cands=drumCandidates[id]; if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]]; if(!cand) return;
  if(audioCtx.state==='suspended') audioCtx.resume();
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer; src.connect(gainNodes[id]);
  const dur=cand.buffer.duration;
  src.playbackRate.value = Math.pow(2, drumPitch[id]/12);
  src.start(0,drumTrimStart[id]*dur,(drumTrimEnd[id]-drumTrimStart[id])*dur);
  padFlash[id]=millis();
}
