// ── BOXER — Input: p5 lifecycle, mouse/keyboard handlers, transcript picker ──

// ── p5 lifecycle ─────────────────────────────────────────────────────────────

let logoImg;
function preload() { logoImg = loadImage('boxer-logo.png'); }

function setup() {
  createCanvas(max(windowWidth, MIN_WIDTH), windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('IBM Plex Mono');
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  uploadEl = select('#upload-input');
  uploadEl.changed(onFileSelected);

  pickerEl = document.createElement('div');
  pickerEl.style.cssText = [
    'position:fixed','display:none','z-index:100',
    'background:rgba(248,244,236,0.97)',
    'border:1px solid rgba(0,0,0,0.5)','border-radius:6px',
    'box-shadow:0 4px 24px rgba(0,0,0,0.18)',
    'padding:10px 12px 12px','max-width:420px','min-width:220px',
    'max-height:340px','overflow-y:auto',
    'font-family:IBM Plex Mono,monospace','pointer-events:auto',
  ].join(';');
  const pickerHeader = document.createElement('div');
  pickerHeader.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';
  const pickerTitle = document.createElement('span');
  pickerTitle.textContent = 'pick words';
  pickerTitle.style.cssText = 'font-size:10px;color:rgba(0,0,0,0.5);letter-spacing:0.05em;';
  const useBtn = document.createElement('button');
  useBtn.textContent = 'use selection';
  useBtn.style.cssText = 'font-family:IBM Plex Mono,monospace;font-size:9px;border:1px solid rgba(0,0,0,0.5);border-radius:3px;background:white;cursor:pointer;padding:2px 7px;';
  useBtn.addEventListener('click', commitPickerSelection);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'font-family:IBM Plex Mono,monospace;font-size:10px;border:none;background:none;cursor:pointer;color:rgba(0,0,0,0.4);padding:0 0 0 6px;';
  closeBtn.addEventListener('click', closePicker);
  const btnGroup = document.createElement('div'); btnGroup.appendChild(useBtn); btnGroup.appendChild(closeBtn);
  pickerHeader.appendChild(pickerTitle); pickerHeader.appendChild(btnGroup); pickerEl.appendChild(pickerHeader);
  const chipsContainer = document.createElement('div');
  chipsContainer.id = 'picker-chips'; chipsContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
  pickerEl.appendChild(chipsContainer); document.body.appendChild(pickerEl);

  DRUMS.forEach(drum => {
    padFlash[drum.id] = -9999; padHeld[drum.id] = false;
    const node = audioCtx.createGain(); node.gain.value = 1.0;
    node.connect(audioCtx.destination); gainNodes[drum.id] = node;
  });
  _nextSteps = [0];
  positionCustomInputs(); updateElementVisibility();
}

function windowResized() {
  resizeCanvas(max(windowWidth, MIN_WIDTH), windowHeight);
  positionCustomInputs(); updateElementVisibility();
}

// ── Header click handler ─────────────────────────────────────────────────────

function onHeaderClick() {
  const recX=168, recY=HEADER_H/2, recRadius=13;
  if (dist(mouseX,mouseY,recX,recY)<recRadius) {
    if (phase==='recording') stopRecording(); else if (phase==='ready') startRecording();
    return true;
  }
  const uploadX=recX+recRadius+10;
  if (mouseX>uploadX&&mouseX<uploadX+80&&abs(mouseY-recY)<12&&phase==='ready') { uploadEl.elt.click(); return true; }
  return false;
}

function onErrorClick() {
  const cx=width/2, cy=height/2;
  if (abs(mouseX-cx)<50&&abs(mouseY-(cy+22))<14) setPhase('ready');
}

// ── Slot header click handler ────────────────────────────────────────────────

function onSlotHeaderClick() {
  const {seqRowHeight,gridTop}=getSeqLayout();
  if (mouseY<gridTop) return false;
  const effY=mouseY+seqScrollY;
  for (let slotIndex=0;slotIndex<slots.length;slotIndex++) {
    const headerY=getSlotHeaderY(slotIndex,gridTop,seqRowHeight);
    const headerW=width-SEQ_MARGIN*2, headerRight=SEQ_MARGIN+headerW;
    if (!(effY>=headerY&&effY<headerY+SLOT_HDR_H&&mouseX>=SEQ_MARGIN&&mouseX<headerRight)) continue;
    const removeBtnX=headerRight-26, dupBtnX=removeBtnX-10-24, clearBtnX=dupBtnX-10-20;
    const volSliderEndX=clearBtnX-12, volSliderW=50, volSliderX=volSliderEndX-volSliderW;
    const stepSliderEndX=volSliderX-44, stepSliderW=50, stepSliderX=stepSliderEndX-stepSliderW;
    const swingSliderEndX=stepSliderX-40, swingSliderW=40, swingSliderX=swingSliderEndX-swingSliderW;
    const humSliderEndX=swingSliderX-40, humSliderW=40, humSliderX=humSliderEndX-humSliderW;
    const headerMid=headerY+SLOT_HDR_H/2;
    const slot=slots[slotIndex];
    const volHandleX=volSliderX+(slot.gridVolume??1.0)*volSliderW;
    const stepHandleX=stepSliderX+((slot.grid.steps-3)/29)*stepSliderW;
    const swingHandleX=swingSliderX+(slot.swing??0)*swingSliderW;
    const humHandleX=humSliderX+(slot.humanize??0)*humSliderW;
    if (slots.length>1&&mouseX>=removeBtnX&&mouseX<removeBtnX+20) { removeSlot(slotIndex); return true; }
    if (mouseX>=dupBtnX&&mouseX<dupBtnX+24) { duplicateSlot(slotIndex); return true; }
    if (mouseX>=clearBtnX&&mouseX<clearBtnX+20) {
      const grid=slots[slotIndex].grid; getAllDrums(slots[slotIndex]).forEach(drum=>{if(grid.cells[drum.id])grid.cells[drum.id].fill(false);}); return true;
    }
    if (tryStartSliderDrag(volHandleX,   headerMid, 'seqVolH',      slotIndex, volSliderX,   volSliderW))   return true;
    if (tryStartSliderDrag(stepHandleX,  headerMid, 'stepSlider',   slotIndex, stepSliderX,  stepSliderW))  return true;
    if (tryStartSliderDrag(swingHandleX, headerMid, 'swingSlider',  slotIndex, swingSliderX, swingSliderW)) return true;
    if (tryStartSliderDrag(humHandleX,   headerMid, 'humSlider',    slotIndex, humSliderX,   humSliderW))   return true;
    selectSlot(slotIndex);
    drag={type:'reorderSlot',slotIndex,currentY:effY}; return true;
  }
  return false;
}

// ── Sequencer controls click handler ─────────────────────────────────────────

function onSeqControlsClick() {
  const {seqRowHeight,ctrlY,gridTop,seqW}=getSeqLayout();
  const ctrlMid=ctrlY+SEQ_CTRL_H/2;
  const playX=SEQ_MARGIN+SEQ_LABEL_W;
  const recBtnX=playX+12*2+16;
  if (dist(mouseX,mouseY,playX,ctrlMid)<12) { seqPlaying?stopSequencer():startSequencer(); return true; }
  if (dist(mouseX,mouseY,recBtnX,ctrlMid)<9) { if (!seqPlaying) startSequencer(); seqRecording=!seqRecording; return true; }
  const bpmLabelX=recBtnX+9+12, bpmSliderX=bpmLabelX+28;
  const bpmNorm=(seqBPM-40)/200, thumbX=bpmSliderX+100*bpmNorm;
  if (abs(mouseX-thumbX)<10&&abs(mouseY-ctrlMid)<10) { drag={type:'bpm',sliderX:bpmSliderX,sliderW:100}; return true; }
  const tapX=bpmSliderX+100+36, tapW=34, tapH=20;
  if (mouseX>tapX&&mouseX<tapX+tapW&&mouseY>ctrlMid-tapH/2&&mouseY<ctrlMid+tapH/2) { handleTap(); return true; }
  const clrAllX=tapX+tapW+10, clrAllW=50, clrAllH=20;
  if (mouseX>clrAllX&&mouseX<clrAllX+clrAllW&&mouseY>ctrlMid-clrAllH/2&&mouseY<ctrlMid+clrAllH/2) {
    const slot=currentSlot(), grid=slot.grid; getAllDrums(slot).forEach(drum=>{if(grid.cells[drum.id])grid.cells[drum.id].fill(false);}); return true;
  }
  // + seq big plus (in scrollable region)
  const lastSlot=slots[slots.length-1];
  const lastGridTop=getSlotGridTop(slots.length-1,gridTop,seqRowHeight);
  const numLastRows=Math.max(1,getSeqDrums(lastSlot).length);
  const addSlotY=lastGridTop+numLastRows*seqRowHeight+8;
  const addSlotCenterX=SEQ_MARGIN+SEQ_LABEL_W+seqW/2, addSlotCenterY=addSlotY+20;
  const effY=mouseY+seqScrollY;
  if (abs(mouseX-addSlotCenterX)<24&&abs(effY-addSlotCenterY)<18&&mouseY>=gridTop) { addSlot(); return true; }
  return false;
}

// ── Sequencer cell click handler ─────────────────────────────────────────────

function onSeqCellsClick() {
  const {seqW,seqRowHeight,gridTop,gridLeft}=getSeqLayout();
  if (mouseY<gridTop) return;
  const effY=mouseY+seqScrollY;
  slots.forEach((slot,slotIndex) => {
    const seqDrums=getSeqDrums(slot), numSeqRows=seqDrums.length;
    const slotGridTopY=getSlotGridTop(slotIndex,gridTop,seqRowHeight);
    const grid=slot.grid, gridHeight=numSeqRows*seqRowHeight;
    if (effY<slotGridTopY||effY>slotGridTopY+gridHeight) return;
    // Eye icon click in row label area (hide row)
    if (mouseX>=SEQ_MARGIN+2&&mouseX<SEQ_MARGIN+16) {
      seqDrums.forEach((drum,rowIndex) => {
        if (effY>=slotGridTopY+rowIndex*seqRowHeight&&effY<slotGridTopY+(rowIndex+1)*seqRowHeight) slot.hiddenDrumIds.add(drum.id);
      });
      return;
    }
    if (mouseX<gridLeft||mouseX>gridLeft+seqW) return;
    const stepPositions=computeStepPositions(grid,slot);
    const stepIdx=posToStep((mouseX-gridLeft)/seqW,stepPositions);
    if (stepIdx<0||stepIdx>=grid.steps) return;
    seqDrums.forEach((drum,rowIndex) => {
      const rowY=slotGridTopY+rowIndex*seqRowHeight;
      if (effY>=rowY&&effY<rowY+seqRowHeight) {
        selectSlot(slotIndex);
        if (!grid.cells[drum.id]) grid.cells[drum.id]=new Array(grid.steps).fill(false);
        const newVal=!grid.cells[drum.id][stepIdx];
        grid.cells[drum.id][stepIdx]=newVal;
        if (newVal && !seqPlaying) triggerDrumAtTime(slot, drum.id, audioCtx.currentTime);
        drag={type:'seqPaint',slotIdx:slotIndex,drumId:drum.id,seqW,gridLeft,gTop:slotGridTopY,seqRowHeight,rowIndex,value:newVal,lastS:stepIdx};
      }
    });
  });
}

// ── Pad interaction handler ──────────────────────────────────────────────────

/** Handle trim bar, dials, swap button, and eye icon — shared by all pads. Returns true if handled. */
function onPadControlInteract(drum, x, y, padW) {
  const slot=currentSlot();
  const hasCandidates=slot.drumCandidates[drum.id]&&slot.drumCandidates[drum.id].length>0;
  const tb=trimBarRect(x,y,padW), swp=swapBtnRect(x,y,padW);
  if (hasCandidates&&mouseY>tb.y&&mouseY<tb.y+tb.h) {
    const {startPx,endPx}=trimHandleX(x,padW,drum.id);
    if (abs(mouseX-startPx)<10) { drag={type:'trimStart',id:drum.id,slotIdx:selectedSlotIdx,barX:tb.x,barW:tb.w}; return true; }
    if (abs(mouseX-endPx)  <10) { drag={type:'trimEnd',  id:drum.id,slotIdx:selectedSlotIdx,barX:tb.x,barW:tb.w}; return true; }
  }
  const volDial=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,0), pitchDial=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,1);
  if (dist(mouseX,mouseY,volDial.cx,volDial.cy)<volDial.r+4) {
    drag={type:'dial',param:'vol',  id:drum.id,slotIdx:selectedSlotIdx,startY:mouseY,startVal:slot.drumVolumes[drum.id]??0.8}; return true;
  }
  if (dist(mouseX,mouseY,pitchDial.cx,pitchDial.cy)<pitchDial.r+4) {
    drag={type:'dial',param:'pitch',id:drum.id,slotIdx:selectedSlotIdx,startY:mouseY,startVal:slot.drumPitch[drum.id]??0}; return true;
  }
  if (mouseX>swp.x&&mouseX<swp.x+swp.w&&mouseY>swp.y&&mouseY<swp.y+swp.h) {
    const cands=slot.drumCandidates[drum.id];
    if (cands&&cands.length>1) {
      slot.drumIdx[drum.id]=(slot.drumIdx[drum.id]+1)%cands.length;
      const nextCand=cands[slot.drumIdx[drum.id]];
      slot.drumTrimStart[drum.id]=nextCand.trimStart??0; slot.drumTrimEnd[drum.id]=nextCand.trimEnd??1;
      padFlash[drum.id]=millis(); triggerDrum(drum.id);
    }
    return true;
  }
  const eyeX=x+8, eyeY=y+PAD_H+LYRICS_STRIP_H-8;
  if (dist(mouseX,mouseY,eyeX,eyeY)<8) {
    if (slot.hiddenDrumIds.has(drum.id)) slot.hiddenDrumIds.delete(drum.id);
    else slot.hiddenDrumIds.add(drum.id);
    return true;
  }
  return false;
}

/** Handle custom pad-specific buttons (remove, clear, speech bubble, record). Returns true if handled. */
function onCustomPadInteract(drum, x, y, padW, customIndex) {
  const slot=currentSlot();
  const rmX=x+padW-8, rmY=y+8;
  if (dist(mouseX,mouseY,rmX,rmY)<9) { removeCustomPad(drum.id); return true; }
  const iconY=y+47;
  const finalized=!!slot.padFinalized[drum.id];
  if (finalized) {
    const clearX=x+padW-9;
    if (dist(mouseX,mouseY,clearX,iconY)<8) {
      slot.padFinalized[drum.id]=false;
      slot.padLyricsMode[drum.id]=false;
      if (customIndex>=0&&slot.customInputEls[customIndex]) {
        slot.customInputEls[customIndex].elt.value='';
        slot.customInputEls[customIndex].elt.readOnly=false;
      }
      slot.drumCandidates[drum.id]=[]; slot.drumIdx[drum.id]=0;
      positionCustomInputs(); return true;
    }
  } else {
    const speechX=x+padW-30;
    if (dist(mouseX,mouseY,speechX,iconY)<8) {
      slot.padLyricsMode[drum.id]=true;
      if (slot.transcriptLoaded) openPicker(slot,drum.id,customIndex);
      return true;
    }
    const recBtnX=x+padW-17;
    if (dist(mouseX,mouseY,recBtnX,iconY)<8) {
      if (slot.padRecording[drum.id]) stopPadRecording(drum.id); else startPadRecording(drum.id); return true;
    }
  }
  return false;
}

/** Handle a click on any pad (standard or custom). */
function onPadInteract(drum, x, y, padW, isCustom, customIndex) {
  if (onPadControlInteract(drum, x, y, padW)) return;
  if (isCustom && onCustomPadInteract(drum, x, y, padW, customIndex)) return;
  const slot=currentSlot();
  const focused=isCustom&&customIndex>=0&&slot.customInputEls[customIndex]&&slot.customInputEls[customIndex].elt.matches(':focus');
  if (mouseX>x&&mouseX<x+padW&&mouseY>y&&mouseY<y+PAD_H&&!focused) triggerDrum(drum.id);
}

function onPadsClick() {
  const {padW,gap,startX,padY}=getPadLayout();
  const plusPos=plusBtnXY(padW,gap,startX,padY);
  if (plusPos&&mouseX>plusPos.x&&mouseX<plusPos.x+padW&&mouseY>plusPos.y&&mouseY<plusPos.y+PAD_H) { addCustomPad(); return; }
  DRUMS.forEach((drum,i) => onPadInteract(drum,startX+i*(padW+gap),padY,padW,false,-1));
  currentSlot().activePadIds.forEach((id,customIndex) => {
    const def=getCustomDef(id);
    const {x,y}=customPadXY(customIndex,padW,gap,startX,padY);
    onPadInteract(def,x,y,padW,true,customIndex);
  });
}

/** Try to start a slider drag if mouse is near the handle. Returns true if drag started. */
function tryStartSliderDrag(handleX, headerMid, dragType, slotIndex, sliderX, sliderW) {
  if (abs(mouseX - handleX) < 8 && abs(mouseY - headerMid) < 8) {
    selectSlot(slotIndex);
    drag = { type: dragType, slotIdx: slotIndex, sldX: sliderX, sldW: sliderW };
    return true;
  }
  return false;
}

// ── Mouse handlers ───────────────────────────────────────────────────────────

function mousePressed() {
  if (audioCtx.state==='suspended') audioCtx.resume();
  if (pickerOpen) return;
  if (onHeaderClick()) return;
  if (phase==='error') { onErrorClick(); return; }
  if (phase==='trimming') {
    if (!trimState) return;
    const {buffer, trimStart, trimEnd} = trimState;
    const dur=buffer.duration;
    const wfX=50, wfY=HEADER_H+36, wfW=width-100, wfH=120;
    const startFrac=trimStart/dur, endFrac=trimEnd/dur;
    const startHandleX=wfX+startFrac*wfW, endHandleX=wfX+endFrac*wfW;
    if (mouseY>wfY&&mouseY<wfY+wfH) {
      if (abs(mouseX-startHandleX)<10) { drag={type:'trimOvlStart',wasPlaying:!!trimPlaySrc,origStart:trimStart}; return; }
      if (abs(mouseX-endHandleX)<10)   { drag={type:'trimOvlEnd',wasPlaying:!!trimPlaySrc};   return; }
      if (mouseX>startHandleX+10&&mouseX<endHandleX-10) {
        drag={type:'trimOvlMove',startMouseX:mouseX,origStart:trimStart,origEnd:trimEnd,dur,wasPlaying:!!trimPlaySrc}; return;
      }
    }
    const btnY=wfY+wfH+28, btnH=22;
    if (mouseY>btnY&&mouseY<btnY+btnH) {
      if (mouseX>wfX&&mouseX<wfX+60) { stopTrimPreview(); trimState=null; setPhase('ready'); return; }
      const playBtnW=64, playBtnX=width/2-32;
      if (mouseX>playBtnX&&mouseX<playBtnX+playBtnW) {
        if (trimPlaySrc) { stopTrimPreview(); }
        else {
          if (audioCtx.state==='suspended') audioCtx.resume();
          const src=audioCtx.createBufferSource();
          src.buffer=buffer; src.connect(audioCtx.destination);
          trimPlaySrc=src;
          src.onended=()=>{ if(trimPlaySrc===src) trimPlaySrc=null; };
          src.start(0, trimState.trimStart, trimState.trimEnd-trimState.trimStart);
          trimPlayStartTime=audioCtx.currentTime;
          trimPlayStartSec=trimState.trimStart;
        }
        return;
      }
      if (mouseX>wfX+wfW-120&&mouseX<wfX+wfW) { confirmTrim(); return; }
    }
    return;
  }
  if (phase!=='ready') return;
  if (onSlotHeaderClick()) return;
  if (onSeqControlsClick()) return;
  onSeqCellsClick();
  onPadsClick();
}

function mouseDragged() {
  if (!drag) return;
  if (drag.type==='trimOvlStart'||drag.type==='trimOvlEnd'||drag.type==='trimOvlMove') {
    if (!trimState) return;
    const {buffer} = trimState;
    const dur=buffer.duration, wfX=50, wfW=width-100;
    if (drag.type==='trimOvlMove') {
      const dx=(mouseX-drag.startMouseX)/wfW*drag.dur;
      const len=drag.origEnd-drag.origStart;
      const newStart=constrain(drag.origStart+dx, 0, drag.dur-len);
      trimState.trimStart=newStart; trimState.trimEnd=newStart+len;
      return;
    }
    const t=constrain((mouseX-wfX)/wfW,0,1)*dur;
    if (drag.type==='trimOvlStart') {
      trimState.trimStart=constrain(t,0,trimState.trimEnd-0.1);
      trimState.trimEnd=Math.min(trimState.trimEnd,trimState.trimStart+TRIM_MAX_SECS);
    } else {
      const maxEnd=Math.min(dur,trimState.trimStart+TRIM_MAX_SECS);
      trimState.trimEnd=constrain(t,trimState.trimStart+0.1,maxEnd);
      if (trimPlaySrc) {
        const elapsed=audioCtx.currentTime-trimPlayStartTime;
        if (trimPlayStartSec+elapsed>=trimState.trimEnd) stopTrimPreview();
      }
    }
    return;
  }
  if (drag.type==='seqPaint') {
    const slot=slots[drag.slotIdx]; const grid=slot.grid; if (!grid) return;
    const stepPositions=computeStepPositions(grid,slot);
    const stepIdx=constrain(posToStep((mouseX-drag.gridLeft)/drag.seqW,stepPositions),0,grid.steps-1);
    if (stepIdx===drag.lastS) return;
    const lo=min(stepIdx,drag.lastS),hi=max(stepIdx,drag.lastS);
    for (let i=lo;i<=hi;i++) { if (!grid.cells[drag.drumId]) grid.cells[drag.drumId]=new Array(grid.steps).fill(false); grid.cells[drag.drumId][i]=drag.value; }
    drag.lastS=stepIdx; return;
  }
  if (drag.type==='dial') {
    const dy=drag.startY-mouseY;
    const slot=slots[drag.slotIdx||selectedSlotIdx];
    if (drag.param==='vol') { slot.drumVolumes[drag.id]=constrain(drag.startVal+dy/80,0,1); }
    else { slot.drumPitch[drag.id]=constrain(Math.round(drag.startVal+dy/8),-12,12); }
  } else if (drag.type==='trimStart') {
    const slot=slots[drag.slotIdx||selectedSlotIdx];
    slot.drumTrimStart[drag.id]=constrain((mouseX-drag.barX)/drag.barW,0,(slot.drumTrimEnd[drag.id]??1)-0.02);
  } else if (drag.type==='trimEnd') {
    const slot=slots[drag.slotIdx||selectedSlotIdx];
    slot.drumTrimEnd[drag.id]=constrain((mouseX-drag.barX)/drag.barW,(slot.drumTrimStart[drag.id]??0)+0.02,1);
  } else if (drag.type==='bpm') {
    seqBPM=constrain(map(mouseX,drag.sliderX,drag.sliderX+drag.sliderW,40,240),40,240);
  } else if (drag.type==='seqVolH') {
    const frac=constrain((mouseX-drag.sldX)/drag.sldW,0,1);
    slots[drag.slotIdx].gridVolume=frac;
  } else if (drag.type==='stepSlider') {
    const frac=constrain((mouseX-drag.sldX)/drag.sldW,0,1);
    setStepCount(drag.slotIdx, Math.round(3+frac*29));
  } else if (drag.type==='swingSlider') {
    slots[drag.slotIdx].swing=constrain((mouseX-drag.sldX)/drag.sldW,0,1);
  } else if (drag.type==='humSlider') {
    slots[drag.slotIdx].humanize=constrain((mouseX-drag.sldX)/drag.sldW,0,1);
  } else if (drag.type==='reorderSlot') {
    const {gridTop}=getSeqLayout();
    drag.currentY=mouseY>=gridTop?mouseY+seqScrollY:mouseY;
  }
}

function mouseReleased() {
  if (drag && drag.type==='trimOvlMove' && abs(mouseX-drag.startMouseX)<5 && trimPlaySrc && trimState) {
    const {buffer}=trimState, dur=buffer.duration, wfX=50, wfW=width-100;
    const clickSec=constrain((drag.startMouseX-wfX)/wfW*dur, trimState.trimStart, trimState.trimEnd);
    stopTrimPreview();
    if (audioCtx.state==='suspended') audioCtx.resume();
    const src=audioCtx.createBufferSource();
    src.buffer=trimState.buffer; src.connect(audioCtx.destination);
    trimPlaySrc=src;
    src.onended=()=>{ if(trimPlaySrc===src) trimPlaySrc=null; };
    src.start(0, clickSec, trimState.trimEnd-clickSec);
    trimPlayStartTime=audioCtx.currentTime; trimPlayStartSec=clickSec;
    drag=null; return;
  }
  const restartTypes = ['trimOvlMove','trimOvlStart','trimOvlEnd'];
  if (drag && restartTypes.includes(drag.type) && drag.wasPlaying && trimState) {
    stopTrimPreview();
    if (audioCtx.state==='suspended') audioCtx.resume();
    const src=audioCtx.createBufferSource();
    src.buffer=trimState.buffer; src.connect(audioCtx.destination);
    trimPlaySrc=src;
    src.onended=()=>{ if(trimPlaySrc===src) trimPlaySrc=null; };
    src.start(0, trimState.trimStart, trimState.trimEnd-trimState.trimStart);
    trimPlayStartTime=audioCtx.currentTime;
    trimPlayStartSec=trimState.trimStart;
  }
  if (drag&&drag.type==='reorderSlot') {
    const {seqRowHeight,gridTop}=getSeqLayout();
    const tgt=reorderTargetIdx(drag.currentY,gridTop,seqRowHeight);
    reorderSlots(drag.slotIndex,tgt);
  }
  drag=null;
}

function mouseWheel(event) {
  const {seqRowHeight,gridTop}=getSeqLayout();
  if (mouseY<gridTop) return;
  const visibleHeight=height-gridTop;
  const maxScroll=Math.max(0,totalSeqContentHeight(seqRowHeight)-visibleHeight);
  seqScrollY=constrain(seqScrollY+event.delta*0.7,0,maxScroll);
  return false;
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function keyPressed() {
  if (document.activeElement&&document.activeElement.classList.contains('custom-input')) return;
  if (key==='r'||key==='R') {
    if (phase==='recording') stopRecording(); else if (phase==='ready') startRecording(); return;
  }
  if (phase==='ready') {
    const id=_kbdMap[key.toLowerCase()];
    if (id) { triggerDrum(id); padHeld[id]=true; if (seqRecording&&seqPlaying) quantizeToGrid0(id); }
    if (key===' ') { seqPlaying?stopSequencer():startSequencer(); }
    if (key==='u'||key==='U') uploadEl.elt.click();
  }
}

function keyReleased() {
  if (document.activeElement&&document.activeElement.classList.contains('custom-input')) return;
  const id=_kbdMap[key.toLowerCase()]; if (id) padHeld[id]=false;
}

function doubleClicked() {
  if (phase!=='ready') return;
  const slot=currentSlot();
  const {padW,gap,startX,padY}=getPadLayout();
  const padTotalHeight=PAD_H+LYRICS_STRIP_H;
  const allDrums=[...DRUMS,...slot.activePadIds.map(id=>getCustomDef(id))];
  allDrums.forEach((drum,i) => {
    const pos=i<DRUMS.length?{x:startX+i*(padW+gap),y:padY}:customPadXY(i-DRUMS.length,padW,gap,startX,padY);
    const {x,y}=pos;
    if (mouseX<x||mouseX>x+padW||mouseY<y||mouseY>y+padTotalHeight) return;
    const volDial=dialCenter(x,y,padW,padTotalHeight,0), pitchDial=dialCenter(x,y,padW,padTotalHeight,1);
    if (dist(mouseX,mouseY,volDial.cx,volDial.cy)<volDial.r+4)     { slot.drumVolumes[drum.id]=0.8; return; }
    if (dist(mouseX,mouseY,pitchDial.cx,pitchDial.cy)<pitchDial.r+4) { slot.drumPitch[drum.id]=0;   return; }
  });
}

// ── Transcript picker ────────────────────────────────────────────────────────

function openPicker(slot, padId, customIndex) {
  pickerOpen=true; pickerSlot=slot; pickerPadId=padId;
  pickerPadCustomIdx=customIndex; pickerSel=[]; pickerAnchor=null;
  const {padW,gap,startX,padY}=getPadLayout();
  const {x:px,y:py}=customPadXY(customIndex,padW,gap,startX,padY);
  pickerEl.style.left=Math.min(px,windowWidth-430)+'px';
  pickerEl.style.top=(py+PAD_H+10)+'px';
  pickerEl.style.display='block'; renderPickerChips();
}

function closePicker() { pickerOpen=false; pickerPadId=null; pickerSlot=null; pickerEl.style.display='none'; }

function renderPickerChips() {
  const container=document.getElementById('picker-chips'); container.innerHTML='';
  if (!pickerSlot) return;
  pickerSlot.lyricsTranscript.forEach((word,idx) => {
    const chip=document.createElement('span');
    chip.textContent=word.word; const selected=pickerSel.includes(idx);
    chip.style.cssText=['display:inline-block','padding:3px 7px','border-radius:3px','cursor:pointer','font-size:10px','line-height:1.4','user-select:none',
      selected?'background:rgba(60,120,100,0.85);color:white;border:1px solid rgba(0,0,0,0.3)':'background:white;color:rgba(0,0,0,0.75);border:1px solid rgba(0,0,0,0.2)',
      'transition:background 0.08s'].join(';');
    chip.addEventListener('click',e=>{
      if (e.shiftKey&&pickerAnchor!==null) {
        const lo=Math.min(pickerAnchor,idx),hi=Math.max(pickerAnchor,idx);
        pickerSel=[]; for(let i=lo;i<=hi;i++) pickerSel.push(i);
      } else { pickerAnchor=idx; pickerSel=[idx]; }
      renderPickerChips();
    });
    container.appendChild(chip);
  });
}

function commitPickerSelection() {
  if (!pickerSel.length||!pickerPadId||!pickerSlot) return;
  const slot=pickerSlot;
  const sorted=[...pickerSel].sort((a,b)=>a-b);
  const words=sorted.map(i=>slot.lyricsTranscript[i]);
  const merged=mergeWordBuffers(slot,words); if (!merged) return;
  const cand={buffer:merged,score:1.0,time:words[0].start,trimStart:0,trimEnd:1};
  slot.drumCandidates[pickerPadId]=[cand]; slot.drumIdx[pickerPadId]=0;
  slot.drumTrimStart[pickerPadId]=0; slot.drumTrimEnd[pickerPadId]=1;
  padFlash[pickerPadId]=millis(); triggerDrum(pickerPadId);
  const text=words.map(w=>w.word).join(' ');
  if (pickerPadCustomIdx>=0&&slot.customInputEls[pickerPadCustomIdx])
    slot.customInputEls[pickerPadCustomIdx].elt.value=text;
  slot.padFinalized[pickerPadId]=true;
  slot.padLyricsMode[pickerPadId]=true;
  positionCustomInputs();
  closePicker();
}
