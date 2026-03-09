// ─────────────────────────────────────────────────────────────────────────────
// DRUM EXTRACTOR — p5.js sketch
// ─────────────────────────────────────────────────────────────────────────────

const BACKEND = 'http://localhost:8000';

const DRUMS = [
  { id: 'kick',  label: 'KICK',   sub: 'bass drum', kbd: 'K', hue: 8   },
  { id: 'snare', label: 'SNARE',  sub: 'backbeat',  kbd: 'S', hue: 200 },
  { id: 'hihat', label: 'HI-HAT', sub: 'closed',    kbd: 'H', hue: 48  },
  { id: 'clap',  label: 'CLAP',   sub: 'hand clap', kbd: 'C', hue: 300 },
];

// ── Palette ───────────────────────────────────────────────────────────────────
const BG    = [237, 14,  5];
const AMBER = [40,  90, 96];
const DIM   = [237, 10, 35];
const GRID  = [237, 12, 14];

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

// ── Sequencer state ───────────────────────────────────────────────────────────
let seqSteps       = 16;
let seqBPM         = 120;
let seqPlaying     = false;
let seqRecording   = false;
let seqGrid        = {};
let seqCurrentStep = 0;

// Lookahead scheduler
let scheduleTimer  = null;
let _schedStep     = 0;
let _nextNoteTime  = 0;
let _loopStartTime = 0;     // audioCtx time when step 0 of current loop began
const LOOKAHEAD_MS   = 25;
const SCHEDULE_AHEAD = 0.10;

// Tap tempo
let tapTimes    = [];
let seqGrouping = 4;    // steps per visual group (beat division)

// Web Audio / recording
let audioCtx      = null;
let mediaRecorder = null;
let recChunks     = [];
let recStream     = null;
let recStart      = 0;
let analyserNode  = null;
let waveformData  = null;

// HTML elements
let uploadEl   = null;
let stepsInput = null;

let errorMsg  = '';
let statusMsg = '';
let spinAngle = 0;

// ── Layout constants ──────────────────────────────────────────────────────────
const PAD_H      = 178;
const TRIM_H     = 20;
const TRIM_GAP   = 8;
const SEQ_ROW_H  = 26;
const SEQ_CTRL_H = 40;
const FOOTER_H   = 28;
const HEADER_H   = 50;
const MIN_CELL_W = 8;    // minimum px per step cell — determines max steps
const SEQ_LABEL_W = 52;
const SEQ_MARGIN  = 60;

// ── p5 setup ──────────────────────────────────────────────────────────────────

function setup() {
  createCanvas(windowWidth, windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('IBM Plex Mono');

  audioCtx   = new (window.AudioContext || window.webkitAudioContext)();
  uploadEl   = select('#upload-input');
  stepsInput = select('#steps-input');

  uploadEl.changed(onFileSelected);

  // Validate and apply only when user signals they're done (blur or Enter)
  // — avoids rejecting partial input like the "2" in "28"
  function applyStepsInput() {
    const v = parseInt(stepsInput.value());
    if (isNaN(v)) { stepsInput.value(seqSteps); return; }
    const maxSteps = calcMaxSteps();
    const clamped  = constrain(v, 3, maxSteps);
    stepsInput.value(clamped);
    if (clamped !== seqSteps) setStepCount(clamped);
  }
  stepsInput.elt.addEventListener('blur',   applyStepsInput);
  stepsInput.elt.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { applyStepsInput(); stepsInput.elt.blur(); }
  });

  // Prevent spacebar / letter keys from bubbling when input is focused
  stepsInput.elt.addEventListener('keydown', e => e.stopPropagation());

  DRUMS.forEach(d => {
    padFlash[d.id]       = -9999;
    padHeld[d.id]        = false;
    drumVolumes[d.id]    = 0.8;
    drumTrimStart[d.id]  = 0;
    drumTrimEnd[d.id]    = 1;
    drumCandidates[d.id] = [];
    drumIdx[d.id]        = 0;
    seqGrid[d.id]        = new Array(seqSteps).fill(false);

    const g = audioCtx.createGain();
    g.gain.value = 0.8;
    g.connect(audioCtx.destination);
    gainNodes[d.id] = g;
  });
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  positionStepsInput();
}

function calcMaxSteps() {
  const seqW = width - SEQ_MARGIN*2 - SEQ_LABEL_W;
  return max(3, floor(seqW / MIN_CELL_W));
}

// ── Main draw loop ────────────────────────────────────────────────────────────

function draw() {
  background(...BG);
  drawBgGrid();
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

// ── Background grid ───────────────────────────────────────────────────────────

function drawBgGrid() {
  stroke(...GRID); strokeWeight(0.5);
  for (let i=0;i<=24;i++) line(map(i,0,24,0,width),0,map(i,0,24,0,width),height);
  for (let j=0;j<=16;j++) line(0,map(j,0,16,0,height),width,map(j,0,16,0,height));
}

function drawHeader() {
  noStroke();
  fill(...AMBER); textSize(11); textStyle(NORMAL); textAlign(LEFT,TOP);
  text('DRUM EXTRACTOR  v0.1', 28, 24);
  fill(...DIM); textSize(9); textAlign(RIGHT,TOP);
  text('CLAP / laion · ' + (phase==='ready'?'READY':phase.toUpperCase()), width-28, 24);
  stroke(...DIM); strokeWeight(0.5); line(28,42,width-28,42);
}

// ── Layout helpers ────────────────────────────────────────────────────────────

function getPadLayout() {
  const n    = DRUMS.length;
  const gap  = 16;
  const padW = min(140, (width - 80 - gap*(n-1)) / n);
  const total = padW*n + gap*(n-1);
  const startX = (width - total) / 2;
  const padY   = HEADER_H + 10 + TRIM_H + TRIM_GAP;
  return { padW, padH: PAD_H, gap, startX, padY };
}

function getSeqLayout() {
  const { padY } = getPadLayout();
  const seqTop  = padY + PAD_H + 16;
  const seqW    = width - SEQ_MARGIN*2 - SEQ_LABEL_W;
  const ctrlY   = seqTop;
  const gridTop = seqTop + SEQ_CTRL_H;
  return { seqTop, margin: SEQ_MARGIN, labelW: SEQ_LABEL_W, seqW, ctrlY, gridTop };
}

// Position the HTML steps input over the canvas
function positionStepsInput() {
  if (phase !== 'ready') { stepsInput.hide(); return; }
  const { seqTop, margin, labelW, seqW } = getSeqLayout();
  const ctrlMid = seqTop + SEQ_CTRL_H/2;

  // Place it after the step-count label — we'll compute this the same way
  // as the draw function lays out controls
  const playX      = margin + labelW;
  const bpmLabelX  = playX + 13 + 14;
  const bpmSliderX = bpmLabelX + 28;
  const tapX       = bpmSliderX + 110 + 36;
  const tapW       = 38;
  const stepLabelX = tapX + tapW + 20;
  const inputX     = stepLabelX + 38;
  const inputY     = ctrlMid - 10;

  stepsInput.style('left',  inputX + 'px');
  stepsInput.style('top',   inputY + 'px');
  stepsInput.show();
}

// ── IDLE ──────────────────────────────────────────────────────────────────────

function drawIdle() {
  stepsInput.hide();
  const cx=width/2, cy=height/2-20;
  const breathe=sin(frameCount*0.035)*0.5+0.5;
  noFill(); stroke(...AMBER,map(breathe,0,1,8,22)); strokeWeight(1);
  circle(cx,cy,200+breathe*16);

  const r=54, hov=dist(mouseX,mouseY,cx,cy)<r;
  strokeWeight(1.5); stroke(...AMBER,hov?90:55); fill(0,0,hov?12:8);
  circle(cx,cy,r*2);

  noStroke(); fill(...AMBER,hov?95:70);
  const mw=14,mh=22,mTop=cy-mh/2-4;
  rectMode(CORNER); rect(cx-mw/2,mTop+mw/2,mw,mh-mw/2); ellipse(cx,mTop+mw/2,mw,mw);
  noFill(); stroke(...AMBER,hov?95:70); strokeWeight(2);
  const arcY=cy+mh/2-2;
  arc(cx,arcY-2,24,16,PI,TWO_PI);
  line(cx,arcY+6,cx,arcY+12); line(cx-8,arcY+12,cx+8,arcY+12);

  noStroke(); fill(...AMBER,hov?90:55); textSize(10); textStyle(NORMAL); textAlign(CENTER);
  text('CLICK TO RECORD',cx,cy+r+20);
  const upY=cy+r+38, hovUp=abs(mouseX-cx)<70&&abs(mouseY-upY)<10;
  fill(...DIM,hovUp?80:50); textSize(9); text('or upload a file',cx,upY);
  cursor(hov||hovUp?HAND:ARROW);
}

// ── RECORDING ─────────────────────────────────────────────────────────────────

function drawRecording() {
  stepsInput.hide();
  const cx=width/2, cy=height/2-30;
  for(let i=0;i<3;i++){
    const p=(frameCount*0.04+i*0.8)%TWO_PI;
    noFill(); stroke(0,90,85,map(sin(p),-1,1,5,30-i*8)); strokeWeight(1);
    circle(cx,cy,(90+i*28+sin(p)*8)*2);
  }
  const r=50, hov=dist(mouseX,mouseY,cx,cy)<r;
  stroke(0,80,85,hov?90:65); strokeWeight(1.5); fill(0,0,hov?10:6); circle(cx,cy,r*2);
  noStroke(); fill(0,80,85); rectMode(CENTER); rect(cx,cy,18,18,2); rectMode(CORNER);

  const elapsed=((millis()-recStart)/1000).toFixed(1);
  fill(0,80,frameCount%40<20?90:50); textSize(10); textAlign(CENTER);
  text(`● REC  ${elapsed}s`,cx,cy+r+20);

  if(analyserNode&&waveformData){
    analyserNode.getByteTimeDomainData(waveformData);
    const ww=min(480,width-80),wh=56,wx=(width-ww)/2,wy=cy+r+36;
    noFill(); stroke(...DIM,40); strokeWeight(0.5); rect(wx,wy,ww,wh);
    stroke(...DIM,25); line(wx,wy+wh/2,wx+ww,wy+wh/2);
    stroke(40,85,96); strokeWeight(1.5); noFill(); beginShape();
    for(let i=0;i<waveformData.length;i++) vertex(wx+map(i,0,waveformData.length-1,0,ww),wy+map(waveformData[i],0,255,wh,0));
    endShape();
  }
  fill(...DIM,60); noStroke(); textSize(9); textAlign(CENTER);
  text('CLICK TO STOP & ANALYSE',cx,height-36);
  cursor(hov?HAND:ARROW);
}

// ── PROCESSING ────────────────────────────────────────────────────────────────

function drawProcessing() {
  stepsInput.hide();
  const cx=width/2,cy=height/2-20,ticks=16;
  for(let i=0;i<ticks;i++){
    const a=(i/ticks)*TWO_PI+spinAngle;
    stroke(...AMBER,pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*70+5); strokeWeight(1.5);
    line(cx+cos(a)*40,cy+sin(a)*40,cx+cos(a)*54,cy+sin(a)*54);
  }
  noStroke(); fill(...AMBER,50); circle(cx,cy,8);
  fill(...AMBER,80); textSize(11); textAlign(CENTER);
  text(statusMsg||'ANALYSING…',cx,cy+72);
  fill(...DIM,50); textSize(9);
  text('running CLAP embeddings — may take 15–40 s',cx,cy+88);
}

// ── READY ─────────────────────────────────────────────────────────────────────

function drawReady() {
  positionStepsInput();
  drawPads();
  drawSequencer();
}

// ── Sub-region helpers ────────────────────────────────────────────────────────

function trimBarRegion(x, padY, padW) {
  return { x, y: padY-TRIM_H-TRIM_GAP, w: padW, h: TRIM_H };
}
function volStripRegion(x, padY, padW) {
  return { x: x+10, y: padY+PAD_H-24, w: padW-20, h: 9 };
}
function swapBtnRegion(x, padY, padW) {
  return { x: x+padW-20, y: padY+8, w: 13, h: 13 };
}
function trimHandleX(x, padW, id) {
  return {
    startPx: x + drumTrimStart[id]*padW,
    endPx:   x + drumTrimEnd[id]*padW,
  };
}

// ── Pads ──────────────────────────────────────────────────────────────────────

function drawPads() {
  const { padW, padH, gap, startX, padY } = getPadLayout();

  DRUMS.forEach((d, i) => {
    const x   = startX + i*(padW+gap);
    const has = drumCandidates[d.id].length > 0;
    const cands   = drumCandidates[d.id];
    const curCand = cands[drumIdx[d.id]];

    const ago      = millis()-padFlash[d.id];
    const flashAmt = max(0,1-ago/110);
    const active   = flashAmt>0||padHeld[d.id];

    const tb  = trimBarRegion(x,padY,padW);
    const vol = volStripRegion(x,padY,padW);
    const swp = swapBtnRegion(x,padY,padW);

    const overTb   = mouseX>tb.x&&mouseX<tb.x+tb.w&&mouseY>tb.y&&mouseY<tb.y+tb.h;
    const overVol  = mouseX>vol.x&&mouseX<vol.x+vol.w&&mouseY>vol.y&&mouseY<vol.y+vol.h;
    const overSwap = mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
    const overPad  = mouseX>x&&mouseX<x+padW&&mouseY>padY&&mouseY<padY+padH&&!overVol&&!overSwap;

    // Trim bar
    fill(0,0,10); noStroke(); rect(tb.x,tb.y,tb.w,tb.h,2);
    if(has&&curCand){
      const buf=curCand.buffer, chan=buf.getChannelData(0);
      const step=max(1,Math.floor(chan.length/tb.w));
      for(let px=0;px<tb.w;px++){
        const frac=px/tb.w;
        const inTrim=frac>=drumTrimStart[d.id]&&frac<=drumTrimEnd[d.id];
        let peak=0;
        const si=Math.floor(frac*chan.length);
        for(let s=si;s<min(si+step,chan.length);s++) peak=max(peak,abs(chan[s]));
        const bh=peak*tb.h*0.88;
        stroke(d.hue,inTrim?55:18,inTrim?80:42,inTrim?85:28); strokeWeight(1);
        line(tb.x+px,tb.y+tb.h/2-bh/2,tb.x+px,tb.y+tb.h/2+bh/2);
      }
      noStroke(); fill(0,0,3,72);
      rect(tb.x,tb.y,drumTrimStart[d.id]*tb.w,tb.h,2,0,0,2);
      rect(tb.x+drumTrimEnd[d.id]*tb.w,tb.y,(1-drumTrimEnd[d.id])*tb.w,tb.h,0,2,2,0);
      const {startPx,endPx}=trimHandleX(x,padW,d.id);
      const nearS=abs(mouseX-startPx)<8&&overTb, nearE=abs(mouseX-endPx)<8&&overTb;
      fill(d.hue,nearS?70:44,nearS?95:74); noStroke(); rect(startPx-1,tb.y-3,3,tb.h+6,1);
      fill(d.hue,nearE?70:44,nearE?95:74);              rect(endPx-1,  tb.y-3,3,tb.h+6,1);
      fill(...DIM,50); noStroke(); textSize(7); textAlign(LEFT);
      text('TRIM',tb.x,tb.y-4);
    } else {
      fill(...DIM,20); noStroke(); textSize(7); textAlign(CENTER);
      text('no audio',tb.x+tb.w/2,tb.y+tb.h/2+3);
    }

    // Pad body
    stroke(d.hue,active?65:55,active?90:70,has?(active?90:overPad?60:35):15);
    strokeWeight(active?2:1); fill(d.hue,active?40:20,active?16:overPad?11:8);
    rectMode(CORNER); rect(x,padY,padW,padH,3);
    if(active){noStroke();fill(d.hue,60,90,flashAmt*12);rect(x,padY,padW,padH,3);}

    noStroke(); fill(d.hue,has?(active?20:30):10,active?96:(has?72:35));
    textSize(46); textStyle(BOLD); textAlign(CENTER,CENTER);
    text(d.kbd,x+padW/2,padY+padH/2-22);

    textStyle(NORMAL);
    fill(d.hue,has?30:10,active?90:(has?65:28));
    textSize(10); textAlign(CENTER);
    text(d.label,x+padW/2,padY+padH-62);
    fill(...DIM,has?60:25); textSize(8);
    text(d.sub,x+padW/2,padY+padH-51);

    if(has&&curCand){
      const norm=constrain(map(curCand.score,0.08,0.42,0,1),0,1);
      fill(d.hue,20,40); noStroke(); rect(x+10,padY+padH-41,padW-20,3,2);
      fill(d.hue,55,78,80); rect(x+10,padY+padH-41,(padW-20)*norm,3,2);
      fill(d.hue,20,50); textSize(7); textAlign(RIGHT);
      text(curCand.score.toFixed(3),x+padW-8,padY+padH-30);
    } else {
      fill(...DIM,30); textSize(8); textAlign(CENTER);
      text('NOT FOUND',x+padW/2,padY+padH-38);
    }

    // Volume strip
    fill(0,0,12); noStroke(); rect(vol.x,vol.y,vol.w,vol.h,3);
    fill(d.hue,overVol?55:40,overVol?80:65,has?85:40);
    rect(vol.x,vol.y,vol.w*drumVolumes[d.id],vol.h,3);
    fill(...DIM,overVol?80:40); textSize(7); textAlign(LEFT);
    text('VOL',vol.x,vol.y-3);

    // Swap button
    const hasSwap=cands.length>1;
    if(hasSwap){
      fill(d.hue,overSwap?50:30,overSwap?80:55,overSwap?90:60); noStroke();
      circle(swp.x+swp.w/2,swp.y+swp.h/2,swp.w);
      fill(d.hue,10,overSwap?96:80); textSize(8); textAlign(CENTER,CENTER);
      text('↻',swp.x+swp.w/2,swp.y+swp.h/2+1);
      fill(...DIM,50); textSize(6); textAlign(LEFT);
      text(`${drumIdx[d.id]+1}/${cands.length}`,swp.x-12,swp.y+swp.h/2+2);
    }

    const {startPx,endPx}=trimHandleX(x,padW,d.id);
    const nearH=has&&overTb&&(abs(mouseX-startPx)<8||abs(mouseX-endPx)<8);
    cursor(nearH||overVol||(overSwap&&hasSwap)||(overPad&&has)?HAND:ARROW);
  });

  noStroke(); fill(...DIM,40); textSize(8); textStyle(NORMAL); textAlign(CENTER);
  text('K · S · H · C   ·   CLICK PADS   ·   SPACE = PLAY/STOP   ·   R = RE-RECORD   ·   U = UPLOAD', width/2, height-FOOTER_H/2+2);
}

// ── Sequencer ─────────────────────────────────────────────────────────────────

function drawSequencer() {
  const { seqTop, margin, labelW, seqW, ctrlY, gridTop } = getSeqLayout();

  stroke(...DIM,30); strokeWeight(0.5);
  line(margin, seqTop-8, width-margin, seqTop-8);

  const ctrlMid = ctrlY + SEQ_CTRL_H/2;

  // ── Play / Stop ────────────────────────────────────────────────────────────
  const playX = margin + labelW;
  const playR = 13;
  const playHov = dist(mouseX,mouseY,playX,ctrlMid) < playR;
  fill(seqPlaying ? 120 : 140, seqPlaying?70:55, seqPlaying?85:70, playHov?95:80);
  noStroke(); circle(playX,ctrlMid,playR*2);
  fill(0,0,seqPlaying?10:95); noStroke();
  if(seqPlaying){
    rectMode(CENTER); rect(playX-3,ctrlMid,3,10,1); rect(playX+3,ctrlMid,3,10,1); rectMode(CORNER);
  } else {
    triangle(playX-4,ctrlMid-7,playX-4,ctrlMid+7,playX+7,ctrlMid);
  }

  // ── Record button ──────────────────────────────────────────────────────────
  const recBtnX = playX + playR*2 + 10 + 10;
  const recBtnR = 10;
  const recHov  = dist(mouseX,mouseY,recBtnX,ctrlMid) < recBtnR;
  // Pulsing glow when armed
  const recPulse = seqRecording ? (sin(frameCount*0.15)*0.5+0.5) : 0;
  if(seqRecording){
    noFill(); stroke(0, 80, 90, recPulse*35);
    strokeWeight(3); circle(recBtnX,ctrlMid,recBtnR*2+8);
  }
  fill(0, seqRecording?80:55, seqRecording?90:65, recHov?100:85);
  noStroke(); circle(recBtnX,ctrlMid,recBtnR*2);
  // Dot
  fill(0,0, seqRecording?98:80); noStroke();
  circle(recBtnX,ctrlMid,5);

  // ── BPM slider ────────────────────────────────────────────────────────────
  const bpmLabelX  = recBtnX + recBtnR + 14;
  const bpmSliderX = bpmLabelX + 28;
  const bpmSliderW = 100;

  fill(...DIM,60); noStroke(); textSize(8); textAlign(LEFT,CENTER);
  text('BPM', bpmLabelX, ctrlMid);

  fill(0,0,16); noStroke(); rect(bpmSliderX, ctrlMid-4, bpmSliderW, 8, 4);
  const bpmNorm = (seqBPM-40)/(240-40);
  fill(...AMBER,75); rect(bpmSliderX, ctrlMid-4, bpmSliderW*bpmNorm, 8, 4);
  const thumbX   = bpmSliderX + bpmSliderW*bpmNorm;
  const thumbHov = abs(mouseX-thumbX)<8 && abs(mouseY-ctrlMid)<10;
  fill(...AMBER,thumbHov?100:80); noStroke(); circle(thumbX, ctrlMid, 12);
  fill(...AMBER,85); textSize(9); textAlign(LEFT,CENTER);
  text(Math.round(seqBPM), bpmSliderX+bpmSliderW+8, ctrlMid);

  // ── Tap tempo ─────────────────────────────────────────────────────────────
  const tapX = bpmSliderX + bpmSliderW + 36;
  const tapW=38, tapH=20;
  const tapHov = mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2;
  fill(40,tapHov?55:35,tapHov?70:50); noStroke(); rect(tapX,ctrlMid-tapH/2,tapW,tapH,3);
  fill(...AMBER,85); textSize(8); textAlign(CENTER,CENTER);
  text('TAP',tapX+tapW/2,ctrlMid);

  // ── Steps label (the HTML input is positioned here by positionStepsInput) ──
  const stepLabelX = tapX + tapW + 20;
  fill(...DIM,55); noStroke(); textSize(8); textAlign(LEFT,CENTER);
  text('STEPS', stepLabelX, ctrlMid);
  // Show current value as faint underlay (input floats on top)
  fill(...AMBER,25); textSize(11); textAlign(LEFT,CENTER);
  text(seqSteps, stepLabelX+38, ctrlMid);

  // ── Grouping buttons ─────────────────────────────────────────────────────
  const grpOpts   = [2, 3, 4, 5, 7];
  const grpBtnW   = 22, grpBtnH = 16;
  const grpStartX = stepLabelX + 82;
  fill(...DIM,45); noStroke(); textSize(8); textAlign(LEFT,CENTER);
  text('DIV', grpStartX, ctrlMid);
  grpOpts.forEach((n, gi) => {
    const bx  = grpStartX + 26 + gi*(grpBtnW+3);
    const bHov = mouseX>bx&&mouseX<bx+grpBtnW&&mouseY>ctrlMid-grpBtnH/2&&mouseY<ctrlMid+grpBtnH/2;
    const sel  = n===seqGrouping;
    fill(sel?AMBER[0]:40, sel?AMBER[1]:30, sel?AMBER[2]:50, bHov?95:80);
    noStroke(); rect(bx, ctrlMid-grpBtnH/2, grpBtnW, grpBtnH, 3);
    fill(sel?0:360, 0, sel?8:70); textSize(8); textAlign(CENTER,CENTER);
    text(n, bx+grpBtnW/2, ctrlMid);
  });

  // ── Grid ──────────────────────────────────────────────────────────────────
  const cellW = seqW / seqSteps;
  const cellH = SEQ_ROW_H;

  // Group shading every seqGrouping steps
  for(let s=0; s<seqSteps; s+=seqGrouping){
    const gx      = margin + labelW + s*cellW;
    const groupW  = min(seqGrouping, seqSteps-s) * cellW;
    const groupNum = Math.floor(s / seqGrouping);
    fill(groupNum%2===0 ? [0,0,11] : [0,0,8]); noStroke();
    rect(gx, gridTop, groupW, cellH*DRUMS.length, 2);
  }

  DRUMS.forEach((d,ri) => {
    const ry = gridTop + ri*cellH;

    // Row label
    noStroke(); fill(d.hue, 35, 65); textSize(9); textAlign(RIGHT,CENTER);
    text(d.label, margin+labelW-8, ry+cellH/2);

    for(let s=0; s<seqSteps; s++){
      const cx2 = margin + labelW + s*cellW;
      const on   = seqGrid[d.id][s];
      const isHead = seqPlaying && s===seqCurrentStep;
      const cellHov = mouseX>cx2+1&&mouseX<cx2+cellW-1&&mouseY>ry+1&&mouseY<ry+cellH-1;

      if(isHead && on){
        fill(d.hue, 70, 98); noStroke();
      } else if(isHead){
        fill(d.hue, 25, 45, 90); noStroke();
      } else if(on){
        fill(d.hue, 65, 85, cellHov?100:88); noStroke();
      } else {
        fill(d.hue, cellHov?25:15, cellHov?30:18, cellHov?80:60); noStroke();
      }
      rect(cx2+1, ry+1, cellW-2, cellH-2, 2);

      if(!on&&!isHead){
        const isDivision = s%seqGrouping===0;
        fill(d.hue,20,isDivision?35:22,80); noStroke();
        circle(cx2+cellW/2, ry+cellH/2, isDivision?4:2.5);
      }
    }
  });

  // Playhead line
  if(seqPlaying){
    const phX = margin + labelW + (seqCurrentStep+0.5)*cellW;
    stroke(...AMBER, 35); strokeWeight(1);
    line(phX, gridTop, phX, gridTop+DRUMS.length*cellH);
  }

  // Record-mode overlay: red tint on grid when recording
  if(seqRecording){
    noStroke(); fill(0, 60, 40, 8);
    rect(margin+labelW, gridTop, seqW, DRUMS.length*cellH, 2);
    // "REC" label
    fill(0,80,90, 70+sin(frameCount*0.15)*20);
    textSize(8); textAlign(RIGHT, TOP); noStroke();
    text('● REC', margin+labelW+seqW-4, gridTop+4);
  }

  // Border
  stroke(...DIM,20); strokeWeight(0.5); noFill();
  rect(margin+labelW, gridTop, seqW, DRUMS.length*cellH, 2);
}

// ── ERROR ─────────────────────────────────────────────────────────────────────

function drawError() {
  stepsInput.hide();
  const cx=width/2,cy=height/2;
  fill(0,75,85); textSize(11); textAlign(CENTER); text('ERROR',cx,cy-18);
  fill(0,50,70); textSize(9); text(errorMsg,cx,cy);
  fill(...DIM,50); textSize(9); text('CLICK TO TRY AGAIN',cx,cy+26);
  cursor(HAND);
}

// ── Lookahead scheduler ───────────────────────────────────────────────────────

function startSequencer() {
  if(audioCtx.state==='suspended') audioCtx.resume();
  _schedStep    = 0;
  _nextNoteTime = audioCtx.currentTime + 0.05;
  _loopStartTime = _nextNoteTime;   // time when step 0 fires
  seqPlaying    = true;
  scheduleLoop();
}

function stopSequencer() {
  seqPlaying   = false;
  seqRecording = false;
  if(scheduleTimer){ clearTimeout(scheduleTimer); scheduleTimer=null; }
}

function scheduleLoop() {
  if(!seqPlaying) return;
  while(_nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD){
    fireStep(_schedStep, _nextNoteTime);
    seqCurrentStep = _schedStep;
    const secPerStep = (60.0/seqBPM) / 4;
    _nextNoteTime += secPerStep;
    _schedStep = (_schedStep+1) % seqSteps;
    // Keep _loopStartTime in sync — it trails behind by one full loop
    if(_schedStep === 0) _loopStartTime = _nextNoteTime;
  }
  scheduleTimer = setTimeout(scheduleLoop, LOOKAHEAD_MS);
}

function fireStep(step, time) {
  DRUMS.forEach(d => {
    if(seqGrid[d.id][step]) triggerDrumAtTime(d.id, time);
  });
  // Metronome: click on every beat division when recording is armed
  if(seqRecording && step % seqGrouping === 0) {
    scheduleMetronomeClick(time, step === 0);
  }
}

function scheduleMetronomeClick(when, isDownbeat) {
  // Synthesize a short click using an oscillator + exponential decay
  // Downbeat: higher pitch; subdivision: lower pitch
  const osc  = audioCtx.createOscillator();
  const env  = audioCtx.createGain();
  osc.connect(env);
  env.connect(audioCtx.destination);

  osc.frequency.value  = isDownbeat ? 1200 : 800;
  osc.type             = 'sine';
  env.gain.setValueAtTime(0.35, when);
  env.gain.exponentialRampToValueAtTime(0.001, when + 0.04);

  osc.start(when);
  osc.stop(when + 0.05);
}

function triggerDrumAtTime(id, when) {
  const cands = drumCandidates[id];
  if(!cands||!cands.length) return;
  const cand = cands[drumIdx[id]];
  if(!cand) return;
  const src = audioCtx.createBufferSource();
  src.buffer = cand.buffer;
  src.connect(gainNodes[id]);
  const dur    = cand.buffer.duration;
  const offset = drumTrimStart[id] * dur;
  const length = (drumTrimEnd[id]-drumTrimStart[id]) * dur;
  src.start(when, offset, length);
}

// ── Record quantization ───────────────────────────────────────────────────────
//
// When recording, we know the audio clock position within the current loop:
//   posInLoop = (audioCtx.currentTime - _loopStartTime) % loopLength
// Divide by stepDuration and round to get the nearest step.
// Using audioCtx.currentTime (not millis()) keeps it tight.

function quantizeToStep(id) {
  const secPerStep  = (60.0/seqBPM) / 4;
  const loopLength  = seqSteps * secPerStep;
  const now         = audioCtx.currentTime;

  // How far into the current loop are we?
  let posInLoop = (now - _loopStartTime) % loopLength;
  if(posInLoop < 0) posInLoop += loopLength;

  const step = Math.round(posInLoop / secPerStep) % seqSteps;

  // Toggle the step (overdub mode — don't wipe existing pattern)
  seqGrid[id][step] = !seqGrid[id][step];
}

// ── Mouse ─────────────────────────────────────────────────────────────────────

function mousePressed() {
  if(audioCtx.state==='suspended') audioCtx.resume();

  if(phase==='idle'){
    const cx=width/2,cy=height/2-20,r=54;
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
    const { seqTop, margin, labelW, seqW, ctrlY, gridTop } = getSeqLayout();
    const ctrlMid = ctrlY + SEQ_CTRL_H/2;
    const playX   = margin + labelW;
    const recBtnX = playX + 13*2 + 10 + 10;

    // Play/stop
    if(dist(mouseX,mouseY,playX,ctrlMid)<13){
      seqPlaying ? stopSequencer() : startSequencer(); return;
    }

    // Record button
    if(dist(mouseX,mouseY,recBtnX,ctrlMid)<10){
      if(!seqPlaying) startSequencer();   // auto-start playback when arming rec
      seqRecording = !seqRecording;
      return;
    }

    // Tap tempo
    const bpmLabelX  = recBtnX + 10 + 14;
    const bpmSliderX = bpmLabelX + 28;
    const tapX       = bpmSliderX + 100 + 36;
    const tapW=38, tapH=20;
    if(mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2){
      handleTap(); return;
    }

    // BPM thumb drag
    const bpmNorm = (seqBPM-40)/(240-40);
    const thumbX  = bpmSliderX + 100*bpmNorm;
    if(abs(mouseX-thumbX)<10&&abs(mouseY-ctrlMid)<10){
      drag={type:'bpm',sliderX:bpmSliderX,sliderW:100}; return;
    }

    // Grouping buttons
    {
      const grpOpts=[2,3,4,5,7], grpBtnW=22, grpBtnH=16;
      const bpmLabelX2 = recBtnX + 10 + 14;
      const bpmSliderX2 = bpmLabelX2 + 28;
      const tapX2 = bpmSliderX2 + 100 + 36;
      const tapW2 = 38;
      const stepLabelX2 = tapX2 + tapW2 + 20;
      const grpStartX = stepLabelX2 + 82;
      grpOpts.forEach((n,gi)=>{
        const bx=grpStartX+26+gi*(grpBtnW+3);
        if(mouseX>bx&&mouseX<bx+grpBtnW&&mouseY>ctrlMid-grpBtnH/2&&mouseY<ctrlMid+grpBtnH/2){
          seqGrouping=n;
        }
      });
    }

    // Grid cells
    const cellW=seqW/seqSteps, cellH=SEQ_ROW_H;
    if(mouseY>=gridTop && mouseY<gridTop+DRUMS.length*cellH &&
       mouseX>=margin+labelW && mouseX<margin+labelW+seqW){
      DRUMS.forEach((d,ri)=>{
        const ry=gridTop+ri*cellH;
        if(mouseY>=ry&&mouseY<ry+cellH){
          const s=floor((mouseX-(margin+labelW))/cellW);
          if(s>=0&&s<seqSteps) seqGrid[d.id][s]=!seqGrid[d.id][s];
        }
      });
      return;
    }

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

const kbdMap = Object.fromEntries(DRUMS.map(d=>[d.kbd.toLowerCase(),d.id]));

function keyPressed(){
  // Don't hijack events when the steps input is focused
  if(document.activeElement === stepsInput.elt) return;

  if(phase==='ready'){
    const id=kbdMap[key.toLowerCase()];
    if(id){
      triggerDrum(id);
      padHeld[id]=true;
      // If record is armed and sequencer is running, quantize to nearest step
      if(seqRecording && seqPlaying) quantizeToStep(id);
    }
    if(key===' '){seqPlaying?stopSequencer():startSequencer();}
    if(key==='r'||key==='R') resetToIdle();
    if(key==='u'||key==='U') uploadEl.elt.click();
  }
}
function keyReleased(){
  if(document.activeElement === stepsInput.elt) return;
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

// ── Step count ────────────────────────────────────────────────────────────────

function setStepCount(n){
  const wasPlaying=seqPlaying;
  if(wasPlaying) stopSequencer();
  seqSteps=n;
  DRUMS.forEach(d=>{
    if(seqGrid[d.id].length<n)
      seqGrid[d.id]=[...seqGrid[d.id],...new Array(n-seqGrid[d.id].length).fill(false)];
    else
      seqGrid[d.id]=seqGrid[d.id].slice(0,n);
  });
  seqCurrentStep=0;
  if(wasPlaying) startSequencer();
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
  DRUMS.forEach(d=>{drumCandidates[d.id]=[]; drumIdx[d.id]=0; drumTrimStart[d.id]=0; drumTrimEnd[d.id]=1;});

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
  const cands=drumCandidates[id];
  if(!cands||!cands.length) return;
  const cand=cands[drumIdx[id]];
  if(!cand) return;
  if(audioCtx.state==='suspended') audioCtx.resume();
  const src=audioCtx.createBufferSource();
  src.buffer=cand.buffer;
  src.connect(gainNodes[id]);
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
    seqGrid[d.id]=new Array(seqSteps).fill(false);
  });
  seqCurrentStep=0;
}
