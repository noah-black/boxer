// ── BOXER — All drawing: header, pads, sequencer, overlays, layout ───────────

// ── Background ──────────────────────────────────────────────────────────────

function drawBgGradient() {
  const [h,s,b] = BG;
  const [,,l] = hsbToHsl(h,s,b);
  drawingContext.fillStyle = `hsl(${h},${s}%,${l}%)`;
  drawingContext.fillRect(0, 0, width, height);
}

// ── Layout computation ───────────────────────────────────────────────────────

/** Compute keyboard grid + control panel layout.
 *  Panel on left ~1/3, keys on right ~2/3 of content area. */
function getPadAreaLayout() {
  const PAD_AREA_TOP = HEADER_H + 16; // 8px enclosure padding + 8px clearance from header

  // Sequencer width defines the reference area
  const seqLeft = SEQ_MARGIN;
  const seqRight = cW() - SEQ_MARGIN;
  const seqW = seqRight - seqLeft;
  const eqZoneW = 100;  // inline EQ graph width
  const panelW = CTRL_PANEL_MIN_W + FX_PANEL_EXTRA_W + eqZoneW;

  // Scale keys up 50% ideally, but shrink to fit available space
  const targetKW = Math.round(KEY_W * 1.5);
  const targetKH = Math.round(KEY_H * 1.5);
  // Row 2 extends KEY_ROW2_OFFSET past gridW, so account for full actual width
  const fullKeysW = KEY_ROW2_OFFSET + 8 * (targetKW + KEY_GAP);
  const maxGap = 50;
  const maxGroupW = seqW; // available space
  // Compute how much room keys get after panel + gap
  const keysAvail = maxGroupW - panelW - Math.min(maxGap, 20);
  const maxKeyW = Math.floor((keysAvail - KEY_ROW2_OFFSET - KEY_GAP) / 8 - KEY_GAP);
  const scale = Math.min(1, maxKeyW / targetKW);
  const kw = Math.max(KEY_W, Math.round(targetKW * scale));
  const kh = Math.max(KEY_H, Math.round(targetKH * scale));

  // gridW includes the row2 offset so the comma key fits inside
  const gridW = KEY_ROW2_OFFSET + 8 * (kw + KEY_GAP);
  const keysH = kh * 2 + KEY_GAP * 3;
  const panelH = Math.round((KEY_H * 2 + KEY_GAP * 3) * 1.9);
  const gridH = Math.max(panelH, keysH);

  // Position panel and keys as a group with a capped gap, centered in seqW
  const gap = Math.min(maxGap, Math.max(12, seqW - panelW - gridW));
  const groupW = panelW + gap + gridW;
  const groupLeft = seqLeft + Math.max(0, Math.round((seqW - groupW) / 2));
  const panelX = groupLeft;
  const gridX = groupLeft + panelW + gap;

  const keysOffsetY = Math.round((panelH - keysH) / 2);

  return { gridX, gridY: PAD_AREA_TOP, gridW, gridH, keysOffsetY, panelX, panelY: PAD_AREA_TOP, panelW, panelH, kw, kh };
}

function keyXY(padIndex, layout) {
  const row = padIndex < 8 ? 0 : 1;
  const col = row === 0 ? padIndex : padIndex - 8;
  const offset = row === 1 ? KEY_ROW2_OFFSET : 0;
  const oy = layout.keysOffsetY || 0;
  const kw = layout.kw || KEY_W, kh = layout.kh || KEY_H;
  return {
    x: layout.gridX + offset + col * (kw + KEY_GAP),
    y: layout.gridY + oy + KEY_GAP + row * (kh + KEY_GAP),
  };
}

function slotRowHeight(slot, seqRowHeight) {
  return slot.type === 'melody' ? MELODY_ROW_MAX : seqRowHeight;
}

function totalSeqContentHeight(seqRowHeight) {
  let h = 0;
  slots.forEach(slot => { h += SLOT_HDR_H + getSeqPads(slot).length * slotRowHeight(slot, seqRowHeight) + SLOT_GAP; });
  return h + 96;
}

const MELODY_ROW_MAX = 10; // melody rows are fixed narrow height

function getSeqLayout() {
  const L = getPadAreaLayout();
  const seqTop  = L.gridY + L.gridH + 16; // 8px enclosure padding + 8px clearance below
  const seqW    = cW()-SEQ_MARGIN*2-SEQ_LABEL_W;
  const gridTop = seqTop+SEQ_CTRL_H;
  const available = cH()-gridTop-96; // reserve space for add-slot "+" below last slot
  // Melody rows have fixed height, so subtract their space from available for drum row calculation
  const drumRows = slots.reduce((acc,s) => acc + (s.type !== 'melody' ? getSeqPads(s).length : 0), 0);
  const melodyPixels = slots.reduce((acc,s) => acc + (s.type === 'melody' ? getSeqPads(s).length * MELODY_ROW_MAX : 0), 0);
  const totalGridRows = drumRows; // only drum rows are flexible
  const N = slots.length;
  const SLOT_HDR_MIN = 22;
  // First compute row height assuming header = row height
  const uniformH = constrain(floor((available - (N-1)*SLOT_GAP) / Math.max(1, totalGridRows + N)), SEQ_ROW_H_MIN, SEQ_ROW_H_MAX);
  // Header has its own minimum to accommodate slider controls
  SLOT_HDR_H = Math.max(uniformH, SLOT_HDR_MIN);
  // Recompute row height with the actual header space and fixed melody pixels subtracted
  const headerTotal = N * SLOT_HDR_H + (N-1) * SLOT_GAP;
  const seqRowHeight = constrain(floor((available - headerTotal - melodyPixels) / Math.max(1, totalGridRows)), SEQ_ROW_H_MIN, SEQ_ROW_H_MAX);
  return { seqTop, seqW, seqRowHeight, ctrlY: seqTop, gridTop, gridLeft: SEQ_MARGIN+SEQ_LABEL_W };
}

function getSlotGridTop(slotIndex, gridTop, seqRowHeight) {
  let y = gridTop;
  for (let i = 0; i < slotIndex; i++) {
    const slot = slots[i], numRows = getSeqPads(slot).length;
    y += SLOT_HDR_H + numRows*slotRowHeight(slot, seqRowHeight) + SLOT_GAP;
  }
  return y + SLOT_HDR_H;
}

function getSlotHeaderY(slotIndex, gridTop, seqRowHeight) {
  return getSlotGridTop(slotIndex, gridTop, seqRowHeight) - SLOT_HDR_H;
}



/** Compute slot header control positions. Sliders compress by up to 20% when space is tight. */
function slotHeaderLayout(headerRight, nMeasures, slotType) {
  nMeasures = nMeasures || 1;
  const btnH=14;
  const capsuleCellW=btnH, capsuleCells=2, capsuleW=capsuleCellW*capsuleCells;
  const removeW=14, removeGap=5;
  const removeX=headerRight-5-removeW;
  const capsuleX=removeX-removeGap-capsuleW;
  // Standalone CLR and DUP buttons to the left of S/M capsule
  const standaloneW=24, standaloneGap=4;
  const dupX=capsuleX-standaloneGap-standaloneW;
  const clrX=dupX-standaloneGap-standaloneW;

  // Step stepper: [- NN +] compact widget, fixed width
  const stepW=36, stepH=12;
  const stepX=clrX-8-stepW;

  // Measure tabs: right after hamburger (+ type icon for melody)
  const measureTabW=12, measurePlusW=12;
  const measureTabsX=SEQ_MARGIN + (slotType === 'melody' ? 30 : 22);
  const measureTabsW=nMeasures*measureTabW+(nMeasures<MAX_MEASURES?measurePlusW:0);

  // Left edge of slider zone: after measure tabs + filename area (min space for filename)
  const leftZone=measureTabsX+measureTabsW+6;

  // Available space for sliders: from leftZone to stepX-8
  const sliderZoneEnd=stepX-8;
  // 3 sliders: VOL 35, SWING 28, RAND 28; gap 12 each
  const fullW=35+12+28+12+28; // 115
  const minW=Math.round(fullW*0.8);
  const available=sliderZoneEnd-leftZone;
  const usedW=constrain(available, minW, fullW);
  const cf=usedW/fullW;

  const volSliderW=Math.round(35*cf);
  const swingSliderW=Math.round(28*cf), humSliderW=Math.round(28*cf);
  const gap=Math.round(12*cf);

  const volSliderX=sliderZoneEnd-volSliderW;
  const swingSliderX=volSliderX-gap-swingSliderW;
  const humSliderX=swingSliderX-gap-humSliderW;

  return {
    btnH, capsuleX, capsuleW, capsuleCellW,
    clrX, dupX, standaloneW,
    removeX, removeW,
    volSliderX, volSliderW,
    swingSliderX, swingSliderW, humSliderX, humSliderW,
    stepX, stepW, stepH,
    measureTabW, measurePlusW, measureTabsX, measureTabsW,
  };
}

// ── Element positioning ──────────────────────────────────────────────────────

function positionSharedInput() {
  if (!_sharedInputEl) return;
  const slot = currentSlot();
  const show = (phase==='ready'||phase==='recording') && slotHasAudio(slot) && !slot.analyzing && !slot.reuploadPending && selectedPadId && slot.type !== 'melody';
  if (!show) { _sharedInputEl.style.display='none'; return; }
  const L = getPadAreaLayout();
  const finalized = !!slot.padFinalized[selectedPadId];
  const C = panelControlLayout(L);
  const inputY = C.ctrlY;
  const inputH = C.inputRowH - 4;
  // Match horizontal icon layout from drawControlPanel — all 6 icons right-aligned
  const iconW = 14, iconsPadR = 4;
  const iconsTotal = 6 * iconW;
  const iconsLeftEdge = L.panelX + L.panelW - iconsPadR - iconsTotal;
  const inputX = C.rowX;
  const inputW = iconsLeftEdge - inputX - 2;
  _sharedInputEl.style.display = 'block';
  _sharedInputEl.style.left = (inputX * UI_SCALE) + 'px';
  _sharedInputEl.style.top = (inputY * UI_SCALE) + 'px';
  _sharedInputEl.style.width = (inputW * UI_SCALE) + 'px';
  _sharedInputEl.style.height = (inputH * UI_SCALE) + 'px';
  _sharedInputEl.style.fontSize = (13 * UI_SCALE) + 'px';
  _sharedInputEl.style.textAlign = 'left';
  _sharedInputEl.style.background = finalized ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.55)';
  if (finalized) {
    _sharedInputEl.style.border = '1px solid rgba(0,0,0,0.08)';
    _sharedInputEl.style.borderRadius = '3px';
    _sharedInputEl.style.pointerEvents = 'none';
  } else {
    _sharedInputEl.style.border = '1px solid rgba(0,0,0,0.2)';
    _sharedInputEl.style.borderRadius = '3px';
    _sharedInputEl.style.pointerEvents = 'auto';
  }
  _sharedInputEl.style.padding = '1px 4px';
  _sharedInputEl.readOnly = finalized;
  // Blur if readonly to prevent stealing keyboard focus
  if (finalized && document.activeElement === _sharedInputEl) _sharedInputEl.blur();
}

function updateElementVisibility() {
  positionSharedInput();
}

// ── Main draw loop ───────────────────────────────────────────────────────────

function draw() {
  if (!_fontsReady) { drawBgGradient(); return; }
  cursor(drag && drag.type==='trimSlide' ? 'grabbing' : ARROW);
  SEQ_MARGIN = min(SEQ_MARGIN_MAX, max(8, (cW() - CONTENT_MIN_W) / 2));
  drawBgGradient();
  push(); scale(UI_SCALE);
  drawHeader(); spinAngle += 0.04;
  drawPadAreaEnclosure(); drawKeyGrid(); drawControlPanel(); drawSequencer();
  if      (phase === 'recording')  drawRecordingOverlay();
  else if (phase === 'trimming')   drawTrimOverlay();
  else if (phase === 'error')      drawErrorOverlay();
  pop();
}

// ── Header ───────────────────────────────────────────────────────────────────

function drawHeader() {
  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(0, 0, cW(), HEADER_H);
  if (logoImg) {
    const logoH = HEADER_H - 8;
    const logoW = logoImg.width * (logoH / logoImg.height);
    image(logoImg, 16, (HEADER_H - logoH) / 2, logoW, logoH);
  }
  // Save/Load buttons — flush right
  const btnW = 26, btnH = 28, btnGap = 6;
  const loadBtnX = cW() - btnW - 4;
  const saveBtnX = loadBtnX - btnW - btnGap;
  const btnY = (HEADER_H - btnH) / 2;
  const hoverSave = mX()>saveBtnX&&mX()<saveBtnX+btnW&&mY()>btnY&&mY()<btnY+btnH;
  const hoverLoad = mX()>loadBtnX&&mX()<loadBtnX+btnW&&mY()>btnY&&mY()<btnY+btnH;

  // Save icon (filled circle + label)
  push();
  const sx=saveBtnX+btnW/2, sy=btnY+8;
  fill(...(hoverSave ? ACCENT : INK_DIM)); noStroke();
  circle(sx, sy, 8);
  textSize(8); textAlign(CENTER, TOP);
  text('save', sx, sy+7);
  pop();

  // Load icon (hollow circle + label)
  push();
  const lx=loadBtnX+btnW/2, ly=btnY+8;
  noFill(); strokeWeight(1.5); stroke(...(hoverLoad ? ACCENT : INK_DIM));
  circle(lx, ly, 8);
  fill(...(hoverLoad ? ACCENT : INK_DIM)); noStroke();
  textSize(8); textAlign(CENTER, TOP);
  text('load', lx, ly+7);
  pop();
  if (hoverSave||hoverLoad) cursor(HAND);
}

function headerBtnRects() {
  const btnW = 26, btnH = 28, btnGap = 6;
  const loadBtnX = cW() - btnW - 4;
  const saveBtnX = loadBtnX - btnW - btnGap;
  const btnY = (HEADER_H - btnH) / 2;
  return { saveBtnX, loadBtnX, btnY, btnW, btnH };
}

// ── Plus helper (reused by add-slot button) ──────────────────────────────────

const PLUS_FONT_SIZE = 64;

function _drawPlus(centerX, centerY, hov) {
  drawingContext.save();
  drawingContext.font = PLUS_FONT_SIZE+"px '"+_debugFont+"', monospace";
  drawingContext.textAlign = 'center'; drawingContext.textBaseline = 'middle';
  drawingContext.strokeStyle = 'rgba(20,17,10,0.35)';
  drawingContext.lineWidth = 1.5; drawingContext.lineJoin = 'round';
  drawingContext.strokeText('+', centerX, centerY);
  drawingContext.fillStyle = hov ? 'rgba(0,0,0,0.48)' : 'rgba(0,0,0,0.28)';
  drawingContext.fillText('+', centerX, centerY);
  drawingContext.restore();
  if (hov) cursor(HAND);
}

// ── Empty-slot prompt (record / upload icons) ───────────────────────────────

function drawEmptySlotPrompt() {
  const L = getPadAreaLayout();
  const cx = cW() / 2;
  const cy = L.gridY + L.gridH / 2;
  const recCx=cx-50, upCx=cx+50;
  const recR=20;
  const recHov=dist(mX(),mY(),recCx,cy)<recR;
  const upHov=mX()>upCx-20&&mX()<upCx+20&&mY()>cy-20&&mY()<cy+20;

  fill(recHov?[0,75,78]:RED); stroke(...INK); strokeWeight(1);
  circle(recCx,cy,recR*2);
  fill(...PANEL); noStroke(); circle(recCx,cy,recR*0.6);
  fill(recHov?[0,75,78]:RED); noStroke(); circle(recCx,cy,recR*0.5);

  noFill(); stroke(upHov?ACCENT:INK); strokeWeight(1.5);
  rect(upCx-18,cy-18,36,36,5);
  line(upCx,cy+8,upCx,cy-6);
  line(upCx-6,cy-1,upCx,cy-8); line(upCx+6,cy-1,upCx,cy-8);
  line(upCx-10,cy+8,upCx-10,cy+11); line(upCx-10,cy+11,upCx+10,cy+11); line(upCx+10,cy+11,upCx+10,cy+8);

  fill(...INK_DIM); noStroke(); textSize(11); textAlign(CENTER,TOP);
  text('record',recCx,cy+recR+4);
  text('upload',upCx,cy+22);

  if (recHov||upHov) cursor(HAND);
}

// ── Analyzing animation (in pad area) ───────────────────────────────────────

function drawAnalyzingAnimation() {
  const L = getPadAreaLayout();
  const cx = cW() / 2;
  const cy = L.gridY + L.gridH / 2;
  const ticks=12;
  for (let i=0;i<ticks;i++) {
    const angle=(i/ticks)*TWO_PI+spinAngle;
    const alpha=pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*70+5;
    stroke(...ACCENT,alpha); strokeWeight(2);
    line(cx+cos(angle)*14,cy+sin(angle)*14,cx+cos(angle)*22,cy+sin(angle)*22);
  }
  fill(...ACCENT); noStroke(); circle(cx,cy,4);
  fill(...INK_DIM); textSize(8); textAlign(CENTER,TOP);
  text('analyzing\u2026',cx,cy+28);
  const slot=currentSlot();
  if (slot.fileName) { fill(...INK_FAINT); textSize(7); text(slot.fileName,cx,cy+40); }
}

// ── Keyboard grid ───────────────────────────────────────────────────────────


function drawKey(def, x, y, isSelected, slot, seqActive, ho, kw, kh) {
  kw = kw || KEY_W; kh = kh || KEY_H;
  const h = (def.hue + (ho||0)) % 360;
  const ago = millis()-(padFlash[def.id]||-9999);
  const flash = max(0, 1-ago/110);
  const hasCand = slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length>0;
  const hov = mX()>x && mX()<x+kw && mY()>y && mY()<y+kh;
  const label = (slot.padText[def.id] || '').trim();
  const displayKey = padDisplayKey(def.id);

  // Background
  if (flash > 0) {
    fill(h, 30+flash*30, 80+flash*15);
  } else if (seqActive) {
    fill(h, 20, 90);
  } else if (isSelected) {
    fill(h, hasCand?25:12, hasCand?88:94);
  } else if (hov) {
    fill(h, 8, 96);
  } else {
    fill(hasCand ? [h, 5, 98] : [...BG, 40]);
  }
  stroke(seqActive ? [h, 50, 60] : (isSelected ? [h, 35, 55] : INK_FAINT));
  strokeWeight(seqActive ? 2 : (isSelected ? 1.5 : 0.5));
  rect(x, y, kw, kh, 4);

  // Key letter
  noStroke();
  fill(isSelected ? [h, 40, 40] : (hasCand ? INK_DIM : INK_FAINT));
  textSize(12); textAlign(CENTER, CENTER);
  text(displayKey, x+kw/2, y + (label ? kh/2-4 : kh/2));

  // Truncated label below letter
  if (label) {
    fill(...INK_FAINT); textSize(6); textAlign(CENTER, CENTER);
    let truncated = label;
    while (truncated.length > 1 && textWidth(truncated) > kw-14) truncated = truncated.slice(0,-1);
    if (truncated !== label) truncated += '\u2026';
    text(truncated, x+kw/2, y+kh/2+7);
  }

  if (hov) cursor(HAND);
}

function drawPadAreaEnclosure() {
  const L = getPadAreaLayout();
  const slot = currentSlot();
  if ((!slotHasAudio(slot) || slot.reuploadPending) && !slot.analyzing) return;
  if (slot.analyzing) return;
  // Enclosing rounded rectangle spanning panel + keyboard
  const pad = 8;
  const left = Math.min(L.panelX, L.gridX) - pad;
  const right = Math.max(L.panelX + L.panelW, L.gridX + L.gridW) + pad;
  const top = L.gridY - pad;
  const bot = L.gridY + L.gridH + pad;
  fill(...PANEL);
  stroke(...INK); strokeWeight(1);
  rect(left, top, right - left, bot - top, CORNER_RADIUS);
}

// ── Melody keyboard (reuses 2×8 pad grid with piano coloring) ───────────────

// Maps pad grid position (0-15) to melody key role.
// Row 0 (home row): A S D F G H J K → positions 0-7
// Row 1 (bottom):   Z X C V B N M , → positions 8-15
const MELODY_PAD_MAP = [
  // Home row: A(unused) S(C#) D(D#) F(unused) G(F#) H(G#) J(A#) K(unused)
  { type: 'unused', key: 'A' },
  { type: 'black',  key: 'S', semitone: 1 },
  { type: 'black',  key: 'D', semitone: 3 },
  { type: 'unused', key: 'F' },
  { type: 'black',  key: 'G', semitone: 6 },
  { type: 'black',  key: 'H', semitone: 8 },
  { type: 'black',  key: 'J', semitone: 10 },
  { type: 'unused', key: 'K' },
  // Bottom row: Z(C) X(D) C(E) V(F) B(G) N(A) M(B) ,(C+)
  { type: 'white', key: 'Z', semitone: 0 },
  { type: 'white', key: 'X', semitone: 2 },
  { type: 'white', key: 'C', semitone: 4 },
  { type: 'white', key: 'V', semitone: 5 },
  { type: 'white', key: 'B', semitone: 7 },
  { type: 'white', key: 'N', semitone: 9 },
  { type: 'white', key: 'M', semitone: 11 },
  { type: 'white', key: ',', semitone: 12 },
];

function drawMelodyKeyboard(L, slot) {
  // Auto-select the single sound pad
  if (selectedPadId !== slot.melodySoundPadId) {
    selectedPadId = slot.melodySoundPadId;
    syncSharedInput(); positionSharedInput();
  }

  const kw = L.kw || KEY_W, kh = L.kh || KEY_H;
  const ho = slot.hueOffset || 0;

  // Draw each pad position using existing grid layout
  for (let i = 0; i < 16; i++) {
    const mp = MELODY_PAD_MAP[i];
    const {x, y} = keyXY(i, L);
    const hov = mX()>x && mX()<x+kw && mY()>y && mY()<y+kh;

    let noteId = null, flashFrac = 0, held = false;
    if (mp.type !== 'unused') {
      const noteIdx = slot.melodyOctave * 12 + mp.semitone;
      noteId = 'm' + noteIdx;
      const flashTime = padFlash[noteId];
      if (flashTime) {
        const elapsed = millis() - flashTime;
        const dur = _padFlashDur[noteId] || 150;
        flashFrac = max(0, 1 - elapsed / dur);
      }
      held = padHeld[noteId];
    }

    push();
    if (mp.type === 'unused') {
      fill(...BG, 40);
      stroke(...INK_FAINT, 30); strokeWeight(0.5);
    } else if (mp.type === 'black') {
      // Black keys flash white
      if (held) fill(0, 0, 85);
      else if (flashFrac > 0) fill(0, 0, lerp(20, 85, flashFrac));
      else if (hov) fill(210, 8, 30);
      else fill(210, 8, 20);
      stroke(...INK_FAINT); strokeWeight(0.5);
    } else {
      // White keys flash dark
      if (held) fill(210, 10, 25);
      else if (flashFrac > 0) fill(210, lerp(0, 10, flashFrac), lerp(100, 25, flashFrac));
      else if (hov) fill(0, 0, 98);
      else fill(0, 0, 100);
      stroke(...INK_FAINT); strokeWeight(0.5);
    }
    rect(x, y, kw, kh, 4);

    // Key letter — invert text color during flash
    noStroke();
    if (mp.type === 'unused') fill(...INK_FAINT, 30);
    else if (mp.type === 'black') {
      if (held || flashFrac > 0.3) fill(210, 8, 20);
      else fill(0, 0, 55);
    } else {
      if (held || flashFrac > 0.3) fill(0, 0, 85);
      else fill(...INK_DIM);
    }
    textSize(12); textAlign(CENTER, CENTER);
    text(mp.key, x+kw/2, y+kh/2);
    pop();
    if (hov && mp.type !== 'unused') cursor(HAND);
  }

  // Octave selector: 4 small buttons below bottom-row keys, within pad area height
  const octBtnW = 20, octBtnH = 11, octGap = 3;
  const octLabels = ['-2', '-1', '0', '+1'];
  const totalOctW = octLabels.length * octBtnW + (octLabels.length - 1) * octGap;
  // Position below the bottom key row, right-aligned within grid
  const botRowY = (L.keysOffsetY || 0) + KEY_GAP + (kh + KEY_GAP);
  const octY = L.gridY + botRowY + kh + 3;
  const octX = L.gridX + KEY_ROW2_OFFSET + 8*(kw+KEY_GAP) - KEY_GAP - totalOctW;

  push();
  textAlign(CENTER, CENTER); textSize(6);
  octLabels.forEach((lbl, i) => {
    const bx = octX + i * (octBtnW + octGap);
    const isActive = i === slot.melodyOctave;
    const bHov = mX()>bx && mX()<bx+octBtnW && mY()>octY && mY()<octY+octBtnH;
    if (isActive) {
      fill(...ACCENT); stroke(...ACCENT); strokeWeight(0.5);
    } else {
      fill(bHov ? [0, 0, 90] : [0, 0, 93]); stroke(...INK_FAINT); strokeWeight(0.5);
    }
    rect(bx, octY, octBtnW, octBtnH, 3);
    fill(isActive ? 360 : INK[0], isActive ? 0 : INK[1], isActive ? 100 : INK[2]);
    noStroke();
    text(lbl, bx + octBtnW/2, octY + octBtnH/2);
    if (bHov) cursor(HAND);
  });
  pop();
}

function getMelodyOctaveLayout(L) {
  const kw = L.kw || KEY_W, kh = L.kh || KEY_H;
  const octBtnW = 20, octBtnH = 11, octGap = 3;
  const totalOctW = 4 * octBtnW + 3 * octGap;
  const botRowY = (L.keysOffsetY || 0) + KEY_GAP + (kh + KEY_GAP);
  const octY = L.gridY + botRowY + kh + 3;
  const octX = L.gridX + KEY_ROW2_OFFSET + 8*(kw+KEY_GAP) - KEY_GAP - totalOctW;
  return { octX, octY, octBtnW, octBtnH, octGap };
}

function drawKeyGrid() {
  const L = getPadAreaLayout();
  const slot = currentSlot();

  if ((!slotHasAudio(slot) || slot.reuploadPending) && !slot.analyzing) { drawEmptySlotPrompt(); return; }
  if (slot.analyzing) { drawAnalyzingAnimation(); return; }

  if (slot.type === 'melody') { drawMelodyKeyboard(L, slot); return; }

  // Auto-select first pad if none selected
  if (!selectedPadId || !slot.activePadIds.includes(selectedPadId)) {
    const newId = slot.activePadIds.length > 0 ? slot.activePadIds[0] : null;
    if (newId !== selectedPadId) { selectedPadId = newId; syncSharedInput(); positionSharedInput(); }
  }

  const isDragReorder = drag && drag.type==='reorderPad' && drag.triggered;
  const dragId = isDragReorder ? drag.padId : null;
  const ho = slot.hueOffset || 0;

  // Determine which pads the sequencer is currently triggering
  const seqActiveIds = new Set();
  if (seqPlaying) {
    const slotFrac = slotLoopFraction(selectedSlotIdx);
    const grid = slot.grid;
    const mCells = grid.measures[slotFrac.measureIdx % grid.measures.length].cells;
    const stepPositions = computeStepPositions(grid, slot);
    const frac = slotFrac.fraction;
    for (let s = 0; s < grid.steps; s++) {
      if (frac >= stepPositions[s] && frac < stepPositions[s+1]) {
        slot.activePadIds.forEach(id => {
          if (mCells[id] && mCells[id][s]) seqActiveIds.add(id);
        });
        break;
      }
    }
  }

  slot.activePadIds.forEach((id, i) => {
    const def = getPadDef(id);
    const {x, y} = keyXY(i, L);
    if (id === dragId) {
      push(); drawingContext.globalAlpha = 0.25;
      drawKey(def, x, y, id===selectedPadId, slot, seqActiveIds.has(id), ho, L.kw, L.kh);
      pop();
    } else {
      drawKey(def, x, y, id===selectedPadId, slot, seqActiveIds.has(id), ho, L.kw, L.kh);
    }
  });

  // Drag reorder insertion line
  if (isDragReorder) {
    const dragTarget = keyReorderTargetIdx(drag.currentX, drag.currentY, L, slot.activePadIds.length);
    if (dragTarget >= 0) {
      const {x: ix, y: iy} = keyXY(dragTarget, L);
      push(); stroke(205, 45, 62); strokeWeight(2); noFill();
      line(ix-1, iy+2, ix-1, iy+(L.kh||KEY_H)-2);
      pop();
    }
    // Ghost key at cursor
    const def = getPadDef(dragId);
    const ghostX = drag.currentX-(L.kw||KEY_W)/2, ghostY = drag.currentY-(L.kh||KEY_H)/2;
    push(); drawingContext.globalAlpha = 0.6;
    drawKey(def, ghostX, ghostY, false, slot, false, ho, L.kw, L.kh);
    pop();
  }

}

// ── Control panel ───────────────────────────────────────────────────────────

function drawControlPanel() {
  const L = getPadAreaLayout();
  const slot = currentSlot();

  // Don't show control panel when slot has no audio or is analyzing
  if (!slotHasAudio(slot) || slot.reuploadPending || slot.analyzing) return;

  // Panel background — subtly tinted by selected pad's hue
  const ho = slot.hueOffset || 0;
  const def = selectedPadId ? getPadDef(selectedPadId) : null;
  const hasMappedPad = def && (slot.padMode[def.id] || (slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length>0));
  if (hasMappedPad) {
    fill((def.hue + ho) % 360, CTRL_PANEL[1], CTRL_PANEL[2]);
  } else {
    fill(...CTRL_PANEL);
  }
  stroke(...INK); strokeWeight(1);
  rect(L.panelX, L.panelY, L.panelW, L.panelH, CORNER_RADIUS);

  if (!selectedPadId || !slot.activePadIds.includes(selectedPadId)) {
    fill(...INK_FAINT); noStroke(); textSize(8); textAlign(CENTER, CENTER);
    text('select a pad', L.panelX+L.panelW/2, L.panelY+L.panelH/2);
    return;
  }

  if (!def) return;
  // Apply slot hue offset so control panel colors match sequencer
  const odef = { ...def, hue: (def.hue + ho) % 360 };
  const hasCandidates = slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length>0;
  const cands = slot.drumCandidates[def.id] || [];
  const isMapped = !!(slot.padMode[def.id] || hasCandidates);

  // Trim bar at top of panel
  const trimX = L.panelX+1, trimY = L.panelY+1, trimW = L.panelW-2;
  if (isMapped) drawPanelTrimBar(odef, trimX, trimY, trimW, slot);
  // Divider between waveform and controls
  stroke(...INK); strokeWeight(1);
  line(L.panelX, trimY + TRIM_H, L.panelX + L.panelW, trimY + TRIM_H);

  // Below trim bar: controls area
  const C = panelControlLayout(L);

  // Slider enclosure
  fill(...SEQ_CELL); stroke(...(isMapped ? INK_FAINT : [...INK_FAINT, 40])); strokeWeight(0.5);
  rect(C.sliderBoxX, C.sliderBoxY, C.sliderBoxW, C.sliderBoxH, 4);

  // Volume slider
  drawPanelSlider(odef, C.sliderX, C.volSliderY, C.sliderW, 'vol', slot.drumVolumes[def.id]??0.8, 0, 1, hasCandidates, !isMapped);

  // Chain link icon + connecting lines between pitch and speed
  const linked = slot.drumPitchSpeedLinked[def.id] ?? true;
  drawChainLinkWithLines(C.chainX, C.chainY, C.pitchSliderY, C.speedSliderY, C.chainX + 5, linked, odef, !isMapped);

  // Pitch slider
  drawPanelSlider(odef, C.sliderX, C.pitchSliderY, C.sliderW, 'pitch', slot.drumPitch[def.id]??0, -12, 12, hasCandidates, !isMapped);

  // Fine tune slider
  drawPanelSlider(odef, C.sliderX, C.fineSliderY, C.sliderW, 'fine', slot.drumFineTune[def.id]??0, -50, 50, hasCandidates, !isMapped);

  // Speed slider
  const speedVal = linked ? Math.pow(2, ((slot.drumPitch[def.id]??0)+(slot.drumFineTune[def.id]??0)/100)/12) : (slot.drumSpeed[def.id]??1.0);
  drawPanelSlider(odef, C.sliderX, C.speedSliderY, C.sliderW, 'speed', speedVal, 0.5, 2.0, hasCandidates, !isMapped);

  // Effects box (reverse toggle + reverb/delay knobs)
  drawEffectsBox(odef, C, slot, def.id, !isMapped);

  // Text input area + mode icons — first row spans full panel width
  const isMelody = slot.type === 'melody';
  const finalized = isMelody ? true : !!slot.padFinalized[def.id];
  const inputY = C.ctrlY;
  const inputH = C.inputRowH - 4;
  const hasTranscript = slot.transcriptLoaded && slot.lyricsTranscript.length > 0;
  const hasResults = slot.analyzeResults && Object.keys(slot.analyzeResults).length > 0;
  const hasClassic = hasResults && availablePrototypes.length > 0;
  const hasSource = !!slot.sourceBuffer;

  // Horizontal icon layout: all 6 icons right-aligned, textbox fills remaining space
  const iconW = 14;
  const iconCy = inputY + inputH / 2;
  const iconsTotal = 6 * iconW;  // no gaps between icons
  const iconsPadR = 4;  // padding from right panel edge
  const iconsRightEdge = L.panelX + L.panelW - iconsPadR;
  const iconsLeftEdge = iconsRightEdge - iconsTotal;
  const inputX = C.rowX;
  const inputW = iconsLeftEdge - inputX - 2;
  const padText = (slot.padText[def.id] || '').trim();

  // Check if there are unmapped pads available (for duplicate icon)
  const unmappedPadAvailable = slot.activePadIds.some(pid => {
    return pid !== def.id && !slot.padMode[pid] && !(slot.drumCandidates[pid] && slot.drumCandidates[pid].length > 0);
  });

  // For melody: draw label in textbox area on canvas (DOM input is hidden)
  if (isMelody) {
    const label = padText || slot.fileName || '';
    fill(...SEQ_CELL); stroke(...INK_FAINT); strokeWeight(0.5);
    rect(inputX, inputY, inputW, inputH, 3);
    fill(...INK_DIM); noStroke(); textSize(6.5); textAlign(LEFT, CENTER);
    text(truncateMiddle(label, inputW - 8), inputX + 4, inputY + inputH / 2);
  }

  // Draw icons left to right, right-aligned
  let iconCurX = iconsLeftEdge;

  // Classic (drum) icon — grayed when no results/prototypes
  {
    const cx = iconCurX + iconW / 2;
    const enabled = hasClassic;
    const classicOpen = slot.padMenuOpen[def.id] === 'classic';
    const cHov = enabled && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2;
    const col = cHov||classicOpen ? ACCENT : (enabled ? INK_FAINT : [...INK_FAINT, 30]);
    push(); translate(cx, iconCy);
    const rw=5, rh=2, bodyH=5;
    fill(col); noStroke();
    ellipse(0, bodyH/2, rw*2, rh*2);
    rect(-rw, -bodyH/2, rw*2, bodyH);
    drawingContext.save();
    drawingContext.globalCompositeOperation = 'destination-out';
    fill(0,0,0,100); noStroke();
    ellipse(0, -bodyH/2, rw*2-1, rh*2-0.5);
    drawingContext.restore();
    noFill(); stroke(col); strokeWeight(0.7);
    ellipse(0, -bodyH/2, rw*2, rh*2);
    noFill(); strokeWeight(0.9);
    line(1, -bodyH/2, rw+3, -bodyH/2-4);
    fill(col); noStroke();
    circle(1, -bodyH/2, 1.5);
    pop();
    if (cHov) cursor(HAND);
    iconCurX += iconW;
  }

  // Transcript icon — grayed when no transcript
  {
    const cx = iconCurX + iconW / 2;
    const enabled = hasTranscript;
    const tHov = enabled && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2;
    const col = tHov ? ACCENT : (enabled ? INK_FAINT : [...INK_FAINT, 30]);
    push(); translate(cx, iconCy);
    noFill(); stroke(col); strokeWeight(0.8); strokeJoin(ROUND);
    const pw=9, ph=10, fold=2.5;
    beginShape();
    vertex(-pw/2, -ph/2); vertex(pw/2-fold, -ph/2); vertex(pw/2, -ph/2+fold);
    vertex(pw/2, ph/2); vertex(-pw/2, ph/2);
    endShape(CLOSE);
    line(pw/2-fold, -ph/2, pw/2-fold, -ph/2+fold);
    line(pw/2-fold, -ph/2+fold, pw/2, -ph/2+fold);
    strokeWeight(0.6);
    line(-pw/2+1.5, -ph/2+3.5, pw/2-fold-1, -ph/2+3.5);
    line(-pw/2+1.5, -ph/2+5.5, pw/2-2, -ph/2+5.5);
    line(-pw/2+1.5, -ph/2+7.5, pw/2-3, -ph/2+7.5);
    pop();
    if (tHov) cursor(HAND);
    iconCurX += iconW;
  }

  // Freestyle [ ] icon — grayed when no source
  {
    const cx = iconCurX + iconW / 2;
    const enabled = hasSource;
    const fHov = enabled && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2;
    const col = fHov ? ACCENT : (enabled ? INK_FAINT : [...INK_FAINT, 30]);
    push(); translate(cx, iconCy);
    noFill(); stroke(col); strokeWeight(1.0); strokeCap(SQUARE);
    const bw = 3.5, bh = 6;
    line(-bw - 1, -bh, -1, -bh);
    line(-bw - 1, -bh, -bw - 1, bh);
    line(-bw - 1, bh, -1, bh);
    line(1, -bh, bw + 1, -bh);
    line(bw + 1, -bh, bw + 1, bh);
    line(1, bh, bw + 1, bh);
    pop();
    if (fHov) cursor(HAND);
    iconCurX += iconW;
  }

  // Cycle icon (↻) with i/N below — grayed when <= 1 candidate
  {
    const cx = iconCurX + iconW / 2;
    const enabled = cands.length > 1;
    const swpHov = enabled && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2;
    const col = swpHov ? ACCENT : (enabled ? INK_FAINT : [...INK_FAINT, 30]);
    fill(col); noStroke();
    textSize(9); textAlign(CENTER, CENTER);
    text('\u21bb', cx, iconCy - 3);
    if (enabled) {
      const idx = (slot.drumIdx[def.id]||0)+1;
      textSize(4); textAlign(CENTER, CENTER);
      fill(col);
      text(idx+'/'+cands.length, cx, iconCy + 6);
    }
    if (swpHov) cursor(HAND);
    iconCurX += iconW;
  }

  // Duplicate icon — two overlapping rectangles with + — grayed when no unmapped pad or not mapped
  {
    const cx = iconCurX + iconW / 2;
    const enabled = !isMelody && isMapped && unmappedPadAvailable;
    const dHov = enabled && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2;
    const col = dHov ? ACCENT : (enabled ? INK_FAINT : [...INK_FAINT, 30]);
    push(); translate(cx, iconCy);
    noFill(); stroke(col); strokeWeight(0.8); strokeJoin(ROUND);
    const rSz = 6, off = 2.5;
    // Back rectangle (offset up-right)
    rect(-rSz/2 + off, -rSz/2 - off, rSz, rSz, 1);
    // Front rectangle
    rect(-rSz/2 - off/2, -rSz/2 + off/2, rSz, rSz, 1);
    // Plus in front rectangle
    strokeWeight(1.0);
    const pSz = 2;
    const pcx = -off/2, pcy = off/2;
    line(pcx - pSz, pcy, pcx + pSz, pcy);
    line(pcx, pcy - pSz, pcx, pcy + pSz);
    pop();
    if (dHov) cursor(HAND);
    iconCurX += iconW;
  }

  // Trash icon — grayed when pad is unmapped
  {
    const cx = iconCurX + iconW / 2;
    const enabled = !isMelody && isMapped;
    const tHov = enabled && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2;
    const col = tHov ? ACCENT : (enabled ? INK_FAINT : [...INK_FAINT, 30]);
    push(); translate(cx, iconCy);
    noFill(); stroke(col); strokeWeight(0.8); strokeJoin(ROUND);
    // Lid
    const tw = 8, th = 9, lidH = 2, handleW = 3;
    line(-tw/2, -th/2 + lidH, tw/2, -th/2 + lidH);  // lid bottom
    line(-handleW/2, -th/2 + lidH, -handleW/2, -th/2);  // handle left
    line(-handleW/2, -th/2, handleW/2, -th/2);  // handle top
    line(handleW/2, -th/2, handleW/2, -th/2 + lidH);  // handle right
    // Body (slight taper)
    const bodyTop = -th/2 + lidH + 0.5;
    const bodyBot = th/2;
    const topW = tw/2 - 0.5, botW = tw/2 - 1.5;
    line(-topW, bodyTop, -botW, bodyBot);
    line(topW, bodyTop, botW, bodyBot);
    line(-botW, bodyBot, botW, bodyBot);
    // Vertical lines inside
    strokeWeight(0.5);
    line(-1.5, bodyTop + 1.5, -1.5, bodyBot - 1);
    line(0, bodyTop + 1.5, 0, bodyBot - 1);
    line(1.5, bodyTop + 1.5, 1.5, bodyBot - 1);
    pop();
    if (tHov) cursor(HAND);
    iconCurX += iconW;
  }

  // X inside the text input (right edge) when finalized — clears text (not shown for melody)
  if (!isMelody && finalized && padText) {
    const xX = inputX + inputW - 10;
    const xY = inputY + inputH/2;
    const xHov = dist(mX(), mY(), xX, xY) < 7;
    push(); strokeCap(ROUND); noFill();
    stroke(xHov ? RED : INK_FAINT); strokeWeight(0.8);
    const s = 2.5;
    line(xX-s, xY-s, xX+s, xY+s);
    line(xX+s, xY-s, xX-s, xY+s);
    pop();
    if (xHov) cursor(HAND);
  }

  // Divider line between text/icon row and sliders/EQ row
  stroke(...INK_FAINT); strokeWeight(0.5);
  line(L.panelX + 4, C.dividerY, L.panelX + L.panelW - 4, C.dividerY);

  // Inline EQ graph — always shown, grayed when unmapped
  drawInlineEQ(odef, C, slot, def.id, !isMapped);

  // Classic sub-menu: rendered last so it paints on top of other controls
  if (hasClassic && slot.padMenuOpen[def.id] === 'classic') {
    // Position below the classic icon (first icon after textbox)
    const classicIconX = iconsLeftEdge;
    const menuY = inputY + inputH + 3;
    const menuX = classicIconX - 2;
    // Background panel
    textSize(5);
    let totalW = 0;
    for (const p of availablePrototypes) totalW += textWidth(p) + 8 + 2;
    totalW -= 2; // remove last gap
    const menuH = 14;
    fill(...PANEL); stroke(...INK_FAINT); strokeWeight(0.5);
    rect(menuX - 2, menuY - 2, totalW + 4, menuH + 4, 3);
    let px = menuX;
    for (const p of availablePrototypes) {
      const pw = textWidth(p) + 8;
      const pHov = mX()>px && mX()<px+pw && mY()>menuY && mY()<menuY+menuH;
      fill(pHov ? ACCENT : PANEL); stroke(...INK_FAINT); strokeWeight(0.5);
      rect(px, menuY, pw, menuH, 2);
      fill(pHov ? [0,0,100] : INK_DIM); noStroke(); textSize(5); textAlign(CENTER, CENTER);
      text(p, px+pw/2, menuY+menuH/2);
      if (pHov) cursor(HAND);
      px += pw + 2;
    }
  }
}


// ── Inline EQ ─────────────────────────────────────────────────────────────────

function eqFreqToX(freq, gx, gw) {
  return gx + (Math.log(freq/20) / Math.log(1000)) * gw;
}

function eqGainToY(gain, gy, gh) {
  return gy + gh/2 - (gain / EQ_GAIN_RANGE) * (gh/2);
}

function drawInlineEQ(drum, C, slot, padId, dimmed) {
  const eq = slot.drumEQ[padId] || { low: 0, mid: 0, high: 0 };
  const gx = C.eqGraphX, gy = C.eqGraphY, gw = C.eqGraphW, gh = C.eqGraphH;

  // Graph background
  fill(...SEQ_CELL); stroke(dimmed ? [...INK_FAINT, 40] : INK_FAINT); strokeWeight(0.5);
  rect(gx, gy, gw, gh, 2);

  // Grid lines — 0dB center
  stroke(...INK_FAINT, dimmed ? 15 : 30); strokeWeight(0.5);
  line(gx, gy + gh/2, gx + gw, gy + gh/2);
  for (const g of [-12, -6, 6, 12]) {
    const ly = eqGainToY(g, gy, gh);
    line(gx, ly, gx + gw, ly);
  }
  for (const f of [100, 1000, 10000]) {
    const lx = eqFreqToX(f, gx, gw);
    line(lx, gy, lx, gy + gh);
  }

  // Frequency labels
  fill(dimmed ? [...INK_FAINT, 30] : INK_FAINT); noStroke(); textSize(4); textAlign(CENTER, TOP);
  for (const [f, label] of [[100,'100'], [1000,'1k'], [10000,'10k']]) {
    text(label, eqFreqToX(f, gx, gw), gy + gh + 1);
  }
  // Gain labels
  textAlign(RIGHT, CENTER);
  for (const g of [-12, 0, 12]) {
    text((g>0?'+':'')+g, gx - 2, eqGainToY(g, gy, gh));
  }

  // Frequency response curve
  noFill(); stroke(drum.hue, dimmed ? 10 : DRUM_S, dimmed ? 90 : DRUM_B); strokeWeight(1.2);
  beginShape();
  const nPts = EQ_CURVE_FREQS.length;
  for (let i = 0; i < nPts; i++) {
    const f = EQ_CURVE_FREQS[i];
    let gain = 0;
    gain += eq.low * (1 / (1 + Math.pow(f / EQ_LOW_FREQ, 2)));
    const midRatio = f / EQ_MID_FREQ;
    gain += eq.mid * (1 / (1 + EQ_MID_Q * Math.pow(midRatio - 1/midRatio, 2)));
    gain += eq.high * (1 / (1 + Math.pow(EQ_HIGH_FREQ / f, 2)));
    const px = eqFreqToX(f, gx, gw);
    const py = eqGainToY(gain, gy, gh);
    vertex(px, constrain(py, gy, gy + gh));
  }
  endShape();

  // Anchor points
  const anchors = [
    { freq: EQ_LOW_FREQ, gain: eq.low, band: 'low' },
    { freq: EQ_MID_FREQ, gain: eq.mid, band: 'mid' },
    { freq: EQ_HIGH_FREQ, gain: eq.high, band: 'high' },
  ];
  for (const a of anchors) {
    const ax = eqFreqToX(a.freq, gx, gw);
    const ay = eqGainToY(a.gain, gy, gh);
    const hov = !dimmed && dist(mX(), mY(), ax, ay) < 8;
    const dragging = !dimmed && drag && drag.type === 'eqBand' && drag.band === a.band;
    fill(dragging || hov ? [drum.hue, DRUM_S, DRUM_B] : PANEL);
    stroke(drum.hue, dimmed ? 10 : DRUM_S, dimmed ? 90 : DRUM_B); strokeWeight(0.8);
    circle(ax, ay, dragging || hov ? 7 : 5);
    if (hov) cursor(HAND);
  }
}

/** Draw a compact rotary knob. Returns {cx, cy, r} for hit testing. */
function drawCompactKnob(cx, cy, radius, value, vmin, vmax, label, color, dimmed) {
  const norm = constrain((value - vmin) / (vmax - vmin), 0, 1);
  const startAngle = PI * 0.75;   // 225° (7 o'clock)
  const sweep = PI * 1.5;         // 270° range
  const endAngle = startAngle + sweep;
  const valAngle = startAngle + norm * sweep;

  // Background circle
  fill(dimmed ? [...SEQ_CELL, 60] : SEQ_CELL); stroke(dimmed ? [...INK_FAINT, 20] : INK_FAINT); strokeWeight(0.5);
  circle(cx, cy, radius * 2);

  // Track arc (full range, faint)
  noFill(); stroke(dimmed ? [...INK_FAINT, 15] : [...INK_FAINT, 30]); strokeWeight(1.5);
  arc(cx, cy, radius * 1.6, radius * 1.6, startAngle, endAngle);

  // Value arc (colored)
  if (!dimmed) {
    stroke(color[0], color.length > 2 ? color[1] : DRUM_S, color.length > 2 ? color[2] : DRUM_B);
    strokeWeight(1.5);
    if (norm > 0.01) arc(cx, cy, radius * 1.6, radius * 1.6, startAngle, valAngle);
  }

  // Tick mark at current position
  const tickR1 = radius * 0.5, tickR2 = radius * 0.9;
  const tx1 = cx + cos(valAngle) * tickR1, ty1 = cy + sin(valAngle) * tickR1;
  const tx2 = cx + cos(valAngle) * tickR2, ty2 = cy + sin(valAngle) * tickR2;
  stroke(dimmed ? [...INK_FAINT, 30] : INK); strokeWeight(0.8);
  line(tx1, ty1, tx2, ty2);

  // Label below
  fill(dimmed ? [...INK_FAINT, 25] : INK_DIM); noStroke();
  textSize(4); textAlign(CENTER, TOP);
  text(label, cx, cy + radius + 1);

  // Hover
  const hov = !dimmed && dist(mX(), mY(), cx, cy) < radius + 2;
  if (hov) cursor(HAND);
  return { cx, cy, r: radius, hov };
}

/** Get layout positions for the 6 effect knobs + reverse toggle within the effects box. */
function fxBoxLayout(C) {
  const bx = C.fxBoxX, by = C.fxBoxY, bw = C.fxBoxW, bh = C.fxBoxH;
  const revW = 22, revH = 12;
  const revX = bx + 4, revY = by + 4;
  // Knob area starts right of reverse toggle
  const knobAreaX = bx + revW + 10;
  const knobAreaW = bw - revW - 14;
  const knobR = 7;  // knob radius
  const knobSpacing = knobAreaW / 3;
  const rowY1 = by + 14;  // reverb row center
  const rowY2 = by + bh - 14;  // delay row center
  const knobs = {};
  // Reverb knobs
  knobs.reverbSize = { cx: knobAreaX + knobSpacing * 0.5, cy: rowY1 };
  knobs.reverbDamping = { cx: knobAreaX + knobSpacing * 1.5, cy: rowY1 };
  knobs.reverbMix = { cx: knobAreaX + knobSpacing * 2.5, cy: rowY1 };
  // Delay knobs
  knobs.delayTime = { cx: knobAreaX + knobSpacing * 0.5, cy: rowY2 };
  knobs.delayFeedback = { cx: knobAreaX + knobSpacing * 1.5, cy: rowY2 };
  knobs.delayMix = { cx: knobAreaX + knobSpacing * 2.5, cy: rowY2 };
  return { revX, revY, revW, revH, knobs, knobR };
}

/** Draw the effects box: reverse toggle + reverb/delay knobs. */
function drawEffectsBox(drum, C, slot, padId, dimmed) {
  const bx = C.fxBoxX, by = C.fxBoxY, bw = C.fxBoxW, bh = C.fxBoxH;
  // Box background
  fill(...SEQ_CELL); stroke(...(dimmed ? [...INK_FAINT, 40] : INK_FAINT)); strokeWeight(0.5);
  rect(bx, by, bw, bh, 4);

  const fx = fxBoxLayout(C);
  const rev = slot.drumReverse[padId] ?? false;
  const rvb = slot.drumReverb[padId] || { size: 0.3, damping: 0.5, mix: 0 };
  const dly = slot.drumDelay[padId] || { time: 250, feedback: 0.3, mix: 0 };
  const col = [drum.hue, DRUM_S, DRUM_B];

  // Reverse toggle
  const revHov = !dimmed && mX() > fx.revX && mX() < fx.revX + fx.revW && mY() > fx.revY && mY() < fx.revY + fx.revH;
  if (rev) {
    fill(drum.hue, dimmed ? 15 : DRUM_S_LITE, dimmed ? 85 : DRUM_B_LITE);
  } else {
    fill(dimmed ? [...SEQ_CELL, 60] : SEQ_CELL);
  }
  stroke(revHov ? ACCENT : (dimmed ? [...INK_FAINT, 20] : INK_FAINT)); strokeWeight(0.5);
  rect(fx.revX, fx.revY, fx.revW, fx.revH, 3);
  fill(rev ? (dimmed ? [...INK_FAINT, 30] : INK) : (dimmed ? [...INK_FAINT, 25] : INK_DIM));
  noStroke(); textSize(4.5); textAlign(CENTER, CENTER);
  text('REV', fx.revX + fx.revW / 2, fx.revY + fx.revH / 2);
  if (revHov) cursor(HAND);

  // Section labels
  fill(dimmed ? [...INK_FAINT, 20] : INK_FAINT); noStroke(); textSize(3.5); textAlign(LEFT, TOP);
  const labelX = fx.knobs.reverbSize.cx - fx.knobR;
  text('REVERB', labelX, by + 2);
  text('DELAY', labelX, by + bh / 2 + 1);

  // Reverb knobs
  drawCompactKnob(fx.knobs.reverbSize.cx, fx.knobs.reverbSize.cy, fx.knobR, rvb.size, 0, 1, 'SIZE', col, dimmed);
  drawCompactKnob(fx.knobs.reverbDamping.cx, fx.knobs.reverbDamping.cy, fx.knobR, rvb.damping, 0, 1, 'DAMP', col, dimmed);
  drawCompactKnob(fx.knobs.reverbMix.cx, fx.knobs.reverbMix.cy, fx.knobR, rvb.mix, 0, 1, 'MIX', col, dimmed);

  // Delay knobs
  drawCompactKnob(fx.knobs.delayTime.cx, fx.knobs.delayTime.cy, fx.knobR, dly.time, 10, 1000, 'TIME', col, dimmed);
  drawCompactKnob(fx.knobs.delayFeedback.cx, fx.knobs.delayFeedback.cy, fx.knobR, dly.feedback, 0, 0.95, 'FB', col, dimmed);
  drawCompactKnob(fx.knobs.delayMix.cx, fx.knobs.delayMix.cy, fx.knobR, dly.mix, 0, 1, 'MIX', col, dimmed);
}

/** Compute consistent control positions within the panel. Used by render + input. */
function panelControlLayout(L) {
  const inputRowH = 24;  // height reserved for text input + icons row
  const ctrlY = L.panelY + TRIM_H + 4;
  const ctrlH = L.panelH - TRIM_H - 8;
  const dividerY = ctrlY + inputRowH;  // line between text row and sliders/EQ row

  // Text/icon row spans full panel width
  const rowX = L.panelX + 8;
  const rowW = L.panelW - 16;

  // Slider box — left portion below the text row (narrowed to 3/4)
  const sliderBoxPad = 4;
  const sliderBoxX = L.panelX + 8;
  const sliderBoxW = Math.round((CTRL_PANEL_MIN_W - 16) * SLIDER_BOX_SCALE);  // 108px
  const labelPadL = 28;   // space for labels (VOL, PITCH, FINE, SPEED) — includes chain bracket zone
  const labelPadR = 18;   // space for values on right
  const sliderW = sliderBoxW - sliderBoxPad * 2 - labelPadL - labelPadR;
  // Four stacked horizontal sliders: VOL, PITCH, FINE, SPEED
  const sliderRowH = 13;   // vertical space per slider row (tighter to fit 4)
  const sliderBoxH = sliderRowH * 4 + sliderBoxPad * 2;
  const sliderBoxY = dividerY + 4;  // below divider
  const volSliderY = sliderBoxY + sliderBoxPad + sliderRowH / 2;
  const pitchSliderY = volSliderY + sliderRowH;
  const fineSliderY = pitchSliderY + sliderRowH;
  const speedSliderY = fineSliderY + sliderRowH;
  const chainY = (pitchSliderY + speedSliderY) / 2;
  const sliderX = sliderBoxX + sliderBoxPad + labelPadL;
  const chainX = sliderBoxX + sliderBoxPad;  // chain icon near left edge of label zone

  // Effects box — right of slider box, left of EQ graph
  const fxBoxGap = 4;
  const fxBoxX = sliderBoxX + sliderBoxW + fxBoxGap;
  const fxBoxW = L.panelX + CTRL_PANEL_MIN_W + FX_PANEL_EXTRA_W - fxBoxX - 4;
  const fxBoxY = sliderBoxY;
  const fxBoxH = sliderBoxH;

  // Inline EQ graph — right of effects box, same height as slider box
  const eqPad = 8;
  const eqGraphX = L.panelX + CTRL_PANEL_MIN_W + FX_PANEL_EXTRA_W + eqPad;
  const eqGraphY = sliderBoxY;
  const eqGraphW = L.panelW - (CTRL_PANEL_MIN_W + FX_PANEL_EXTRA_W) - eqPad * 2;
  const eqGraphH = sliderBoxH;
  return { ctrlY, ctrlH, dividerY, inputRowH, sliderW, sliderX,
    volSliderY, pitchSliderY, fineSliderY, speedSliderY, chainX, chainY,
    sliderBoxX, sliderBoxY, sliderBoxW, sliderBoxH, rowX, rowW,
    fxBoxX, fxBoxY, fxBoxW, fxBoxH,
    eqGraphX, eqGraphY, eqGraphW, eqGraphH };
}

function speedToNorm(spd) { return constrain((Math.log2(spd) + 1) / 2, 0, 1); }
function normToSpeed(n) { return Math.pow(2, n * 2 - 1); }

function drawPanelSlider(drum, x, y, w, param, val, vmin, vmax, hasCandidates, dimmed) {
  const normVal = param === 'speed' ? speedToNorm(val) : constrain((val-vmin)/(vmax-vmin), 0, 1);
  const handleX = x + normVal * w;
  const hov = !dimmed && abs(mX()-handleX)<6 && abs(mY()-y)<8;

  // Track
  stroke(dimmed ? [...INK_FAINT, 40] : INK_FAINT); strokeWeight(1);
  line(x, y, x+w, y);

  // Fill
  if (hasCandidates) {
    stroke(drum.hue, hov?50:(dimmed?20:DRUM_S), hov?70:(dimmed?80:DRUM_B)); strokeWeight(2);
    if (param === 'pitch' || param === 'fine' || param === 'speed') {
      const midX = x + w/2;
      if (handleX >= midX) line(midX, y, handleX, y);
      else line(handleX, y, midX, y);
    } else {
      line(x, y, handleX, y);
    }
  }

  // Handle
  fill(hov ? ACCENT : (dimmed ? SEQ_CELL : PANEL)); stroke(dimmed ? [...INK_FAINT, 40] : INK_FAINT); strokeWeight(1);
  circle(handleX, y, 7);

  // Label left
  fill(dimmed ? [...INK_FAINT, 30] : (hasCandidates ? INK_DIM : INK_FAINT)); noStroke();
  textSize(6); textAlign(RIGHT, CENTER);
  const labels = { vol: 'VOL', pitch: 'PITCH', fine: 'FINE', speed: 'SPEED' };
  text(labels[param] || param, x - 6, y);

  // Value right
  textSize(6); textAlign(LEFT, CENTER);
  if (dimmed) fill([...INK_FAINT, 30]);
  if (param==='vol') text(Math.round(val*100)+'%', x+w+4, y);
  else if (param==='pitch') text((val>0?'+':'')+val, x+w+4, y);
  else if (param==='fine') text((val>0?'+':'')+Math.round(val)+'¢', x+w+4, y);
  else text(Math.round(val*100)+'%', x+w+4, y);

  if (hov) cursor(HAND);
}

function drawChainLinkWithLines(cx, cy, pitchY, speedY, bracketRight, linked, drum, dimmed) {
  const hov = !dimmed && abs(mX()-cx)<5 && abs(mY()-cy)<5;
  const col = dimmed ? [...INK_FAINT, 20] : (linked ? [drum.hue, DRUM_S, DRUM_B] : [...INK_FAINT, 40]);

  // Rectilinear connector lines from chain icon to pitch/speed label areas
  const lineCol = dimmed ? [...INK_FAINT, 15] : (linked ? [drum.hue, 20, DRUM_B] : [...INK_FAINT, 25]);
  stroke(lineCol); strokeWeight(0.7); noFill();
  // Top connector: up from chain to pitch row, then right
  line(cx, cy - 4, cx, pitchY); line(cx, pitchY, bracketRight, pitchY);
  // Bottom connector: down from chain to speed row, then right
  line(cx, cy + 4, cx, speedY); line(cx, speedY, bracketRight, speedY);

  // Chain link icon — rotated 90° (vertical), scaled down to fit tighter spacing
  const lkW = 1.6, lkH = 2.8, r = 0.6, sw = 0.7;
  const overlap = 1.0;

  // p5's scale(UI_SCALE) is already active, so use logical coords directly
  const dc = drawingContext;
  dc.save();
  dc.lineWidth = sw;
  dc.lineJoin = 'round';
  const [h2, sl, ll] = hsbToHsl(col[0]||0, col[1]||0, col[2]||0);
  const alpha = col.length === 4 ? col[3] / 100 : 1;
  dc.strokeStyle = `hsla(${h2},${sl}%,${ll}%,${alpha})`;
  dc.fillStyle = 'none';

  function rrPath(x, y, w, h, r) {
    dc.moveTo(x+r, y);
    dc.lineTo(x+w-r, y); dc.arcTo(x+w, y, x+w, y+r, r);
    dc.lineTo(x+w, y+h-r); dc.arcTo(x+w, y+h, x+w-r, y+h, r);
    dc.lineTo(x+r, y+h); dc.arcTo(x, y+h, x, y+h-r, r);
    dc.lineTo(x, y+r); dc.arcTo(x, y, x+r, y, r);
    dc.closePath();
  }

  if (linked) {
    const topY = cy - lkH + overlap/2;
    const botY = cy - overlap/2;
    const lkX = cx - lkW/2;

    dc.beginPath(); rrPath(lkX, botY, lkW, lkH, r); dc.stroke();
    dc.beginPath(); rrPath(lkX, topY, lkW, lkH, r); dc.stroke();

    // Interlock illusion: erase crossing segments with bg color, redraw correct z-order
    const bgHsl = hsbToHsl(...SEQ_CELL);
    dc.strokeStyle = `hsl(${SEQ_CELL[0]},${bgHsl[1]}%,${bgHsl[2]}%)`;
    dc.lineWidth = sw + 1.2;
    dc.beginPath();
    dc.moveTo(lkX, botY - 0.3);
    dc.lineTo(lkX, botY + r + 0.3);
    dc.stroke();
    dc.beginPath();
    dc.moveTo(lkX + lkW, botY - 0.3);
    dc.lineTo(lkX + lkW, botY + r + 0.3);
    dc.stroke();

    dc.strokeStyle = `hsla(${h2},${sl}%,${ll}%,${alpha})`;
    dc.lineWidth = sw;
    // Bottom link's top-left in front
    dc.beginPath();
    dc.moveTo(lkX + r, botY);
    dc.arcTo(lkX, botY, lkX, botY + r, r);
    dc.lineTo(lkX, botY + lkH - r);
    dc.stroke();
    // Top link's bottom-right in front
    dc.beginPath();
    dc.moveTo(lkX + lkW - r, topY + lkH);
    dc.arcTo(lkX + lkW, topY + lkH, lkX + lkW, topY + lkH - r, r);
    dc.lineTo(lkX + lkW, topY + r);
    dc.stroke();
  } else {
    const gap = 1;
    const topY = cy - lkH - gap/2;
    const botY = cy + gap/2;
    const lkX = cx - lkW/2;
    dc.beginPath(); rrPath(lkX, topY, lkW, lkH, r); dc.stroke();
    dc.beginPath(); rrPath(lkX, botY, lkW, lkH, r); dc.stroke();
  }

  dc.restore();
  if (hov) cursor(HAND);
}


function drawPanelTrimBar(drum, x, y, w, slot) {
  const h = TRIM_H;
  const hasCandidates = slot.drumCandidates[drum.id] && slot.drumCandidates[drum.id].length>0;
  const curCand = hasCandidates ? slot.drumCandidates[drum.id][slot.drumIdx[drum.id]] : null;
  fill(BG[0], 6, 100); stroke(drum.hue, 12, 82); strokeWeight(0.5);
  rect(x, y, w, h);
  if (!hasCandidates || !curCand) return;

  let channel;
  if (curCand.buffer) { channel = curCand.buffer.getChannelData(0); }
  else if (slot.sourceBuffer) {
    const sr = slot.sourceBuffer.sampleRate;
    const sampleStart = Math.max(0, Math.floor((curCand.ctxStart||0)*sr));
    const sampleEnd = Math.min(slot.sourceBuffer.length, Math.ceil((curCand.ctxEnd||1)*sr));
    channel = slot.sourceBuffer.getChannelData(0).subarray(sampleStart, sampleEnd);
  }
  if (!channel) return;

  const ts = slot.drumTrimStart[drum.id]||0, te = slot.drumTrimEnd[drum.id]??1;
  const activeDrag = drag && (drag.type==='trimStart'||drag.type==='trimEnd'||drag.type==='trimSlide') && drag.id===drum.id;
  let dispStart = ts, dispEnd = te, shrinkHandleFrac = null;

  if (activeDrag) {
    const ps = drag.proposedStart??ts, pe = drag.proposedEnd??te;
    if (drag.type==='trimSlide') { dispStart=ps; dispEnd=pe; }
    else {
      const extending = (drag.type==='trimStart') ? (ps < ts) : (pe > te);
      if (extending) {
        // Zoom out to show the extended range
        dispStart = ps; dispEnd = pe;
      } else {
        // Frozen viewport with floating handle
        const range = te - ts;
        if (range > 0.001) {
          if (drag.type==='trimStart') shrinkHandleFrac = constrain((ps - ts) / range, 0, 1);
          else shrinkHandleFrac = constrain((pe - ts) / range, 0, 1);
        }
      }
    }
  }

  const dispLen = dispEnd - dispStart;
  if (dispLen > 0.001) {
    for (let px=0; px<w; px++) {
      const ctxFrac = dispStart + (px/w) * dispLen;
      const sampleIdx = Math.floor(constrain(ctxFrac,0,1)*(channel.length-1));
      const step = max(1, Math.floor(dispLen*channel.length/w));
      let peak = 0;
      for (let s2=sampleIdx; s2<min(sampleIdx+step,channel.length); s2++) peak=max(peak,abs(channel[s2]));
      const barHeight = peak*(h-4)*0.9;
      let inActive = true;
      if (shrinkHandleFrac !== null) {
        const barFrac = px/w;
        if (drag.type==='trimStart') inActive = barFrac>=shrinkHandleFrac;
        else inActive = barFrac<=shrinkHandleFrac;
      }
      stroke(drum.hue, inActive?DRUM_S:22, inActive?DRUM_B:80); strokeWeight(1);
      line(x+px, y+h/2-barHeight/2, x+px, y+h/2+barHeight/2);
    }
    if (shrinkHandleFrac !== null) {
      noStroke(); fill(...BG, 55);
      if (drag.type==='trimStart') rect(x+1, y+1, shrinkHandleFrac*(w-2), h-2);
      else rect(x+1+shrinkHandleFrac*(w-2), y+1, (1-shrinkHandleFrac)*(w-2), h-2);
    }
  }

  // Edge handles
  const overTrimBar = mX()>x && mX()<x+w && mY()>y && mY()<y+h;
  const nearLeft = abs(mX()-x)<8 && overTrimBar && !activeDrag;
  const nearRight = abs(mX()-(x+w))<8 && overTrimBar && !activeDrag;
  if (shrinkHandleFrac !== null) {
    const hx = x + shrinkHandleFrac*w;
    fill(drum.hue, 80, 65); noStroke(); rect(hx-1.5, y, 3, h, 1);
  }
  fill(drum.hue, nearLeft?80:DRUM_S, nearLeft?65:DRUM_B); noStroke(); rect(x, y, 3, h, 1);
  fill(drum.hue, nearRight?80:DRUM_S, nearRight?65:DRUM_B); rect(x+w-3, y, 3, h, 1);
  if (nearLeft||nearRight) cursor(HAND);
  else if (overTrimBar && !activeDrag && !nearLeft && !nearRight) cursor('grab');
}


function keyReorderTargetIdx(mx, my, L, numPads) {
  const oy = L.keysOffsetY || 0;
  const kh = L.kh || KEY_H, kw = L.kw || KEY_W;
  const row = my >= L.gridY + oy + kh + KEY_GAP*2 ? 1 : 0;
  const offset = row === 1 ? KEY_ROW2_OFFSET : 0;
  const col = Math.round((mx - L.gridX - offset) / (kw + KEY_GAP));
  const rowStart = row * 8;
  return constrain(rowStart + col, 0, numPads);
}


// ── Slot header helpers ──────────────────────────────────────────────────────

/** Draw a labelled slider in a slot header (RAND, SWING, STEPS, VOL). */
function drawHeaderSlider(label, sliderX, sliderW, handleX, headerMid, valueText) {
  const sliderY = headerMid - 2;
  const hov = dist(mX(), mY(), handleX, headerMid - seqScrollY) < 5.5;
  stroke(...INK_FAINT); strokeWeight(1); line(sliderX, sliderY, sliderX + sliderW, sliderY);
  fill(hov ? ACCENT : PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(handleX, sliderY, 7);
  // Label centered below slider
  fill(...INK); noStroke(); textSize(5); textAlign(CENTER, TOP);
  const labelText = valueText !== undefined ? label + ' ' + valueText : label;
  text(labelText, sliderX + sliderW / 2, sliderY + 4);
}

/** Draw the compact [- NN +] step count stepper in a slot header. */
function drawStepStepper(sx, sy, sw, sh, headerMid, steps) {
  const third=sw/3;
  const minusX=sx, numX=sx+third, plusX=sx+third*2;
  const screenMid=headerMid-seqScrollY;
  const minHov=mX()>minusX&&mX()<minusX+third&&abs(mY()-screenMid)<sh/2+2;
  const plusHov=mX()>plusX&&mX()<plusX+third&&abs(mY()-screenMid)<sh/2+2;
  const numHov=mX()>numX&&mX()<plusX&&abs(mY()-screenMid)<sh/2+2;
  // Background capsule
  fill(...PANEL); stroke(...INK_DIM); strokeWeight(1);
  rect(sx, sy, sw, sh, sh/2);
  // Minus
  fill(minHov?ACCENT:INK_DIM); noStroke(); textSize(6); textAlign(CENTER,CENTER);
  text('\u2013', minusX+third/2, headerMid);
  // Number (hide when editing)
  if (!_stepEditInput||_stepEditInput.style.display==='none') {
    fill(...INK); textSize(5); text(steps, numX+third/2, headerMid);
  }
  // Plus
  fill(plusHov?ACCENT:INK_DIM); textSize(6); text('+', plusX+third/2, headerMid);
  // Dividers
  stroke(...INK_DIM); strokeWeight(1);
  line(numX, sy+2, numX, sy+sh-2);
  line(plusX, sy+2, plusX, sy+sh-2);
  if (minHov||plusHov||numHov) cursor(HAND);
}

/** Draw measure tabs in a slot header. */
function drawMeasureTabs(slot, slotIndex, L, headerMid) {
  const grid = slot.grid, nM = grid.measures.length;
  const tw = L.measureTabW, tabH = 10, r = 3;
  const baseX = L.measureTabsX, tabY = headerMid - tabH/2 + 1; // shifted down 1px from center
  const ho = slot.hueOffset || 0;
  const playInfo = seqPlaying ? slotLoopFraction(slotIndex) : null;
  const effMouseY = mY() + seqScrollY;
  const isDragReorder = drag && drag.type === 'reorderMeasure' && drag.slotIndex === slotIndex;
  const tabMidY = tabY + tabH / 2;

  // Delete X's just above tabs (only when >1 measure)
  if (nM > 1) {
    const xS = 1.225; // half-size of the X
    for (let i = 0; i < nM; i++) {
      const tx = baseX + i * tw;
      const xCx = tx + (tw - 1) / 2, xCy = tabY - 3;
      const xHov = mX() >= tx && mX() < tx + tw && effMouseY >= xCy - 4 && effMouseY < tabY;
      push(); strokeCap(ROUND); noFill();
      stroke(xHov ? INK : INK_FAINT); strokeWeight(0.7);
      line(xCx - xS, xCy - xS, xCx + xS, xCy + xS);
      line(xCx + xS, xCy - xS, xCx - xS, xCy + xS);
      pop();
      if (xHov) cursor(HAND);
    }
  }

  for (let i = 0; i < nM; i++) {
    const tx = baseX + i * tw;
    const mHue = MEASURE_HUES[i % MEASURE_HUES.length];
    const isEdit = (i === grid.editMeasure);
    const isPlaying = playInfo && (playInfo.measureIdx === i);
    const hov = mX() >= tx && mX() < tx + tw && effMouseY >= tabY && effMouseY < tabY + tabH;

    // Background
    if (isEdit) {
      fill(mHue, 40, 65);
    } else if (hov) {
      fill(mHue, 12, 90);
    } else {
      noFill();
    }

    // Playing indicator: accent stroke
    if (isPlaying) {
      stroke(mHue, 40, 65);
      strokeWeight(1.5);
    } else {
      stroke(...INK_FAINT);
      strokeWeight(0.5);
    }

    rect(tx, tabY, tw - 1, tabH, r);

    // Label
    noStroke();
    fill(isEdit ? [0, 0, 100] : INK_DIM);
    textSize(6); textAlign(CENTER, CENTER);
    text(i + 1, tx + (tw - 1) / 2, tabMidY);

    if (hov) cursor(HAND);
  }

  // Plus button (only if under max)
  if (nM < MAX_MEASURES) {
    const plusX = baseX + nM * tw;
    const plusHov = mX() >= plusX && mX() < plusX + L.measurePlusW && effMouseY >= tabY && effMouseY < tabY + tabH;
    noFill(); stroke(...INK_FAINT); strokeWeight(0.5);
    rect(plusX, tabY, L.measurePlusW - 1, tabH, r);
    noStroke(); fill(plusHov ? ACCENT : INK_DIM);
    textSize(7); textAlign(CENTER, CENTER);
    text('+', plusX + (L.measurePlusW - 1) / 2, tabMidY);
    if (plusHov) cursor(HAND);
  }

  // Drag reorder insertion indicator
  if (isDragReorder) {
    const targetIdx = drag.targetIdx ?? drag.fromIdx;
    const lineX = baseX + targetIdx * tw;
    stroke(...ACCENT); strokeWeight(2);
    line(lineX, tabY - 1, lineX, tabY + tabH + 1);
  }
}

/** Draw the S/M button capsule in a slot header. */
function drawButtonCapsule(cx, cy, cellW, cellH, headerMid, slot) {
  const labels=['S','M'];
  const accents=[ACCENT,RED];
  const actives=[slot.soloed,slot.muted];
  const n=2;
  // Capsule outline
  fill(...PANEL); stroke(...INK_DIM); strokeWeight(1);
  rect(cx, cy, cellW*n, cellH, cellH/2);
  // Per-cell hover/active fills and labels
  for (let i=0; i<n; i++) {
    const x=cx+i*cellW;
    const hov=mX()>x&&mX()<x+cellW&&mY()>cy-seqScrollY&&mY()<cy+cellH-seqScrollY;
    if (hov||actives[i]) {
      drawingContext.save();
      drawingContext.beginPath();
      const r=cellH/2;
      const cLeft=cx+0.5, cTop=cy+0.5, cW2=cellW*n-1, cH2=cellH-1;
      drawingContext.moveTo(cLeft+r,cTop);
      drawingContext.lineTo(cLeft+cW2-r,cTop);
      drawingContext.arcTo(cLeft+cW2,cTop,cLeft+cW2,cTop+r,r);
      drawingContext.lineTo(cLeft+cW2,cTop+cH2-r);
      drawingContext.arcTo(cLeft+cW2,cTop+cH2,cLeft+cW2-r,cTop+cH2,r);
      drawingContext.lineTo(cLeft+r,cTop+cH2);
      drawingContext.arcTo(cLeft,cTop+cH2,cLeft,cTop+cH2-r,r);
      drawingContext.lineTo(cLeft,cTop+r);
      drawingContext.arcTo(cLeft,cTop,cLeft+r,cTop,r);
      drawingContext.closePath();
      drawingContext.clip();
      fill(accents[i]); noStroke();
      rect(x, cy, cellW, cellH);
      drawingContext.restore();
    }
    fill((hov||actives[i])?[0,0,98]:INK_DIM); noStroke(); textSize(5); textAlign(CENTER,CENTER);
    text(labels[i], x+cellW/2, headerMid);
  }
  // Divider line between cells
  stroke(...INK_DIM); strokeWeight(1);
  line(cx+cellW, cy+2, cx+cellW, cy+cellH-2);
}

/** Draw a standalone text button (CLR / DUP). */
function drawStandaloneBtn(x, y, w, h, label, headerMid, hoverColor) {
  const hov=mX()>x&&mX()<x+w&&mY()>y-seqScrollY&&mY()<y+h-seqScrollY;
  fill(hov?hoverColor:PANEL); stroke(...INK_DIM); strokeWeight(1);
  rect(x, y, w, h, 3);
  fill(hov?[0,0,98]:INK_DIM); noStroke(); textSize(5); textAlign(CENTER,CENTER);
  text(label, x+w/2, headerMid);
  if (hov) cursor(HAND);
}

/** Draw the standalone X (remove slot) button. */
function drawRemoveSlotBtn(rx, ry, rw, rh, headerMid, showRemove) {
  if (!showRemove) return;
  const cx=rx+rw/2, cy=headerMid;
  const hov=mX()>rx&&mX()<rx+rw&&mY()>ry-seqScrollY&&mY()<ry+rh-seqScrollY;
  const s=3.5;
  push(); strokeCap(ROUND); noFill();
  stroke(hov?RED:INK_DIM); strokeWeight(1.5);
  line(cx-s, cy-s, cx+s, cy+s);
  line(cx+s, cy-s, cx-s, cy+s);
  pop();
  if (hov) cursor(HAND);
}

// ── Sequencer ────────────────────────────────────────────────────────────────

/** Draw the play/rec/bpm/tap/clr-all control bar at top of sequencer. */
function drawSeqControlBar(ctrlY) {
  const ctrlMid=ctrlY+SEQ_CTRL_H/2;
  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(SEQ_MARGIN,ctrlY,cW()-SEQ_MARGIN*2,SEQ_CTRL_H,CORNER_RADIUS,CORNER_RADIUS,0,0);

  const playX=SEQ_MARGIN+12+12;
  const playRadius=12, playHov=dist(mX(),mY(),playX,ctrlMid)<playRadius;
  fill(seqPlaying?[120,55,70]:playHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); circle(playX,ctrlMid,playRadius*2);
  fill(seqPlaying?[0,0,98]:INK); noStroke();
  if (seqPlaying) { rectMode(CENTER); rect(playX-3,ctrlMid,3,9,1); rect(playX+3,ctrlMid,3,9,1); rectMode(CORNER); }
  else { triangle(playX-4,ctrlMid-6,playX-4,ctrlMid+6,playX+7,ctrlMid); }

  const recBtnX=playX+playRadius*2+16, recBtnRadius=9;
  const recBtnHov=dist(mX(),mY(),recBtnX,ctrlMid)<recBtnRadius;
  if (seqRecording) { noFill(); stroke(...RED,(sin(frameCount*0.15)*0.5+0.5)*40); strokeWeight(3); circle(recBtnX,ctrlMid,recBtnRadius*2+10); }
  fill(seqRecording?RED:recBtnHov?RED:[0,30,94]); stroke(...INK); strokeWeight(1); circle(recBtnX,ctrlMid,recBtnRadius*2);
  fill(seqRecording?[0,0,98]:INK); noStroke(); circle(recBtnX,ctrlMid,4);

  const bpmLabelX=recBtnX+recBtnRadius+12, bpmSliderX=bpmLabelX+28, bpmSliderW=100;
  fill(...INK_DIM); noStroke(); textSize(8); textAlign(LEFT,CENTER); text('BPM',bpmLabelX,ctrlMid);
  fill(...BG); stroke(...INK); strokeWeight(1); rect(bpmSliderX,ctrlMid-4,bpmSliderW,8,4);
  const bpmNorm=(seqBPM-40)/200;
  fill(...ACCENT,80); noStroke(); rect(bpmSliderX,ctrlMid-4,bpmSliderW*bpmNorm,8,4);
  const thumbX=bpmSliderX+bpmSliderW*bpmNorm, thumbHov=abs(mX()-thumbX)<8&&abs(mY()-ctrlMid)<10;
  fill(thumbHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); circle(thumbX,ctrlMid,11);
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER); text(Math.round(seqBPM),bpmSliderX+bpmSliderW+8,ctrlMid);

  const tapX=bpmSliderX+bpmSliderW+36, tapW=34, tapH=20;
  const tapHov=mX()>tapX&&mX()<tapX+tapW&&mY()>ctrlMid-tapH/2&&mY()<ctrlMid+tapH/2;
  fill(tapHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(tapX,ctrlMid-tapH/2,tapW,tapH,CORNER_RADIUS);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('TAP',tapX+tapW/2,ctrlMid);


  if (seqRecording) {
    fill(0,65,55,65+sin(frameCount*0.15)*18); textSize(8); textAlign(RIGHT,CENTER); noStroke();
    text('\u25cf REC',cW()-SEQ_MARGIN-8,ctrlMid);
  }

  // Global measure tabs + padlock (right-aligned before REC indicator)
  drawGlobalMeasureTabs(ctrlMid);
}

/** Draw global measure tabs and padlock in the control bar. */
function drawGlobalMeasureTabs(ctrlMid) {
  const maxM = Math.max(...slots.map(s => s.grid.measures.length));
  if (maxM < 1) return;
  const tw = 16, tabH = 14, r = 3;
  const lockW = 14;
  const totalW = maxM * tw + lockW;
  const baseX = cW() - SEQ_MARGIN - 8 - totalW - (seqRecording ? 42 : 0);
  const tabY = ctrlMid - tabH / 2;
  const tabMidY = tabY + tabH / 2;
  const refIdx = slots.findIndex(s => s.grid.measures.length === maxM);
  const playInfo = seqPlaying ? slotLoopFraction(refIdx >= 0 ? refIdx : 0) : null;
  // Tabs are disabled (grayed, no interaction) when playing and unlocked
  const disabled = seqPlaying && !globalMeasureLock;

  for (let i = 0; i < maxM; i++) {
    const tx = baseX + i * tw;
    const mHue = MEASURE_HUES[i % MEASURE_HUES.length];
    const isEdit = (i === globalEditMeasure);
    const isPlaying = playInfo && disabled && (playInfo.measureIdx === i);
    const hov = !disabled && mX() >= tx && mX() < tx + tw && mY() >= tabY && mY() < tabY + tabH;

    if (isEdit || isPlaying) {
      fill(mHue, disabled ? 20 : 40, disabled ? 78 : 65);
    } else if (hov) {
      fill(mHue, 12, 90);
    } else {
      noFill();
    }

    if (isPlaying) {
      stroke(mHue, 30, 70); strokeWeight(1.5);
    } else {
      stroke(...(disabled ? INK_FAINT : INK_FAINT)); strokeWeight(0.5);
    }
    rect(tx, tabY, tw - 1, tabH, r);

    noStroke();
    fill(isEdit || isPlaying ? (disabled ? [...INK_DIM] : [0, 0, 100]) : INK_DIM);
    textSize(8); textAlign(CENTER, CENTER);
    text(i + 1, tx + (tw - 1) / 2, tabMidY);
    if (hov) cursor(HAND);
  }

  // Padlock icon
  const lockX = baseX + maxM * tw + 4;
  const locked = globalMeasureLock;
  const lockHov = mX() >= lockX - 2 && mX() < lockX + 10 && mY() >= tabY && mY() < tabY + tabH;
  const col = lockHov ? INK : (locked ? INK_DIM : INK_FAINT);
  const bw = 7, bh = 5, shackleR = 2.5;
  const bx = lockX, by = tabMidY;
  noStroke();
  fill(...col);
  rect(bx, by, bw, bh, 1);
  const shackleY = locked ? by : by - 2.5;
  const cx = bx + bw / 2;
  noFill(); stroke(...col); strokeWeight(1.2);
  arc(cx, shackleY, shackleR * 2, shackleR * 2, PI, TWO_PI);
  line(cx - shackleR, shackleY, cx - shackleR, by);
  if (locked) {
    line(cx + shackleR, shackleY, cx + shackleR, by);
  } else {
    line(cx + shackleR, shackleY, cx + shackleR, shackleY + 1);
  }
  if (lockHov) cursor(HAND);
}

/** Draw the header bar for a single slot (label, sliders, buttons). */
function drawSlotHeader(slot, slotIndex, slotGridTopY, seqRowHeight, numSeqRows) {
  const headerY=slotGridTopY-SLOT_HDR_H;
  const isSelected=slotIndex===selectedSlotIdx;
  const headerW=cW()-SEQ_MARGIN*2;
  const isLast=slotIndex===slots.length-1;

  const headerRight=SEQ_MARGIN+headerW;
  const L=slotHeaderLayout(headerRight, slot.grid.measures.length, slot.type);
  const btnY=headerY+(SLOT_HDR_H-L.btnH)/2;

  const volFrac=slot.gridVolume??1.0, volHandleX=L.volSliderX+volFrac*L.volSliderW;
  const swingFrac=slot.swing??0, swingHandleX=L.swingSliderX+swingFrac*L.swingSliderW;
  const humFrac=slot.humanize??0, humHandleX=L.humSliderX+humFrac*L.humSliderW;

  const headerMid=headerY+SLOT_HDR_H/2;

  const isDraggingThis=drag&&drag.type==='reorderSlot'&&drag.slotIndex===slotIndex;
  fill(isSelected?SELECTED_HDR:isDraggingThis?[...SELECTED_HDR.slice(0,2),SELECTED_HDR[2]-6]:PANEL); stroke(...INK); strokeWeight(1);
  const headerBottomR=(numSeqRows===0&&isLast)?CORNER_RADIUS:0;
  rect(SEQ_MARGIN,headerY,headerW,SLOT_HDR_H,0,0,headerBottomR,headerBottomR);

  fill(...INK); noStroke(); textSize(7); textAlign(LEFT,CENTER);
  text('\u2630', SEQ_MARGIN+7, headerMid);

  // Type indicator next to hamburger (melody only)
  if (slot.type === 'melody') {
    push(); noStroke(); fill(...INK_FAINT);
    const tiX = SEQ_MARGIN + 19, tiY = headerMid - 3;
    for (let r = 0; r < 3; r++) rect(tiX, tiY + r * 2.5, 5, 1, 0.5);
    pop();
  }

  // ── Measure tabs ──────────────────────────────────────────────────────────
  drawMeasureTabs(slot, slotIndex, L, headerMid);

  textSize(8); textAlign(LEFT,CENTER);
  fill(slot.fileName?INK_DIM:[0,0,65]); noStroke();
  const fnStart=L.measureTabsX+L.measureTabsW+6, fnEnd=L.humSliderX-8;
  const reupSpace=slot.fileName?20:0;
  const fnMaxW=fnEnd-fnStart-reupSpace;
  if (fnMaxW>20) text(truncateMiddle(slot.fileName||'—',fnMaxW), fnStart, headerMid);

  // Analyzing spinner next to filename
  if (slot.analyzing && fnMaxW>20) {
    const fnTextW=slot.fileName?textWidth(truncateMiddle(slot.fileName,fnMaxW)):0;
    const spX=fnStart+fnTextW+10, spR=4, ticks=8;
    push();
    for (let i=0;i<ticks;i++) {
      const angle=(i/ticks)*TWO_PI+spinAngle;
      const alpha=pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*80+10;
      stroke(...ACCENT,alpha); strokeWeight(1.5); noFill();
      const ix=spX+cos(angle)*spR, iy=headerMid+sin(angle)*spR;
      const ox=spX+cos(angle)*(spR+1.5), oy=headerMid+sin(angle)*(spR+1.5);
      line(ix,iy,ox,oy);
    }
    pop();
  }

  // Re-upload icon (↻ circular arrow) next to filename
  if (slot.fileName && fnMaxW>20 && !slot.analyzing) {
    textSize(8);
    const fnTextW=textWidth(truncateMiddle(slot.fileName,fnMaxW));
    const reupX=fnStart+fnTextW+10, reupR=5;
    const reupHov=dist(mX(),mY(),reupX,headerMid-seqScrollY)<7;
    const col=reupHov?ACCENT:INK_FAINT;
    // Arc: gap at top, arrowhead at right side of gap (~1:30 position)
    const tipAngle=-HALF_PI+0.55, tailAngle=-HALF_PI-0.55+TWO_PI;
    noFill(); stroke(...col); strokeWeight(1.2);
    arc(reupX,headerMid,reupR*2,reupR*2,tipAngle,tailAngle);
    // Arrowhead: filled triangle at tipAngle, pointing clockwise (into the gap)
    const tx=reupX+cos(tipAngle)*reupR, ty=headerMid+sin(tipAngle)*reupR;
    const fwd=tipAngle-HALF_PI, a=3;
    fill(...col); noStroke();
    triangle(tx+cos(fwd)*a*0.5,ty+sin(fwd)*a*0.5,
      tx+cos(fwd+2.3)*a,ty+sin(fwd+2.3)*a,
      tx+cos(fwd-2.3)*a,ty+sin(fwd-2.3)*a);
    if (reupHov) cursor(HAND);
  }

  drawHeaderSlider('RAND',  L.humSliderX,   L.humSliderW,   humHandleX,   headerMid);
  drawHeaderSlider('SWING', L.swingSliderX, L.swingSliderW, swingHandleX, headerMid);
  drawHeaderSlider('VOL',   L.volSliderX,   L.volSliderW,   volHandleX,   headerMid);
  const stepY=headerY+(SLOT_HDR_H-L.stepH)/2;
  drawStepStepper(L.stepX, stepY, L.stepW, L.stepH, headerMid, slot.grid.steps);

  drawStandaloneBtn(L.clrX, btnY, L.standaloneW, L.btnH, 'CLR', headerMid, RED);
  drawStandaloneBtn(L.dupX, btnY, L.standaloneW, L.btnH, 'DUP', headerMid, ACCENT);
  drawButtonCapsule(L.capsuleX, btnY, L.capsuleCellW, L.btnH, headerMid, slot);
  drawRemoveSlotBtn(L.removeX, btnY, L.removeW, L.btnH, headerMid, slots.length>1);
}

/** Draw the step grid for a single slot (cells, column bands, scanline). */
function drawSlotGrid(slot, slotIndex, slotGridTopY, seqRowHeight, seqW, gridLeft, loopProgress, isLast) {
  const rowH = slotRowHeight(slot, seqRowHeight);
  const seqDrums=getSeqPads(slot), numSeqRows=seqDrums.length;
  if (numSeqRows === 0) return;

  const grid=slot.grid, gridHeight=numSeqRows*rowH;
  const stepPositions=computeStepPositions(grid,slot);
  const scanX=gridLeft+loopProgress*seqW;
  const ho=slot.hueOffset||0;
  const dHue=(h)=>(h+ho)%360;

  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(SEQ_MARGIN,slotGridTopY,cW()-SEQ_MARGIN*2,gridHeight,0,0,isLast?CORNER_RADIUS:0,isLast?CORNER_RADIUS:0);

  for (let step=0;step<grid.steps;step++) {
    const x0=gridLeft+stepPositions[step]*seqW, x1=gridLeft+stepPositions[step+1]*seqW;
    fill(Math.floor(step/4)%2===0?SEQ_CELL:SEQ_CELL_ALT); noStroke();
    rect(x0,slotGridTopY+1,x1-x0-1,gridHeight-2);
  }

  const isMelody = slot.type === 'melody';

  seqDrums.forEach((drum,rowIndex) => {
    const rowY=slotGridTopY+rowIndex*rowH;
    if (rowIndex>0) { stroke(0,0,58); strokeWeight(1); line(gridLeft,rowY,gridLeft+seqW,rowY); }

    // Black-key row tinting for melody
    if (isMelody && drum.isBlack) {
      noStroke(); fill(210, 6, 88, 60);
      rect(gridLeft, rowY, seqW, rowH);
    }

    const labelX=SEQ_MARGIN, labelW=SEQ_LABEL_W;
    const effMouseYL=mY()+seqScrollY;
    const labelHov=mX()>labelX&&mX()<labelX+labelW&&effMouseYL>rowY&&effMouseYL<rowY+rowH;

    if (isMelody) {
      // Piano-key shaped label: white keys are wider, black keys narrower+dark
      const isBlack = drum.isBlack;
      const keyLabelW = isBlack ? SEQ_LABEL_W * 0.6 : SEQ_LABEL_W - 2;
      const keyLabelX = gridLeft - keyLabelW - 2;
      const keyLabelY = rowY + 0.5;
      const keyLabelH = rowH - 1;

      if (isBlack) {
        fill(labelHov ? [210, 15, 35] : [210, 8, 20]);
      } else {
        fill(labelHov ? [0, 0, 98] : [0, 0, 100]);
      }
      stroke(...INK_FAINT, 50); strokeWeight(0.5);
      rect(keyLabelX, keyLabelY, keyLabelW, keyLabelH, 1, 1, 0, 0);

      // Octave indicator: show on the bottom C row (semitone offset 0 within octave)
      const noteInOctave = (parseInt(drum.id.slice(1)) % 12);
      if (noteInOctave === 0) {
        const octIdx = Math.floor(parseInt(drum.id.slice(1)) / 12);
        const octLabel = octIdx === 2 ? '' : octIdx < 2 ? (octIdx - 2) + '' : '+' + (octIdx - 2);
        if (octLabel) {
          fill(...INK_FAINT); noStroke(); textSize(5); textAlign(LEFT, CENTER);
          text(octLabel, keyLabelX + 2, keyLabelY + keyLabelH/2);
        }
      }
      if (labelHov) cursor(HAND);
    } else {
      const hasCand=slot.drumCandidates[drum.id]&&slot.drumCandidates[drum.id].length>0;
      fill(labelHov?[dHue(drum.hue),DRUM_S,DRUM_B]:(hasCand?[dHue(drum.hue),DRUM_S,DRUM_B]:INK_FAINT));
      if (labelHov) { fill(dHue(drum.hue),DRUM_S+10,DRUM_B+5); cursor(HAND); }
      noStroke(); textSize(7); textAlign(RIGHT,CENTER);
      const textValue=(slot.padText[drum.id]||'').trim();
      let rowLabel=textValue||padDisplayKey(drum.id);
      const maxLabelW=SEQ_LABEL_W-20;
      if (textWidth(rowLabel)>maxLabelW) {
        while (rowLabel.length>1&&textWidth(rowLabel.trim()+'\u2026')>maxLabelW) rowLabel=rowLabel.slice(0,-1);
        rowLabel=rowLabel.trim()+'\u2026';
      }
      text(rowLabel,gridLeft-8,rowY+rowH/2);
    }

    const ec=grid.measures[grid.editMeasure].cells;
    const ecp=(grid.measures[grid.editMeasure].cellPitch)||{};
    for (let step=0;step<grid.steps;step++) {
      const x0=gridLeft+stepPositions[step]*seqW, x1=gridLeft+stepPositions[step+1]*seqW;
      const cellW=max(x1-x0,2);
      const on=ec[drum.id]?ec[drum.id][step]:false;
      const isHead=seqPlaying&&loopProgress>=stepPositions[step]&&loopProgress<stepPositions[step+1];
      const effMouseY=mY()+seqScrollY;
      const cellHov=mX()>x0+1&&mX()<x0+cellW-1&&effMouseY>rowY+1&&effMouseY<rowY+rowH-1;
      const pad2=1.5;
      // Compute glow fraction from cell trigger
      let glow = 0;
      if (on) {
        const glowKey = slotIndex + '_' + drum.id + '_' + step;
        const g = _cellGlow[glowKey];
        if (g) {
          const elapsed = millis() - g.triggerMs;
          if (elapsed >= 0 && elapsed < g.durationMs) glow = 1 - elapsed / g.durationMs;
        }
      }
      const glowS = glow * 20, glowB = glow * 30;

      if (isMelody) {
        // Uniform bluish cells for melody
        const mH = MELODY_CELL[0], mS = MELODY_CELL[1], mB = MELODY_CELL[2];
        if      (isHead&&on) fill(mH, mS+8+glowS, min(100, mB+10+glowB));
        else if (isHead)     fill(mH, mS-10, mB+30);
        else if (on)         fill(mH, mS+glowS, min(100, mB+glowB), cellHov?100:90);
        else if (cellHov)    fill(mH, 15, 85, 50);
        else                 noFill();
      } else {
        const cp=on&&ecp[drum.id]?(ecp[drum.id][step]||0):0;
        if      (isHead&&on) fill(dHue(drum.hue),DRUM_S+8+glowS,min(100,DRUM_B+10+glowB));
        else if (isHead)     fill(dHue(drum.hue),DRUM_S_LITE,DRUM_B_LITE-10);
        else if (on)         fill(dHue(drum.hue),DRUM_S+glowS,min(100,DRUM_B+glowB),cellHov?100:90);
        else if (cellHov)    fill(dHue(drum.hue),20,85,50);
        else                 noFill();
      }
      noStroke();
      if (on||isHead||cellHov) rect(x0+pad2,rowY+pad2,cellW-pad2*2,rowH-pad2*2,2);

      // Per-cell pitch indicator (drum only)
      if (!isMelody) {
        const cp=on&&ecp[drum.id]?(ecp[drum.id][step]||0):0;
        if (on && cellW >= 14) {
          if (cp !== 0) {
            fill(0,0,100,80); noStroke();
            const pitchStr = (cp>0?'+':'')+cp;
            const noteSize = min(8, rowH * 0.55);
            const numSize = min(6, rowH * 0.45);
            textSize(numSize); const numW = textWidth(pitchStr);
            textSize(noteSize); const noteW = textWidth('\u2669');
            const rx = x0 + cellW - 3;
            textAlign(RIGHT, CENTER);
            textSize(numSize); text(pitchStr, rx, rowY+rowH/2);
            textSize(noteSize); text('\u2669', rx - numW - 1, rowY+rowH/2);
          } else if (cellHov && !pickerOpen) {
            fill(0,0,100,35); noStroke();
            textSize(min(8, rowH * 0.55)); textAlign(RIGHT, CENTER);
            text('\u2669', x0+cellW-3, rowY+rowH/2);
          }
        } else if (on && cp !== 0 && cellW >= 6) {
          fill(0,0,100,60); noStroke();
          circle(x0+cellW-3, rowY+3, 2);
        }
      }
      if (!on&&!isHead) {
        const isBeat=step%4===0;
        const dotHue = isMelody ? MELODY_CELL[0] : dHue(drum.hue);
        fill(dotHue,28,isBeat?60:80,75); noStroke(); circle(x0+cellW/2,rowY+rowH/2,isBeat?3:1.8);
      }
    }
  });

  for (let step=1;step<grid.steps;step++) {
    const cellX=gridLeft+stepPositions[step]*seqW;
    stroke(0,0,step%4===0?28:58); strokeWeight(1);
    line(cellX,slotGridTopY+1,cellX,slotGridTopY+gridHeight-1);
  }

  if (seqPlaying&&loopProgress>=0) {
    stroke(...ACCENT,22); strokeWeight(6); line(scanX,slotGridTopY,scanX,slotGridTopY+gridHeight);
    stroke(...INK,60);    strokeWeight(1); line(scanX,slotGridTopY,scanX,slotGridTopY+gridHeight);
  }

  // Seq label drag reorder insertion line
  if (drag && drag.type==='reorderSeqLabel' && drag.triggered && drag.slotIdx===slotIndex) {
    const tgt = seqLabelReorderTarget(drag, slotIndex, slotGridTopY, seqRowHeight);
    if (tgt >= 0 && tgt <= numSeqRows) {
      const lineY = slotGridTopY + tgt * seqRowHeight;
      push(); stroke(205, 45, 62); strokeWeight(2); noFill();
      line(SEQ_MARGIN, lineY, gridLeft, lineY);
      pop();
    }
  }
}

/** Compute seq label reorder target row index (0 = before first, n = after last). */
function seqLabelReorderTarget(dragState, slotIndex, slotGridTopY, seqRowHeight) {
  const slot = slots[slotIndex];
  const seqDrums = getSeqPads(slot);
  const effY = dragState.currentY + seqScrollY;
  for (let i = 0; i < seqDrums.length; i++) {
    if (effY < slotGridTopY + i * seqRowHeight + seqRowHeight / 2) return i;
  }
  return seqDrums.length;
}

/** Draw the pill scrollbar to the right of the sequencer. */
function drawSeqScrollbar(gridTop, visibleHeight, seqRowHeight) {
  const totalH = totalSeqContentHeight(seqRowHeight);
  if (totalH > visibleHeight) {
    const sbX = cW()-6, sbW = 4;
    const thumbH = Math.max(20, visibleHeight * (visibleHeight/totalH));
    const thumbY = gridTop + (seqScrollY / Math.max(1, totalH-visibleHeight)) * (visibleHeight-thumbH);
    fill(...INK_FAINT, 40); noStroke(); rect(sbX, gridTop, sbW, visibleHeight, sbW/2);
    fill(...INK_DIM, 85); noStroke(); rect(sbX, thumbY, sbW, thumbH, sbW/2);
  }
}

/** Top-level sequencer draw — orchestrates control bar, slots, and scrollbar. */
function drawSequencer() {
  const {seqTop,seqW,seqRowHeight,ctrlY,gridTop,gridLeft}=getSeqLayout();
  const visibleHeight=cH()-gridTop;
  seqScrollY=constrain(seqScrollY, 0, Math.max(0, totalSeqContentHeight(seqRowHeight)-visibleHeight));

  drawSeqControlBar(ctrlY);

  // Scrollable sequencer content
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(0, gridTop, cW(), visibleHeight);
  drawingContext.clip();
  push(); translate(0, -seqScrollY);

  // Clamp globalEditMeasure to max measures across all slots
  const globalMaxM = Math.max(...slots.map(s => s.grid.measures.length));
  if (globalEditMeasure >= globalMaxM) globalEditMeasure = globalMaxM - 1;

  // Update globalEditMeasure to follow playback when not locked
  if (seqPlaying && !globalMeasureLock) {
    // Find the slot with the most measures and use its phase
    const refIdx = slots.findIndex(s => s.grid.measures.length === globalMaxM);
    const refFrac = slotLoopFraction(refIdx >= 0 ? refIdx : 0);
    globalEditMeasure = refFrac.measureIdx;
  }

  slots.forEach((slot,slotIndex) => {
    const slotGridTopY=getSlotGridTop(slotIndex,gridTop,seqRowHeight);
    const seqDrums=getSeqPads(slot);
    const isLast=slotIndex===slots.length-1;
    // Sync editMeasure: locked → global; stopped → global; playing+unlocked → follows playback
    const slotFrac=slotLoopFraction(slotIndex);
    if (globalMeasureLock || !seqPlaying) {
      slot.grid.editMeasure=globalEditMeasure%slot.grid.measures.length;
    } else if (seqPlaying) {
      slot.grid.editMeasure=slotFrac.measureIdx;
    }
    const loopProgress=seqPlaying?slotFrac.fraction:-1;
    drawSlotHeader(slot, slotIndex, slotGridTopY, seqRowHeight, seqDrums.length);
    drawSlotGrid(slot, slotIndex, slotGridTopY, seqRowHeight, seqW, gridLeft, loopProgress, isLast);
  });

  // Drag-to-reorder insertion line
  if (drag&&drag.type==='reorderSlot') {
    const tgt=reorderTargetIdx(drag.currentY,gridTop,seqRowHeight);
    let lineY;
    if (tgt<slots.length) lineY=getSlotHeaderY(tgt,gridTop,seqRowHeight);
    else { const lastSlot=slots[slots.length-1]; lineY=getSlotGridTop(slots.length-1,gridTop,seqRowHeight)+getSeqPads(lastSlot).length*seqRowHeight; }
    stroke(...ACCENT); strokeWeight(2.5); noFill(); line(SEQ_MARGIN,lineY,SEQ_MARGIN+(cW()-SEQ_MARGIN*2),lineY);
  }

  // Two add-slot buttons: drum + melody (below last slot)
  const lastSlot=slots[slots.length-1];
  const lastGridTop=getSlotGridTop(slots.length-1,gridTop,seqRowHeight);
  const numLastRows=Math.max(1,getSeqPads(lastSlot).length);
  const addSlotY=lastGridTop+numLastRows*slotRowHeight(lastSlot, seqRowHeight)+20;
  const addSlotCenterY=addSlotY+20;
  const addSlotGap=40;
  const addSlotMidX=SEQ_MARGIN+SEQ_LABEL_W+seqW/2;
  const addDrumX=addSlotMidX-addSlotGap/2-12;
  const addMelodyX=addSlotMidX+addSlotGap/2+12;
  const effMouseYAddSlot=mY()+seqScrollY;
  const addDrumHov=abs(mX()-addDrumX)<18&&abs(effMouseYAddSlot-addSlotCenterY)<18&&mY()>=gridTop;
  const addMelodyHov=abs(mX()-addMelodyX)<18&&abs(effMouseYAddSlot-addSlotCenterY)<18&&mY()>=gridTop;

  // Drum add button: + with grid dots icon
  _drawPlus(addDrumX, addSlotCenterY, addDrumHov);
  push(); noStroke();
  fill(addDrumHov ? [...ACCENT] : [...INK_DIM]);
  // 2x3 dot grid icon
  for (let r=0;r<2;r++) for (let c=0;c<3;c++)
    circle(addDrumX+6+c*3, addSlotCenterY+6+r*3, 1.5);
  pop();

  // Melody add button: + with piano-roll lines icon
  _drawPlus(addMelodyX, addSlotCenterY, addMelodyHov);
  push(); noStroke();
  fill(addMelodyHov ? [...ACCENT] : [...INK_DIM]);
  // Horizontal lines icon (piano roll)
  for (let r=0;r<3;r++) {
    rect(addMelodyX+4, addSlotCenterY+5+r*3, 8, 1.2, 0.5);
  }
  pop();

  pop();
  drawingContext.restore();

  drawSeqScrollbar(gridTop, visibleHeight, seqRowHeight);
}


// ── Overlays ─────────────────────────────────────────────────────────────────

function drawRecordingOverlay() {
  const barW=min(420,cW()-80),barH=36,barX=(cW()-barW)/2,barY=HEADER_H+6;
  fill(...PANEL,92); stroke(...INK,60); strokeWeight(1); rect(barX,barY,barW,barH,CORNER_RADIUS);
  if (analyserNode&&waveformData) {
    analyserNode.getByteTimeDomainData(waveformData);
    stroke(0,65,50,80); strokeWeight(1.5); noFill(); beginShape();
    for (let i=0;i<waveformData.length;i++)
      vertex(barX+8+map(i,0,waveformData.length-1,0,barW-16),barY+map(waveformData[i],0,255,barH-4,4));
    endShape();
  }
  const elapsed=((millis()-recStart)/1000).toFixed(1);
  fill(0,70,62,70+sin(frameCount*0.15)*25); noStroke(); circle(barX+14,barY+barH/2,7);
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER); text(elapsed+'s',barX+22,barY+barH/2);
  fill(...INK_DIM); textAlign(RIGHT,CENTER); textSize(8); text('R or \u25cf to stop',barX+barW-8,barY+barH/2);
}



function drawErrorOverlay() {
  noStroke(); fill(...BG,88); rect(0,HEADER_H,cW(),cH()-HEADER_H);
  const cx=cW()/2,cy=cH()/2;
  fill(...RED); textSize(11); textAlign(CENTER); text('ERROR',cx,cy-16);
  fill(...INK_DIM); textSize(9); text(errorMsg,cx,cy+2);
  const hov=abs(mX()-cx)<50&&abs(mY()-(cy+22))<10;
  fill(hov?INK:INK_FAINT); textSize(9); text('dismiss',cx,cy+22); cursor(hov?HAND:ARROW);
}

// ── Trimmer overlay ──────────────────────────────────────────────────────────

function drawTrimOverlay() {
  if (!trimState) return;
  cursor(ARROW);
  const {buffer, trimStart, trimEnd, wfPeaks, fileName} = trimState;
  const dur = buffer.duration;

  noStroke(); fill(...BG,94); rect(0,HEADER_H,cW(),cH()-HEADER_H);

  const wfX=50, wfY=HEADER_H+36, wfW=cW()-100, wfH=120;
  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(wfX,wfY,wfW,wfH,CORNER_RADIUS);

  const startFrac=trimStart/dur, endFrac=trimEnd/dur;
  const n=wfPeaks.length;
  for (let px=0;px<wfW;px++) {
    const t=px/wfW;
    const inTrim=t>=startFrac&&t<=endFrac;
    const peak=wfPeaks[Math.floor(t*n)];
    const barHeight=peak*(wfH-8)*0.85;
    stroke(inTrim?[...ACCENT]:INK_FAINT); strokeWeight(1);
    line(wfX+px,wfY+wfH/2-barHeight/2,wfX+px,wfY+wfH/2+barHeight/2);
  }

  noStroke(); fill(...BG,62);
  if (startFrac>0) rect(wfX+1,wfY+1,startFrac*(wfW-2),wfH-2,CORNER_RADIUS,0,0,CORNER_RADIUS);
  if (endFrac<1) rect(wfX+1+endFrac*(wfW-2),wfY+1,(1-endFrac)*(wfW-2),wfH-2,0,CORNER_RADIUS,CORNER_RADIUS,0);

  const startHandleX=wfX+startFrac*wfW, endHandleX=wfX+endFrac*wfW;
  const handleTop=wfY+wfH/2-12, handleBot=wfY+wfH/2+12;
  const onHandle=mY()>handleTop&&mY()<handleBot;
  const nearStart=onHandle&&abs(mX()-startHandleX)<8;
  const nearEnd=onHandle&&abs(mX()-endHandleX)<8;
  stroke(...INK); strokeWeight(1.5);
  line(startHandleX,wfY,startHandleX,wfY+wfH); line(endHandleX,wfY,endHandleX,wfY+wfH);
  fill(nearStart?ACCENT:PANEL); noStroke(); rect(startHandleX-4,wfY+wfH/2-12,7,24,2);
  fill(nearEnd?ACCENT:PANEL); rect(endHandleX-3,wfY+wfH/2-12,7,24,2);

  if (trimPlaySrc) {
    const elapsed=audioCtx.currentTime-trimPlayStartTime;
    const curSec=trimPlayStartSec+elapsed;
    if (curSec<=trimEnd) {
      const scanX=wfX+curSec/dur*wfW;
      stroke(...ACCENT,80); strokeWeight(1.5); line(scanX,wfY,scanX,wfY+wfH);
    }
  }
  const inTrimRegion=mX()>Math.min(startHandleX,endHandleX-1)&&mX()<Math.max(endHandleX,startHandleX+1)&&mY()>wfY&&mY()<wfY+wfH;
  if (nearStart||nearEnd) cursor('ew-resize');
  else if (inTrimRegion) cursor(MOVE);

  const selDur=trimEnd-trimStart;
  const isCustomClip = trimState.mode === 'customClip';
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,TOP);
  if (!isCustomClip) text('max 30s', cW()/2, HEADER_H+12);
  else text('select clip region', cW()/2, HEADER_H+12);
  textSize(8); textAlign(LEFT,TOP);
  text(selDur.toFixed(1)+'s selected', wfX, wfY+wfH+8);
  textAlign(RIGHT,TOP);
  text('total: '+dur.toFixed(1)+'s', wfX+wfW, wfY+wfH+8);
  const leftW=textWidth(selDur.toFixed(1)+'s selected'), rightW=textWidth('total: '+dur.toFixed(1)+'s');
  const fnMaxW=(wfX+wfW-rightW-8)-(wfX+leftW+8);
  textAlign(CENTER,TOP);
  text(truncateMiddle(fileName||'', fnMaxW), cW()/2, wfY+wfH+8);

  const btnY=wfY+wfH+28, btnH=22;
  const canX=wfX, canW=60;
  const canHov=mX()>canX&&mX()<canX+canW&&mY()>btnY&&mY()<btnY+btnH;
  fill(canHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(canX,btnY,canW,btnH,CORNER_RADIUS);
  fill(canHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('CANCEL',canX+canW/2,btnY+btnH/2);

  // Stem isolation toggle (between CANCEL and PLAY)
  if (!isCustomClip) {
    const stemLabels = ['FULL', 'VOX', 'DRUMS'];
    const stemValues = ['full', 'vocals', 'drums'];
    const playBtnLeft = cW()/2-32;
    const gap = playBtnLeft - (canX+canW);
    const capsW = Math.min(gap - 16, 150);
    const capsX = canX + canW + (gap - capsW) / 2;
    const cellW = capsW / 3;
    for (let i = 0; i < 3; i++) {
      const cx = capsX + i * cellW;
      const sel = trimStemMode === stemValues[i];
      const hov = mX()>cx&&mX()<cx+cellW&&mY()>btnY&&mY()<btnY+btnH;
      const rTL = i===0 ? CORNER_RADIUS : 0, rTR = i===2 ? CORNER_RADIUS : 0;
      const rBR = i===2 ? CORNER_RADIUS : 0, rBL = i===0 ? CORNER_RADIUS : 0;
      fill(sel ? ACCENT : (hov ? [...INK_FAINT] : PANEL));
      stroke(...INK); strokeWeight(1);
      rect(cx, btnY, cellW, btnH, rTL, rTR, rBR, rBL);
      fill(sel ? [0,0,98] : INK); noStroke(); textSize(7); textAlign(CENTER,CENTER);
      text(stemLabels[i], cx+cellW/2, btnY+btnH/2);
    }
  }

  const isPlayingPreview = !!trimPlaySrc;
  const playBtnW=64, playBtnX=cW()/2-playBtnW/2;
  const playHov=mX()>playBtnX&&mX()<playBtnX+playBtnW&&mY()>btnY&&mY()<btnY+btnH;
  fill(isPlayingPreview||playHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(playBtnX,btnY,playBtnW,btnH,CORNER_RADIUS);
  fill(isPlayingPreview||playHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text(isPlayingPreview?'\u25a0 STOP':'\u25b6 PLAY', playBtnX+playBtnW/2, btnY+btnH/2);

  const upLabel=(isCustomClip?'USE ':'UPLOAD ')+selDur.toFixed(1)+'s';
  textSize(8); const upW=max(80,textWidth(upLabel)+20);
  const upX=wfX+wfW-upW;
  const upHov=mX()>upX&&mX()<upX+upW&&mY()>btnY&&mY()<btnY+btnH;
  fill(upHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(upX,btnY,upW,btnH,CORNER_RADIUS);
  fill(upHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text(upLabel,upX+upW/2,btnY+btnH/2);
}
