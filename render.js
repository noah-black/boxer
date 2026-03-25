// ── BOXER — All drawing: header, pads, sequencer, overlays, layout ───────────

// ── Background gradient ──────────────────────────────────────────────────────

function drawBgGradient() {
  const ctx = drawingContext;
  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(1, '#badcff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);
}

// ── Layout computation ───────────────────────────────────────────────────────

function getPadLayout() {
  const gap = 0;
  const numActive = currentSlot().activePadIds.length;
  const hasPlus = numActive < PAD_DEFS.length;
  const row0cols = Math.min(numActive, 8) + (numActive <= 8 && hasPlus ? 1 : 0);
  const nCols    = Math.max(row0cols, 1);
  const padW   = max(66, min(96, (cW()-SEQ_MARGIN*2) / nCols));
  const total  = padW * nCols;
  const startX = (cW()-total)/2;
  const padY   = HEADER_H+10+TRIM_H+TRIM_GAP;
  const numPadRows = numActive > 8 ? 2 : 1;
  return { padW, gap, startX, padY, numPadRows };
}

function padRowStep() { return PAD_H+LYRICS_STRIP_H+TRIM_H+TRIM_GAP+PAD_ROW_GAP; }

function padXY(padIndex, padW, gap, startX, padY) {
  const row = padIndex<8?0:1, col = row===0?padIndex:padIndex-8;
  return { x: startX+col*(padW+gap), y: padY+row*padRowStep() };
}

function plusBtnXY(padW, gap, startX, padY) {
  const numActive = currentSlot().activePadIds.length;
  if (numActive >= PAD_DEFS.length) return null;
  const row = numActive<=8?0:1, col = row===0?numActive:numActive-8;
  return { x: startX+col*(padW+gap), y: padY+row*padRowStep() };
}

function totalSeqContentHeight(seqRowHeight) {
  let h = 0;
  slots.forEach(slot => { h += SLOT_HDR_H + getSeqPads(slot).length * seqRowHeight + SLOT_GAP; });
  return h + 96;
}

function getSeqLayout() {
  const { padY, numPadRows } = getPadLayout();
  const seqTop  = padY+(numPadRows-1)*padRowStep()+PAD_H+LYRICS_STRIP_H+14;
  const seqW    = cW()-SEQ_MARGIN*2-SEQ_LABEL_W;
  const gridTop = seqTop+SEQ_CTRL_H;
  const available = cH()-gridTop-96; // reserve space for add-slot "+" below last slot
  const totalGridRows = slots.reduce((acc,slot) => acc+getSeqPads(slot).length, 0);
  const N = slots.length;
  const SLOT_HDR_MIN = 22;
  // First compute row height assuming header = row height
  const uniformH = constrain(floor((available - (N-1)*SLOT_GAP) / Math.max(1, totalGridRows + N)), SEQ_ROW_H_MIN, SEQ_ROW_H_MAX);
  // Header has its own minimum to accommodate slider controls
  SLOT_HDR_H = Math.max(uniformH, SLOT_HDR_MIN);
  // Recompute row height with the actual header space subtracted
  const headerTotal = N * SLOT_HDR_H + (N-1) * SLOT_GAP;
  const seqRowHeight = constrain(floor((available - headerTotal) / Math.max(1, totalGridRows)), SEQ_ROW_H_MIN, SEQ_ROW_H_MAX);
  return { seqTop, seqW, seqRowHeight, ctrlY: seqTop, gridTop, gridLeft: SEQ_MARGIN+SEQ_LABEL_W };
}

function getSlotGridTop(slotIndex, gridTop, seqRowHeight) {
  let y = gridTop;
  for (let i = 0; i < slotIndex; i++) {
    const slot = slots[i], numRows = getSeqPads(slot).length;
    y += SLOT_HDR_H + numRows*seqRowHeight + SLOT_GAP;
  }
  return y + SLOT_HDR_H;
}

function getSlotHeaderY(slotIndex, gridTop, seqRowHeight) {
  return getSlotGridTop(slotIndex, gridTop, seqRowHeight) - SLOT_HDR_H;
}

function trimBarRect(x, y, padW) { return {x, y:y-TRIM_H-TRIM_GAP, w:padW, h:TRIM_H}; }

function dialCenter(x, y, padW, padH, dialIndex) {
  const spacing = padW/3;
  return {cx: x+spacing*(dialIndex+1)-spacing*0.05, cy: y+padH-22, r: 10};
}

function swapBtnRect(x, y, padW) { return {x:x+6, y:y+5, w:13, h:13}; }


/** Compute slot header control positions. Sliders compress by up to 20% when space is tight. */
function slotHeaderLayout(headerRight, nMeasures) {
  nMeasures = nMeasures || 1;
  const btnH=14;
  const capsuleCellW=btnH, capsuleCells=4, capsuleW=capsuleCellW*capsuleCells;
  const removeW=14, removeGap=5;
  const removeX=headerRight-5-removeW;
  const capsuleX=removeX-removeGap-capsuleW;

  // Step stepper: [- NN +] compact widget, fixed width
  const stepW=36, stepH=12;
  const stepX=capsuleX-8-stepW;

  // Measure tabs: right after hamburger
  const measureTabW=12, measurePlusW=12;
  const measureTabsX=SEQ_MARGIN+22;
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
    removeX, removeW,
    volSliderX, volSliderW,
    swingSliderX, swingSliderW, humSliderX, humSliderW,
    stepX, stepW, stepH,
    measureTabW, measurePlusW, measureTabsX, measureTabsW,
  };
}

// ── Element positioning ──────────────────────────────────────────────────────

function positionPadInputs() {
  const { padW, gap, startX, padY } = getPadLayout();
  const slot = currentSlot();
  slot.activePadIds.forEach((id, i) => {
    const el = slot.padInputEls[id]; if (!el) return;
    const {x:px, y:py} = padXY(i, padW, gap, startX, padY);
    const finalized = !!slot.padFinalized[id];
    const inputW = finalized ? padW-24 : padW-24;
    el.elt.style.left=((px+5)*UI_SCALE)+'px'; el.elt.style.top=((py+40)*UI_SCALE)+'px';
    el.elt.style.width=(inputW*UI_SCALE)+'px'; el.elt.style.fontSize=(9*UI_SCALE)+'px';
    el.elt.style.textAlign='center';
    el.elt.style.borderBottom = finalized ? 'none' : '1px solid rgba(0,0,0,0.35)';
    el.elt.readOnly = finalized;
  });
}

function updateElementVisibility() {
  const show = (phase==='ready'||phase==='recording');
  slots.forEach(slot => {
    const isCurrent = slot===currentSlot();
    const visible = show && isCurrent && slotHasAudio(slot) && !slot.analyzing && !slot.reuploadPending;
    Object.values(slot.padInputEls).forEach(el => {
      el.elt.style.display = visible?'block':'none';
    });
  });
}

// ── Main draw loop ───────────────────────────────────────────────────────────

function draw() {
  if (!_fontsReady) { drawBgGradient(); return; }
  SEQ_MARGIN = min(SEQ_MARGIN_MAX, max(8, (cW() - CONTENT_MIN_W) / 2));
  drawBgGradient();
  push(); scale(UI_SCALE);
  drawHeader(); spinAngle += 0.04;
  drawPads(); drawSequencer();
  if (_pendingMenu) drawPadMenu(_pendingMenu.def,_pendingMenu.x,_pendingMenu.y,_pendingMenu.padW);
  if      (phase === 'recording')  drawRecordingOverlay();
  else if (phase === 'trimming')   drawTrimOverlay();
else if (phase === 'error')      drawErrorOverlay();
  if (padRecordingId) drawPadRecordingOverlay();
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
  // Save/Load buttons
  const btnW = 26, btnH = 28, btnGap = 6;
  const loadBtnX = cW() - SEQ_MARGIN - btnW;
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
  const loadBtnX = cW() - SEQ_MARGIN - btnW;
  const saveBtnX = loadBtnX - btnW - btnGap;
  const btnY = (HEADER_H - btnH) / 2;
  return { saveBtnX, loadBtnX, btnY, btnW, btnH };
}

// ── Trim bar (waveform above each pad) ───────────────────────────────────────

function drawTrimBar(drum, x, y, padW, roundLeft=true, roundRight=true) {
  const slot = currentSlot();
  const tb = trimBarRect(x, y, padW);
  const hasCandidates = slot.drumCandidates[drum.id] && slot.drumCandidates[drum.id].length>0;
  const curCand = hasCandidates ? slot.drumCandidates[drum.id][slot.drumIdx[drum.id]] : null;
  const overTrimBar = mX()>tb.x&&mX()<tb.x+tb.w&&mY()>tb.y&&mY()<tb.y+tb.h;
  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(tb.x,tb.y,tb.w,tb.h,roundLeft?3:0,roundRight?3:0,0,0);
  if (hasCandidates&&curCand) {
    // Get full context channel data
    let channel;
    if (curCand.buffer) { channel = curCand.buffer.getChannelData(0); }
    else if (slot.sourceBuffer) {
      const sr=slot.sourceBuffer.sampleRate;
      const sampleStart=Math.max(0,Math.floor((curCand.ctxStart||0)*sr));
      const sampleEnd=Math.min(slot.sourceBuffer.length,Math.ceil((curCand.ctxEnd||1)*sr));
      channel=slot.sourceBuffer.getChannelData(0).subarray(sampleStart,sampleEnd);
    }
    if (!channel) return;

    // Determine display range: normally [trimStart, trimEnd], modified during drag
    const ts=slot.drumTrimStart[drum.id]||0, te=slot.drumTrimEnd[drum.id]??1;
    const activeDrag=drag&&(drag.type==='trimStart'||drag.type==='trimEnd')&&drag.id===drum.id;
    let dispStart=ts, dispEnd=te; // range of context to display (fills the bar)
    let shrinkHandleFrac=null; // if shrinking, where to draw the handle (0-1 within bar)

    if (activeDrag) {
      const ps=drag.proposedStart??ts, pe=drag.proposedEnd??te;
      const extending=(drag.type==='trimStart')?(ps<ts):(pe>te);
      if (extending) {
        // Live-preview: show the extended range
        dispStart=ps; dispEnd=pe;
      } else {
        // Shrinking: keep display at committed range, show handle position
        dispStart=ts; dispEnd=te;
        if (drag.type==='trimStart') {
          shrinkHandleFrac=(ps-ts)/(te-ts);
        } else {
          shrinkHandleFrac=(pe-ts)/(te-ts);
        }
      }
    }

    // Render waveform scaled to fill bar from dispStart..dispEnd of context
    const dispLen=dispEnd-dispStart;
    if (dispLen>0.001) {
      for (let px=0; px<tb.w; px++) {
        const ctxFrac=dispStart+(px/tb.w)*dispLen;
        const sampleIdx=Math.floor(constrain(ctxFrac,0,1)*(channel.length-1));
        const step=max(1,Math.floor(dispLen*channel.length/tb.w));
        let peak=0;
        for (let s2=sampleIdx; s2<min(sampleIdx+step,channel.length); s2++) peak=max(peak,abs(channel[s2]));
        const barHeight=peak*(tb.h-4)*0.9;
        // During shrink drag, dim the area being trimmed away
        let inActive=true;
        if (shrinkHandleFrac!==null) {
          const barFrac=px/tb.w;
          if (drag.type==='trimStart') inActive=barFrac>=shrinkHandleFrac;
          else inActive=barFrac<=shrinkHandleFrac;
        }
        stroke(drum.hue,inActive?DRUM_S:22,inActive?DRUM_B:80); strokeWeight(1);
        line(tb.x+px,tb.y+tb.h/2-barHeight/2,tb.x+px,tb.y+tb.h/2+barHeight/2);
      }
      // Shrink drag: dark mask over trimmed region
      if (shrinkHandleFrac!==null) {
        noStroke(); fill(...BG,55);
        if (drag.type==='trimStart') {
          rect(tb.x+1,tb.y+1,shrinkHandleFrac*(tb.w-2),tb.h-2,2,0,0,2);
        } else {
          const maskX=tb.x+1+shrinkHandleFrac*(tb.w-2);
          rect(maskX,tb.y+1,(1-shrinkHandleFrac)*(tb.w-2),tb.h-2,0,2,2,0);
        }
      }
    }

    // Handles: at edges normally, at shrink position during shrink drag
    const nearLeft=abs(mX()-tb.x)<8&&overTrimBar&&!activeDrag;
    const nearRight=abs(mX()-(tb.x+tb.w))<8&&overTrimBar&&!activeDrag;
    if (shrinkHandleFrac!==null) {
      // Draw handle at shrink position
      const hx=tb.x+shrinkHandleFrac*tb.w;
      fill(drum.hue,80,65); noStroke(); rect(hx-1.5,tb.y,3,tb.h,1);
    }
    // Always draw edge handles
    fill(drum.hue,nearLeft?80:DRUM_S,nearLeft?65:DRUM_B); noStroke(); rect(tb.x,tb.y,3,tb.h,roundLeft?1:0);
    fill(drum.hue,nearRight?80:DRUM_S,nearRight?65:DRUM_B); rect(tb.x+tb.w-3,tb.y,3,tb.h,0,roundRight?1:0,0,0);
  }
}

// ── Pad body ─────────────────────────────────────────────────────────────────

function drawPad(def, x, y, padW, roundLeft, roundRight) {
  const slot = currentSlot();
  const hasCandidates = slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length>0;
  const cands = slot.drumCandidates[def.id] || [];
  const el = slot.padInputEls[def.id];
  const textValue = el ? el.elt.value.trim() : '';
  const hasText = textValue!=='';
  const finalized = !!slot.padFinalized[def.id];
  const padLive = hasCandidates || hasText;
  const ago = millis()-(padFlash[def.id]||-9999);
  const active = (max(0,1-ago/110)>0)||(padHeld[def.id]||false);
  const padTotalHeight = PAD_H+LYRICS_STRIP_H;
  const tb=trimBarRect(x,y,padW), swp=swapBtnRect(x,y,padW);
  const volDialPos=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,0), pitchDialPos=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,1);
  const overTrimBar=mX()>tb.x&&mX()<tb.x+tb.w&&mY()>tb.y&&mY()<tb.y+tb.h;
  const overVol=dist(mX(),mY(),volDialPos.cx,volDialPos.cy)<volDialPos.r+4;
  const overPitch=dist(mX(),mY(),pitchDialPos.cx,pitchDialPos.cy)<pitchDialPos.r+4;
  const overSwap=mX()>swp.x&&mX()<swp.x+swp.w&&mY()>swp.y&&mY()<swp.y+swp.h;
  const overPad=mX()>x&&mX()<x+padW&&mY()>y&&mY()<y+PAD_H&&!overVol&&!overPitch&&!overSwap;

  // Trim bar
  drawTrimBar(def,x,y,padW,roundLeft,roundRight);

  // Pad body
  const padSat=active?14:(overPad&&padLive)?8:padLive?5:3;
  const padBri=active?94:98;
  if (!hasText&&!hasCandidates) fill(...BG,40); else fill(def.hue,padSat,padBri);
  stroke(...INK); strokeWeight(active?2:1); rect(x,y,padW,padTotalHeight,0,0,roundRight?CORNER_RADIUS:0,roundLeft?CORNER_RADIUS:0);
  fill(active?INK_DIM:padLive?[def.hue,DRUM_S,DRUM_B]:INK_FAINT);
  noStroke(); textSize(32); textAlign(CENTER,CENTER);
  text(padDisplayKey(def.id),x+padW/2,y+PAD_H/2-22);
  drawDial(def,x,y,padW,PAD_H+LYRICS_STRIP_H,0,slot.drumVolumes[def.id]??0.8, 0,  1, hasCandidates,active);
  drawDial(def,x,y,padW,PAD_H+LYRICS_STRIP_H,1,slot.drumPitch[def.id]??0,   -12, 12,hasCandidates,active);
  // Swap button
  if (cands.length>1) {
    const hov=mX()>swp.x&&mX()<swp.x+swp.w&&mY()>swp.y&&mY()<swp.y+swp.h;
    fill(hov?ACCENT:PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(swp.x+swp.w/2,swp.y+swp.h/2,swp.w);
    fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('\u21bb',swp.x+swp.w/2,swp.y+swp.h/2+1);
    fill(...INK); textSize(6); textStyle(BOLD); textAlign(CENTER,TOP);
    text(`${(slot.drumIdx[def.id]||0)+1}/${cands.length}`,swp.x+swp.w/2,swp.y+swp.h+2); textStyle(NORMAL);
  }
  // Remove-pad × (top-right)
  const rmSize=7;
  const rmCx=x+padW-12,rmCy=y+12;
  const rmHov=dist(mX(),mY(),rmCx,rmCy)<rmSize+2;
  push(); strokeCap(ROUND); noFill();
  stroke(rmHov?RED:INK_FAINT); strokeWeight(2);
  line(rmCx-rmSize/2,rmCy-rmSize/2,rmCx+rmSize/2,rmCy+rmSize/2); line(rmCx+rmSize/2,rmCy-rmSize/2,rmCx-rmSize/2,rmCy+rmSize/2);
  pop(); if (rmHov) cursor(HAND);
  // Input row icons (vertically centred with the DOM input at y+40)
  const iconY=y+47;
  if (finalized) {
    // Clear × — positioned just right of the pad label text, clamped to input width
    const el=slot.padInputEls[def.id];
    const labelText=el?el.elt.value:'';
    textSize(9);
    const labelW=textWidth(labelText);
    const inputW=padW-24;
    const inputCx=x+5+inputW/2; // center of the input field
    const visibleLabelW=min(labelW, inputW);
    const clearXPos=inputCx+visibleLabelW/2+7;
    const clampedClearX=min(clearXPos, x+padW-6);
    const clearSize=3.5;
    const clearHov=dist(mX(),mY(),clampedClearX,iconY)<clearSize+4;
    push(); strokeCap(ROUND); noFill();
    stroke(clearHov?RED:INK_FAINT); strokeWeight(1.5);
    line(clampedClearX-clearSize/2,iconY-clearSize/2,clampedClearX+clearSize/2,iconY+clearSize/2); line(clampedClearX+clearSize/2,iconY-clearSize/2,clampedClearX-clearSize/2,iconY+clearSize/2);
    pop(); if (clearHov) cursor(HAND);
  } else {
    // Hamburger menu icon
    const hamX=x+padW-14, hamHov=dist(mX(),mY(),hamX,iconY)<8;
    fill(hamHov?INK_DIM:INK_FAINT); noStroke();
    for (let li=0;li<3;li++) rect(hamX-4,iconY-4+li*3.5,8,1.5,0.75);
    if (hamHov) cursor(HAND);
  }
  // Cursor
  const nearHandle=hasCandidates&&overTrimBar&&(abs(mX()-tb.x)<8||abs(mX()-(tb.x+tb.w))<8);
  cursor(nearHandle||overVol||overPitch||(overSwap&&cands.length>1)||(overPad&&padLive)?HAND:ARROW);
}

// ── Hamburger dropdown (drawn in second pass above other pads) ──────────────

function drawPadMenu(def, x, y, padW) {
  const slot = currentSlot();
  if (!slot.padMenuOpen[def.id]) return;
  const items = getPadMenuItems(slot, def.id);
  if (items.length === 0) return;
  const menuW=72, itemH=18;
  const menuX=x+padW-menuW, menuY=y+55;
  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(menuX,menuY,menuW,itemH*items.length,3);
  items.forEach((item,i) => {
    const iy=menuY+i*itemH;
    const hov=mX()>menuX&&mX()<menuX+menuW&&mY()>iy&&mY()<iy+itemH;
    if (hov) { fill(...BG); noStroke(); rect(menuX+1,iy+(i===0?1:0),menuW-2,itemH-(i===0||i===items.length-1?1:0),i===0?2:0,i===0?2:0,i===items.length-1?2:0,i===items.length-1?2:0); cursor(HAND); }
    fill(hov?INK:INK_DIM); noStroke(); textSize(7); textAlign(LEFT,CENTER);
    text(item.label,menuX+6,iy+itemH/2);
  });
}

// ── Plus button ──────────────────────────────────────────────────────────────

const PLUS_FONT_SIZE = 64;

function _drawPlus(centerX, centerY, hov) {
  drawingContext.save();
  drawingContext.font = PLUS_FONT_SIZE+"px 'Silkscreen', monospace";
  drawingContext.textAlign = 'center'; drawingContext.textBaseline = 'middle';
  drawingContext.strokeStyle = 'rgba(20,17,10,0.35)';
  drawingContext.lineWidth = 1.5; drawingContext.lineJoin = 'round';
  drawingContext.strokeText('+', centerX, centerY);
  drawingContext.fillStyle = hov ? 'rgba(0,0,0,0.48)' : 'rgba(0,0,0,0.28)';
  drawingContext.fillText('+', centerX, centerY);
  drawingContext.restore();
  if (hov) cursor(HAND);
}

const PROTO_SHORTCUTS = [
  { name: 'kick',  label: 'kick',  hue: 10  },
  { name: 'snare', label: 'snare', hue: 205 },
  { name: 'hihat', label: 'hihat', hue: 80  },
  { name: 'clap',  label: 'clap',  hue: 295 },
];

function protoChipRects(x, y, padW) {
  const slot = currentSlot();
  if (!slot.analyzeResults || Object.keys(slot.analyzeResults).length === 0) return [];
  const chips = PROTO_SHORTCUTS.filter(p => slot.analyzeResults[p.name]);
  if (chips.length === 0) return [];
  const cx = x + padW/2, cy = y + PAD_H/2;
  const chipW = 28, chipH = 24, gap = 4;
  // Spread chips out from center, but clamp so they stay within the padW column
  const maxSpread = Math.max(0, padW/2 - chipW - gap/2 - 1);
  const spread = Math.min(10, maxSpread);
  const positions = [
    { dx: -(chipW + gap/2) - spread, dy: -(chipH + gap/2) - spread },
    { dx: gap/2 + spread,            dy: -(chipH + gap/2) - spread },
    { dx: -(chipW + gap/2) - spread, dy: gap/2 + spread },
    { dx: gap/2 + spread,            dy: gap/2 + spread },
  ];
  return chips.map((proto, i) => {
    const pos = positions[i] || positions[0];
    return {
      name: proto.name, label: proto.label, hue: proto.hue,
      x: cx + pos.dx, y: cy + pos.dy, w: chipW, h: chipH
    };
  });
}

function drawPlusButton(x, y, padW) {
  const chips = protoChipRects(x, y, padW);
  // Draw "+" centered — chips sit around it in four corners
  const plusHov = mX()>x&&mX()<x+padW&&mY()>y&&mY()<y+PAD_H && !chips.some(c => mX()>c.x&&mX()<c.x+c.w&&mY()>c.y&&mY()<c.y+c.h);
  _drawPlus(x+padW/2, y+PAD_H/2, plusHov);
  const barH = 4;
  chips.forEach(chip => {
    const chipHov = mX()>chip.x&&mX()<chip.x+chip.w&&mY()>chip.y&&mY()<chip.y+chip.h;
    push();
    // Chip body
    strokeWeight(1); stroke(...(chipHov ? ACCENT : INK_DIM));
    fill(...PANEL);
    rect(chip.x, chip.y, chip.w, chip.h, 3);
    // Colored top bar
    noStroke();
    fill(chip.hue, chipHov ? DRUM_S : DRUM_S_LITE, chipHov ? DRUM_B : DRUM_B_LITE);
    rect(chip.x+1, chip.y+1, chip.w-2, barH, 2, 2, 0, 0);
    // Label
    noStroke(); fill(...(chipHov ? ACCENT : INK_DIM));
    textSize(7); textAlign(CENTER, CENTER);
    text(chip.label, chip.x+chip.w/2, chip.y+barH+(chip.h-barH)/2);
    pop();
    if (chipHov) cursor(HAND);
  });
}

// ── Empty-slot prompt (record / upload icons) ───────────────────────────────

function drawEmptySlotPrompt(padY) {
  const cx=cW()/2, cy=padY+PAD_H/2;
  const recCx=cx-50, upCx=cx+50;
  const recR=24;
  const recHov=dist(mX(),mY(),recCx,cy)<recR;
  const upHov=mX()>upCx-24&&mX()<upCx+24&&mY()>cy-24&&mY()<cy+24;

  // Record icon — solid red circle
  fill(recHov?[0,75,78]:RED); stroke(...INK); strokeWeight(1);
  circle(recCx,cy,recR*2);
  fill(...PANEL); noStroke(); circle(recCx,cy,recR*0.6);
  fill(recHov?[0,75,78]:RED); noStroke(); circle(recCx,cy,recR*0.5);

  // Upload icon — rounded rect with up-arrow
  noFill(); stroke(upHov?ACCENT:INK); strokeWeight(1.5);
  rect(upCx-22,cy-22,44,44,6);
  // Arrow shaft
  line(upCx,cy+10,upCx,cy-8);
  // Arrow head
  line(upCx-7,cy-2,upCx,cy-10); line(upCx+7,cy-2,upCx,cy-10);
  // Tray base
  line(upCx-12,cy+10,upCx-12,cy+14); line(upCx-12,cy+14,upCx+12,cy+14); line(upCx+12,cy+14,upCx+12,cy+10);

  // Labels
  fill(...INK_DIM); noStroke(); textSize(8); textAlign(CENTER,TOP);
  text('record',recCx,cy+recR+6);
  text('upload',upCx,cy+28);

  if (recHov||upHov) cursor(HAND);
}

// ── Analyzing animation (in pad area) ───────────────────────────────────────

function drawAnalyzingAnimation(padY) {
  const cx=cW()/2, cy=padY+PAD_H/2, ticks=12;
  for (let i=0;i<ticks;i++) {
    const angle=(i/ticks)*TWO_PI+spinAngle;
    const alpha=pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*70+5;
    stroke(...ACCENT,alpha); strokeWeight(2);
    line(cx+cos(angle)*18,cy+sin(angle)*18,cx+cos(angle)*28,cy+sin(angle)*28);
  }
  fill(...ACCENT); noStroke(); circle(cx,cy,5);
  fill(...INK_DIM); textSize(9); textAlign(CENTER,TOP);
  text('analyzing\u2026',cx,cy+36);
  const slot=currentSlot();
  if (slot.fileName) { fill(...INK_FAINT); textSize(8); text(slot.fileName,cx,cy+50); }
}

// ── All pads ─────────────────────────────────────────────────────────────────

let _pendingMenu = null;

function drawPads() {
  const {padW,gap,startX,padY}=getPadLayout();
  const slot=currentSlot();
  _pendingMenu=null;

  if ((!slotHasAudio(slot) || slot.reuploadPending) && !slot.analyzing) { drawEmptySlotPrompt(padY); return; }
  if (slot.analyzing) { drawAnalyzingAnimation(padY); return; }

  const isDragReorder = drag && drag.type==='reorderPad' && drag.triggered;
  const dragId = isDragReorder ? drag.padId : null;
  const dragTarget = isDragReorder ? padReorderTargetIdx(drag.currentX,drag.currentY,padW,gap,startX,padY,slot.activePadIds.length) : -1;

  slot.activePadIds.forEach((id,i) => {
    const def=getPadDef(id);
    const {x,y}=padXY(i,padW,gap,startX,padY);
    const roundLeft=(i===0||i===8);
    const roundRight=false;
    if (id===dragId) { push(); drawingContext.globalAlpha=0.25; drawPad(def,x,y,padW,roundLeft,roundRight); pop(); }
    else drawPad(def,x,y,padW,roundLeft,roundRight);
    if (slot.padMenuOpen[id]) _pendingMenu={def,x,y,padW};
  });

  // Draw insertion indicator during pad reorder
  if (isDragReorder && dragTarget >= 0) {
    const insertIdx = dragTarget > drag.padIndex ? dragTarget - 1 : dragTarget;
    const indicatorX = startX + constrain(dragTarget, 0, slot.activePadIds.length) * (padW + gap);
    const row = dragTarget <= 8 ? 0 : 1;
    const iy = padY + row * padRowStep();
    push(); stroke(205, 45, 62); strokeWeight(2); noFill();
    line(indicatorX, iy + 4, indicatorX, iy + PAD_H - 4);
    pop();
  }

  // Draw ghost pad at cursor
  if (isDragReorder) {
    const def = getPadDef(dragId);
    const ghostX = drag.currentX - padW / 2, ghostY = drag.currentY - PAD_H / 2;
    push(); drawingContext.globalAlpha = 0.6;
    drawPad(def, ghostX, ghostY, padW, false, false);
    pop();
  }

  const plusPos=plusBtnXY(padW,gap,startX,padY);
  if (plusPos) drawPlusButton(plusPos.x,plusPos.y,padW);
}

// ── Dials ────────────────────────────────────────────────────────────────────

function drawDial(drum, x, y, padW, padH, dialIndex, val, vmin, vmax, hasCandidates, active) {
  const {cx,cy,r}=dialCenter(x,y,padW,padH,dialIndex);
  const isPitch=(dialIndex===1), t=(val-vmin)/(vmax-vmin);
  const minAngle=PI*0.75, maxAngle=PI*2.25, valAngle=minAngle+t*(maxAngle-minAngle);
  stroke(0,0,hasCandidates?80:88); strokeWeight(2); noFill(); arc(cx,cy,r*2,r*2,minAngle,maxAngle);
  if (hasCandidates) {
    stroke(drum.hue,active?DRUM_S+10:DRUM_S,active?DRUM_B+5:DRUM_B); strokeWeight(2);
    if      (isPitch&&val>=0) arc(cx,cy,r*2,r*2,PI*1.5,valAngle);
    else if (isPitch)         arc(cx,cy,r*2,r*2,valAngle,PI*1.5);
    else                      arc(cx,cy,r*2,r*2,minAngle,valAngle);
  }
  fill(active?[drum.hue,DRUM_S,DRUM_B+8]:PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(cx,cy,r*2);
  const lineX=cx+cos(valAngle)*(r-2), lineY=cy+sin(valAngle)*(r-2);
  stroke(hasCandidates?[drum.hue,DRUM_S,DRUM_B]:INK_FAINT); strokeWeight(1.5); line(cx,cy,lineX,lineY);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,BOTTOM);
  text(isPitch?'PITCH':'VOL',cx,cy-r-2);
  fill(...INK_DIM); noStroke(); textSize(7); textAlign(CENTER,TOP);
  const labelString=isPitch?(val===0?'0':(val>0?'+':'')+Math.round(val)+'st'):Math.round(val*100)+'%';
  text(labelString,cx,cy+r+1);
}

// ── Slot header helpers ──────────────────────────────────────────────────────

/** Draw a labelled slider in a slot header (RAND, SWING, STEPS, VOL). */
function drawHeaderSlider(label, sliderX, sliderW, handleX, headerMid, valueText) {
  const sliderY = headerMid - 2;
  const hov = dist(mX(), mY(), handleX, headerMid - seqScrollY) < 5.5;
  stroke(...INK_FAINT); strokeWeight(1); line(sliderX, sliderY, sliderX + sliderW, sliderY);
  fill(hov ? ACCENT : PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(handleX, sliderY, 7);
  // Label centered below slider
  fill(...INK); noStroke(); textSize(7); textAlign(CENTER, TOP);
  const labelText = valueText !== undefined ? label + ' ' + valueText : label;
  text(labelText, sliderX + sliderW / 2, sliderY + 3);
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
  fill(minHov?ACCENT:INK_DIM); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text('\u2013', minusX+third/2, headerMid);
  // Number (hide when editing)
  if (!_stepEditInput||_stepEditInput.style.display==='none') {
    fill(...INK); textSize(7); text(steps, numX+third/2, headerMid);
  }
  // Plus
  fill(plusHov?ACCENT:INK_DIM); textSize(8); text('+', plusX+third/2, headerMid);
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
      stroke(xHov ? INK : INK_FAINT); strokeWeight(1.2);
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

/** Draw the C/D/S/M button capsule in a slot header. */
function drawButtonCapsule(cx, cy, cellW, cellH, headerMid, slot) {
  const labels=['C','D','S','M'];
  const accents=[RED,ACCENT,ACCENT,RED];
  const actives=[false,false,slot.soloed,slot.muted];
  const n=4;
  // Capsule outline
  fill(...PANEL); stroke(...INK_DIM); strokeWeight(1);
  rect(cx, cy, cellW*n, cellH, cellH/2);
  // Per-cell hover/active fills and labels
  for (let i=0; i<n; i++) {
    const x=cx+i*cellW;
    const hov=mX()>x&&mX()<x+cellW&&mY()>cy-seqScrollY&&mY()<cy+cellH-seqScrollY;
    if (hov||actives[i]) {
      // Fill this cell with accent, clipping to capsule shape
      drawingContext.save();
      drawingContext.beginPath();
      const r=cellH/2;
      const cLeft=cx+0.5, cTop=cy+0.5, cW=cellW*n-1, cH=cellH-1;
      drawingContext.moveTo(cLeft+r,cTop);
      drawingContext.lineTo(cLeft+cW-r,cTop);
      drawingContext.arcTo(cLeft+cW,cTop,cLeft+cW,cTop+r,r);
      drawingContext.lineTo(cLeft+cW,cTop+cH-r);
      drawingContext.arcTo(cLeft+cW,cTop+cH,cLeft+cW-r,cTop+cH,r);
      drawingContext.lineTo(cLeft+r,cTop+cH);
      drawingContext.arcTo(cLeft,cTop+cH,cLeft,cTop+cH-r,r);
      drawingContext.lineTo(cLeft,cTop+r);
      drawingContext.arcTo(cLeft,cTop,cLeft+r,cTop,r);
      drawingContext.closePath();
      drawingContext.clip();
      fill(accents[i]); noStroke();
      rect(x, cy, cellW, cellH);
      drawingContext.restore();
    }
    fill((hov||actives[i])?[0,0,98]:INK_DIM); noStroke(); textSize(7); textAlign(CENTER,CENTER);
    text(labels[i], x+cellW/2, headerMid);
  }
  // Divider lines between cells
  stroke(...INK_DIM); strokeWeight(1);
  for (let i=1; i<n; i++) {
    const x=cx+i*cellW;
    line(x, cy+2, x, cy+cellH-2);
  }
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

  const playX=SEQ_MARGIN+SEQ_LABEL_W;
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

  const clrAllX=tapX+tapW+10, clrAllW=50, clrAllH=20;
  const clrAllHov=mX()>clrAllX&&mX()<clrAllX+clrAllW&&mY()>ctrlMid-clrAllH/2&&mY()<ctrlMid+clrAllH/2;
  fill(clrAllHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(clrAllX,ctrlMid-clrAllH/2,clrAllW,clrAllH,CORNER_RADIUS);
  fill(clrAllHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('CLR ALL',clrAllX+clrAllW/2,ctrlMid);

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
  const tw = 12, tabH = 10, r = 3;
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
    textSize(6); textAlign(CENTER, CENTER);
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
  const L=slotHeaderLayout(headerRight, slot.grid.measures.length);
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

  drawButtonCapsule(L.capsuleX, btnY, L.capsuleCellW, L.btnH, headerMid, slot);
  drawRemoveSlotBtn(L.removeX, btnY, L.removeW, L.btnH, headerMid, slots.length>1);
}

/** Draw the step grid for a single slot (cells, column bands, scanline). */
function drawSlotGrid(slot, slotIndex, slotGridTopY, seqRowHeight, seqW, gridLeft, loopProgress, isLast) {
  const seqDrums=getSeqPads(slot), numSeqRows=seqDrums.length;
  if (numSeqRows === 0) return;

  const grid=slot.grid, gridHeight=numSeqRows*seqRowHeight;
  const stepPositions=computeStepPositions(grid,slot);
  const scanX=gridLeft+loopProgress*seqW;
  const ho=slot.hueOffset||0;
  const dHue=(h)=>(h+ho)%360;

  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(SEQ_MARGIN,slotGridTopY,cW()-SEQ_MARGIN*2,gridHeight,0,0,isLast?CORNER_RADIUS:0,isLast?CORNER_RADIUS:0);

  for (let step=0;step<grid.steps;step++) {
    const x0=gridLeft+stepPositions[step]*seqW, x1=gridLeft+stepPositions[step+1]*seqW;
    fill(Math.floor(step/4)%2===0?[0,0,91]:[0,0,85]); noStroke();
    rect(x0,slotGridTopY+1,x1-x0-1,gridHeight-2);
  }

  seqDrums.forEach((drum,rowIndex) => {
    const rowY=slotGridTopY+rowIndex*seqRowHeight;
    if (rowIndex>0) { stroke(0,0,58); strokeWeight(1); line(gridLeft,rowY,gridLeft+seqW,rowY); }

    fill((slot.drumCandidates[drum.id]&&slot.drumCandidates[drum.id].length>0)?[dHue(drum.hue),DRUM_S,DRUM_B]:INK_FAINT);
    noStroke(); textSize(7); textAlign(RIGHT,CENTER);
    const el=slot.padInputEls[drum.id];
    const textValue=el?el.elt.value.trim():'';
    let rowLabel=textValue||padDisplayKey(drum.id);
    const maxLabelW=SEQ_LABEL_W-20;
    if (textWidth(rowLabel)>maxLabelW) {
      while (rowLabel.length>1&&textWidth(rowLabel.trim()+'\u2026')>maxLabelW) rowLabel=rowLabel.slice(0,-1);
      rowLabel=rowLabel.trim()+'\u2026';
    }
    text(rowLabel,gridLeft-8,rowY+seqRowHeight/2);

    const ec=grid.measures[grid.editMeasure].cells;
    for (let step=0;step<grid.steps;step++) {
      const x0=gridLeft+stepPositions[step]*seqW, x1=gridLeft+stepPositions[step+1]*seqW;
      const cellW=max(x1-x0,2);
      const on=ec[drum.id]?ec[drum.id][step]:false;
      const isHead=seqPlaying&&loopProgress>=stepPositions[step]&&loopProgress<stepPositions[step+1];
      const effMouseY=mY()+seqScrollY;
      const cellHov=mX()>x0+1&&mX()<x0+cellW-1&&effMouseY>rowY+1&&effMouseY<rowY+seqRowHeight-1;
      const pad2=1.5;
      if      (isHead&&on) fill(dHue(drum.hue),DRUM_S+8,DRUM_B+10);
      else if (isHead)     fill(dHue(drum.hue),DRUM_S_LITE,DRUM_B_LITE-10);
      else if (on)         fill(dHue(drum.hue),DRUM_S,DRUM_B,cellHov?100:90);
      else if (cellHov)    fill(dHue(drum.hue),20,85,50);
      else                 noFill();
      noStroke();
      if (on||isHead||cellHov) rect(x0+pad2,rowY+pad2,cellW-pad2*2,seqRowHeight-pad2*2,2);
      if (!on&&!isHead) {
        const isBeat=step%4===0;
        fill(dHue(drum.hue),28,isBeat?60:80,75); noStroke(); circle(x0+cellW/2,rowY+seqRowHeight/2,isBeat?3:1.8);
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

  // + seq big plus (below last slot)
  const lastSlot=slots[slots.length-1];
  const lastGridTop=getSlotGridTop(slots.length-1,gridTop,seqRowHeight);
  const numLastRows=Math.max(1,getSeqPads(lastSlot).length);
  const addSlotY=lastGridTop+numLastRows*seqRowHeight+20;
  const addSlotCenterX=SEQ_MARGIN+SEQ_LABEL_W+seqW/2, addSlotCenterY=addSlotY+20;
  const effMouseYAddSlot=mY()+seqScrollY;
  const addSlotHov=abs(mX()-addSlotCenterX)<24&&abs(effMouseYAddSlot-addSlotCenterY)<18&&mY()>=gridTop;
  _drawPlus(addSlotCenterX, addSlotCenterY, addSlotHov);

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

function drawPadRecordingOverlay() {
  const barW=min(420,cW()-80),barH=36,barX=(cW()-barW)/2,barY=HEADER_H+6;
  fill(...PANEL,92); stroke(...INK,60); strokeWeight(1); rect(barX,barY,barW,barH,CORNER_RADIUS);
  if (padRecAnalyser&&padRecWaveformData) {
    padRecAnalyser.getByteTimeDomainData(padRecWaveformData);
    stroke(0,65,50,80); strokeWeight(1.5); noFill(); beginShape();
    for (let i=0;i<padRecWaveformData.length;i++)
      vertex(barX+8+map(i,0,padRecWaveformData.length-1,0,barW-16),barY+map(padRecWaveformData[i],0,255,barH-4,4));
    endShape();
  }
  const slot=currentSlot(), rec=slot.padRecorders[padRecordingId];
  const elapsed=rec?((Date.now()-rec.startTime)/1000).toFixed(1):'0.0';
  fill(0,70,62,70+sin(frameCount*0.15)*25); noStroke(); circle(barX+14,barY+barH/2,7);
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER); text(elapsed+'s',barX+22,barY+barH/2);
  const stopW=50, stopX=barX+barW-stopW-8, stopY=barY+4, stopH=barH-8;
  const stopHov=mX()>stopX&&mX()<stopX+stopW&&mY()>stopY&&mY()<stopY+stopH;
  fill(stopHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(stopX,stopY,stopW,stopH,3);
  fill(stopHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('STOP',stopX+stopW/2,barY+barH/2);
  if (stopHov) cursor(HAND);
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
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,TOP);
  text('max 30s', cW()/2, HEADER_H+12);
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

  const isPlayingPreview = !!trimPlaySrc;
  const playBtnW=64, playBtnX=cW()/2-playBtnW/2;
  const playHov=mX()>playBtnX&&mX()<playBtnX+playBtnW&&mY()>btnY&&mY()<btnY+btnH;
  fill(isPlayingPreview||playHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(playBtnX,btnY,playBtnW,btnH,CORNER_RADIUS);
  fill(isPlayingPreview||playHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text(isPlayingPreview?'\u25a0 STOP':'\u25b6 PLAY', playBtnX+playBtnW/2, btnY+btnH/2);

  const upLabel='UPLOAD '+selDur.toFixed(1)+'s';
  textSize(8); const upW=max(80,textWidth(upLabel)+20);
  const upX=wfX+wfW-upW;
  const upHov=mX()>upX&&mX()<upX+upW&&mY()>btnY&&mY()<btnY+btnH;
  fill(upHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(upX,btnY,upW,btnH,CORNER_RADIUS);
  fill(upHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text(upLabel,upX+upW/2,btnY+btnH/2);
}
