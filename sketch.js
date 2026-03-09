// ─────────────────────────────────────────────────────────────────────────────
// BOXER — drum extractor + polymetric sequencer
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = 'http://localhost:8000';

const DRUMS = [
  { id: 'kick',  label: 'KICK',   sub: 'bass drum', kbd: 'A', hue: 10  },
  { id: 'hihat', label: 'HI-HAT', sub: 'closed',    kbd: 'S', hue: 42  },
  { id: 'snare', label: 'SNARE',  sub: 'backbeat',  kbd: 'D', hue: 205 },
  { id: 'clap',  label: 'CLAP',   sub: 'hand clap', kbd: 'F', hue: 295 },
];

const GRIDS = [
  { steps: 16 },
  { steps: 12 },
  { steps: 10 },
  { steps: 14 },
];

// ── Palette ───────────────────────────────────────────────────────────────────
// Light pastel theme — warm cream ground, white panels, fine-tip-pen borders
const BG        = [38, 14, 93];    // warm cream
const PANEL     = [0,   0, 100];   // white
const INK       = [0,   0,   8];   // near-black (borders + primary text)
const INK_DIM   = [0,   0,  48];   // secondary text
const INK_FAINT = [0,   0,  72];   // tertiary / placeholders
const ACCENT    = [38, 80,  78];   // amber gold (buttons, highlights)

// Per-drum: vivid but works on white
// s and b tuned so each reads clearly against both white panels and BG
const DRUM_S = 72, DRUM_B = 62;    // saturation, brightness for filled cells
const DRUM_S_LITE = 38, DRUM_B_LITE = 88; // tint for empty cells / backgrounds

// ── App state ─────────────────────────────────────────────────────────────────
let phase = 'idle';

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

// ── Layout constants ──────────────────────────────────────────────────────────
const PAD_H         = 148;
const TRIM_H        = 18;
const TRIM_GAP      = 7;
const SEQ_ROW_H_MIN = 17;
const SEQ_ROW_H_MAX = 36;
const GRID_GAP      = 8;
const SEQ_CTRL_H    = 40;
const FOOTER_H      = 26;
const HEADER_H      = 52;
const SEQ_MARGIN    = 56;
const SEQ_LABEL_W   = 72;   // wide enough for bold drum labels
const R             = 5;    // global corner radius

// Web Audio / recording
let audioCtx      = null;
let mediaRecorder = null;
let recChunks     = [];
let recStream     = null;
let recStart      = 0;
let analyserNode  = null;
let waveformData  = null;
let uploadEl      = null;

let errorMsg  = '';
let statusMsg = '';
let spinAngle = 0;

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('IBM Plex Mono');

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  uploadEl = select('#upload-input');
  uploadEl.changed(onFileSelected);

  DRUMS.forEach(d => {
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

  GRIDS.forEach((g, gi) => {
    seqGrid[gi] = {};
    _nextSteps[gi] = 0;
    DRUMS.forEach(d => { seqGrid[gi][d.id] = new Array(g.steps).fill(false); });
  });
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

// ── Timing ────────────────────────────────────────────────────────────────────

function loopDuration()  { return 4 * (60.0 / seqBPM); }
function loopFraction()  {
  if (!seqPlaying) return 0;
  return ((audioCtx.currentTime - _loopStartTime) % loopDuration()) / loopDuration();
}

// ── Draw ──────────────────────────────────────────────────────────────────────

function draw() {
  background(...BG);
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

// ── Header ────────────────────────────────────────────────────────────────────

function drawHeader() {
  // Header panel
  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(0, 0, width, HEADER_H);

  // BOXER wordmark
  textFont('Orbitron');
  textStyle(BOLD); textSize(22); textAlign(LEFT, CENTER);
  fill(...INK); noStroke();
  text('BOXER', 24, HEADER_H / 2);
  textFont('IBM Plex Mono');


}

// ── Layout helpers ────────────────────────────────────────────────────────────

function getPadLayout() {
  const n    = DRUMS.length, gap = 14;
  const padW = min(136, (width - 80 - gap*(n-1)) / n);
  const total = padW*n + gap*(n-1);
  return {
    padW, padH: PAD_H, gap,
    startX: (width - total) / 2,
    padY: HEADER_H + 12 + TRIM_H + TRIM_GAP,
  };
}

function getSeqLayout() {
  const { padY } = getPadLayout();
  const seqTop  = padY + PAD_H + 14;
  const seqW    = width - SEQ_MARGIN*2 - SEQ_LABEL_W;
  const gridTop = seqTop + SEQ_CTRL_H;
  const totalRows = GRIDS.length * DRUMS.length;
  const totalGaps = GRIDS.length - 1;
  const available = height - gridTop - FOOTER_H - 10;
  const rowH = constrain(
    floor((available - totalGaps * GRID_GAP) / totalRows),
    SEQ_ROW_H_MIN, SEQ_ROW_H_MAX
  );
  return {
    seqTop, seqW, rowH,
    ctrlY:    seqTop,
    gridTop,
    gridLeft: SEQ_MARGIN + SEQ_LABEL_W,
  };
}

function gridY(gi, gridTop, rowH) {
  return gridTop + gi * (DRUMS.length * rowH + GRID_GAP);
}

// ── Sub-regions ───────────────────────────────────────────────────────────────

function trimBarRegion(x, padY, padW) {
  return { x, y: padY-TRIM_H-TRIM_GAP, w: padW, h: TRIM_H };
}
function volStripRegion(x, padY, padW) {
  return { x: x+9, y: padY+PAD_H-22, w: padW-18, h: 8 };
}
function swapBtnRegion(x, padY, padW) {
  return { x: x+padW-18, y: padY+7, w: 13, h: 13 };
}
function trimHandleX(x, padW, id) {
  return {
    startPx: x + drumTrimStart[id]*padW,
    endPx:   x + drumTrimEnd[id]*padW,
  };
}
// Clear button for each grid — sits at right edge of label column
function clearBtnRegion(gi, gridTop, rowH) {
  const gTop = gridY(gi, gridTop, rowH);
  const gridH = DRUMS.length * rowH;
  return {
    x: SEQ_MARGIN + SEQ_LABEL_W - 26,
    y: gTop + gridH/2 - 9,
    w: 22, h: 18,
  };
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function drawIdle() {
  const cx = width/2, cy = height/2 - 10;
  const breathe = sin(frameCount*0.035)*0.5+0.5;

  // Breathing ring
  noFill(); stroke(...INK, map(breathe,0,1,8,22)); strokeWeight(1.5);
  circle(cx, cy, 200+breathe*16);

  // Mic button
  const r = 54, hov = dist(mouseX,mouseY,cx,cy) < r;
  fill(...PANEL); stroke(...INK); strokeWeight(1);
  circle(cx, cy, r*2);

  // Mic icon
  fill(hov ? ACCENT : INK_DIM); noStroke();
  const mw=13,mh=20,mTop=cy-mh/2-4;
  rectMode(CORNER);
  rect(cx-mw/2, mTop+mw/2, mw, mh-mw/2, 2);
  ellipse(cx, mTop+mw/2, mw, mw);
  noFill(); stroke(hov ? ACCENT : INK_DIM); strokeWeight(2);
  const arcY = cy+mh/2-2;
  arc(cx, arcY-2, 22, 14, PI, TWO_PI);
  line(cx, arcY+5, cx, arcY+11);
  line(cx-7, arcY+11, cx+7, arcY+11);

  fill(...INK_DIM); noStroke(); textSize(10); textStyle(NORMAL); textAlign(CENTER);
  text('CLICK TO RECORD', cx, cy+r+20);
  const upY = cy+r+38, hovUp = abs(mouseX-cx)<70&&abs(mouseY-upY)<10;
  fill(hovUp?INK:INK_FAINT); textSize(9); text('or upload a file', cx, upY);
  cursor(hov||hovUp ? HAND : ARROW);
}

// ── RECORDING ─────────────────────────────────────────────────────────────────

function drawRecording() {
  const cx=width/2, cy=height/2-30;
  for(let i=0;i<3;i++){
    const p=(frameCount*0.04+i*0.8)%TWO_PI;
    noFill(); stroke(0,70,65,map(sin(p),-1,1,4,22-i*6)); strokeWeight(1.5);
    circle(cx,cy,(90+i*28+sin(p)*8)*2);
  }
  const r=50, hov=dist(mouseX,mouseY,cx,cy)<r;
  fill(...PANEL); stroke(...INK); strokeWeight(1); circle(cx,cy,r*2);
  fill(0,75,65); noStroke(); rectMode(CENTER); rect(cx,cy,18,18,3); rectMode(CORNER);
  const elapsed=((millis()-recStart)/1000).toFixed(1);
  fill(0,75,frameCount%40<20?60:40); noStroke(); textSize(10); textAlign(CENTER);
  text(`● REC  ${elapsed}s`, cx, cy+r+20);
  if(analyserNode&&waveformData){
    analyserNode.getByteTimeDomainData(waveformData);
    const ww=min(480,width-80),wh=54,wx=(width-ww)/2,wy=cy+r+36;
    fill(...PANEL); stroke(...INK); strokeWeight(1); rect(wx,wy,ww,wh,R);
    stroke(...INK,20); line(wx+4,wy+wh/2,wx+ww-4,wy+wh/2);
    stroke(DRUMS[0].hue,65,55); strokeWeight(1.5); noFill(); beginShape();
    for(let i=0;i<waveformData.length;i++)
      vertex(wx+map(i,0,waveformData.length-1,4,ww-4),wy+map(waveformData[i],0,255,wh-4,4));
    endShape();
  }
  fill(...INK_FAINT); noStroke(); textSize(9); textAlign(CENTER);
  text('CLICK TO STOP & ANALYSE', cx, height-FOOTER_H/2);
  cursor(hov?HAND:ARROW);
}

// ── PROCESSING ────────────────────────────────────────────────────────────────

function drawProcessing() {
  const cx=width/2, cy=height/2-20, ticks=16;
  for(let i=0;i<ticks;i++){
    const a=(i/ticks)*TWO_PI+spinAngle;
    const alpha=pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*70+5;
    stroke(...ACCENT,alpha); strokeWeight(2);
    line(cx+cos(a)*38,cy+sin(a)*38,cx+cos(a)*52,cy+sin(a)*52);
  }
  fill(...ACCENT); noStroke(); circle(cx,cy,8);
  fill(...INK); textSize(11); textAlign(CENTER);
  text(statusMsg||'ANALYSING…',cx,cy+72);
  fill(...INK_DIM); textSize(9);
  text('running CLAP embeddings — may take 15–40 s',cx,cy+88);
}

// ── READY ─────────────────────────────────────────────────────────────────────

function drawReady() {
  drawPads();
  drawSequencer();
}

// ── Pads ──────────────────────────────────────────────────────────────────────

function drawPads() {
  const { padW, padH, gap, startX, padY } = getPadLayout();

  DRUMS.forEach((d, i) => {
    const x       = startX + i*(padW+gap);
    const has     = drumCandidates[d.id].length > 0;
    const cands   = drumCandidates[d.id];
    const curCand = cands[drumIdx[d.id]];

    const ago      = millis()-padFlash[d.id];
    const flashAmt = max(0, 1-ago/110);
    const active   = flashAmt>0 || padHeld[d.id];

    const tb  = trimBarRegion(x,padY,padW);
    const vol = volStripRegion(x,padY,padW);
    const swp = swapBtnRegion(x,padY,padW);

    const overTb   = mouseX>tb.x&&mouseX<tb.x+tb.w&&mouseY>tb.y&&mouseY<tb.y+tb.h;
    const overVol  = mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h;
    const overSwap = mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
    const overPad  = mouseX>x&&mouseX<x+padW&&mouseY>padY&&mouseY<padY+padH&&!overVol&&!overSwap;

    // ── Trim bar ─────────────────────────────────────────────────────────────
    fill(...PANEL); stroke(...INK); strokeWeight(1); rect(tb.x,tb.y,tb.w,tb.h,3);
    if(has&&curCand){
      const buf=curCand.buffer, chan=buf.getChannelData(0);
      const step=max(1,Math.floor(chan.length/tb.w));
      for(let px=0;px<tb.w;px++){
        const frac=px/tb.w;
        const inTrim=frac>=drumTrimStart[d.id]&&frac<=drumTrimEnd[d.id];
        let peak=0; const si=Math.floor(frac*chan.length);
        for(let s=si;s<min(si+step,chan.length);s++) peak=max(peak,abs(chan[s]));
        const bh=peak*(tb.h-4)*0.9;
        stroke(d.hue, inTrim?DRUM_S:20, inTrim?DRUM_B:78); strokeWeight(1);
        line(tb.x+px, tb.y+tb.h/2-bh/2, tb.x+px, tb.y+tb.h/2+bh/2);
      }
      // dim overlays outside trim
      noStroke(); fill(...BG, 60);
      rect(tb.x+1, tb.y+1, drumTrimStart[d.id]*(tb.w-2), tb.h-2, 2,0,0,2);
      const endFrac=drumTrimEnd[d.id];
      rect(tb.x+1+endFrac*(tb.w-2), tb.y+1, (1-endFrac)*(tb.w-2), tb.h-2, 0,2,2,0);
      // handles
      const {startPx,endPx}=trimHandleX(x,padW,d.id);
      const nearS=abs(mouseX-startPx)<8&&overTb, nearE=abs(mouseX-endPx)<8&&overTb;
      fill(d.hue,nearS?80:DRUM_S,nearS?70:DRUM_B); noStroke();
      rect(startPx-1.5, tb.y, 3, tb.h, 1);
      fill(d.hue,nearE?80:DRUM_S,nearE?70:DRUM_B);
      rect(endPx-1.5,   tb.y, 3, tb.h, 1);

    } else {
      fill(...INK_FAINT); noStroke(); textSize(7); textAlign(CENTER);
      text('no audio', tb.x+tb.w/2, tb.y+tb.h/2+3);
    }

    // ── Pad body ─────────────────────────────────────────────────────────────
    if(active){
      fill(d.hue, DRUM_S, DRUM_B+8);
    } else if(overPad && has){
      fill(d.hue, DRUM_S_LITE+10, DRUM_B_LITE-4);
    } else {
      fill(...PANEL);
    }
    stroke(...INK); strokeWeight(active?2:1);
    rect(x, padY, padW, padH, R);

    // Colored top accent bar
    fill(d.hue, DRUM_S, DRUM_B, has?90:30); noStroke();
    rect(x+1, padY+1, padW-2, 5, R, R, 0, 0);

    // Key letter
    fill(active ? [0,0,98] : has ? [d.hue, DRUM_S, DRUM_B] : INK_FAINT);
    noStroke(); textSize(42); textStyle(BOLD); textAlign(CENTER,CENTER);
    text(d.kbd, x+padW/2, padY+padH/2-20);

    // Label
    textStyle(NORMAL);
    fill(active?[0,0,95]:INK); textSize(9); textAlign(CENTER);
    text(d.label, x+padW/2, padY+padH-57);




    // Volume strip
    fill(...BG); stroke(...INK); strokeWeight(1); rect(vol.x,vol.y,vol.w,vol.h,4);
    fill(d.hue,DRUM_S,DRUM_B,has?85:35); noStroke();
    rect(vol.x, vol.y, vol.w*drumVolumes[d.id], vol.h, 4);


    // Swap button
    const hasSwap=cands.length>1;
    if(hasSwap){
      const hov2=mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
      fill(hov2?ACCENT:PANEL); stroke(...INK); strokeWeight(1);
      circle(swp.x+swp.w/2, swp.y+swp.h/2, swp.w);
      fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
      text('↻', swp.x+swp.w/2, swp.y+swp.h/2+1);
      fill(...INK); textSize(8); textStyle(BOLD); textAlign(RIGHT);
      text(`${drumIdx[d.id]+1}/${cands.length}`, swp.x-4, swp.y+swp.h/2+2);
      textStyle(NORMAL);
    }

    const {startPx,endPx}=trimHandleX(x,padW,d.id);
    const nearH=has&&overTb&&(abs(mouseX-startPx)<8||abs(mouseX-endPx)<8);
    cursor(nearH||overVol||(overSwap&&hasSwap)||(overPad&&has)?HAND:ARROW);
  });


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
  fill(seqPlaying?[120,55,72]:playHov?ACCENT:PANEL);
  stroke(...INK); strokeWeight(1); circle(playX,ctrlMid,playR*2);
  fill(seqPlaying?[0,0,98]:INK); noStroke();
  if(seqPlaying){
    rectMode(CENTER); rect(playX-3,ctrlMid,3,9,1); rect(playX+3,ctrlMid,3,9,1); rectMode(CORNER);
  } else {
    triangle(playX-4,ctrlMid-6,playX-4,ctrlMid+6,playX+7,ctrlMid);
  }

  // Record button
  const recBtnX=playX+playR*2+16, recBtnR=9;
  const recHov=dist(mouseX,mouseY,recBtnX,ctrlMid)<recBtnR;
  const recPulse=seqRecording?(sin(frameCount*0.15)*0.5+0.5):0;
  if(seqRecording){
    noFill(); stroke(0,70,60,recPulse*40); strokeWeight(3);
    circle(recBtnX,ctrlMid,recBtnR*2+10);
  }
  fill(seqRecording?[0,70,68]:recHov?[0,30,92]:PANEL);
  stroke(...INK); strokeWeight(1); circle(recBtnX,ctrlMid,recBtnR*2);
  fill(seqRecording?[0,0,98]:INK); noStroke(); circle(recBtnX,ctrlMid,5);

  // BPM
  const bpmLabelX=recBtnX+recBtnR+12, bpmSliderX=bpmLabelX+28, bpmSliderW=100;
  fill(...INK_DIM); noStroke(); textSize(8); textAlign(LEFT,CENTER);
  text('BPM', bpmLabelX, ctrlMid);
  fill(...BG); stroke(...INK); strokeWeight(1); rect(bpmSliderX,ctrlMid-4,bpmSliderW,8,4);
  const bpmNorm=(seqBPM-40)/200;
  fill(...ACCENT,80); noStroke(); rect(bpmSliderX,ctrlMid-4,bpmSliderW*bpmNorm,8,4);
  const thumbX=bpmSliderX+bpmSliderW*bpmNorm;
  const tHov=abs(mouseX-thumbX)<8&&abs(mouseY-ctrlMid)<10;
  fill(tHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); circle(thumbX,ctrlMid,11);
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER);
  text(Math.round(seqBPM), bpmSliderX+bpmSliderW+8, ctrlMid);

  // Tap
  const tapX=bpmSliderX+bpmSliderW+36, tapW=34, tapH=20;
  const tapHov=mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2;
  fill(tapHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(tapX,ctrlMid-tapH/2,tapW,tapH,R);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('TAP', tapX+tapW/2, ctrlMid);

  // Global clear
  const clrX=tapX+tapW+14, clrW=42, clrH=20;
  const clrHov=mouseX>clrX&&mouseX<clrX+clrW&&mouseY>ctrlMid-clrH/2&&mouseY<ctrlMid+clrH/2;
  fill(clrHov?[0,60,82]:PANEL); stroke(...INK); strokeWeight(1); rect(clrX,ctrlMid-clrH/2,clrW,clrH,R);
  fill(clrHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('CLR ALL', clrX+clrW/2, ctrlMid);

  // ── Stacked grids ─────────────────────────────────────────────────────────
  const frac    = loopFraction();
  const scanX   = gridLeft + frac * seqW;
  const totalH  = GRIDS.length * (DRUMS.length*rowH + GRID_GAP) - GRID_GAP;

  GRIDS.forEach((g, gi) => {
    const gTop  = gridY(gi, gridTop, rowH);
    const gridH = DRUMS.length * rowH;
    const cellW = seqW / g.steps;

    // Grid panel
    fill(...PANEL); stroke(...INK); strokeWeight(1);
    rect(SEQ_MARGIN, gTop, width-SEQ_MARGIN*2, gridH, R);

    // Step count label — large, outside the panel to the left
    fill(...INK); noStroke(); textSize(16); textStyle(BOLD); textAlign(RIGHT, CENTER);
    text(g.steps, SEQ_MARGIN-4, gTop+gridH/2);
    textStyle(NORMAL);

    // Clear button
    const cb = clearBtnRegion(gi, gridTop, rowH);
    const cbHov = mouseX>cb.x&&mouseX<cb.x+cb.w&&mouseY>cb.y&&mouseY<cb.y+cb.h;
    fill(cbHov?[0,55,82]:PANEL); stroke(...INK); strokeWeight(1); rect(cb.x,cb.y,cb.w,cb.h,3);
    fill(cbHov?[0,0,98]:INK_DIM); noStroke(); textSize(10); textAlign(CENTER,CENTER);
    text('✕', cb.x+cb.w/2, cb.y+cb.h/2+1);

    // Clip grid into panel bounds
    const innerX = gridLeft, innerW = seqW;

    // Group shading: alternate every 4 steps for visual reference
    for(let s=0; s<g.steps; s++){
      const cx2 = innerX + s*cellW;
      const groupOf4 = Math.floor(s/4);
      fill(groupOf4%2===0 ? [0,0,97] : [0,0,94]); noStroke();
      // Clip to panel rounded corners on edges
      rect(max(cx2, innerX), gTop+1, min(cellW, innerX+innerW-max(cx2,innerX))-1, gridH-2);
    }

    DRUMS.forEach((d, ri) => {
      const ry = gTop + ri*rowH;

      // Row divider (except last)
      if(ri < DRUMS.length-1){
        stroke(...INK, 18); strokeWeight(0.5);
        line(gridLeft, ry+rowH, gridLeft+seqW, ry+rowH);
      }

      // Row label on every grid
      fill(d.hue, DRUM_S, DRUM_B); noStroke(); textSize(8); textStyle(BOLD); textAlign(RIGHT, CENTER);
      text(d.label, gridLeft-28, ry+rowH/2);
      textStyle(NORMAL);

      for(let s=0; s<g.steps; s++){
        const cx2     = innerX + s*cellW;
        const on      = seqGrid[gi][d.id][s];
        const cFracS  = s / g.steps, cFracE = (s+1) / g.steps;
        const isHead  = seqPlaying && frac>=cFracS && frac<cFracE;
        const cHov    = mouseX>cx2+1&&mouseX<cx2+cellW-1&&mouseY>ry+1&&mouseY<ry+rowH-1;

        const pad = 1.5;
        if(isHead&&on)     { fill(d.hue, DRUM_S+8, DRUM_B+10); noStroke(); }
        else if(isHead)    { fill(d.hue, DRUM_S_LITE, DRUM_B_LITE-8); noStroke(); }
        else if(on)        { fill(d.hue, DRUM_S, DRUM_B, cHov?100:90); noStroke(); }
        else               { fill(d.hue, cHov?28:DRUM_S_LITE-10, cHov?85:DRUM_B_LITE+2, cHov?60:0); noStroke(); }

        if(on||isHead)     rect(cx2+pad, ry+pad, cellW-pad*2, rowH-pad*2, 2);

        // Beat dot on empty cells
        if(!on&&!isHead){
          const isBeat=s%4===0;
          fill(d.hue, 30, isBeat?65:80, 80); noStroke();
          circle(cx2+cellW/2, ry+rowH/2, isBeat?3.5:2);
        }
      }
    });

    // Inner column dividers (thin vertical lines at cell boundaries)
    for(let s=1; s<g.steps; s++){
      const cx2 = innerX + s*cellW;
      stroke(...INK, s%4===0 ? 20 : 8); strokeWeight(0.5);
      line(cx2, gTop+1, cx2, gTop+gridH-1);
    }
  });

  // ── Single scanline through all grids ─────────────────────────────────────
  if(seqPlaying){
    // Glow
    stroke(...ACCENT, 25); strokeWeight(6);
    line(scanX, gridTop, scanX, gridTop+totalH);
    // Line
    stroke(...INK, 70); strokeWeight(1);
    line(scanX, gridTop, scanX, gridTop+totalH);
  }

  // REC label
  if(seqRecording){
    fill(0,65,58, 70+sin(frameCount*0.15)*20);
    textSize(8); textAlign(RIGHT,TOP); noStroke();
    text('● REC', width-SEQ_MARGIN-6, gridTop+4);
  }
}

// ── ERROR ─────────────────────────────────────────────────────────────────────

function drawError() {
  const cx=width/2,cy=height/2;
  fill(0,65,62); textSize(11); textAlign(CENTER); text('ERROR',cx,cy-18);
  fill(...INK_DIM); textSize(9); text(errorMsg,cx,cy);
  fill(...INK_FAINT); textSize(9); text('CLICK TO TRY AGAIN',cx,cy+26);
  cursor(HAND);
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

function startSequencer() {
  if(audioCtx.state==='suspended') audioCtx.resume();
  GRIDS.forEach((_,gi)=>{ _nextSteps[gi]=0; });
  _loopStartTime = audioCtx.currentTime + 0.05;
  seqPlaying     = true;
  scheduleLoop();
}

function stopSequencer() {
  seqPlaying   = false;
  seqRecording = false;
  if(scheduleTimer){ clearTimeout(scheduleTimer); scheduleTimer=null; }
}

function scheduleLoop() {
  if(!seqPlaying) return;
  const now=audioCtx.currentTime, loopDur=loopDuration();
  if(now >= _loopStartTime + loopDur){
    _loopStartTime += loopDur;
    GRIDS.forEach((_,gi)=>{ _nextSteps[gi]=0; });
    if(seqRecording) scheduleMetronomeClick(_loopStartTime, true);
  }
  GRIDS.forEach((g,gi)=>{
    const sDur=loopDur/g.steps;
    while(_nextSteps[gi]<g.steps){
      const t=_loopStartTime+_nextSteps[gi]*sDur;
      if(t>now+SCHEDULE_AHEAD) break;
      DRUMS.forEach(d=>{ if(seqGrid[gi][d.id][_nextSteps[gi]]) triggerDrumAtTime(d.id,t); });
      if(gi===0&&seqRecording&&_nextSteps[gi]%4===0&&_nextSteps[gi]>0)
        scheduleMetronomeClick(t, false);
      _nextSteps[gi]++;
    }
  });
  scheduleTimer=setTimeout(scheduleLoop, LOOKAHEAD_MS);
}

function triggerDrumAtTime(id, when) {
  const cands=drumCandidates[id]; if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]]; if(!cand) return;
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer; src.connect(gainNodes[id]);
  const dur=cand.buffer.duration;
  src.start(when, drumTrimStart[id]*dur, (drumTrimEnd[id]-drumTrimStart[id])*dur);
}

function scheduleMetronomeClick(when, isDownbeat) {
  const osc=audioCtx.createOscillator(), env=audioCtx.createGain();
  osc.connect(env); env.connect(audioCtx.destination);
  osc.frequency.value=isDownbeat?1200:800; osc.type='sine';
  env.gain.setValueAtTime(0.3,when);
  env.gain.exponentialRampToValueAtTime(0.001,when+0.04);
  osc.start(when); osc.stop(when+0.05);
}

function quantizeToAllGrids(id) {
  const now=audioCtx.currentTime, loopDur=loopDuration();
  let pos=(now-_loopStartTime)%loopDur;
  if(pos<0) pos+=loopDur;
  const frac=pos/loopDur;
  // Only quantize into grid 0 (16-step grid)
  const g0 = GRIDS[0];
  const step0 = Math.round(frac*g0.steps) % g0.steps;
  seqGrid[0][id][step0] = !seqGrid[0][id][step0];
}

// ── Mouse ─────────────────────────────────────────────────────────────────────

function mousePressed() {
  if(audioCtx.state==='suspended') audioCtx.resume();

  if(phase==='idle'){
    const cx=width/2,cy=height/2-10,r=54;
    if(dist(mouseX,mouseY,cx,cy)<r){startRecording();return;}
    const upY=cy+r+38;
    if(abs(mouseX-cx)<70&&abs(mouseY-upY)<10){uploadEl.elt.click();return;}
  }
  if(phase==='recording'){
    if(dist(mouseX,mouseY,width/2,height/2-30)<50) stopRecording();
    return;
  }
  if(phase==='error'){phase='idle';return;}

  if(phase==='ready'){
    const { seqW, rowH, ctrlY, gridTop, gridLeft } = getSeqLayout();
    const ctrlMid=ctrlY+SEQ_CTRL_H/2;
    const playX=SEQ_MARGIN+SEQ_LABEL_W;
    const recBtnX=playX+12*2+16;

    // Play/stop
    if(dist(mouseX,mouseY,playX,ctrlMid)<12){
      seqPlaying?stopSequencer():startSequencer(); return;
    }
    // Record
    if(dist(mouseX,mouseY,recBtnX,ctrlMid)<9){
      if(!seqPlaying) startSequencer();
      seqRecording=!seqRecording; return;
    }
    // BPM thumb
    const bpmLabelX=recBtnX+9+12, bpmSliderX=bpmLabelX+28;
    const bpmNorm=(seqBPM-40)/200, thumbX=bpmSliderX+100*bpmNorm;
    if(abs(mouseX-thumbX)<10&&abs(mouseY-ctrlMid)<10){
      drag={type:'bpm',sliderX:bpmSliderX,sliderW:100}; return;
    }
    // Tap
    const tapX=bpmSliderX+100+36, tapW=34, tapH=20;
    if(mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2){
      handleTap(); return;
    }

    // Global clear
    {
      const bpmLabelX2=recBtnX+9+12, bpmSliderX2=bpmLabelX2+28;
      const tapX2=bpmSliderX2+100+36, tapW2=34;
      const clrX=tapX2+tapW2+14, clrW=42, clrH=20;
      if(mouseX>clrX&&mouseX<clrX+clrW&&mouseY>ctrlMid-clrH/2&&mouseY<ctrlMid+clrH/2){
        GRIDS.forEach((_,gi)=>{ DRUMS.forEach(d=>{ seqGrid[gi][d.id].fill(false); }); });
        return;
      }
    }

    // Clear buttons
    GRIDS.forEach((_,gi)=>{
      const cb=clearBtnRegion(gi, gridTop, rowH);
      if(mouseX>cb.x&&mouseX<cb.x+cb.w&&mouseY>cb.y&&mouseY<cb.y+cb.h){
        DRUMS.forEach(d=>{ seqGrid[gi][d.id].fill(false); });
      }
    });

    // Grid cells
    GRIDS.forEach((g,gi)=>{
      const gTop=gridY(gi,gridTop,rowH), gridH=DRUMS.length*rowH;
      const cellW=seqW/g.steps;
      if(mouseY<gTop||mouseY>gTop+gridH) return;
      if(mouseX<gridLeft||mouseX>gridLeft+seqW) return;
      const s=floor((mouseX-gridLeft)/cellW);
      if(s<0||s>=g.steps) return;
      DRUMS.forEach((d,ri)=>{
        const ry=gTop+ri*rowH;
        if(mouseY>=ry&&mouseY<ry+rowH) seqGrid[gi][d.id][s]=!seqGrid[gi][d.id][s];
      });
    });

    // Pad region
    const {padW,padH,gap,startX,padY}=getPadLayout();
    for(let i=0;i<DRUMS.length;i++){
      const d=DRUMS[i], x=startX+i*(padW+gap);
      const has=drumCandidates[d.id].length>0;
      const tb=trimBarRegion(x,padY,padW);
      if(mouseY>tb.y&&mouseY<tb.y+tb.h&&has){
        const {startPx,endPx}=trimHandleX(x,padW,d.id);
        if(abs(mouseX-startPx)<10){drag={type:'trimStart',id:d.id,barX:tb.x,barW:tb.w};return;}
        if(abs(mouseX-endPx)<10)  {drag={type:'trimEnd',  id:d.id,barX:tb.x,barW:tb.w};return;}
      }
      const vol=volStripRegion(x,padY,padW);
      if(mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h){
        drag={type:'vol',id:d.id,startX:mouseX,startVol:drumVolumes[d.id],barX:vol.x,barW:vol.w};return;
      }
      const swp=swapBtnRegion(x,padY,padW);
      if(mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h){
        const cands=drumCandidates[d.id];
        if(cands.length>1){
          drumIdx[d.id]=(drumIdx[d.id]+1)%cands.length;
          drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;
          padFlash[d.id]=millis(); triggerDrum(d.id);
        }
        return;
      }
      if(mouseX>x&&mouseX<x+padW&&mouseY>padY&&mouseY<padY+padH){
        triggerDrum(d.id); return;
      }
    }
  }
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

const kbdMap=Object.fromEntries(DRUMS.map(d=>[d.kbd.toLowerCase(),d.id]));

function keyPressed(){
  if(phase==='ready'){
    const id=kbdMap[key.toLowerCase()];
    if(id){
      triggerDrum(id); padHeld[id]=true;
      if(seqRecording&&seqPlaying) quantizeToAllGrids(id);
    }
    if(key===' '){seqPlaying?stopSequencer():startSequencer();}
    if(key==='r'||key==='R') resetToIdle();
    if(key==='u'||key==='U') uploadEl.elt.click();
  }
}
function keyReleased(){
  const id=kbdMap[key.toLowerCase()];
  if(id) padHeld[id]=false;
}

// ── Tap tempo ─────────────────────────────────────────────────────────────────

function handleTap(){
  const now=millis();
  tapTimes.push(now);
  tapTimes=tapTimes.filter(t=>now-t<3000).slice(-8);
  if(tapTimes.length>=2){
    const intervals=[];
    for(let i=1;i<tapTimes.length;i++) intervals.push(tapTimes[i]-tapTimes[i-1]);
    seqBPM=constrain(60000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),40,240);
  }
}

// ── Recording pipeline ────────────────────────────────────────────────────────

async function startRecording(){
  try{ recStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); }
  catch(e){ errorMsg='Microphone access denied'; phase='error'; return; }
  const src=audioCtx.createMediaStreamSource(recStream);
  analyserNode=audioCtx.createAnalyser(); analyserNode.fftSize=512;
  waveformData=new Uint8Array(analyserNode.frequencyBinCount);
  src.connect(analyserNode);
  recChunks=[]; mediaRecorder=new MediaRecorder(recStream);
  mediaRecorder.ondataavailable=e=>{if(e.data.size>0)recChunks.push(e.data);};
  mediaRecorder.onstop=onRecordingStop;
  mediaRecorder.start(100); recStart=millis(); phase='recording';
}

function stopRecording(){
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){
    mediaRecorder.stop(); recStream.getTracks().forEach(t=>t.stop()); analyserNode=null;
  }
}

function onRecordingStop(){ submitAudio(new Blob(recChunks,{type:'audio/webm'})); }
function onFileSelected(){ const f=uploadEl.elt.files[0]; if(f) submitAudio(f); }

async function submitAudio(blob){
  phase='processing'; statusMsg='EMBEDDING AUDIO…';
  const form=new FormData(); form.append('file',blob,'audio');
  let data;
  try{
    const resp=await fetch(`${BACKEND}/analyze`,{method:'POST',body:form});
    if(!resp.ok){const e=await resp.json().catch(()=>({detail:resp.statusText}));throw new Error(e.detail||resp.statusText);}
    data=await resp.json();
  } catch(e){ errorMsg=e.message; phase='error'; return; }

  drumCandidates={}; drumIdx={};
  DRUMS.forEach(d=>{
    drumCandidates[d.id]=[]; drumIdx[d.id]=0;
    drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;
  });
  for(const [id,info] of Object.entries(data.drums)){
    const decoded=[];
    for(const cand of info.candidates){
      try{
        const bin=atob(cand.audio),bytes=new Uint8Array(bin.length);
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

function triggerDrum(id){
  const cands=drumCandidates[id]; if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]]; if(!cand) return;
  if(audioCtx.state==='suspended') audioCtx.resume();
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer; src.connect(gainNodes[id]);
  const dur=cand.buffer.duration;
  src.start(0,drumTrimStart[id]*dur,(drumTrimEnd[id]-drumTrimStart[id])*dur);
  padFlash[id]=millis();
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetToIdle(){
  stopSequencer();
  phase='idle'; drumCandidates={}; drumIdx={};
  DRUMS.forEach(d=>{
    drumCandidates[d.id]=[]; drumIdx[d.id]=0;
    drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;
    padFlash[d.id]=-9999; padHeld[d.id]=false;
  });
  GRIDS.forEach((g,gi)=>{
    DRUMS.forEach(d=>{ seqGrid[gi][d.id]=new Array(g.steps).fill(false); });
  });
}
