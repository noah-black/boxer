// ─────────────────────────────────────────────────────────────────────────────
// DRUM EXTRACTOR — p5.js sketch
// Aesthetic: vintage hardware instrument / oscilloscope
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = 'http://localhost:8000';

// ── Drum slot definitions ─────────────────────────────────────────────────────
// col: [h, s, b] in HSB (easier to compute glow variants)
const DRUMS = [
  { id: 'kick',   label: 'KICK',   sub: 'bass drum', kbd: 'K', hue: 8   },
  { id: 'snare',  label: 'SNARE',  sub: 'backbeat',  kbd: 'S', hue: 200 },
  { id: 'hihat',  label: 'HI-HAT', sub: 'closed',    kbd: 'H', hue: 48  },
  { id: 'tom',    label: 'TOM',    sub: 'mid drum',   kbd: 'T', hue: 140 },

];

// ── App state ─────────────────────────────────────────────────────────────────
let phase = 'idle';   // idle | recording | processing | ready | error

let drumBuffers = {};  // id → AudioBuffer
let drumScores  = {};  // id → float (CLAP cosine similarity)
let drumTimes   = {};  // id → float (onset time in source)

let padFlash    = {};  // id → millis() of last trigger
let padHeld     = {};  // id → bool (for sustained visual while key is down)

// Web Audio
let audioCtx = null;

// Recording
let mediaRecorder = null;
let recChunks     = [];
let recStream     = null;
let recStart      = 0;
let analyserNode  = null;
let waveformData  = null;

// Upload
let uploadEl = null;

// Error / status
let errorMsg  = '';
let statusMsg = '';

// Animation
let spinAngle = 0;

// ── Palette ───────────────────────────────────────────────────────────────────
// All drawing uses HSB mode so we can derive glow colours easily
const BG        = [237, 14, 5];     // near-black with slight blue tint
const AMBER     = [40, 90, 96];     // phosphor amber — dominant accent
const DIM       = [237, 10, 35];    // dimmed text / inactive lines
const GRID      = [237, 12, 14];    // subtle grid

// ── p5 lifecycle ──────────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('IBM Plex Mono');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  uploadEl = select('#upload-input');
  uploadEl.changed(onFileSelected);

  DRUMS.forEach(d => {
    padFlash[d.id] = -9999;
    padHeld[d.id]  = false;
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  background(...BG);
  drawGrid();
  drawHeader();
  spinAngle += 0.04;

  switch (phase) {
    case 'idle':       drawIdle();       break;
    case 'recording':  drawRecording();  break;
    case 'processing': drawProcessing(); break;
    case 'ready':      drawReady();      break;
    case 'error':      drawError();      break;
  }
}

// ── Background grid (oscilloscope feel) ───────────────────────────────────────

function drawGrid() {
  stroke(...GRID);
  strokeWeight(0.5);

  const cols = 24, rows = 16;
  for (let i = 0; i <= cols; i++) {
    const x = map(i, 0, cols, 0, width);
    line(x, 0, x, height);
  }
  for (let j = 0; j <= rows; j++) {
    const y = map(j, 0, rows, 0, height);
    line(0, y, width, y);
  }
}

// ── Header ────────────────────────────────────────────────────────────────────

function drawHeader() {
  noStroke();
  fill(...AMBER);
  textSize(11);
  textStyle(NORMAL);
  textAlign(LEFT, TOP);
  text('DRUM EXTRACTOR  v0.1', 28, 24);

  fill(...DIM);
  textSize(9);
  textAlign(RIGHT, TOP);
  text('CLAP / laion · ' + (phase === 'ready' ? 'READY' : phase.toUpperCase()), width - 28, 24);

  // Header rule
  stroke(...DIM);
  strokeWeight(0.5);
  line(28, 42, width - 28, 42);
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function drawIdle() {
  const cx = width / 2;
  const cy = height / 2 - 10;

  // Outer breathing ring
  const breathe = sin(frameCount * 0.035) * 0.5 + 0.5;
  noFill();
  stroke(...AMBER, map(breathe, 0, 1, 8, 22));
  strokeWeight(1);
  circle(cx, cy, 220 + breathe * 20);

  // Mic button
  const r = 58;
  const hov = dist(mouseX, mouseY, cx, cy) < r;

  strokeWeight(1.5);
  stroke(...AMBER, hov ? 90 : 55);
  fill(0, 0, hov ? 12 : 8);
  circle(cx, cy, r * 2);

  // Mic symbol — simple SVG-style drawn with p5 primitives
  noStroke();
  fill(...AMBER, hov ? 95 : 70);

  // Capsule body
  const mw = 14, mh = 22, mx = cx - mw / 2, mTop = cy - mh / 2 - 4;
  rectMode(CORNER);
  rect(mx, mTop + mw / 2, mw, mh - mw / 2, 0, 0, 0, 0);
  ellipse(cx, mTop + mw / 2, mw, mw);

  // Stand arc
  noFill();
  stroke(...AMBER, hov ? 95 : 70);
  strokeWeight(2);
  const arcY = cy + mh / 2 - 2;
  arc(cx, arcY - 2, 24, 16, PI, TWO_PI);

  // Stem
  line(cx, arcY + 6, cx, arcY + 12);
  line(cx - 8, arcY + 12, cx + 8, arcY + 12);

  // Label
  noStroke();
  fill(...AMBER, hov ? 90 : 55);
  textSize(10);
  textStyle(NORMAL);
  textAlign(CENTER);
  text('CLICK TO RECORD', cx, cy + r + 22);

  // Upload link
  const upY = cy + r + 44;
  const hovUp = abs(mouseX - cx) < 70 && abs(mouseY - upY) < 10;
  fill(...DIM, hovUp ? 80 : 50);
  textSize(9);
  text('or upload a file', cx, upY);

  cursor(hov || hovUp ? HAND : ARROW);
}

// ── RECORDING ─────────────────────────────────────────────────────────────────

function drawRecording() {
  const cx = width / 2;
  const cy = height / 2 - 30;

  // Pulsing rings
  for (let i = 0; i < 3; i++) {
    const phase_i = (frameCount * 0.04 + i * 0.8) % TWO_PI;
    const r_outer = 100 + i * 30 + sin(phase_i) * 10;
    noFill();
    stroke(0, 90, 85, map(sin(phase_i), -1, 1, 5, 30 - i * 8));
    strokeWeight(1);
    circle(cx, cy, r_outer * 2);
  }

  // Stop button
  const r = 52;
  const hov = dist(mouseX, mouseY, cx, cy) < r;

  stroke(0, 80, 85, hov ? 90 : 65);
  strokeWeight(1.5);
  fill(0, 0, hov ? 10 : 6);
  circle(cx, cy, r * 2);

  noStroke();
  fill(0, 80, 85);
  rectMode(CENTER);
  rect(cx, cy, 18, 18, 2);
  rectMode(CORNER);

  // REC indicator
  const elapsed = ((millis() - recStart) / 1000).toFixed(1);
  const blink = frameCount % 40 < 20;
  fill(0, 80, blink ? 90 : 50);
  textSize(10);
  textAlign(CENTER);
  text(`● REC  ${elapsed}s`, cx, cy + r + 22);

  // Waveform scope
  if (analyserNode && waveformData) {
    analyserNode.getByteTimeDomainData(waveformData);

    const ww = min(500, width - 80);
    const wh = 60;
    const wx = (width - ww) / 2;
    const wy = cy + r + 40;

    // Scope frame
    noFill();
    stroke(...DIM, 40);
    strokeWeight(0.5);
    rect(wx, wy, ww, wh);

    // Centre line
    stroke(...DIM, 25);
    line(wx, wy + wh / 2, wx + ww, wy + wh / 2);

    // Waveform — amber phosphor
    stroke(40, 85, 96);
    strokeWeight(1.5);
    noFill();
    beginShape();
    for (let i = 0; i < waveformData.length; i++) {
      const x = wx + map(i, 0, waveformData.length - 1, 0, ww);
      const y = wy + map(waveformData[i], 0, 255, wh, 0);
      vertex(x, y);
    }
    endShape();

    // Glow pass (wider, lower alpha)
    stroke(40, 80, 96, 25);
    strokeWeight(5);
    beginShape();
    for (let i = 0; i < waveformData.length; i++) {
      const x = wx + map(i, 0, waveformData.length - 1, 0, ww);
      const y = wy + map(waveformData[i], 0, 255, wh, 0);
      vertex(x, y);
    }
    endShape();
  }

  fill(...DIM, 60);
  noStroke();
  textSize(9);
  textAlign(CENTER);
  text('CLICK TO STOP & ANALYSE', cx, height - 36);

  cursor(hov ? HAND : ARROW);
}

// ── PROCESSING ────────────────────────────────────────────────────────────────

function drawProcessing() {
  const cx = width / 2;
  const cy = height / 2;

  // Rotating tick marks (hardware boot-up feel)
  const ticks = 16;
  for (let i = 0; i < ticks; i++) {
    const a     = (i / ticks) * TWO_PI + spinAngle;
    const frac  = (i / ticks + spinAngle / TWO_PI) % 1;
    const alpha = pow(frac, 1.5) * 70 + 5;
    const r1    = 42, r2 = 56;
    stroke(...AMBER, alpha);
    strokeWeight(1.5);
    line(cx + cos(a) * r1, cy + sin(a) * r1,
         cx + cos(a) * r2, cy + sin(a) * r2);
  }

  // Inner dot
  noStroke();
  fill(...AMBER, 50);
  circle(cx, cy, 8);

  fill(...AMBER, 80);
  textSize(11);
  textAlign(CENTER);
  text(statusMsg || 'ANALYSING…', cx, cy + 80);

  fill(...DIM, 50);
  textSize(9);
  text('running CLAP embeddings — may take 15–40 s', cx, cy + 98);
}

// ── READY ─────────────────────────────────────────────────────────────────────

function getPadLayout() {
  const n     = DRUMS.length;
  const maxW  = 140;
  const gap   = 18;
  const padH  = 190;
  const avail = width - 80;
  const padW  = min(maxW, (avail - gap * (n - 1)) / n);
  const total = padW * n + gap * (n - 1);
  const startX = (width - total) / 2;
  const padY   = height / 2 - padH / 2;
  return { padW, padH, gap, startX, padY };
}

function drawReady() {
  const { padW, padH, gap, startX, padY } = getPadLayout();

  DRUMS.forEach((d, i) => {
    const x   = startX + i * (padW + gap);
    const has = !!drumBuffers[d.id];

    const ago      = millis() - padFlash[d.id];
    const flashAmt = max(0, 1 - ago / 110);   // quick 110 ms flash
    const held     = padHeld[d.id];
    const active   = flashAmt > 0 || held;

    const hovering = mouseX > x && mouseX < x + padW &&
                     mouseY > padY && mouseY < padY + padH && has;

    // ── Pad body ─────────────────────────────────────────────────────────────
    const bgB = active ? 16 : (hovering ? 11 : 8);
    const borderA = has
      ? (active ? 90 : (hovering ? 60 : 35))
      : 15;

    stroke(d.hue, active ? 65 : 55, active ? 90 : 70, borderA);
    strokeWeight(active ? 2 : 1);
    fill(d.hue, active ? 40 : 20, bgB);
    rectMode(CORNER);
    rect(x, padY, padW, padH, 3);

    // ── Glow overlay when active ─────────────────────────────────────────────
    if (active) {
      noStroke();
      fill(d.hue, 60, 90, flashAmt * 12);
      rect(x, padY, padW, padH, 3);
    }

    // ── Key letter ───────────────────────────────────────────────────────────
    noStroke();
    fill(d.hue, has ? (active ? 20 : 30) : 10, active ? 96 : (has ? 72 : 35));
    textSize(54);
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    text(d.kbd, x + padW / 2, padY + padH / 2 - 22);

    // ── Drum name + sub-label ─────────────────────────────────────────────────
    textStyle(NORMAL);
    fill(d.hue, has ? 30 : 10, active ? 90 : (has ? 65 : 28));
    textSize(10);
    textAlign(CENTER);
    text(d.label, x + padW / 2, padY + padH - 52);

    fill(...DIM, has ? 60 : 25);
    textSize(8);
    text(d.sub, x + padW / 2, padY + padH - 40);

    // ── Score bar ────────────────────────────────────────────────────────────
    if (has) {
      const barW = padW - 22;
      const barH = 3;
      const bx   = x + 11;
      const by   = padY + padH - 22;

      // Track
      fill(0, 0, 18);
      noStroke();
      rect(bx, by, barW, barH, 2);

      // Fill — cosine similarity typically ~0.1–0.4 for CLAP
      const score = drumScores[d.id] || 0;
      const norm  = constrain(map(score, 0.08, 0.38, 0, 1), 0, 1);
      fill(d.hue, 60, 80, 80);
      rect(bx, by, barW * norm, barH, 2);

      // Score text
      fill(d.hue, 25, 55);
      textSize(7);
      textAlign(RIGHT);
      text(score.toFixed(3), x + padW - 8, by + 10);
    } else {
      fill(...DIM, 30);
      textSize(8);
      textAlign(CENTER);
      text('NOT FOUND', x + padW / 2, padY + padH - 16);
    }
  });

  // ── Footer hint ─────────────────────────────────────────────────────────────
  noStroke();
  fill(...DIM, 45);
  textSize(8);
  textStyle(NORMAL);
  textAlign(CENTER);
  text(
    'KEYS: K · S · H · T · C   ·   CLICK PADS   ·   R = RECORD AGAIN   ·   U = UPLOAD',
    width / 2, height - 22
  );

  // Cursor
  const anyHov = DRUMS.some((d, i) => {
    const x = startX + i * (padW + gap);
    return mouseX > x && mouseX < x + padW && mouseY > padY && mouseY < padY + padH;
  });
  cursor(anyHov ? HAND : ARROW);
}

// ── ERROR ─────────────────────────────────────────────────────────────────────

function drawError() {
  const cx = width / 2, cy = height / 2;

  fill(0, 75, 85);
  textSize(11);
  textAlign(CENTER);
  text('ERROR', cx, cy - 18);

  fill(0, 50, 70);
  textSize(9);
  text(errorMsg, cx, cy);

  fill(...DIM, 50);
  textSize(9);
  text('CLICK TO TRY AGAIN', cx, cy + 26);

  cursor(HAND);
}

// ── Mouse ─────────────────────────────────────────────────────────────────────

function mousePressed() {
  // Resume AudioContext on first interaction (browser autoplay policy)
  if (audioCtx.state === 'suspended') audioCtx.resume();

  if (phase === 'idle') {
    const cx = width / 2, cy = height / 2 - 10, r = 58;
    const upY = cy + r + 44;

    if (dist(mouseX, mouseY, cx, cy) < r) {
      startRecording();
    } else if (abs(mouseX - cx) < 70 && abs(mouseY - upY) < 10) {
      uploadEl.elt.click();
    }
    return;
  }

  if (phase === 'recording') {
    const cx = width / 2, cy = height / 2 - 30;
    if (dist(mouseX, mouseY, cx, cy) < 52) stopRecording();
    return;
  }

  if (phase === 'ready') {
    const { padW, padH, gap, startX, padY } = getPadLayout();
    DRUMS.forEach((d, i) => {
      const x = startX + i * (padW + gap);
      if (mouseX > x && mouseX < x + padW &&
          mouseY > padY && mouseY < padY + padH) {
        triggerDrum(d.id);
      }
    });
  }

  if (phase === 'error') {
    phase = 'idle';
  }
}

// ── Keyboard ──────────────────────────────────────────────────────────────────

const kbdMap = Object.fromEntries(DRUMS.map(d => [d.kbd.toLowerCase(), d.id]));

function keyPressed() {
  if (phase === 'ready') {
    const id = kbdMap[key.toLowerCase()];
    if (id) {
      triggerDrum(id);
      padHeld[id] = true;
    }
    if (key === 'r' || key === 'R') resetToIdle();
    if (key === 'u' || key === 'U') uploadEl.elt.click();
  }
}

function keyReleased() {
  const id = kbdMap[key.toLowerCase()];
  if (id) padHeld[id] = false;
}

// ── Recording pipeline ────────────────────────────────────────────────────────

async function startRecording() {
  try {
    recStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  } catch (e) {
    errorMsg = 'Microphone access denied';
    phase    = 'error';
    return;
  }

  // Wire up analyser for scope display
  const src  = audioCtx.createMediaStreamSource(recStream);
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 512;
  waveformData = new Uint8Array(analyserNode.frequencyBinCount);
  src.connect(analyserNode);

  recChunks   = [];
  mediaRecorder = new MediaRecorder(recStream);
  mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = onRecordingStop;
  mediaRecorder.start(100);   // 100 ms timeslices

  recStart = millis();
  phase    = 'recording';
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
    recStream.getTracks().forEach(t => t.stop());
    analyserNode = null;
  }
}

function onRecordingStop() {
  const blob = new Blob(recChunks, { type: 'audio/webm' });
  submitAudio(blob);
}

// ── File upload ───────────────────────────────────────────────────────────────

function onFileSelected() {
  const file = uploadEl.elt.files[0];
  if (file) submitAudio(file);
}

// ── Submit to backend ─────────────────────────────────────────────────────────

async function submitAudio(blob) {
  phase     = 'processing';
  statusMsg = 'EMBEDDING AUDIO…';

  const form = new FormData();
  form.append('file', blob, 'audio');

  let data;
  try {
    const resp = await fetch(`${BACKEND}/analyze`, { method: 'POST', body: form });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || resp.statusText);
    }
    data = await resp.json();
  } catch (e) {
    errorMsg = e.message;
    phase    = 'error';
    return;
  }

  // Decode returned base64 WAV clips into AudioBuffers
  drumBuffers = {};
  drumScores  = {};
  drumTimes   = {};

  for (const [id, info] of Object.entries(data.drums)) {
    try {
      const binary = atob(info.audio);
      const bytes  = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      drumBuffers[id] = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
      drumScores[id]  = info.score;
      drumTimes[id]   = info.time;
    } catch (e) {
      console.warn(`Failed to decode ${id}:`, e);
    }
  }

  phase = 'ready';
}

// ── Playback ──────────────────────────────────────────────────────────────────

function triggerDrum(id) {
  const buf = drumBuffers[id];
  if (!buf) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const src = audioCtx.createBufferSource();
  src.buffer = buf;
  src.connect(audioCtx.destination);
  src.start(0);

  padFlash[id] = millis();
}

// ── Utility ───────────────────────────────────────────────────────────────────

function resetToIdle() {
  phase       = 'idle';
  drumBuffers = {};
  drumScores  = {};
  drumTimes   = {};
  DRUMS.forEach(d => {
    padFlash[d.id] = -9999;
    padHeld[d.id]  = false;
  });
}
