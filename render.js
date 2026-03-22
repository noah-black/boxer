// ── BOXER — All drawing: header, pads, sequencer, overlays, layout ───────────

// ── Layout computation ───────────────────────────────────────────────────────

function getPadLayout() {
  const gap = 0;
  const numActive = currentSlot().activePadIds.length;
  const hasPlus = numActive < CUSTOM_DEFS.length;
  const row0cols = DRUMS.length + Math.min(numActive, 4) + (numActive <= 4 && hasPlus ? 1 : 0);
  const nCols    = Math.max(row0cols, DRUMS.length + 1);
  const padW   = max(66, min(96, (width-SEQ_MARGIN*2) / nCols));
  const total  = padW * nCols;
  const startX = (width-total)/2;
  const padY   = HEADER_H+10+TRIM_H+TRIM_GAP;
  const numPadRows = numActive > 4 ? 2 : 1;
  return { padW, gap, startX, padY, numPadRows };
}

function padRowStep() { return PAD_H+LYRICS_STRIP_H+TRIM_H+TRIM_GAP+PAD_ROW_GAP; }

function customPadXY(customIndex, padW, gap, startX, padY) {
  const row = customIndex<4?0:1, col = row===0?DRUMS.length+customIndex:customIndex-4;
  return { x: startX+col*(padW+gap), y: padY+row*padRowStep() };
}

function plusBtnXY(padW, gap, startX, padY) {
  const numActive = currentSlot().activePadIds.length;
  if (numActive >= CUSTOM_DEFS.length) return null;
  let row, col;
  if (numActive < 4)       { row=0; col=DRUMS.length+numActive; }
  else if (numActive===4)  { row=0; col=DRUMS.length+4; }
  else                     { row=1; col=numActive-4; }
  return { x: startX+col*(padW+gap), y: padY+row*padRowStep() };
}

function totalSeqContentHeight(seqRowHeight) {
  let h = 0;
  slots.forEach(slot => { h += SLOT_HDR_H + getSeqDrums(slot).length * seqRowHeight + SLOT_GAP; });
  return h + 60;
}

function getSeqLayout() {
  const { padY, numPadRows } = getPadLayout();
  const seqTop  = padY+(numPadRows-1)*padRowStep()+PAD_H+LYRICS_STRIP_H+14;
  const seqW    = width-SEQ_MARGIN*2-SEQ_LABEL_W;
  const gridTop = seqTop+SEQ_CTRL_H;
  const available = height-gridTop;
  const totalGridRows = slots.reduce((acc,slot) => acc+getSeqDrums(slot).length, 0);
  const totalGapH = (slots.length-1)*(SLOT_GAP+SLOT_HDR_H) + slots.length*SLOT_HDR_H;
  const seqRowHeight = constrain(floor((available-totalGapH)/Math.max(1,totalGridRows)), SEQ_ROW_H_MIN, SEQ_ROW_H_MAX);
  return { seqTop, seqW, seqRowHeight, ctrlY: seqTop, gridTop, gridLeft: SEQ_MARGIN+SEQ_LABEL_W };
}

function getSlotGridTop(slotIndex, gridTop, seqRowHeight) {
  let y = gridTop;
  for (let i = 0; i < slotIndex; i++) {
    const slot = slots[i], numRows = getSeqDrums(slot).length;
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

function trimHandleX(x, padW, id) {
  const slot = currentSlot();
  return { startPx: x+(slot.drumTrimStart[id]||0)*padW, endPx: x+(slot.drumTrimEnd[id]??1)*padW };
}

// ── Element positioning ──────────────────────────────────────────────────────

function positionCustomInputs() {
  const { padW, gap, startX, padY } = getPadLayout();
  const slot = currentSlot();
  slot.activePadIds.forEach((id, i) => {
    const el = slot.customInputEls[i]; if (!el) return;
    const {x:px, y:py} = customPadXY(i, padW, gap, startX, padY);
    const finalized = !!slot.padFinalized[id];
    const inputW = finalized ? padW-24 : padW-44;
    el.elt.style.left=(px+5)+'px'; el.elt.style.top=(py+40)+'px';
    el.elt.style.width=inputW+'px'; el.elt.style.fontSize='9px';
    el.elt.style.textAlign='center';
    el.elt.style.borderBottom = finalized ? 'none' : '1px solid rgba(0,0,0,0.35)';
    el.elt.readOnly = finalized;
  });
}

function updateElementVisibility() {
  const show = (phase==='ready'||phase==='recording');
  slots.forEach(slot => {
    const isCurrent = slot===currentSlot();
    slot.customInputEls.forEach(el => {
      el.elt.style.display = (show&&isCurrent)?'block':'none';
    });
  });
}

// ── Main draw loop ───────────────────────────────────────────────────────────

function draw() {
  background(...BG);
  drawHeader(); spinAngle += 0.04;
  drawPads(); drawSequencer();
  if      (phase === 'recording')  drawRecordingOverlay();
  else if (phase === 'trimming')   drawTrimOverlay();
  else if (phase === 'processing') drawProcessingOverlay();
  else if (phase === 'error')      drawErrorOverlay();
}

// ── Header ───────────────────────────────────────────────────────────────────

function drawHeader() {
  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(0, 0, width, HEADER_H);
  if (logoImg) {
    const logoH = HEADER_H - 8;
    const logoW = logoImg.width * (logoH / logoImg.height);
    image(logoImg, 16, (HEADER_H - logoH) / 2, logoW, logoH);
  }
  const recX = 168, recY = HEADER_H / 2, recRadius = 13;
  const isRec = phase === 'recording';
  const recHov = dist(mouseX, mouseY, recX, recY) < recRadius;
  if (isRec) { noFill(); stroke(...RED, (sin(frameCount*0.15)*0.5+0.5)*40); strokeWeight(4); circle(recX,recY,recRadius*2+10); }
  fill(isRec?RED:recHov?RED:[0,50,90]); stroke(...INK); strokeWeight(1); circle(recX,recY,recRadius*2);
  fill(...PANEL); noStroke();
  if (isRec) { rectMode(CENTER); rect(recX,recY,8,8,1); rectMode(CORNER); } else { circle(recX,recY,7); }
  const uploadX = recX+recRadius+10;
  const uploadHov = mouseX>uploadX && mouseX<uploadX+80 && abs(mouseY-recY)<10;
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER); text('upload file',uploadX,recY);
  if (analyzing) {
    const flash = (sin(frameCount*0.18)*0.5+0.5);
    const pillX=uploadX+86, pillW=56, pillH=18;
    fill(0,70,72,60+flash*40); stroke(0,70,55); strokeWeight(1); rect(pillX,recY-pillH/2,pillW,pillH,pillH/2);
    fill(0,0,98); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('loading',pillX+pillW/2,recY);
  }
  cursor(recHov||uploadHov?HAND:ARROW);
}

// ── Trim bar (waveform above each pad) ───────────────────────────────────────

function drawTrimBar(drum, x, y, padW, roundLeft=true, roundRight=true) {
  const slot = currentSlot();
  const tb = trimBarRect(x, y, padW);
  const hasCandidates = slot.drumCandidates[drum.id] && slot.drumCandidates[drum.id].length>0;
  const curCand = hasCandidates ? slot.drumCandidates[drum.id][slot.drumIdx[drum.id]] : null;
  const overTrimBar = mouseX>tb.x&&mouseX<tb.x+tb.w&&mouseY>tb.y&&mouseY<tb.y+tb.h;
  fill(...PANEL); stroke(...INK); strokeWeight(1); rect(tb.x,tb.y,tb.w,tb.h,roundLeft?3:0,roundRight?3:0,0,0);
  if (hasCandidates&&curCand) {
    let channel;
    if (curCand.buffer) { channel = curCand.buffer.getChannelData(0); }
    else if (slot.sourceBuffer) {
      const sr=slot.sourceBuffer.sampleRate;
      const sampleStart=Math.max(0,Math.floor((curCand.ctxStart||0)*sr));
      const sampleEnd=Math.min(slot.sourceBuffer.length,Math.ceil((curCand.ctxEnd||1)*sr));
      channel=slot.sourceBuffer.getChannelData(0).subarray(sampleStart,sampleEnd);
    }
    if (!channel) return;
    const step=max(1,Math.floor(channel.length/tb.w));
    for (let px=0; px<tb.w; px++) {
      const frac=px/tb.w;
      const inTrim=frac>=(slot.drumTrimStart[drum.id]||0)&&frac<=(slot.drumTrimEnd[drum.id]??1);
      let peak=0; const sampleIdx=Math.floor(frac*channel.length);
      for (let s2=sampleIdx; s2<min(sampleIdx+step,channel.length); s2++) peak=max(peak,abs(channel[s2]));
      const barHeight=peak*(tb.h-4)*0.9;
      stroke(drum.hue,inTrim?DRUM_S:22,inTrim?DRUM_B:80); strokeWeight(1);
      line(tb.x+px,tb.y+tb.h/2-barHeight/2,tb.x+px,tb.y+tb.h/2+barHeight/2);
    }
    noStroke(); fill(...BG,55);
    rect(tb.x+1,tb.y+1,(slot.drumTrimStart[drum.id]||0)*(tb.w-2),tb.h-2,2,0,0,2);
    const endFrac=slot.drumTrimEnd[drum.id]??1;
    rect(tb.x+1+endFrac*(tb.w-2),tb.y+1,(1-endFrac)*(tb.w-2),tb.h-2,0,2,2,0);
    const origStart=(curCand.trimStart??0)*tb.w, origEnd=(curCand.trimEnd??1)*tb.w;
    stroke(drum.hue,30,45,60); strokeWeight(1);
    line(tb.x+origStart,tb.y+1,tb.x+origStart,tb.y+tb.h-1);
    line(tb.x+origEnd,tb.y+1,tb.x+origEnd,tb.y+tb.h-1);
    const {startPx,endPx}=trimHandleX(x,padW,drum.id);
    const nearStart=abs(mouseX-startPx)<8&&overTrimBar, nearEnd=abs(mouseX-endPx)<8&&overTrimBar;
    fill(drum.hue,nearStart?80:DRUM_S,nearStart?65:DRUM_B); noStroke(); rect(startPx-1.5,tb.y,3,tb.h,1);
    fill(drum.hue,nearEnd?80:DRUM_S,nearEnd?65:DRUM_B);              rect(endPx-1.5,  tb.y,3,tb.h,1);
  }
}

// ── Pad body ─────────────────────────────────────────────────────────────────

function drawPadBody(drum, x, y, padW, sublabel, active, padLive, isCustom, hasText, roundLeft=true, roundRight=true, kbdOverride=null) {
  const slot = currentSlot();
  const hasCandidates = slot.drumCandidates[drum.id] && slot.drumCandidates[drum.id].length>0;
  const cands = slot.drumCandidates[drum.id] || [];
  const padTotalHeight = PAD_H+LYRICS_STRIP_H;
  const tb=trimBarRect(x,y,padW), swp=swapBtnRect(x,y,padW);
  const volDialPos=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,0), pitchDialPos=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,1);
  const overTrimBar=mouseX>tb.x&&mouseX<tb.x+tb.w&&mouseY>tb.y&&mouseY<tb.y+tb.h;
  const overVol=dist(mouseX,mouseY,volDialPos.cx,volDialPos.cy)<volDialPos.r+4;
  const overPitch=dist(mouseX,mouseY,pitchDialPos.cx,pitchDialPos.cy)<pitchDialPos.r+4;
  const overSwap=mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
  const overPad=mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H&&!overVol&&!overPitch&&!overSwap;
  if (isCustom&&!hasText) fill(...BG,40); else fill(...PANEL);
  stroke(...INK); strokeWeight(active?2:1); rect(x,y,padW,padTotalHeight,0,0,roundRight?CORNER_RADIUS:0,roundLeft?CORNER_RADIUS:0);
  // Gradient overlay: transparent-white at top → drum colour at bottom
  const [gradH,gradS,gradL]=hsbToHsl(drum.hue,DRUM_S,DRUM_B);
  const gradAlpha=active?0.55:(overPad&&padLive)?0.22:padLive?0.14:0.07;
  drawingContext.save();
  const gradient=drawingContext.createLinearGradient(x,y,x,y+padTotalHeight);
  gradient.addColorStop(0,'rgba(255,255,255,0)');
  gradient.addColorStop(1,`hsla(${gradH},${gradS}%,${gradL}%,${gradAlpha})`);
  drawingContext.fillStyle=gradient;
  drawingContext.fillRect(x+1,y+1,padW-2,padTotalHeight-2);
  drawingContext.restore();
  fill(active?INK_DIM:padLive?[drum.hue,DRUM_S,DRUM_B]:INK_FAINT);
  noStroke(); textSize(32); textStyle(BOLD); textAlign(CENTER,CENTER);
  text(kbdOverride||drum.kbd,x+padW/2,y+PAD_H/2-22); textStyle(NORMAL);
  fill(hasCandidates?INK:INK_FAINT); textSize(8); textAlign(CENTER);
  let labelString=sublabel.toUpperCase();
  while (labelString.length>1&&textWidth(labelString)>padW-12) labelString=labelString.slice(0,-1);
  text(labelString,x+padW/2,y+PAD_H/2+3);
  drawDial(drum,x,y,padW,PAD_H+LYRICS_STRIP_H,0,slot.drumVolumes[drum.id]??0.8, 0,  1, hasCandidates,active);
  drawDial(drum,x,y,padW,PAD_H+LYRICS_STRIP_H,1,slot.drumPitch[drum.id]??0,   -12, 12,hasCandidates,active);
  // Eye icon — toggles sequencer row visibility
  const eyeX=x+8, eyeY=y+PAD_H+LYRICS_STRIP_H-12, isVisible=!slot.hiddenDrumIds.has(drum.id);
  const eyeHov=dist(mouseX,mouseY,eyeX,eyeY)<7;
  drawEyeIcon(eyeX,eyeY,isVisible,eyeHov);
  if (cands.length>1) {
    const hov=mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h;
    fill(hov?ACCENT:PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(swp.x+swp.w/2,swp.y+swp.h/2,swp.w);
    fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('↻',swp.x+swp.w/2,swp.y+swp.h/2+1);
    fill(...INK); textSize(6); textStyle(BOLD); textAlign(CENTER,TOP);
    text(`${(slot.drumIdx[drum.id]||0)+1}/${cands.length}`,swp.x+swp.w/2,swp.y+swp.h+2); textStyle(NORMAL);
  }
  const {startPx,endPx}=trimHandleX(x,padW,drum.id);
  const nearHandle=hasCandidates&&overTrimBar&&(abs(mouseX-startPx)<8||abs(mouseX-endPx)<8);
  cursor(nearHandle||overVol||overPitch||(overSwap&&cands.length>1)||(overPad&&padLive)||eyeHov?HAND:ARROW);
}

// ── Standard pad ─────────────────────────────────────────────────────────────

function drawStandardPad(drum, x, y, padW, roundLeft, roundRight) {
  const slot = currentSlot();
  const hasCandidates=slot.drumCandidates[drum.id]&&slot.drumCandidates[drum.id].length>0;
  const ago=millis()-padFlash[drum.id];
  const active=(max(0,1-ago/110)>0)||padHeld[drum.id];
  drawTrimBar(drum,x,y,padW,roundLeft,roundRight);
  drawPadBody(drum,x,y,padW,(drum.label||drum.kbd),active,hasCandidates,false,false,roundLeft,roundRight);
}

// ── Custom pad ───────────────────────────────────────────────────────────────

function drawCustomPad(drum, x, y, padW, customIndex, roundLeft, roundRight) {
  const slot = currentSlot();
  const hasCandidates=slot.drumCandidates[drum.id]&&slot.drumCandidates[drum.id].length>0;
  const ago=millis()-padFlash[drum.id];
  const active=(max(0,1-ago/110)>0)||padHeld[drum.id];
  const inputElement=slot.customInputEls[customIndex];
  const textValue=inputElement?inputElement.value().trim():'', hasText=textValue!=='';
  const finalized=!!slot.padFinalized[drum.id];
  drawTrimBar(drum,x,y,padW,roundLeft,roundRight);
  drawPadBody(drum,x,y,padW,'',active,(hasCandidates||hasText),true,hasText,roundLeft,roundRight,CUSTOM_DEFS[customIndex].kbd);
  // Remove-pad × (top-right, always present)
  const rmX=x+padW-8,rmY=y+8,rmRadius=6;
  const rmHov=dist(mouseX,mouseY,rmX,rmY)<rmRadius+3;
  fill(rmHov?RED:PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(rmX,rmY,rmRadius*2);
  fill(rmHov?[0,0,98]:INK_FAINT); noStroke(); textSize(7); textAlign(CENTER,CENTER);
  text('\u00d7',rmX,rmY+0.5); if (rmHov) cursor(HAND);
  // Input row icons (vertically centred with the DOM input at y+40)
  const iconY=y+47;
  if (finalized) {
    // Clear-input × — clicking reverts to editable state
    const clearX=x+padW-9, clearHov=dist(mouseX,mouseY,clearX,iconY)<8;
    fill(clearHov?RED:PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(clearX,iconY,11);
    fill(clearHov?[0,0,98]:INK_FAINT); noStroke(); textSize(7); textAlign(CENTER,CENTER);
    text('\u00d7',clearX,iconY+0.5); if (clearHov) cursor(HAND);
  } else {
    // Speech bubble — opens transcript picker
    const speechX=x+padW-30, speechHov=dist(mouseX,mouseY,speechX,iconY)<8;
    drawSpeechBubble(speechX,iconY,speechHov);
    // Record button
    const isRec=slot.padRecording[drum.id];
    const recBtnX=x+padW-17, recBtnHov=dist(mouseX,mouseY,recBtnX,iconY)<8;
    if (isRec) { noFill(); stroke(drum.hue,70,65,(sin(frameCount*0.15)*0.5+0.5)*45); strokeWeight(3); circle(recBtnX,iconY,18); }
    fill(isRec?[drum.hue,70,62]:recBtnHov?[drum.hue,50,80]:PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(recBtnX,iconY,13);
    fill(isRec?[0,0,98]:[drum.hue,DRUM_S,DRUM_B]); noStroke();
    if (isRec) { rectMode(CENTER); rect(recBtnX,iconY,4,4,1); rectMode(CORNER); } else { circle(recBtnX,iconY,4); }
    if (recBtnHov) cursor(HAND);
  }
}

// ── Plus button ──────────────────────────────────────────────────────────────

function drawPlusButton(x, y, padW, roundLeft, roundRight) {
  const nextDef=CUSTOM_DEFS[currentSlot().activePadIds.length]; if (!nextDef) return;
  const hov=mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H;
  const centerX=x+padW/2, centerY=y+PAD_H/2;
  drawingContext.save();
  drawingContext.font = "52px 'IBM Plex Mono', monospace";
  drawingContext.textAlign = 'center'; drawingContext.textBaseline = 'middle';
  drawingContext.strokeStyle = 'rgba(20,17,10,0.35)';
  drawingContext.lineWidth = 1.5; drawingContext.lineJoin = 'round';
  drawingContext.strokeText('+', centerX, centerY);
  drawingContext.fillStyle = hov ? 'rgba(0,0,0,0.48)' : 'rgba(0,0,0,0.28)';
  drawingContext.fillText('+', centerX, centerY);
  drawingContext.restore();
  if (hov) cursor(HAND);
}

// ── All pads ─────────────────────────────────────────────────────────────────

function drawPads() {
  const {padW,gap,startX,padY}=getPadLayout();
  const slot=currentSlot();
  const numCustom=slot.activePadIds.length;
  DRUMS.forEach((drum,i) => {
    const roundLeft=i===0, roundRight=(i===DRUMS.length-1&&numCustom===0);
    drawStandardPad(drum,startX+i*(padW+gap),padY,padW,roundLeft,roundRight);
  });
  slot.activePadIds.forEach((id,i) => {
    const def=getCustomDef(id);
    const {x,y}=customPadXY(i,padW,gap,startX,padY);
    const isRow2=(i>=4);
    const roundLeft=isRow2?(i===4):false;
    const lastInRow=isRow2?(i===numCustom-1&&numCustom===CUSTOM_DEFS.length):(i===3||(i===numCustom-1&&numCustom<=3&&numCustom===CUSTOM_DEFS.length));
    const roundRight=lastInRow&&numCustom===CUSTOM_DEFS.length;
    drawCustomPad(def,x,y,padW,i,roundLeft,roundRight);
  });
  const plusPos=plusBtnXY(padW,gap,startX,padY);
  if (plusPos) {
    const isRow2=(numCustom>=4);
    const roundLeft=isRow2&&numCustom===4;
    drawPlusButton(plusPos.x,plusPos.y,padW,roundLeft,true);
  }
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

// ── Eye icon ─────────────────────────────────────────────────────────────────

function drawEyeIcon(cx, cy, visible, hovered) {
  const c = hovered ? INK : INK_DIM;
  stroke(...c); strokeWeight(1); noFill();
  arc(cx,cy,10,6,0,PI); arc(cx,cy,10,6,PI,TWO_PI);
  if (visible) { fill(...c); noStroke(); circle(cx,cy,3); }
  else { stroke(...c); strokeWeight(1); line(cx-4,cy+3,cx+4,cy-3); }
  if (hovered) cursor(HAND);
}

// ── Speech bubble icon ───────────────────────────────────────────────────────

function drawSpeechBubble(cx, cy, hov) {
  const c = hov ? INK_DIM : INK_FAINT;
  stroke(...c); strokeWeight(0.8); fill(hov?[0,0,93]:PANEL);
  rect(cx-5, cy-4, 10, 7, 1.5);
  noStroke(); fill(...c);
  triangle(cx-2.5, cy+3, cx+1.5, cy+3, cx-3.5, cy+6);
  circle(cx-2.5, cy-1, 1.5); circle(cx, cy-1, 1.5); circle(cx+2.5, cy-1, 1.5);
  if (hov) cursor(HAND);
}

// ── Slot header helpers ──────────────────────────────────────────────────────

/** Draw a labelled slider in a slot header (RAND, SWING, STEPS, VOL). */
function drawHeaderSlider(label, sliderX, sliderW, handleX, headerMid, valueText) {
  const hov = dist(mouseX, mouseY, handleX, headerMid - seqScrollY) < 5.5;
  fill(...INK); noStroke(); textSize(6); textAlign(RIGHT, CENTER);
  text(label, sliderX - 8, headerMid);
  stroke(...INK_FAINT); strokeWeight(1); line(sliderX, headerMid, sliderX + sliderW, headerMid);
  fill(hov ? ACCENT : PANEL); stroke(...INK_FAINT); strokeWeight(1); circle(handleX, headerMid, 9);
  if (valueText !== undefined) {
    fill(...INK); noStroke(); textSize(6); textAlign(LEFT, CENTER);
    text(valueText, sliderX + sliderW + 3, headerMid);
  }
}

/** Draw a small button in a slot header (CLR, DUP, ×). */
function drawSmallButton(btnX, btnY, btnW, btnH, label, headerMid, accentColor, textSz) {
  const hov = mouseX > btnX && mouseX < btnX + btnW && mouseY > btnY - seqScrollY && mouseY < btnY + btnH - seqScrollY;
  fill(hov ? accentColor : PANEL); stroke(...INK); strokeWeight(1); rect(btnX, btnY, btnW, btnH, 2);
  fill(hov ? [0, 0, 98] : INK); noStroke(); textSize(textSz || 7); textAlign(CENTER, CENTER); text(label, btnX + btnW / 2, headerMid);
}

// ── Sequencer ────────────────────────────────────────────────────────────────

/** Draw the play/rec/bpm/tap/clr-all control bar at top of sequencer. */
function drawSeqControlBar(ctrlY) {
  const ctrlMid=ctrlY+SEQ_CTRL_H/2;
  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(SEQ_MARGIN,ctrlY,width-SEQ_MARGIN*2,SEQ_CTRL_H,CORNER_RADIUS,CORNER_RADIUS,0,0);

  const playX=SEQ_MARGIN+SEQ_LABEL_W;
  const playRadius=12, playHov=dist(mouseX,mouseY,playX,ctrlMid)<playRadius;
  fill(seqPlaying?[120,55,70]:playHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); circle(playX,ctrlMid,playRadius*2);
  fill(seqPlaying?[0,0,98]:INK); noStroke();
  if (seqPlaying) { rectMode(CENTER); rect(playX-3,ctrlMid,3,9,1); rect(playX+3,ctrlMid,3,9,1); rectMode(CORNER); }
  else { triangle(playX-4,ctrlMid-6,playX-4,ctrlMid+6,playX+7,ctrlMid); }

  const recBtnX=playX+playRadius*2+16, recBtnRadius=9;
  const recBtnHov=dist(mouseX,mouseY,recBtnX,ctrlMid)<recBtnRadius;
  if (seqRecording) { noFill(); stroke(...RED,(sin(frameCount*0.15)*0.5+0.5)*40); strokeWeight(3); circle(recBtnX,ctrlMid,recBtnRadius*2+10); }
  fill(seqRecording?RED:recBtnHov?RED:[0,30,94]); stroke(...INK); strokeWeight(1); circle(recBtnX,ctrlMid,recBtnRadius*2);
  fill(seqRecording?[0,0,98]:INK); noStroke(); circle(recBtnX,ctrlMid,4);

  const bpmLabelX=recBtnX+recBtnRadius+12, bpmSliderX=bpmLabelX+28, bpmSliderW=100;
  fill(...INK_DIM); noStroke(); textSize(8); textAlign(LEFT,CENTER); text('BPM',bpmLabelX,ctrlMid);
  fill(...BG); stroke(...INK); strokeWeight(1); rect(bpmSliderX,ctrlMid-4,bpmSliderW,8,4);
  const bpmNorm=(seqBPM-40)/200;
  fill(...ACCENT,80); noStroke(); rect(bpmSliderX,ctrlMid-4,bpmSliderW*bpmNorm,8,4);
  const thumbX=bpmSliderX+bpmSliderW*bpmNorm, thumbHov=abs(mouseX-thumbX)<8&&abs(mouseY-ctrlMid)<10;
  fill(thumbHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); circle(thumbX,ctrlMid,11);
  fill(...INK); noStroke(); textSize(9); textAlign(LEFT,CENTER); text(Math.round(seqBPM),bpmSliderX+bpmSliderW+8,ctrlMid);

  const tapX=bpmSliderX+bpmSliderW+36, tapW=34, tapH=20;
  const tapHov=mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2;
  fill(tapHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(tapX,ctrlMid-tapH/2,tapW,tapH,CORNER_RADIUS);
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('TAP',tapX+tapW/2,ctrlMid);

  const clrAllX=tapX+tapW+10, clrAllW=50, clrAllH=20;
  const clrAllHov=mouseX>clrAllX&&mouseX<clrAllX+clrAllW&&mouseY>ctrlMid-clrAllH/2&&mouseY<ctrlMid+clrAllH/2;
  fill(clrAllHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(clrAllX,ctrlMid-clrAllH/2,clrAllW,clrAllH,CORNER_RADIUS);
  fill(clrAllHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('CLR ALL',clrAllX+clrAllW/2,ctrlMid);

  if (seqRecording) {
    fill(0,65,55,65+sin(frameCount*0.15)*18); textSize(8); textAlign(RIGHT,CENTER); noStroke();
    text('\u25cf REC',width-SEQ_MARGIN-8,ctrlMid);
  }
}

/** Draw the header bar for a single slot (label, sliders, buttons). */
function drawSlotHeader(slot, slotIndex, slotGridTopY, seqRowHeight, numSeqRows) {
  const headerY=slotGridTopY-SLOT_HDR_H;
  const isSelected=slotIndex===selectedSlotIdx;
  const headerW=width-SEQ_MARGIN*2;
  const isLast=slotIndex===slots.length-1;

  const headerRight=SEQ_MARGIN+headerW;
  const btnH=14, btnY=headerY+(SLOT_HDR_H-btnH)/2;
  const removeBtnX=headerRight-26, dupBtnX=removeBtnX-10-24, clearBtnX=dupBtnX-10-20;

  const volSliderEndX=clearBtnX-12, volSliderW=50, volSliderX=volSliderEndX-volSliderW;
  const volFrac=slot.gridVolume??1.0, volHandleX=volSliderX+volFrac*volSliderW;
  const stepSliderEndX=volSliderX-44, stepSliderW=50, stepSliderX=stepSliderEndX-stepSliderW;
  const stepFrac=(slot.grid.steps-3)/29, stepHandleX=stepSliderX+stepFrac*stepSliderW;
  const swingSliderEndX=stepSliderX-40, swingSliderW=40, swingSliderX=swingSliderEndX-swingSliderW;
  const swingFrac=slot.swing??0, swingHandleX=swingSliderX+swingFrac*swingSliderW;
  const humSliderEndX=swingSliderX-40, humSliderW=40, humSliderX=humSliderEndX-humSliderW;
  const humFrac=slot.humanize??0, humHandleX=humSliderX+humFrac*humSliderW;

  const headerMid=headerY+SLOT_HDR_H/2;

  const isDraggingThis=drag&&drag.type==='reorderSlot'&&drag.slotIndex===slotIndex;
  fill(isSelected?[38,30,96]:isDraggingThis?[38,20,90]:PANEL); stroke(...INK); strokeWeight(1);
  const headerBottomR=(numSeqRows===0&&isLast)?CORNER_RADIUS:0;
  rect(SEQ_MARGIN,headerY,headerW,SLOT_HDR_H,0,0,headerBottomR,headerBottomR);

  fill(isSelected?ACCENT:INK); noStroke(); textSize(7); textAlign(LEFT,CENTER);
  text('\u2630  SEQ '+(slotIndex+1), SEQ_MARGIN+7, headerMid);

  textSize(8); textAlign(LEFT,CENTER);
  fill(slot.fileName?INK_DIM:[0,0,65]); noStroke();
  const fnStart=SEQ_MARGIN+52, fnEnd=humSliderX-24, fnMaxW=fnEnd-fnStart;
  if (fnMaxW>20) text(truncateMiddle(slot.fileName||'—',fnMaxW), fnStart, headerMid);

  drawHeaderSlider('RAND',  humSliderX,   humSliderW,   humHandleX,   headerMid);
  drawHeaderSlider('SWING', swingSliderX, swingSliderW, swingHandleX, headerMid);
  drawHeaderSlider('STEPS', stepSliderX,  stepSliderW,  stepHandleX,  headerMid, slot.grid.steps);
  drawHeaderSlider('VOL',   volSliderX,   volSliderW,   volHandleX,   headerMid);

  drawSmallButton(clearBtnX, btnY, 20, btnH, 'CLR', headerMid, RED);
  drawSmallButton(dupBtnX, btnY, 24, btnH, 'DUP', headerMid, ACCENT);
  if (slots.length>1) {
    drawSmallButton(removeBtnX, btnY, 20, btnH, '\u00d7', headerMid, RED, 8);
  }
}

/** Draw the step grid for a single slot (cells, column bands, scanline). */
function drawSlotGrid(slot, slotIndex, slotGridTopY, seqRowHeight, seqW, gridLeft, loopProgress, isLast) {
  const seqDrums=getSeqDrums(slot), numSeqRows=seqDrums.length;
  if (numSeqRows === 0) return;

  const grid=slot.grid, gridHeight=numSeqRows*seqRowHeight;
  const stepPositions=computeStepPositions(grid,slot);
  const scanX=gridLeft+loopProgress*seqW;
  const numStdInSeq=DRUMS.filter(drum=>!slot.hiddenDrumIds.has(drum.id)).length;

  fill(...PANEL); stroke(...INK); strokeWeight(1);
  rect(SEQ_MARGIN,slotGridTopY,width-SEQ_MARGIN*2,gridHeight,0,0,isLast?CORNER_RADIUS:0,isLast?CORNER_RADIUS:0);

  for (let step=0;step<grid.steps;step++) {
    const x0=gridLeft+stepPositions[step]*seqW, x1=gridLeft+stepPositions[step+1]*seqW;
    fill(Math.floor(step/4)%2===0?[0,0,91]:[0,0,85]); noStroke();
    rect(x0,slotGridTopY+1,x1-x0-1,gridHeight-2);
  }

  if (numSeqRows>numStdInSeq) {
    const sepY=slotGridTopY+numStdInSeq*seqRowHeight;
    stroke(0,0,55); strokeWeight(1); line(gridLeft,sepY,gridLeft+seqW,sepY);
  }

  seqDrums.forEach((drum,rowIndex) => {
    const isCustomDrum=isCustomId(drum.id);
    const rowY=slotGridTopY+rowIndex*seqRowHeight;
    if (isCustomDrum) { fill(0,0,95,50); noStroke(); rect(gridLeft,rowY,seqW,seqRowHeight); }
    if (rowIndex>0&&rowIndex!==numStdInSeq) { stroke(0,0,isCustomDrum?65:58); strokeWeight(1); line(gridLeft,rowY,gridLeft+seqW,rowY); }

    const effMouseYLabel=mouseY+seqScrollY;
    const rowEyeX=SEQ_MARGIN+8, rowEyeY=rowY+seqRowHeight/2;
    const rowEyeHov=mouseX>=SEQ_MARGIN+2&&mouseX<SEQ_MARGIN+16&&effMouseYLabel>rowY&&effMouseYLabel<rowY+seqRowHeight;
    drawEyeIcon(rowEyeX,rowEyeY,true,rowEyeHov);
    if (rowEyeHov) cursor(HAND);
    fill((slot.drumCandidates[drum.id]&&slot.drumCandidates[drum.id].length>0)?[drum.hue,DRUM_S,DRUM_B]:INK_FAINT);
    noStroke(); textSize(7); textStyle(BOLD); textAlign(RIGHT,CENTER);
    let rowLabel=drum.label||drum.kbd;
    if (isCustomDrum) {
      const customIndex=slot.activePadIds.indexOf(drum.id);
      const textValue=slot.customInputEls[customIndex]?slot.customInputEls[customIndex].value().trim():'';
      rowLabel=textValue||(CUSTOM_DEFS[customIndex]||drum).kbd;
    }
    while (rowLabel.length>1&&textWidth(rowLabel)>SEQ_LABEL_W-20) rowLabel=rowLabel.slice(0,-1);
    text(rowLabel,gridLeft-8,rowY+seqRowHeight/2); textStyle(NORMAL);

    for (let step=0;step<grid.steps;step++) {
      const x0=gridLeft+stepPositions[step]*seqW, x1=gridLeft+stepPositions[step+1]*seqW;
      const cellW=max(x1-x0,2);
      const on=grid.cells[drum.id]?grid.cells[drum.id][step]:false;
      const isHead=seqPlaying&&loopProgress>=stepPositions[step]&&loopProgress<stepPositions[step+1];
      const effMouseY=mouseY+seqScrollY;
      const cellHov=mouseX>x0+1&&mouseX<x0+cellW-1&&effMouseY>rowY+1&&effMouseY<rowY+seqRowHeight-1;
      const pad2=1.5;
      if      (isHead&&on) fill(drum.hue,DRUM_S+8,DRUM_B+10);
      else if (isHead)     fill(drum.hue,DRUM_S_LITE,DRUM_B_LITE-10);
      else if (on)         fill(drum.hue,DRUM_S,DRUM_B,cellHov?100:90);
      else if (cellHov)    fill(drum.hue,20,85,50);
      else                 noFill();
      noStroke();
      if (on||isHead||cellHov) rect(x0+pad2,rowY+pad2,cellW-pad2*2,seqRowHeight-pad2*2,2);
      if (!on&&!isHead) {
        const isBeat=step%4===0;
        fill(drum.hue,28,isBeat?60:80,75); noStroke(); circle(x0+cellW/2,rowY+seqRowHeight/2,isBeat?3:1.8);
      }
    }
  });

  for (let step=1;step<grid.steps;step++) {
    const cellX=gridLeft+stepPositions[step]*seqW;
    stroke(0,0,step%4===0?28:58); strokeWeight(1);
    line(cellX,slotGridTopY+1,cellX,slotGridTopY+gridHeight-1);
  }

  if (seqPlaying) {
    stroke(...ACCENT,22); strokeWeight(6); line(scanX,slotGridTopY,scanX,slotGridTopY+gridHeight);
    stroke(...INK,60);    strokeWeight(1); line(scanX,slotGridTopY,scanX,slotGridTopY+gridHeight);
  }
}

/** Draw the pill scrollbar to the right of the sequencer. */
function drawSeqScrollbar(gridTop, visibleHeight, seqRowHeight) {
  const totalH = totalSeqContentHeight(seqRowHeight);
  if (totalH > visibleHeight) {
    const sbX = width-SEQ_MARGIN+6, sbW = 4;
    const thumbH = Math.max(20, visibleHeight * (visibleHeight/totalH));
    const thumbY = gridTop + (seqScrollY / Math.max(1, totalH-visibleHeight)) * (visibleHeight-thumbH);
    fill(...INK_FAINT, 40); noStroke(); rect(sbX, gridTop, sbW, visibleHeight, sbW/2);
    fill(...INK_DIM, 85); noStroke(); rect(sbX, thumbY, sbW, thumbH, sbW/2);
  }
}

/** Top-level sequencer draw — orchestrates control bar, slots, and scrollbar. */
function drawSequencer() {
  const {seqTop,seqW,seqRowHeight,ctrlY,gridTop,gridLeft}=getSeqLayout();
  const visibleHeight=height-gridTop;
  seqScrollY=constrain(seqScrollY, 0, Math.max(0, totalSeqContentHeight(seqRowHeight)-visibleHeight));

  drawSeqControlBar(ctrlY);

  const loopProgress=loopFraction();

  // Scrollable sequencer content
  drawingContext.save();
  drawingContext.beginPath();
  drawingContext.rect(0, gridTop, width, visibleHeight);
  drawingContext.clip();
  push(); translate(0, -seqScrollY);

  slots.forEach((slot,slotIndex) => {
    const slotGridTopY=getSlotGridTop(slotIndex,gridTop,seqRowHeight);
    const seqDrums=getSeqDrums(slot);
    const isLast=slotIndex===slots.length-1;
    drawSlotHeader(slot, slotIndex, slotGridTopY, seqRowHeight, seqDrums.length);
    drawSlotGrid(slot, slotIndex, slotGridTopY, seqRowHeight, seqW, gridLeft, loopProgress, isLast);
  });

  // Drag-to-reorder insertion line
  if (drag&&drag.type==='reorderSlot') {
    const tgt=reorderTargetIdx(drag.currentY,gridTop,seqRowHeight);
    let lineY;
    if (tgt<slots.length) lineY=getSlotHeaderY(tgt,gridTop,seqRowHeight);
    else { const lastSlot=slots[slots.length-1]; lineY=getSlotGridTop(slots.length-1,gridTop,seqRowHeight)+getSeqDrums(lastSlot).length*seqRowHeight; }
    stroke(...ACCENT); strokeWeight(2.5); noFill(); line(SEQ_MARGIN,lineY,SEQ_MARGIN+(width-SEQ_MARGIN*2),lineY);
  }

  // + seq big plus (below last slot)
  const lastSlot=slots[slots.length-1];
  const lastGridTop=getSlotGridTop(slots.length-1,gridTop,seqRowHeight);
  const numLastRows=Math.max(1,getSeqDrums(lastSlot).length);
  const addSlotY=lastGridTop+numLastRows*seqRowHeight+8;
  const addSlotCenterX=SEQ_MARGIN+SEQ_LABEL_W+seqW/2, addSlotCenterY=addSlotY+20;
  const effMouseYAddSlot=mouseY+seqScrollY;
  const addSlotHov=abs(mouseX-addSlotCenterX)<24&&abs(effMouseYAddSlot-addSlotCenterY)<18&&mouseY>=gridTop;
  drawingContext.font = "44px 'IBM Plex Mono', monospace";
  drawingContext.textAlign = 'center'; drawingContext.textBaseline = 'middle';
  drawingContext.strokeStyle = 'rgba(20,17,10,0.35)';
  drawingContext.lineWidth = 1.5; drawingContext.lineJoin = 'round';
  drawingContext.strokeText('+', addSlotCenterX, addSlotCenterY);
  drawingContext.fillStyle = addSlotHov ? 'rgba(0,0,0,0.48)' : 'rgba(0,0,0,0.28)';
  drawingContext.fillText('+', addSlotCenterX, addSlotCenterY);

  pop();
  drawingContext.restore();

  drawSeqScrollbar(gridTop, visibleHeight, seqRowHeight);
}

// ── Overlays ─────────────────────────────────────────────────────────────────

function drawRecordingOverlay() {
  const barW=min(420,width-80),barH=36,barX=(width-barW)/2,barY=HEADER_H+6;
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

function drawProcessingOverlay() {
  noStroke(); fill(...BG,88); rect(0,HEADER_H,width,height-HEADER_H);
  const cx=width/2,cy=height/2,ticks=16;
  for (let i=0;i<ticks;i++) {
    const angle=(i/ticks)*TWO_PI+spinAngle;
    stroke(...ACCENT,pow(((i/ticks+spinAngle/TWO_PI)%1),1.5)*70+5); strokeWeight(2);
    line(cx+cos(angle)*32,cy+sin(angle)*32,cx+cos(angle)*46,cy+sin(angle)*46);
  }
  fill(...ACCENT); noStroke(); circle(cx,cy,7);
  fill(...INK); textSize(11); textAlign(CENTER); text('ANALYSING\u2026',cx,cy+60);
  fill(...INK_DIM); textSize(9); text('running CLAP embeddings',cx,cy+76);
}

function drawErrorOverlay() {
  noStroke(); fill(...BG,88); rect(0,HEADER_H,width,height-HEADER_H);
  const cx=width/2,cy=height/2;
  fill(...RED); textSize(11); textAlign(CENTER); text('ERROR',cx,cy-16);
  fill(...INK_DIM); textSize(9); text(errorMsg,cx,cy+2);
  const hov=abs(mouseX-cx)<50&&abs(mouseY-(cy+22))<10;
  fill(hov?INK:INK_FAINT); textSize(9); text('dismiss',cx,cy+22); cursor(hov?HAND:ARROW);
}

// ── Trimmer overlay ──────────────────────────────────────────────────────────

function drawTrimOverlay() {
  if (!trimState) return;
  cursor(ARROW);
  const {buffer, trimStart, trimEnd, wfPeaks, fileName} = trimState;
  const dur = buffer.duration;

  noStroke(); fill(...BG,94); rect(0,HEADER_H,width,height-HEADER_H);

  const wfX=50, wfY=HEADER_H+36, wfW=width-100, wfH=120;
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
  const nearStart=abs(mouseX-startHandleX)<10&&mouseY>wfY&&mouseY<wfY+wfH;
  const nearEnd=abs(mouseX-endHandleX)<10&&mouseY>wfY&&mouseY<wfY+wfH;
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
  const inTrimRegion=mouseX>startHandleX+10&&mouseX<endHandleX-10&&mouseY>wfY&&mouseY<wfY+wfH;
  if (nearStart||nearEnd) cursor('ew-resize');
  else if (inTrimRegion) cursor(MOVE);

  const selDur=trimEnd-trimStart;
  fill(...INK); noStroke(); textSize(8); textAlign(CENTER,TOP);
  text('max 30s', width/2, HEADER_H+12);
  textSize(8); textAlign(LEFT,TOP);
  text(selDur.toFixed(1)+'s selected', wfX, wfY+wfH+8);
  textAlign(RIGHT,TOP);
  text('total: '+dur.toFixed(1)+'s', wfX+wfW, wfY+wfH+8);
  const leftW=textWidth(selDur.toFixed(1)+'s selected'), rightW=textWidth('total: '+dur.toFixed(1)+'s');
  const fnMaxW=(wfX+wfW-rightW-8)-(wfX+leftW+8);
  textAlign(CENTER,TOP);
  text(truncateMiddle(fileName||'', fnMaxW), width/2, wfY+wfH+8);

  const btnY=wfY+wfH+28, btnH=22;
  const canX=wfX, canW=60;
  const canHov=mouseX>canX&&mouseX<canX+canW&&mouseY>btnY&&mouseY<btnY+btnH;
  fill(canHov?RED:PANEL); stroke(...INK); strokeWeight(1); rect(canX,btnY,canW,btnH,CORNER_RADIUS);
  fill(canHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text('CANCEL',canX+canW/2,btnY+btnH/2);

  const isPlayingPreview = !!trimPlaySrc;
  const playBtnW=64, playBtnX=width/2-playBtnW/2;
  const playHov=mouseX>playBtnX&&mouseX<playBtnX+playBtnW&&mouseY>btnY&&mouseY<btnY+btnH;
  fill(isPlayingPreview||playHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(playBtnX,btnY,playBtnW,btnH,CORNER_RADIUS);
  fill(isPlayingPreview||playHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER);
  text(isPlayingPreview?'\u25a0 STOP':'\u25b6 PLAY', playBtnX+playBtnW/2, btnY+btnH/2);

  const upLabel='UPLOAD '+selDur.toFixed(1)+'s';
  textSize(8); const upW=max(80,textWidth(upLabel)+20);
  const upX=wfX+wfW-upW;
  const upHov=mouseX>upX&&mouseX<upX+upW&&mouseY>btnY&&mouseY<btnY+btnH;
  fill(upHov?ACCENT:PANEL); stroke(...INK); strokeWeight(1); rect(upX,btnY,upW,btnH,CORNER_RADIUS);
  fill(upHov?[0,0,98]:INK); noStroke(); textSize(8); textAlign(CENTER,CENTER); text(upLabel,upX+upW/2,btnY+btnH/2);
}
