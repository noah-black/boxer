// ── BOXER — Input: p5 lifecycle, mouse/keyboard handlers, transcript picker ──

// ── p5 lifecycle ─────────────────────────────────────────────────────────────

let logoImg;
let _fontsReady = false;
function preload() {
  logoImg = loadImage('boxer-logo.png');
  Promise.all([
    document.fonts.load("16px 'Silkscreen'"),
    document.fonts.load("bold 16px 'Silkscreen'"),
  ]).then(() => { _fontsReady = true; });
}

function setup() {
  window.addEventListener('beforeunload', e => { e.preventDefault(); });
  createCanvas(max(windowWidth, MIN_WIDTH), windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont('Silkscreen');
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
  pickerHeader.style.cssText = 'display:flex;justify-content:flex-end;align-items:center;margin-bottom:8px;';
  const useBtn = document.createElement('button');
  useBtn.textContent = 'use selection';
  useBtn.style.cssText = 'font-family:IBM Plex Mono,monospace;font-size:9px;border:1px solid rgba(0,0,0,0.5);border-radius:3px;background:white;cursor:pointer;padding:2px 7px;';
  useBtn.addEventListener('click', commitPickerSelection);
  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = 'font-family:IBM Plex Mono,monospace;font-size:10px;border:none;background:none;cursor:pointer;color:rgba(0,0,0,0.4);padding:0 0 0 6px;';
  closeBtn.addEventListener('click', closePicker);
  const btnGroup = document.createElement('div'); btnGroup.appendChild(useBtn); btnGroup.appendChild(closeBtn);
  pickerHeader.appendChild(btnGroup); pickerEl.appendChild(pickerHeader);
  const chipsContainer = document.createElement('div');
  chipsContainer.id = 'picker-chips'; chipsContainer.style.cssText = 'display:flex;flex-wrap:wrap;gap:0;user-select:none;';
  pickerEl.appendChild(chipsContainer); document.body.appendChild(pickerEl);

  _nextSteps = [0];
  fetch(`${BACKEND}/prototypes`).then(r=>r.json()).then(d=>{availablePrototypes=d.prototypes||[];}).catch(()=>{});
  positionPadInputs(); updateElementVisibility();
}

function windowResized() {
  resizeCanvas(max(windowWidth, MIN_WIDTH), windowHeight);
  positionPadInputs(); updateElementVisibility();
}


function onErrorClick() {
  const cx=cW()/2, cy=cH()/2;
  if (abs(mX()-cx)<50&&abs(mY()-(cy+22))<14) setPhase('ready');
}

// ── Slot header click handler ────────────────────────────────────────────────

function onSlotHeaderClick() {
  const {seqRowHeight,gridTop}=getSeqLayout();
  if (mY()<gridTop) return false;
  const effY=mY()+seqScrollY;
  for (let slotIndex=0;slotIndex<slots.length;slotIndex++) {
    const headerY=getSlotHeaderY(slotIndex,gridTop,seqRowHeight);
    const headerW=cW()-SEQ_MARGIN*2, headerRight=SEQ_MARGIN+headerW;
    if (!(effY>=headerY&&effY<headerY+SLOT_HDR_H&&mX()>=SEQ_MARGIN&&mX()<headerRight)) continue;
    const slot=slots[slotIndex];
    const L=slotHeaderLayout(headerRight, slot.grid.measures.length);
    const headerMid=headerY+SLOT_HDR_H/2;
    const screenMid=headerMid-seqScrollY; // screen-space Y for hit detection
    const volHandleX=L.volSliderX+(slot.gridVolume??1.0)*L.volSliderW;
    const swingHandleX=L.swingSliderX+(slot.swing??0)*L.swingSliderW;
    const humHandleX=L.humSliderX+(slot.humanize??0)*L.humSliderW;
    // Capsule buttons: C D S M
    if (mX()>=L.capsuleX&&mX()<L.capsuleX+L.capsuleCellW*4) {
      const cellIdx=Math.floor((mX()-L.capsuleX)/L.capsuleCellW);
      if (cellIdx===0) { const ec=editCells(slots[slotIndex]); getActivePads(slots[slotIndex]).forEach(drum=>{if(ec[drum.id])ec[drum.id].fill(false);}); return true; }
      if (cellIdx===1) { duplicateSlot(slotIndex); return true; }
      if (cellIdx===2) { slot.soloed=!slot.soloed; return true; }
      if (cellIdx===3) { slot.muted=!slot.muted; return true; }
    }
    // Remove slot (X) button
    if (slots.length>1&&mX()>=L.removeX&&mX()<L.removeX+L.removeW) { removeSlot(slotIndex); return true; }
    // Measure tabs click
    {
      const tabH=10, tabY=headerMid-tabH/2+1; // matches render offset
      const nM=slot.grid.measures.length;
      // Delete X's just above tabs
      if (nM>1) {
        for (let i=0;i<nM;i++) {
          const tx=L.measureTabsX+i*L.measureTabW;
          const xCy=tabY-3;
          if (mX()>=tx&&mX()<tx+L.measureTabW&&effY>=xCy-4&&effY<tabY) {
            removeMeasure(slotIndex, i); selectSlot(slotIndex); return true;
          }
        }
      }
      // Plus button
      if (nM<MAX_MEASURES) {
        const plusX=L.measureTabsX+nM*L.measureTabW;
        if (mX()>=plusX&&mX()<plusX+L.measurePlusW&&effY>=tabY&&effY<tabY+tabH) {
          addMeasure(slotIndex); selectSlot(slotIndex); return true;
        }
      }
      // Tab clicks
      for (let i=0;i<nM;i++) {
        const tx=L.measureTabsX+i*L.measureTabW;
        if (mX()>=tx&&mX()<tx+L.measureTabW&&effY>=tabY&&effY<tabY+tabH) {
          selectSlot(slotIndex);
          slot.grid.editMeasure=i;
          drag={type:'reorderMeasure',slotIndex,fromIdx:i,startX:mX()};
          return true;
        }
      }
    }
    // Re-upload icon click
    const fnStart=L.measureTabsX+L.measureTabsW+6, fnEnd=L.humSliderX-24, fnMaxW=fnEnd-fnStart-(slot.fileName?20:0);
    if (slot.fileName && fnMaxW>20) {
      textSize(8);
      const fnTextW=textWidth(truncateMiddle(slot.fileName,fnMaxW));
      const reupX=fnStart+fnTextW+10;
      if (dist(mX(),mY(),reupX,screenMid)<7) {
        selectSlot(slotIndex);
        slot.reuploadPending=true;
        updateElementVisibility();
        return true;
      }
    }
    if (tryStartSliderDrag(volHandleX,   screenMid, 'seqVolH',      slotIndex, L.volSliderX,   L.volSliderW))   return true;
    // Step stepper [- NN +]
    if (mX()>=L.stepX&&mX()<L.stepX+L.stepW&&abs(screenMid-mY())<L.stepH/2+2) {
      const third=L.stepW/3;
      if (mX()<L.stepX+third) { setStepCount(slotIndex, slot.grid.steps-1); selectSlot(slotIndex); return true; }
      if (mX()>=L.stepX+third*2) { setStepCount(slotIndex, slot.grid.steps+1); selectSlot(slotIndex); return true; }
      // Click number area to edit
      selectSlot(slotIndex);
      openStepEdit(slotIndex, L.stepX+third, screenMid-L.stepH/2, third, L.stepH);
      return true;
    }
    if (tryStartSliderDrag(swingHandleX, screenMid, 'swingSlider',  slotIndex, L.swingSliderX, L.swingSliderW)) return true;
    if (tryStartSliderDrag(humHandleX,   screenMid, 'humSlider',    slotIndex, L.humSliderX,   L.humSliderW))   return true;
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
  if (dist(mX(),mY(),playX,ctrlMid)<12) { seqPlaying?stopSequencer():startSequencer(); return true; }
  if (dist(mX(),mY(),recBtnX,ctrlMid)<9) { if (!seqPlaying) startSequencer(); seqRecording=!seqRecording; if (seqRecording) scheduleMetronomeClick(_loopStartTime,true); return true; }
  const bpmLabelX=recBtnX+9+12, bpmSliderX=bpmLabelX+28;
  const bpmNorm=(seqBPM-40)/200, thumbX=bpmSliderX+100*bpmNorm;
  if (abs(mX()-thumbX)<10&&abs(mY()-ctrlMid)<10) { drag={type:'bpm',sliderX:bpmSliderX,sliderW:100}; return true; }
  const tapX=bpmSliderX+100+36, tapW=34, tapH=20;
  if (mX()>tapX&&mX()<tapX+tapW&&mY()>ctrlMid-tapH/2&&mY()<ctrlMid+tapH/2) { handleTap(); return true; }
  const clrAllX=tapX+tapW+10, clrAllW=50, clrAllH=20;
  if (mX()>clrAllX&&mX()<clrAllX+clrAllW&&mY()>ctrlMid-clrAllH/2&&mY()<ctrlMid+clrAllH/2) {
    const slot=currentSlot(), ec=editCells(slot); getActivePads(slot).forEach(drum=>{if(ec[drum.id])ec[drum.id].fill(false);}); return true;
  }
  // Global measure tabs + padlock
  {
    const maxM=Math.max(...slots.map(s=>s.grid.measures.length));
    if (maxM>=1) {
      const tw=12, tabH=10, lockW=14;
      const totalW=maxM*tw+lockW;
      const baseX=cW()-SEQ_MARGIN-8-totalW-(seqRecording?42:0);
      const tabY=ctrlMid-tabH/2;
      // Lock icon
      const lockX=baseX+maxM*tw+4;
      if (mX()>=lockX-2&&mX()<lockX+10&&mY()>=tabY&&mY()<tabY+tabH) {
        globalMeasureLock=!globalMeasureLock; return true;
      }
      // Tab clicks (disabled when playing and unlocked — measures follow playback)
      if (!(seqPlaying && !globalMeasureLock)) {
        for (let i=0;i<maxM;i++) {
          const tx=baseX+i*tw;
          if (mX()>=tx&&mX()<tx+tw&&mY()>=tabY&&mY()<tabY+tabH) {
            globalEditMeasure=i; return true;
          }
        }
      }
    }
  }
  // + seq big plus (in scrollable region)
  const lastSlot=slots[slots.length-1];
  const lastGridTop=getSlotGridTop(slots.length-1,gridTop,seqRowHeight);
  const numLastRows=Math.max(1,getSeqPads(lastSlot).length);
  const addSlotY=lastGridTop+numLastRows*seqRowHeight+20;
  const addSlotCenterX=SEQ_MARGIN+SEQ_LABEL_W+seqW/2, addSlotCenterY=addSlotY+20;
  const effY=mY()+seqScrollY;
  if (abs(mX()-addSlotCenterX)<24&&abs(effY-addSlotCenterY)<18&&mY()>=gridTop) { addSlot(); return true; }
  return false;
}

// ── Sequencer cell click handler ─────────────────────────────────────────────

function onSeqCellsClick() {
  const {seqW,seqRowHeight,gridTop,gridLeft}=getSeqLayout();
  if (mY()<gridTop) return;
  const effY=mY()+seqScrollY;
  slots.forEach((slot,slotIndex) => {
    const seqDrums=getSeqPads(slot), numSeqRows=seqDrums.length;
    const slotGridTopY=getSlotGridTop(slotIndex,gridTop,seqRowHeight);
    const grid=slot.grid, gridHeight=numSeqRows*seqRowHeight;
    if (effY<slotGridTopY||effY>slotGridTopY+gridHeight) return;
    if (mX()<gridLeft||mX()>gridLeft+seqW) return;
    const stepPositions=computeStepPositions(grid,slot);
    const stepIdx=posToStep((mX()-gridLeft)/seqW,stepPositions);
    if (stepIdx<0||stepIdx>=grid.steps) return;
    seqDrums.forEach((drum,rowIndex) => {
      const rowY=slotGridTopY+rowIndex*seqRowHeight;
      if (effY>=rowY&&effY<rowY+seqRowHeight) {
        selectSlot(slotIndex);
        const ec=editCells(slot);
        if (!ec[drum.id]) ec[drum.id]=new Array(grid.steps).fill(false);
        const newVal=!ec[drum.id][stepIdx];
        ec[drum.id][stepIdx]=newVal;
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
  if (hasCandidates&&mY()>tb.y&&mY()<tb.y+tb.h) {
    const dLeft=abs(mX()-tb.x), dRight=abs(mX()-(tb.x+tb.w));
    // Hit zone: 10px from either edge of the bar
    if (dLeft<10||dRight<10) {
      const which=dRight<=dLeft?'trimEnd':'trimStart';
      const ts=slot.drumTrimStart[drum.id]||0, te=slot.drumTrimEnd[drum.id]??1;
      drag={type:which,id:drum.id,slotIdx:selectedSlotIdx,barX:tb.x,barW:tb.w,
            origStart:ts,origEnd:te,proposedStart:ts,proposedEnd:te}; return true;
    }
  }
  const volDial=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,0), pitchDial=dialCenter(x,y,padW,PAD_H+LYRICS_STRIP_H,1);
  if (dist(mX(),mY(),volDial.cx,volDial.cy)<volDial.r+4) {
    drag={type:'dial',param:'vol',  id:drum.id,slotIdx:selectedSlotIdx,startY:mY(),startVal:slot.drumVolumes[drum.id]??0.8}; return true;
  }
  if (dist(mX(),mY(),pitchDial.cx,pitchDial.cy)<pitchDial.r+4) {
    drag={type:'dial',param:'pitch',id:drum.id,slotIdx:selectedSlotIdx,startY:mY(),startVal:slot.drumPitch[drum.id]??0}; return true;
  }
  if (mX()>swp.x&&mX()<swp.x+swp.w&&mY()>swp.y&&mY()<swp.y+swp.h) {
    const cands=slot.drumCandidates[drum.id];
    if (cands&&cands.length>1) {
      slot.drumIdx[drum.id]=(slot.drumIdx[drum.id]+1)%cands.length;
      const nextCand=cands[slot.drumIdx[drum.id]];
      slot.drumTrimStart[drum.id]=nextCand.trimStart??0; slot.drumTrimEnd[drum.id]=nextCand.trimEnd??1;
      padFlash[drum.id]=millis(); triggerDrum(drum.id);
    }
    return true;
  }
  return false;
}

/** Handle pad-specific buttons (remove, clear/reinit, hamburger menu). Returns true if handled. */
function onPadButtonInteract(def, x, y, padW) {
  const slot=currentSlot();
  const rmCx=x+padW-12, rmCy=y+12;
  if (dist(mX(),mY(),rmCx,rmCy)<9) { removePad(def.id); return true; }
  const iconY=y+47;
  const finalized=!!slot.padFinalized[def.id];
  if (finalized) {
    // Dynamic clear-x position: just right of label text
    const el=slot.padInputEls[def.id];
    const labelText=el?el.elt.value:'';
    textSize(9);
    const labelW=textWidth(labelText);
    const inputCx=x+5+(padW-24)/2;
    const clearXPos=min(inputCx+labelW/2+7, x+padW-6);
    if (dist(mX(),mY(),clearXPos,iconY)<8) { clearPad(def.id); return true; }
  } else {
    // Hamburger icon click — toggle menu
    const hamX=x+padW-14;
    if (dist(mX(),mY(),hamX,iconY)<8) {
      // Close all other menus first
      slot.activePadIds.forEach(id => { if (id!==def.id) slot.padMenuOpen[id]=false; });
      slot.padMenuOpen[def.id]=!slot.padMenuOpen[def.id];
      return true;
    }
    // Menu item click (if menu is open)
    if (slot.padMenuOpen[def.id]) {
      const items=getPadMenuItems(slot,def.id);
      const menuW=72, itemH=18;
      const menuX=x+padW-menuW, menuY=y+55;
      for (let i=0;i<items.length;i++) {
        const iy=menuY+i*itemH;
        if (mX()>menuX&&mX()<menuX+menuW&&mY()>iy&&mY()<iy+itemH) {
          const action=items[i].action;
          if (action==='prototype') {
            slot.padMenuOpen[def.id]='prototype';
          } else if (action==='back') {
            slot.padMenuOpen[def.id]=true;
          } else if (action.startsWith('proto:')) {
            applyPrototype(slot,def.id,action.slice(6));
          } else if (action==='lyrics') {
            slot.padMenuOpen[def.id]=false;
            slot.padMode[def.id]='lyrics';
            if (slot.transcriptLoaded) openPicker(slot,def.id);
          } else if (action==='record') {
            slot.padMenuOpen[def.id]=false;
            slot.padMode[def.id]='record';
            startPadRecording(def.id);
          }
          return true;
        }
      }
    }
  }
  return false;
}

/** Handle a click on any pad. */
function onPadInteract(def, x, y, padW, padIndex) {
  if (onPadControlInteract(def, x, y, padW)) return;
  if (onPadButtonInteract(def, x, y, padW)) return;
  const slot=currentSlot();
  const el=slot.padInputEls[def.id];
  const focused=el&&el.elt.matches(':focus');
  if (mX()>x&&mX()<x+padW&&mY()>y&&mY()<y+PAD_H&&!focused) {
    drag = { type:'reorderPad', padId:def.id, padIndex:padIndex, startX:mX(), startY:mY(), triggered:false };
  }
}

/** If any pad menu is open, handle menu/hamburger clicks and consume the event.
 *  Returns true if the click was handled (menu item, hamburger, or close-on-outside). */
function handleOpenPadMenu() {
  const slot=currentSlot();
  const openMenuId=slot.activePadIds.find(id=>slot.padMenuOpen[id]);
  if (!openMenuId) return false;
  const {padW,gap,startX,padY}=getPadLayout();
  const def=getPadDef(openMenuId);
  const idx=slot.activePadIds.indexOf(openMenuId);
  const {x,y}=padXY(idx,padW,gap,startX,padY);
  const items=getPadMenuItems(slot,openMenuId);
  const menuW=72, itemH=18;
  const menuX=x+padW-menuW, menuY=y+55, menuH=items.length*itemH;
  // Click on a menu item
  if (mX()>menuX&&mX()<menuX+menuW&&mY()>menuY&&mY()<menuY+menuH) {
    onPadButtonInteract(def,x,y,padW);
    return true;
  }
  // Click on the hamburger (toggle off)
  const hamX=x+padW-14, iconY=y+47;
  if (dist(mX(),mY(),hamX,iconY)<8) { slot.padMenuOpen[openMenuId]=false; return true; }
  // Click anywhere else — close menu
  slot.padMenuOpen[openMenuId]=false;
  return true;
}

function onPadsClick() {
  const slot=currentSlot();
  const {padW,gap,startX,padY}=getPadLayout();

  // Empty-slot prompt: record / upload icons
  if ((!slotHasAudio(slot) || slot.reuploadPending) && !slot.analyzing) {
    const cx=cW()/2, cy=padY+PAD_H/2;
    if (dist(mX(),mY(),cx-50,cy)<24 && phase==='ready') { startRecording(); return; }
    if (mX()>cx+50-24&&mX()<cx+50+24&&mY()>cy-24&&mY()<cy+24 && phase==='ready') { uploadEl.elt.click(); return; }
    return;
  }
  if (slot.analyzing) return;

  const plusPos=plusBtnXY(padW,gap,startX,padY);
  if (plusPos&&mX()>plusPos.x&&mX()<plusPos.x+padW&&mY()>plusPos.y&&mY()<plusPos.y+PAD_H) {
    // Check shortcut chips first
    const chips = protoChipRects(plusPos.x, plusPos.y, padW);
    for (const chip of chips) {
      if (mX()>chip.x&&mX()<chip.x+chip.w&&mY()>chip.y&&mY()<chip.y+chip.h) {
        addPadWithPrototype(chip.name); return;
      }
    }
    addPad(); return;
  }
  slot.activePadIds.forEach((id,i) => {
    const def=getPadDef(id);
    const {x,y}=padXY(i,padW,gap,startX,padY);
    onPadInteract(def,x,y,padW,i);
  });
}

/** Try to start a slider drag if mouse is near the handle. Returns true if drag started. */
function tryStartSliderDrag(handleX, headerMid, dragType, slotIndex, sliderX, sliderW) {
  if (abs(mX() - handleX) < 8 && abs(mY() - headerMid) < 8) {
    selectSlot(slotIndex);
    drag = { type: dragType, slotIdx: slotIndex, sldX: sliderX, sldW: sliderW };
    return true;
  }
  return false;
}

/** Compute target pad index from mouse position during pad reorder drag. */
function padReorderTargetIdx(mx, my, padW, gap, startX, padY, numPads) {
  const step = padRowStep();
  const row = my >= padY + step ? 1 : 0;
  const rowStart = row === 0 ? 0 : 8;
  const col = Math.round((mx - startX) / (padW + gap));
  const maxInRow = row === 0 ? Math.min(numPads, 8) : numPads - 8;
  const idx = rowStart + constrain(col, 0, Math.max(0, maxInRow));
  return constrain(idx, 0, numPads);
}

// ── Mouse handlers ───────────────────────────────────────────────────────────

function mousePressed() {
  if (audioCtx.state==='suspended') audioCtx.resume();
  // Close step editor if clicking outside it
  if (_stepEditInput && _stepEditInput.style.display !== 'none' &&
      document.activeElement !== _stepEditInput) closeStepEdit();
  if (padRecordingId) { stopPadRecording(padRecordingId); return; }
  if (pickerOpen) return;
  if (handleOpenPadMenu()) return;
  if (phase==='recording') {
    // Click anywhere stops the main recording (same as pressing R)
    stopRecording(); return;
  }
  if (phase==='error') { onErrorClick(); return; }
  if (phase==='trimming') {
    if (!trimState) return;
    const {buffer, trimStart, trimEnd} = trimState;
    const dur=buffer.duration;
    const wfX=50, wfY=HEADER_H+36, wfW=cW()-100, wfH=120;
    const startFrac=trimStart/dur, endFrac=trimEnd/dur;
    const startHandleX=wfX+startFrac*wfW, endHandleX=wfX+endFrac*wfW;
    if (mY()>wfY&&mY()<wfY+wfH) {
      const handleTop=wfY+wfH/2-12, handleBot=wfY+wfH/2+12;
      const onHandle=mY()>handleTop&&mY()<handleBot;
      if (onHandle&&abs(mX()-startHandleX)<8) { drag={type:'trimOvlStart',wasPlaying:!!trimPlaySrc,origStart:trimStart}; return; }
      if (onHandle&&abs(mX()-endHandleX)<8)   { drag={type:'trimOvlEnd',wasPlaying:!!trimPlaySrc};   return; }
      if (mX()>Math.min(startHandleX,endHandleX-1)&&mX()<Math.max(endHandleX,startHandleX+1)) {
        drag={type:'trimOvlMove',startMouseX:mX(),origStart:trimStart,origEnd:trimEnd,dur,wasPlaying:!!trimPlaySrc}; return;
      }
    }
    const btnY=wfY+wfH+28, btnH=22;
    if (mY()>btnY&&mY()<btnY+btnH) {
      if (mX()>wfX&&mX()<wfX+60) { stopTrimPreview(); trimState=null; setPhase('ready'); return; }
      const playBtnW=64, playBtnX=cW()/2-32;
      if (mX()>playBtnX&&mX()<playBtnX+playBtnW) {
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
      if (mX()>wfX+wfW-120&&mX()<wfX+wfW) { confirmTrim(); return; }
    }
    return;
  }
  if (phase!=='ready') return;
  // Save/Load buttons in header
  if (mY()<HEADER_H) {
    const {saveBtnX, loadBtnX, btnY, btnW, btnH} = headerBtnRects();
    if (mX()>saveBtnX&&mX()<saveBtnX+btnW&&mY()>btnY&&mY()<btnY+btnH) { saveSession(); return; }
    if (mX()>loadBtnX&&mX()<loadBtnX+btnW&&mY()>btnY&&mY()<btnY+btnH) { loadSession(); return; }
  }
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
    const dur=buffer.duration, wfX=50, wfW=cW()-100;
    if (drag.type==='trimOvlMove') {
      const dx=(mX()-drag.startMouseX)/wfW*drag.dur;
      const len=drag.origEnd-drag.origStart;
      const newStart=constrain(drag.origStart+dx, 0, drag.dur-len);
      trimState.trimStart=newStart; trimState.trimEnd=newStart+len;
      return;
    }
    const t=constrain((mX()-wfX)/wfW,0,1)*dur;
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
    const stepIdx=constrain(posToStep((mX()-drag.gridLeft)/drag.seqW,stepPositions),0,grid.steps-1);
    if (stepIdx===drag.lastS) return;
    const lo=min(stepIdx,drag.lastS),hi=max(stepIdx,drag.lastS);
    const ec=editCells(slot); for (let i=lo;i<=hi;i++) { if (!ec[drag.drumId]) ec[drag.drumId]=new Array(grid.steps).fill(false); ec[drag.drumId][i]=drag.value; }
    drag.lastS=stepIdx; return;
  }
  if (drag.type==='dial') {
    const dy=drag.startY-mY();
    const slot=slots[drag.slotIdx||selectedSlotIdx];
    if (drag.param==='vol') { slot.drumVolumes[drag.id]=constrain(drag.startVal+dy/80,0,1); }
    else { slot.drumPitch[drag.id]=constrain(Math.round(drag.startVal+dy/8),-12,12); }
  } else if (drag.type==='trimStart') {
    // Mouse displacement from left edge → context fraction change
    const dx=mX()-drag.barX;
    const range=drag.origEnd-drag.origStart;
    const newStart=drag.origStart+dx*(range/drag.barW);
    drag.proposedStart=constrain(newStart,0,drag.origEnd-0.02);
    drag.proposedEnd=drag.origEnd;
  } else if (drag.type==='trimEnd') {
    // Mouse displacement from right edge → context fraction change
    const dx=mX()-(drag.barX+drag.barW);
    const range=drag.origEnd-drag.origStart;
    const newEnd=drag.origEnd+dx*(range/drag.barW);
    drag.proposedStart=drag.origStart;
    drag.proposedEnd=constrain(newEnd,drag.origStart+0.02,1);
  } else if (drag.type==='bpm') {
    seqBPM=constrain(map(mX(),drag.sliderX,drag.sliderX+drag.sliderW,40,240),40,240);
  } else if (drag.type==='seqVolH') {
    const frac=constrain((mX()-drag.sldX)/drag.sldW,0,1);
    slots[drag.slotIdx].gridVolume=frac;
  } else if (drag.type==='swingSlider') {
    slots[drag.slotIdx].swing=constrain((mX()-drag.sldX)/drag.sldW,0,1);
  } else if (drag.type==='humSlider') {
    slots[drag.slotIdx].humanize=constrain((mX()-drag.sldX)/drag.sldW,0,1);
  } else if (drag.type==='reorderMeasure') {
    const slot=slots[drag.slotIndex];
    const tw=12; // measureTabW
    const dx=mX()-drag.startX;
    if (Math.abs(dx)>tw/2) {
      const nM=slot.grid.measures.length;
      const currentX=mX();
      const baseX=slotHeaderLayout(SEQ_MARGIN+cW()-SEQ_MARGIN*2, nM).measureTabsX;
      drag.targetIdx=constrain(Math.round((currentX-baseX)/tw), 0, nM);
    }
  } else if (drag.type==='reorderSlot') {
    const {gridTop}=getSeqLayout();
    drag.currentY=mY()>=gridTop?mY()+seqScrollY:mY();
  } else if (drag.type==='reorderPad') {
    const dx=mX()-drag.startX, dy=mY()-drag.startY;
    if (Math.abs(dx)>5||Math.abs(dy)>5) drag.triggered=true;
    drag.currentX=mX(); drag.currentY=mY();
  }
}

function mouseReleased() {
  if (drag && drag.type==='trimOvlMove' && abs(mX()-drag.startMouseX)<5 && trimPlaySrc && trimState) {
    const {buffer}=trimState, dur=buffer.duration, wfX=50, wfW=cW()-100;
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
  if (drag&&(drag.type==='trimStart'||drag.type==='trimEnd')) {
    const slot=slots[drag.slotIdx||selectedSlotIdx];
    slot.drumTrimStart[drag.id]=drag.proposedStart??drag.origStart;
    slot.drumTrimEnd[drag.id]=drag.proposedEnd??drag.origEnd;
  }
  if (drag&&drag.type==='reorderMeasure') {
    if (drag.targetIdx!==undefined&&drag.targetIdx!==drag.fromIdx) {
      reorderMeasures(drag.slotIndex, drag.fromIdx, drag.targetIdx);
    }
  }
  if (drag&&drag.type==='reorderSlot') {
    const {seqRowHeight,gridTop}=getSeqLayout();
    const tgt=reorderTargetIdx(drag.currentY,gridTop,seqRowHeight);
    reorderSlots(drag.slotIndex,tgt);
  }
  if (drag&&drag.type==='reorderPad') {
    if (!drag.triggered) {
      triggerDrum(drag.padId);
    } else {
      const {padW,gap,startX,padY}=getPadLayout();
      const slot=currentSlot();
      const tgt=padReorderTargetIdx(mX(),mY(),padW,gap,startX,padY,slot.activePadIds.length);
      if (tgt!==drag.padIndex) reorderPads(drag.padIndex,tgt);
    }
  }
  drag=null;
}

function mouseWheel(event) {
  // Let horizontal scroll pass through for native browser scrolling
  if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
  const {seqRowHeight,gridTop}=getSeqLayout();
  if (mY()<gridTop) return;
  const visibleHeight=cH()-gridTop;
  const maxScroll=Math.max(0,totalSeqContentHeight(seqRowHeight)-visibleHeight);
  seqScrollY=constrain(seqScrollY+event.delta*0.7,0,maxScroll);
  return false;
}

// ── Keyboard ─────────────────────────────────────────────────────────────────

function keyPressed() {
  if (document.activeElement&&document.activeElement.classList.contains('pad-input')) return;
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
  if (document.activeElement&&document.activeElement.classList.contains('pad-input')) return;
  const id=_kbdMap[key.toLowerCase()]; if (id) padHeld[id]=false;
}

function doubleClicked() {
  if (phase!=='ready') return;
  const slot=currentSlot();
  const {padW,gap,startX,padY}=getPadLayout();
  const padTotalHeight=PAD_H+LYRICS_STRIP_H;
  slot.activePadIds.forEach((id,i) => {
    const def=getPadDef(id);
    const {x,y}=padXY(i,padW,gap,startX,padY);
    if (mX()<x||mX()>x+padW||mY()<y||mY()>y+padTotalHeight) return;
    const volDial=dialCenter(x,y,padW,padTotalHeight,0), pitchDial=dialCenter(x,y,padW,padTotalHeight,1);
    if (dist(mX(),mY(),volDial.cx,volDial.cy)<volDial.r+4)     { slot.drumVolumes[def.id]=0.8; return; }
    if (dist(mX(),mY(),pitchDial.cx,pitchDial.cy)<pitchDial.r+4) { slot.drumPitch[def.id]=0;   return; }
  });
}

// ── Transcript picker ────────────────────────────────────────────────────────

function openPicker(slot, padId) {
  pickerOpen=true; pickerSlot=slot; pickerPadId=padId;
  pickerSel=[]; pickerAnchor=null;
  const {padW,gap,startX,padY}=getPadLayout();
  const padIndex=slot.activePadIds.indexOf(padId);
  const {x:px,y:py}=padXY(padIndex,padW,gap,startX,padY);
  pickerEl.style.left=Math.min(px*UI_SCALE,windowWidth-430)+'px';
  pickerEl.style.top=((py+PAD_H+10)*UI_SCALE)+'px';
  pickerEl.style.display='block'; renderPickerChips();
}

function closePicker() { pickerOpen=false; pickerPadId=null; pickerSlot=null; pickerEl.style.display='none'; }

function playWordPreview(word) {
  if (!pickerSlot||!pickerSlot.sourceBuffer) return;
  if (audioCtx.state==='suspended') audioCtx.resume();
  const sr=pickerSlot.sourceBuffer.sampleRate;
  const startSamp=Math.max(0,Math.round(word.start*sr));
  const endSamp=Math.min(pickerSlot.sourceBuffer.length,Math.round((word.end+LYRIC_POST_ROLL)*sr));
  const len=endSamp-startSamp; if (len<=0) return;
  const buf=audioCtx.createBuffer(1,len,sr);
  buf.getChannelData(0).set(pickerSlot.sourceBuffer.getChannelData(0).subarray(startSamp,endSamp));
  const src=audioCtx.createBufferSource(); src.buffer=buf; src.connect(audioCtx.destination); src.start(0);
}

function renderPickerChips() {
  const container=document.getElementById('picker-chips'); container.innerHTML='';
  if (!pickerSlot) return;
  pickerSlot.lyricsTranscript.forEach((word,idx) => {
    const chip=document.createElement('span');
    chip.textContent='\u00A0'+word.word+'\u00A0'; const selected=pickerSel.includes(idx);
    chip.style.cssText=['display:inline-block','padding:3px 0','cursor:pointer','font-size:10px','line-height:1.4',
      selected?'background:rgba(60,120,100,0.85);color:white':'background:white;color:rgba(0,0,0,0.75)',
      'border:none','transition:background 0.08s'].join(';');
    chip.addEventListener('mousedown',e=>{
      e.preventDefault();
      pickerDragging=true; pickerAnchor=idx;
      if (e.shiftKey&&pickerSel.length>0) {
        const lo=Math.min(pickerAnchor,idx),hi=Math.max(pickerAnchor,idx);
        pickerSel=[]; for(let i=lo;i<=hi;i++) pickerSel.push(i);
      } else {
        pickerSel=[idx];
      }
      playWordPreview(word);
      renderPickerChips();
    });
    chip.addEventListener('mouseenter',()=>{
      if (!pickerDragging||pickerAnchor===null) return;
      const lo=Math.min(pickerAnchor,idx),hi=Math.max(pickerAnchor,idx);
      pickerSel=[]; for(let i=lo;i<=hi;i++) pickerSel.push(i);
      renderPickerChips();
    });
    container.appendChild(chip);
  });
}

function playPickerSelection() {
  if (!pickerSlot||!pickerSel.length) return;
  const words=pickerSel.map(i=>pickerSlot.lyricsTranscript[i]);
  const merged=mergeWordBuffers(pickerSlot,words);
  if (merged) {
    if (audioCtx.state==='suspended') audioCtx.resume();
    const src=audioCtx.createBufferSource(); src.buffer=merged; src.connect(audioCtx.destination); src.start(0);
  }
}

document.addEventListener('mouseup',()=>{
  if (pickerDragging) {
    // Play full selection on release, unless it's still just the original single word
    if (pickerSel.length > 1) playPickerSelection();
    pickerDragging=false;
  }
});

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
  const el=slot.padInputEls[pickerPadId];
  if (el) el.elt.value=text;
  slot.padFinalized[pickerPadId]=true;
  slot.padMode[pickerPadId]='lyrics';
  positionPadInputs();
  closePicker();
}
