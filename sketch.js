// ─────────────────────────────────────────────────────────────────────────────
// BOXER — drum extractor + polymetric sequencer
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = 'http://localhost:8000';

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

const ALL_DRUMS = [...DRUMS, ...CUSTOM_DRUMS];   // sequencer uses all 8

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
// Start directly on the main screen
let phase = 'ready';

let drumCandidates = {};
let drumIdx        = {};
let drumVolumes    = {};
let drumTrimStart  = {};
let drumTrimEnd    = {};
let gainNodes      = {};
let padFlash       = {};
let padHeld        = {};
let drag           = null;

// Sequencer
let seqGrid        = [];
let seqBPM         = 120;
let seqPlaying     = false;
let seqRecording   = false;
let scheduleTimer  = null;
let _loopStartTime = 0;
let _nextSteps     = [];
const LOOKAHEAD_MS   = 25;
const SCHEDULE_AHEAD = 0.10;

let tapTimes = [];

// Recording
let mediaRecorder = null;
let recChunks     = [];
let recStream     = null;
let recStart      = 0;
let analyserNode  = null;
let waveformData  = null;

let audioCtx = null;
let uploadEl = null;
let customInputEls = [];   // 4 HTML text inputs

let errorMsg  = '';
let statusMsg = '';
let spinAngle = 0;

// ── Layout ────────────────────────────────────────────────────────────────────
const PAD_H       = 112;   // all pads same height
const INPUT_H     = 26;    // text input strip below each custom pad
const TRIM_H      = 14;
const TRIM_GAP    = 5;
const SEQ_ROW_H_MIN = 13;
const SEQ_ROW_H_MAX = 28;
const GRID_GAP    = 8;
const SEQ_CTRL_H  = 40;
const FOOTER_H    = 16;
const HEADER_H    = 52;
const SEQ_MARGIN  = 56;
const SEQ_LABEL_W = 68;    // fits bold drum labels
const STEP_TAB_W  = 36;    // step-count appendage tab on left
const CLR_TAB_W   = 42;    // clear tab on right
const R           = 5;

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
    // Don't let typing bubble to p5 key handlers
    el.elt.addEventListener('keydown', e => e.stopPropagation());
    return el;
  });

  ALL_DRUMS.forEach(d => {
    padFlash[d.id]       = -9999;
    padHeld[d.id]        = false;
    drumVolumes[d.id]    = 0.8;
    drumTrimStart[d.id]  = 0;
    drumTrimEnd[d.id]    = 1;
    drumCandidates[d.id] = [];
    drumIdx[d.id]        = 0;
    const g = audioCtx.createGain();
    g.gain.value = 0.8;
    g.connect(audioCtx.destination);
    gainNodes[d.id] = g;
  });

  const GRIDS_DEF = [16, 12, 10, 14];
  GRIDS_DEF.forEach((steps, gi) => {
    seqGrid[gi] = {};
    _nextSteps[gi] = 0;
    ALL_DRUMS.forEach(d => { seqGrid[gi][d.id] = new Array(steps).fill(false); });
  });
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

// ── Timing ────────────────────────────────────────────────────────────────────

function loopDuration() { return 4 * (60.0 / seqBPM); }
function loopFraction() {
  if (!seqPlaying) return 0;
  return ((audioCtx.currentTime - _loopStartTime) % loopDuration()) / loopDuration();
}

const GRIDS = [{steps:16},{steps:12},{steps:10},{steps:14}];

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw() {
  background(...BG);
  drawHeader();
  spinAngle += 0.04;

  if (phase === 'recording') {
    drawPads();
    drawSequencer();
    drawRecordingOverlay();
  } else if (phase === 'processing') {
    drawPads();
    drawSequencer();
    drawProcessingOverlay();
  } else if (phase === 'error') {
    drawPads();
    drawSequencer();
    drawErrorOverlay();
  } else {
    // 'ready'
    drawPads();
    drawSequencer();
  }

  positionCustomInputs();
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

  // Record button (red circle, right of BOXER title)
  const recX = 168, recY = HEADER_H/2, recR = 13;
  const isRec = phase === 'recording';
  const recHov = dist(mouseX,mouseY,recX,recY) < recR;
  if(isRec){
    noFill(); stroke(...RED, (sin(frameCount*0.15)*0.5+0.5)*40); strokeWeight(4);
    circle(recX,recY,recR*2+10);
  }
  fill(isRec ? RED : recHov ? RED : [0,50,90]); stroke(...INK); strokeWeight(1);
  circle(recX, recY, recR*2);
  // Dot or stop square
  fill(...PANEL); noStroke();
  if(isRec) { rectMode(CENTER); rect(recX,recY,8,8,1); rectMode(CORNER); }
  else       { circle(recX,recY,7); }

  // Upload link
  const upX = recX + recR + 10;
  const upHov = mouseX>upX && mouseX<upX+80 && abs(mouseY-recY)<10;
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER);
  text('upload file', upX, recY);

  cursor(recHov || upHov ? HAND : ARROW);
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function getPadLayout() {
  const n=8, gap=9;
  const padW = min(112, (width-60-gap*(n-1))/n);
  const total = padW*n + gap*(n-1);
  const startX = (width-total)/2;
  // Single row; trim bar sits above audio pads, input strip below custom pads
  const padY = HEADER_H + 10 + TRIM_H + TRIM_GAP;
  return { padW, gap, startX, padY };
}

function getSeqLayout() {
  const { padY } = getPadLayout();
  const seqTop  = padY + PAD_H + INPUT_H + 14;
  const seqW    = width - SEQ_MARGIN*2 - SEQ_LABEL_W;
  const gridTop = seqTop + SEQ_CTRL_H;
  const totalRows = GRIDS.length * ALL_DRUMS.length;
  const totalGaps = GRIDS.length - 1;
  const available = height - gridTop - FOOTER_H - 6;
  const rowH = constrain(
    floor((available - totalGaps*GRID_GAP) / totalRows),
    SEQ_ROW_H_MIN, SEQ_ROW_H_MAX
  );
  return { seqTop, seqW, rowH, ctrlY: seqTop, gridTop,
           gridLeft: SEQ_MARGIN + SEQ_LABEL_W };
}

function gridY(gi, gridTop, rowH) {
  return gridTop + gi * (ALL_DRUMS.length * rowH + GRID_GAP);
}

// ── Pad sub-regions ───────────────────────────────────────────────────────────

function trimBarRegion(x, y, padW) {
  return { x, y: y-TRIM_H-TRIM_GAP, w: padW, h: TRIM_H };
}
function volStripRegion(x, y, padW, padH) {
  return { x: x+9, y: y+padH-20, w: padW-18, h: 7 };
}
function swapBtnRegion(x, y, padW) {
  return { x: x+padW-18, y: y+7, w: 13, h: 13 };
}
function trimHandleX(x, padW, id) {
  return {
    startPx: x + drumTrimStart[id]*padW,
    endPx:   x + drumTrimEnd[id]*padW,
  };
}

// ── Position custom HTML inputs over custom pads ──────────────────────────────

function positionCustomInputs() {
  const { padW, gap, startX, padY } = getPadLayout();
  const show = (phase === 'ready');
  CUSTOM_DRUMS.forEach((d, i) => {
    const el = customInputEls[i];
    // Custom pads are the last 4 in the row
    const col = DRUMS.length + i;
    const px = startX + col*(padW+gap);
    // Input strip sits just below the pad
    const py = padY + PAD_H + 4;
    el.style('left', px + 'px');
    el.style('top',  py + 'px');
    el.style('width', padW + 'px');
    el.style('font-size', '10px');
    show ? el.show() : el.hide();
  });
}

// ── PADS ──────────────────────────────────────────────────────────────────────

function drawPads() {
  const { padW, gap, startX, padY } = getPadLayout();

  // ── Audio pads (first 4: A S D F) ────────────────────────────────────────
  DRUMS.forEach((d, i) => {
    const x   = startX + i*(padW+gap);
    const y   = padY;
    const has = drumCandidates[d.id].length > 0;
    const cands   = drumCandidates[d.id];
    const curCand = cands[drumIdx[d.id]];
    const ago      = millis()-padFlash[d.id];
    const flashAmt = max(0,1-ago/110);
    const active   = flashAmt>0||padHeld[d.id];
    const tb  = trimBarRegion(x,y,padW);
    const vol = volStripRegion(x,y,padW,PAD_H);
    const swp = swapBtnRegion(x,y,padW);
    const overTb   = mouseX>tb.x&&mouseX<tb.x+tb.w&&mouseY>tb.y&&mouseY<tb.y+tb.h;
    const overVol  = mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h;
    const overSwap = mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
    const overPad  = mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H&&!overVol&&!overSwap;

    // Trim bar
    fill(...PANEL); stroke(...INK); strokeWeight(1); rect(tb.x,tb.y,tb.w,tb.h,3);
    if(has&&curCand){
      const buf=curCand.buffer, chan=buf.getChannelData(0);
      const step=max(1,Math.floor(chan.length/tb.w));
      for(let px2=0;px2<tb.w;px2++){
        const frac=px2/tb.w;
        const inTrim=frac>=drumTrimStart[d.id]&&frac<=drumTrimEnd[d.id];
        let peak=0; const si=Math.floor(frac*chan.length);
        for(let s=si;s<min(si+step,chan.length);s++) peak=max(peak,abs(chan[s]));
        const bh=peak*(tb.h-4)*0.9;
        stroke(d.hue,inTrim?DRUM_S:22,inTrim?DRUM_B:80); strokeWeight(1);
        line(tb.x+px2,tb.y+tb.h/2-bh/2,tb.x+px2,tb.y+tb.h/2+bh/2);
      }
      noStroke(); fill(...BG,55);
      rect(tb.x+1,tb.y+1,drumTrimStart[d.id]*(tb.w-2),tb.h-2,2,0,0,2);
      const ef=drumTrimEnd[d.id];
      rect(tb.x+1+ef*(tb.w-2),tb.y+1,(1-ef)*(tb.w-2),tb.h-2,0,2,2,0);
      const {startPx,endPx}=trimHandleX(x,padW,d.id);
      const nearS=abs(mouseX-startPx)<8&&overTb, nearE=abs(mouseX-endPx)<8&&overTb;
      fill(d.hue,nearS?80:DRUM_S,nearS?65:DRUM_B); noStroke(); rect(startPx-1.5,tb.y,3,tb.h,1);
      fill(d.hue,nearE?80:DRUM_S,nearE?65:DRUM_B);              rect(endPx-1.5,  tb.y,3,tb.h,1);
    }

    drawPadBody(d, x, y, padW, PAD_H, has, active, overPad, curCand);
    drawVolStrip(d, vol, has, drumVolumes[d.id]);
    drawSwapBtn(d, swp, cands);

    const {startPx,endPx}=trimHandleX(x,padW,d.id);
    const nearH=has&&overTb&&(abs(mouseX-startPx)<8||abs(mouseX-endPx)<8);
    cursor(nearH||overVol||(overSwap&&cands.length>1)||(overPad&&has)?HAND:ARROW);
  });

  // ── Custom pads (last 4: G H J K) ────────────────────────────────────────
  CUSTOM_DRUMS.forEach((d, i) => {
    const col  = DRUMS.length + i;
    const x    = startX + col*(padW+gap);
    const y    = padY;
    const has  = drumCandidates[d.id].length > 0;
    const cands = drumCandidates[d.id];
    const curCand = cands[drumIdx[d.id]];
    const ago      = millis()-padFlash[d.id];
    const flashAmt = max(0,1-ago/110);
    const active   = flashAmt>0||padHeld[d.id];
    const vol  = volStripRegion(x,y,padW,PAD_H);
    const swp  = swapBtnRegion(x,y,padW);
    const overVol  = mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h;
    const overSwap = mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
    const overPad  = mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H&&!overVol&&!overSwap;
    const hasText  = customInputEls[i] && customInputEls[i].value().trim() !== '';

    // No trim bar — draw a blank placeholder bar instead so spacing matches
    fill(...PANEL); stroke(...INK); strokeWeight(1);
    rect(x, y-TRIM_H-TRIM_GAP, padW, TRIM_H, 3);

    // Waveform in trim bar if audio assigned
    if(has && curCand){
      const tbC = {x, y: y-TRIM_H-TRIM_GAP, w: padW, h: TRIM_H};
      const buf=curCand.buffer, chan=buf.getChannelData(0);
      const step=max(1,Math.floor(chan.length/tbC.w));
      for(let px2=0;px2<tbC.w;px2++){
        const frac=px2/tbC.w;
        const inTrim=frac>=drumTrimStart[d.id]&&frac<=drumTrimEnd[d.id];
        let peak=0; const si=Math.floor(frac*chan.length);
        for(let s=si;s<min(si+step,chan.length);s++) peak=max(peak,abs(chan[s]));
        const bh=peak*(tbC.h-4)*0.9;
        stroke(d.hue,inTrim?DRUM_S:22,inTrim?DRUM_B:80); strokeWeight(1);
        line(tbC.x+px2,tbC.y+tbC.h/2-bh/2,tbC.x+px2,tbC.y+tbC.h/2+bh/2);
      }
      noStroke(); fill(...BG,55);
      rect(tbC.x+1,tbC.y+1,drumTrimStart[d.id]*(tbC.w-2),tbC.h-2,2,0,0,2);
      const ef=drumTrimEnd[d.id];
      rect(tbC.x+1+ef*(tbC.w-2),tbC.y+1,(1-ef)*(tbC.w-2),tbC.h-2,0,2,2,0);
    }
    drawPadBody(d, x, y, padW, PAD_H, has||hasText, active, overPad, curCand);
    if(has) { drawVolStrip(d, vol, has, drumVolumes[d.id]); }
    drawSwapBtn(d, swp, cands);

    cursor((overSwap&&cands.length>1)||(overPad&&(has||hasText))?HAND:ARROW);
  });
}

// ── Shared pad drawing helpers ────────────────────────────────────────────────

function drawPadBody(d, x, y, padW, padH, has, active, overPad, curCand) {
  if(active)             fill(d.hue,DRUM_S,DRUM_B+8);
  else if(overPad&&has)  fill(d.hue,DRUM_S_LITE+10,DRUM_B_LITE-5);
  else                   fill(...PANEL);
  stroke(...INK); strokeWeight(active?2:1); rect(x,y,padW,padH,R);
  // Top accent bar
  fill(d.hue,DRUM_S,DRUM_B,has?85:25); noStroke(); rect(x+1,y+1,padW-2,5,R,R,0,0);
  // Key letter
  fill(active?[0,0,98]:has?[d.hue,DRUM_S,DRUM_B]:INK_FAINT);
  noStroke(); textSize(32); textStyle(BOLD); textAlign(CENTER,CENTER);
  text(d.kbd, x+padW/2, y+padH/2-10);
  textStyle(NORMAL);
  // Label (id or custom indicator)
  fill(active?[0,0,95]:INK); textSize(8); textAlign(CENTER);
  const lbl = d.label || d.kbd;
  text(lbl, x+padW/2, y+padH-32);
}

function drawVolStrip(d, vol, has, vol_val) {
  fill(...BG); stroke(...INK); strokeWeight(1); rect(vol.x,vol.y,vol.w,vol.h,4);
  fill(d.hue,DRUM_S,DRUM_B,has?80:30); noStroke();
  rect(vol.x,vol.y,vol.w*vol_val,vol.h,4);
}

function drawSwapBtn(d, swp, cands) {
  if(cands.length<2) return;
  const hov=mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
  fill(hov?ACCENT:PANEL); stroke(...INK); strokeWeight(1);
  circle(swp.x+swp.w/2,swp.y+swp.h/2,swp.w);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('↻',swp.x+swp.w/2,swp.y+swp.h/2+1);
  fill(...INK); textSize(8); textStyle(BOLD); textAlign(RIGHT);
  const id = d.id;
  text(`${drumIdx[id]+1}/${cands.length}`,swp.x-4,swp.y+swp.h/2+2);
  textStyle(NORMAL);
}

// ── Recording overlay ─────────────────────────────────────────────────────────

function drawRecordingOverlay() {
  // Semi-transparent scrim
  noStroke(); fill(...BG, 88);
  rect(0, HEADER_H, width, height-HEADER_H);

  const cx=width/2, cy=height/2;
  // Waveform panel
  const ww=min(520,width-80), wh=70, wx=(width-ww)/2, wy=cy-wh/2-20;
  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(wx,wy,ww,wh,R);
  if(analyserNode&&waveformData){
    analyserNode.getByteTimeDomainData(waveformData);
    stroke(0,70,55); strokeWeight(1.5); noFill(); beginShape();
    for(let i=0;i<waveformData.length;i++)
      vertex(wx+map(i,0,waveformData.length-1,8,ww-8), wy+map(waveformData[i],0,255,wh-6,6));
    endShape();
  }

  // Timer
  const elapsed=((millis()-recStart)/1000).toFixed(1);
  fill(0,65,52); noStroke(); textSize(11); textAlign(CENTER);
  text(`● ${elapsed}s`, cx, wy+wh+22);
  fill(...INK_DIM); textSize(9);
  text('click the record button to stop', cx, wy+wh+38);
}

// ── Processing overlay ────────────────────────────────────────────────────────

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

// ── Error overlay ─────────────────────────────────────────────────────────────

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

  // Controls panel
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

  // Record button
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

  // Global CLR ALL
  const clrAX=tapX+tapW+10, clrAW=50, clrAH=20;
  const clrAHov=mouseX>clrAX&&mouseX<clrAX+clrAW&&mouseY>ctrlMid-clrAH/2&&mouseY<ctrlMid+clrAH/2;
  fill(clrAHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(clrAX,ctrlMid-clrAH/2,clrAW,clrAH,R);
  fill(clrAHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('CLR ALL',clrAX+clrAW/2,ctrlMid);

  // ── Stacked grids ─────────────────────────────────────────────────────────
  const frac   = loopFraction();
  const scanX  = gridLeft + frac * seqW;
  const totalH = GRIDS.length*(ALL_DRUMS.length*rowH+GRID_GAP)-GRID_GAP;

  GRIDS.forEach((g, gi) => {
    const gTop  = gridY(gi, gridTop, rowH);
    const gridH = ALL_DRUMS.length * rowH;
    const cellW = seqW / g.steps;

    // ── Step-count tab (left appendage) ───────────────────────────────────
    const tabX = SEQ_MARGIN - STEP_TAB_W - 1;   // flush against main panel
    fill(...PANEL); stroke(...INK); strokeWeight(1);
    rect(tabX, gTop, STEP_TAB_W, gridH, R, 0, 0, R);
    fill(...INK); noStroke(); textSize(14); textStyle(BOLD); textAlign(CENTER,CENTER);
    text(g.steps, tabX+STEP_TAB_W/2, gTop+gridH/2);
    textStyle(NORMAL);

    // ── Main grid panel ────────────────────────────────────────────────────
    fill(...PANEL); stroke(...INK); strokeWeight(1);
    rect(SEQ_MARGIN, gTop, width-SEQ_MARGIN*2, gridH, 0, R, R, 0);

    // ── Clear tab (right appendage, red) ──────────────────────────────────
    const clrX2 = width-SEQ_MARGIN+1;
    const clrHov2 = mouseX>clrX2&&mouseX<clrX2+CLR_TAB_W&&mouseY>gTop&&mouseY<gTop+gridH;
    fill(clrHov2?[0,80,75]:RED); stroke(...INK); strokeWeight(1);
    rect(clrX2, gTop, CLR_TAB_W, gridH, 0, R, R, 0);
    fill(...PANEL); noStroke(); textSize(11); textAlign(CENTER,CENTER);
    text('✕', clrX2+CLR_TAB_W/2, gTop+gridH/2);

    // Alternating column shading
    for(let s=0; s<g.steps; s++){
      const cx2=gridLeft+s*cellW;
      fill(Math.floor(s/4)%2===0?[0,0,91]:[0,0,85]); noStroke();
      rect(max(cx2,gridLeft),gTop+1,min(cellW,gridLeft+seqW-max(cx2,gridLeft))-1,gridH-2);
    }

    // Separator between audio rows and custom rows
    const sepY = gTop + DRUMS.length*rowH;
    stroke(...INK,55); strokeWeight(1);
    line(gridLeft, sepY, gridLeft+seqW, sepY);

    ALL_DRUMS.forEach((d, ri) => {
      const ry = gTop + ri*rowH;
      const isCustom = ri >= DRUMS.length;

      // Subtle custom-row tint
      if(isCustom){ fill(0,0,95,50); noStroke(); rect(gridLeft,ry,seqW,rowH); }

      // Row dividers
      if(ri>0 && ri!==DRUMS.length){
        stroke(0,0,isCustom?65:58); strokeWeight(1);
        line(gridLeft,ry,gridLeft+seqW,ry);
      }

      // Drum label
      const labelColor = isCustom
        ? (drumCandidates[d.id].length>0 ? [d.hue,DRUM_S,DRUM_B] : INK_FAINT)
        : [d.hue,DRUM_S,DRUM_B];
      fill(...labelColor); noStroke(); textSize(7); textStyle(BOLD); textAlign(RIGHT,CENTER);
      text(isCustom ? d.kbd : d.label, gridLeft-8, ry+rowH/2);
      textStyle(NORMAL);

      for(let s=0; s<g.steps; s++){
        const cx2    = gridLeft+s*cellW;
        const on     = seqGrid[gi][d.id][s];
        const cFracS = s/g.steps, cFracE=(s+1)/g.steps;
        const isHead = seqPlaying&&frac>=cFracS&&frac<cFracE;
        const cHov   = mouseX>cx2+1&&mouseX<cx2+cellW-1&&mouseY>ry+1&&mouseY<ry+rowH-1;
        const pad2   = 1.5;

        if(isHead&&on)     fill(d.hue,DRUM_S+8,DRUM_B+10);
        else if(isHead)    fill(d.hue,DRUM_S_LITE,DRUM_B_LITE-10);
        else if(on)        fill(d.hue,DRUM_S,DRUM_B,cHov?100:90);
        else               { if(cHov) fill(d.hue,20,85,50); else { noFill(); } }
        noStroke();
        if(on||isHead) rect(cx2+pad2,ry+pad2,cellW-pad2*2,rowH-pad2*2,2);

        if(!on&&!isHead){
          const isBeat=s%4===0;
          fill(d.hue,28,isBeat?60:80,75); noStroke();
          circle(cx2+cellW/2,ry+rowH/2,isBeat?3:1.8);
        }
      }
    });

    // Column dividers
    for(let s=1;s<g.steps;s++){
      const cx2=gridLeft+s*cellW;
      stroke(0,0,s%4===0?28:58); strokeWeight(1);
      line(cx2,gTop+1,cx2,gTop+gridH-1);
    }
  });

  // Single scanline
  if(seqPlaying){
    stroke(...ACCENT,22); strokeWeight(6); line(scanX,gridTop,scanX,gridTop+totalH);
    stroke(...INK,60);    strokeWeight(1); line(scanX,gridTop,scanX,gridTop+totalH);
  }

  if(seqRecording){
    fill(0,65,55,65+sin(frameCount*0.15)*18);
    textSize(8); textAlign(RIGHT,TOP); noStroke();
    text('● REC', width-SEQ_MARGIN-CLR_TAB_W-6, gridTop+4);
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startSequencer() {
  if(audioCtx.state==='suspended') audioCtx.resume();
  GRIDS.forEach((_,gi)=>{ _nextSteps[gi]=0; });
  _loopStartTime = audioCtx.currentTime + 0.05;
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
  if(now >= _loopStartTime+loopDur){
    _loopStartTime += loopDur;
    GRIDS.forEach((_,gi)=>{ _nextSteps[gi]=0; });
    if(seqRecording) scheduleMetronomeClick(_loopStartTime, true);
  }
  GRIDS.forEach((g,gi)=>{
    const sDur=loopDur/g.steps;
    while(_nextSteps[gi]<g.steps){
      const t=_loopStartTime+_nextSteps[gi]*sDur;
      if(t>now+SCHEDULE_AHEAD) break;
      ALL_DRUMS.forEach(d=>{ if(seqGrid[gi][d.id][_nextSteps[gi]]) triggerDrumAtTime(d.id,t); });
      if(gi===0&&seqRecording&&_nextSteps[gi]%4===0&&_nextSteps[gi]>0)
        scheduleMetronomeClick(t, false);
      _nextSteps[gi]++;
    }
  });
  scheduleTimer = setTimeout(scheduleLoop, LOOKAHEAD_MS);
}

function triggerDrumAtTime(id, when) {
  const cands=drumCandidates[id]; if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]]; if(!cand) return;
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer; src.connect(gainNodes[id]);
  const dur=cand.buffer.duration;
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
  const frac=pos/loopDur;
  const step=Math.round(frac*16)%16;
  seqGrid[0][id][step]=!seqGrid[0][id][step];
}

// ── Mouse ─────────────────────────────────────────────────────────────────────

function mousePressed() {
  if(audioCtx.state==='suspended') audioCtx.resume();

  // Header record button
  const recX=168, recY=HEADER_H/2, recR=13;
  if(dist(mouseX,mouseY,recX,recY)<recR){
    if(phase==='recording') stopRecording();
    else if(phase==='ready') startRecording();
    return;
  }
  // Upload link in header
  const upX=recX+recR+10;
  if(mouseX>upX&&mouseX<upX+80&&abs(mouseY-recY)<12&&phase==='ready'){
    uploadEl.elt.click(); return;
  }

  if(phase==='error'){
    // Dismiss on click
    const cx=width/2, cy=height/2;
    if(abs(mouseX-cx)<50&&abs(mouseY-(cy+22))<14) phase='ready';
    return;
  }

  if(phase!=='ready') return;

  const { seqW, rowH, ctrlY, gridTop, gridLeft } = getSeqLayout();
  const ctrlMid = ctrlY+SEQ_CTRL_H/2;
  const playX   = SEQ_MARGIN+SEQ_LABEL_W;
  const recBtnX = playX+12*2+16;

  // Sequencer play
  if(dist(mouseX,mouseY,playX,ctrlMid)<12){
    seqPlaying?stopSequencer():startSequencer(); return;
  }
  // Sequencer record
  if(dist(mouseX,mouseY,recBtnX,ctrlMid)<9){
    if(!seqPlaying) startSequencer();
    seqRecording=!seqRecording; return;
  }
  // BPM thumb
  const bpmLX=recBtnX+9+12, bpmSX=bpmLX+28;
  const bpmN=(seqBPM-40)/200, thumbX2=bpmSX+100*bpmN;
  if(abs(mouseX-thumbX2)<10&&abs(mouseY-ctrlMid)<10){
    drag={type:'bpm',sliderX:bpmSX,sliderW:100}; return;
  }
  // Tap
  const tapX=bpmSX+100+36, tapW=34, tapH=20;
  if(mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2){
    handleTap(); return;
  }
  // CLR ALL
  const clrAX=tapX+tapW+10, clrAW=50, clrAH=20;
  if(mouseX>clrAX&&mouseX<clrAX+clrAW&&mouseY>ctrlMid-clrAH/2&&mouseY<ctrlMid+clrAH/2){
    GRIDS.forEach((_,gi)=>ALL_DRUMS.forEach(d=>seqGrid[gi][d.id].fill(false)));
    return;
  }

  // Grid clear tabs (right side)
  GRIDS.forEach((_,gi)=>{
    const gTop=gridY(gi,gridTop,rowH), gridH=ALL_DRUMS.length*rowH;
    const clrX2=width-SEQ_MARGIN+1;
    if(mouseX>clrX2&&mouseX<clrX2+CLR_TAB_W&&mouseY>gTop&&mouseY<gTop+gridH){
      ALL_DRUMS.forEach(d=>seqGrid[gi][d.id].fill(false));
    }
  });

  // Grid cells
  GRIDS.forEach((g,gi)=>{
    const gTop=gridY(gi,gridTop,rowH), gridH=ALL_DRUMS.length*rowH;
    const cellW=seqW/g.steps;
    if(mouseY<gTop||mouseY>gTop+gridH||mouseX<gridLeft||mouseX>gridLeft+seqW) return;
    const s=floor((mouseX-gridLeft)/cellW);
    if(s<0||s>=g.steps) return;
    ALL_DRUMS.forEach((d,ri)=>{
      const ry=gTop+ri*rowH;
      if(mouseY>=ry&&mouseY<ry+rowH) seqGrid[gi][d.id][s]=!seqGrid[gi][d.id][s];
    });
  });

  // Pad region — audio pads
  const { padW, gap, startX, padY } = getPadLayout();
  DRUMS.forEach((d,i)=>{
    const x=startX+i*(padW+gap), y=padY;
    const has=drumCandidates[d.id].length>0;
    const tb=trimBarRegion(x,y,padW);
    if(mouseY>tb.y&&mouseY<tb.y+tb.h&&has){
      const {startPx,endPx}=trimHandleX(x,padW,d.id);
      if(abs(mouseX-startPx)<10){drag={type:'trimStart',id:d.id,barX:tb.x,barW:tb.w};return;}
      if(abs(mouseX-endPx)<10)  {drag={type:'trimEnd',  id:d.id,barX:tb.x,barW:tb.w};return;}
    }
    const vol=volStripRegion(x,y,padW,PAD_H);
    if(mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h){
      drag={type:'vol',id:d.id,startX:mouseX,startVol:drumVolumes[d.id],barX:vol.x,barW:vol.w};return;
    }
    const swp=swapBtnRegion(x,y,padW);
    if(mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h){
      const cands=drumCandidates[d.id];
      if(cands.length>1){
        drumIdx[d.id]=(drumIdx[d.id]+1)%cands.length;
        drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;
        padFlash[d.id]=millis(); triggerDrum(d.id);
      }
      return;
    }
    if(mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H) triggerDrum(d.id);
  });

  // Custom pads
  CUSTOM_DRUMS.forEach((d,i)=>{
    const col=DRUMS.length+i;
    const x=startX+col*(padW+gap), y=padY;
    const swp=swapBtnRegion(x,y,padW);
    const vol=volStripRegion(x,y,padW,PAD_H);
    if(mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h){
      const cands=drumCandidates[d.id];
      if(cands.length>1){
        drumIdx[d.id]=(drumIdx[d.id]+1)%cands.length;
        drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;
        padFlash[d.id]=millis(); triggerDrum(d.id);
      }
      return;
    }
    if(mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h){
      drag={type:'vol',id:d.id,startX:mouseX,startVol:drumVolumes[d.id],barX:vol.x,barW:vol.w};return;
    }
    if(mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H&&
       !customInputEls[i].elt.matches(':focus')) triggerDrum(d.id);
  });
}

function mouseDragged() {
  if(!drag) return;
  if(drag.type==='vol'){
    const v=constrain(drag.startVol+(mouseX-drag.startX)/drag.barW,0,1);
    drumVolumes[drag.id]=v; gainNodes[drag.id].gain.value=v;
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
  // Don't capture keys when a text input is focused
  if(document.activeElement && document.activeElement.classList.contains('custom-input')) return;

  if(phase==='ready'){
    const id=kbdMap[key.toLowerCase()];
    if(id){ triggerDrum(id); padHeld[id]=true;
      if(seqRecording&&seqPlaying) quantizeToGrid0(id);
    }
    if(key===' '){ seqPlaying?stopSequencer():startSequencer(); }
    if(key==='r'||key==='R') { submitAudio(null); }  // re-analyze (noop if no audio)
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
  catch(e){ errorMsg='Microphone access denied'; phase='error'; return; }
  const src=audioCtx.createMediaStreamSource(recStream);
  analyserNode=audioCtx.createAnalyser(); analyserNode.fftSize=512;
  waveformData=new Uint8Array(analyserNode.frequencyBinCount);
  src.connect(analyserNode);
  recChunks=[]; mediaRecorder=new MediaRecorder(recStream);
  mediaRecorder.ondataavailable=e=>{ if(e.data.size>0) recChunks.push(e.data); };
  mediaRecorder.onstop=onRecordingStop;
  mediaRecorder.start(100); recStart=millis(); phase='recording';
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
  phase='processing';
  const form=new FormData();
  form.append('file', blob, 'audio');

  // Collect custom text queries
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
  } catch(e){ errorMsg=e.message; phase='error'; return; }

  // Reset all candidates
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
        decoded.push({buffer:buf,score:cand.score,time:cand.time});
      } catch(e){ console.warn(`decode ${id}:`,e); }
    }
    drumCandidates[id]=decoded;
  }
  phase='ready';
}

// ── Playback ──────────────────────────────────────────────────────────────────

function triggerDrum(id) {
  const cands=drumCandidates[id]; if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]]; if(!cand) return;
  if(audioCtx.state==='suspended') audioCtx.resume();
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer; src.connect(gainNodes[id]);
  const dur=cand.buffer.duration;
  src.start(0,drumTrimStart[id]*dur,(drumTrimEnd[id]-drumTrimStart[id])*dur);
  padFlash[id]=millis();
}
