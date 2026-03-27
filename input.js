// ── BOXER — Input: p5 lifecycle, mouse/keyboard handlers, transcript picker ──

// ── p5 lifecycle ─────────────────────────────────────────────────────────────

let logoImg;
function preload() {
  logoImg = loadImage('boxer-logo.png');
  _fontsReady = true;
}

function setup() {
  window.addEventListener('beforeunload', e => { e.preventDefault(); });
  createCanvas(max(windowWidth, MIN_WIDTH), windowHeight);
  colorMode(HSB, 360, 100, 100, 100);
  textFont(_debugFont);
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

  // Shared pad text input
  _sharedInputEl = document.createElement('input');
  _sharedInputEl.type = 'text';
  _sharedInputEl.className = 'pad-input';
  _sharedInputEl.style.cssText = [
    'position:fixed','z-index:50','border:none','outline:none','background:transparent',
    `font-family:'${_debugFont}',monospace`,'padding:0 2px','display:none',
  ].join(';');
  _sharedInputEl.addEventListener('input', () => {
    const slot = currentSlot();
    if (!selectedPadId) return;
    slot.padText[selectedPadId] = _sharedInputEl.value;
  });
  _sharedInputEl.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      const slot = currentSlot();
      if (selectedPadId && _sharedInputEl.value.trim()) {
        slot.padText[selectedPadId] = _sharedInputEl.value;
        slot.padFinalized[selectedPadId] = true;
        const mode = slot.padMode[selectedPadId];
        if (mode === 'lyrics') applyLyricsQuery(slot, selectedPadId);
        else queryClapLive(slot, selectedPadId);
        syncSharedInput(); positionSharedInput();
      }
      _sharedInputEl.blur(); e.preventDefault();
    }
    if (e.key === 'Escape') { _sharedInputEl.blur(); e.preventDefault(); }
  });
  document.body.appendChild(_sharedInputEl);

  // Override textSize to apply debug font size offset
  const _origTextSize = window.textSize;
  window.textSize = function(s) { _origTextSize(s + _debugFontSize); };

  _nextSteps = [0];
  ensureAllPads(currentSlot());
  selectedPadId = currentSlot().activePadIds[0] || null;
  fetch(`${BACKEND}/prototypes`).then(r=>r.json()).then(d=>{availablePrototypes=d.prototypes||[];}).catch(()=>{});
  // _createDebugPanel(); // debug panel disabled — uncomment to re-enable (backtick to toggle)
  syncSharedInput(); positionSharedInput(); updateElementVisibility();
}

function _createDebugPanel() {
  const panel = document.createElement('div');
  panel.id = 'debug-panel';
  panel.style.cssText = [
    'position:fixed','top:0','right:0','z-index:9999','display:none',
    'background:rgba(30,30,30,0.95)','color:#ccc','padding:10px 14px',
    "font-family:'IBM Plex Mono',monospace",'font-size:11px',
    'width:240px','max-height:100vh','overflow-y:auto',
    'border-left:1px solid #555','user-select:none',
  ].join(';');

  const colorDefs = [
    ['BG', BG], ['PANEL', PANEL], ['CTRL_PANEL', CTRL_PANEL],
    ['SEQ_CELL', SEQ_CELL], ['SEQ_CELL_ALT', SEQ_CELL_ALT],
    ['INK', INK], ['INK_DIM', INK_DIM],
    ['INK_FAINT', INK_FAINT], ['ACCENT', ACCENT], ['SELECTED_HDR', SELECTED_HDR],
  ];
  const scalarDefs = [
    ['DRUM_S', () => DRUM_S, v => { DRUM_S = v; _palette.DRUM_S = v; }, 0, 100],
    ['DRUM_B', () => DRUM_B, v => { DRUM_B = v; _palette.DRUM_B = v; }, 0, 100],
    ['DRUM_S_LITE', () => DRUM_S_LITE, v => { DRUM_S_LITE = v; _palette.DRUM_S_LITE = v; }, 0, 100],
    ['DRUM_B_LITE', () => DRUM_B_LITE, v => { DRUM_B_LITE = v; _palette.DRUM_B_LITE = v; }, 0, 100],
  ];

  let html = '<div style="font-size:13px;font-weight:bold;margin-bottom:8px">Debug: Colors</div>';

  colorDefs.forEach(([name, arr]) => {
    html += `<div style="margin-bottom:6px"><label style="display:block;margin-bottom:2px">${name}</label>`;
    ['H','S','B'].forEach((ch, ci) => {
      const max = ci === 0 ? 360 : 100;
      html += `<span style="font-size:9px;width:12px;display:inline-block">${ch}</span>`;
      html += `<input type="range" min="0" max="${max}" value="${arr[ci]}" data-color="${name}" data-idx="${ci}" style="width:140px;vertical-align:middle">`;
      html += `<span class="dbg-val" data-color="${name}" data-idx="${ci}" style="font-size:9px;width:28px;display:inline-block;text-align:right">${arr[ci]}</span><br>`;
    });
    html += '</div>';
  });

  html += '<div style="margin-top:8px;border-top:1px solid #555;padding-top:8px">';
  scalarDefs.forEach(([name,,, mn, mx]) => {
    const val = name === 'DRUM_S' ? DRUM_S : name === 'DRUM_B' ? DRUM_B : name === 'DRUM_S_LITE' ? DRUM_S_LITE : DRUM_B_LITE;
    html += `<label style="font-size:10px">${name}</label> `;
    html += `<input type="range" min="${mn}" max="${mx}" value="${val}" data-scalar="${name}" style="width:120px;vertical-align:middle">`;
    html += `<span class="dbg-val" data-scalar="${name}" style="font-size:9px;width:28px;display:inline-block;text-align:right">${val}</span><br>`;
  });
  html += '</div>';

  html += '<div style="margin-top:8px;border-top:1px solid #555;padding-top:8px">';
  html += '<label style="font-size:10px">Font</label> ';
  html += '<select id="dbg-font" style="font-size:10px;width:150px;background:#222;color:#ccc;border:1px solid #555">';
  ['Silkscreen','IBM Plex Mono','monospace','Inter','Arial','Courier New','Georgia',
   'Futura','Helvetica Neue','Palatino','Baskerville','Didot','Optima','Gill Sans',
   'American Typewriter','Copperplate','Papyrus','Marker Felt','Chalkduster',
   'Snell Roundhand','Phosphate','Herculanum','Trattatello','Party LET',
   'Menlo','Monaco','Andale Mono','Bradley Hand','Brush Script MT',
   'Comic Sans MS','Impact','Luminari','Zapfino',
   'Avenir','Avenir Next Condensed','DIN Alternate','Rockwell',
  ].forEach(f => {
    html += `<option value="${f}" ${f===_debugFont?'selected':''}>${f}</option>`;
  });
  html += '</select><br>';
  html += '<label style="font-size:10px">Size offset</label> ';
  html += `<input type="range" id="dbg-fontsize" min="-4" max="8" value="${_debugFontSize}" style="width:120px;vertical-align:middle">`;
  html += `<span id="dbg-fontsize-val" style="font-size:9px">${_debugFontSize}</span>`;
  html += '</div>';

  html += '<div style="margin-top:8px;text-align:right"><button id="dbg-reset" style="font-size:10px;background:#444;color:#ccc;border:1px solid #666;padding:2px 8px;cursor:pointer">Reset</button></div>';

  panel.innerHTML = html;
  document.body.appendChild(panel);

  // Wire color sliders
  const colorArrays = { BG, PANEL, CTRL_PANEL, SEQ_CELL, SEQ_CELL_ALT, INK, INK_DIM, INK_FAINT, ACCENT, SELECTED_HDR };
  panel.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.color) {
      const arr = colorArrays[el.dataset.color];
      const idx = parseInt(el.dataset.idx);
      arr[idx] = parseInt(el.value);
      _palette[el.dataset.color][idx] = arr[idx];
      const valSpan = panel.querySelector(`.dbg-val[data-color="${el.dataset.color}"][data-idx="${idx}"]`);
      if (valSpan) valSpan.textContent = el.value;
    }
    if (el.dataset.scalar) {
      const v = parseInt(el.value);
      const s = scalarDefs.find(d => d[0] === el.dataset.scalar);
      if (s) s[2](v);
      const valSpan = panel.querySelector(`.dbg-val[data-scalar="${el.dataset.scalar}"]`);
      if (valSpan) valSpan.textContent = v;
    }
    if (el.id === 'dbg-fontsize') {
      _debugFontSize = parseInt(el.value);
      document.getElementById('dbg-fontsize-val').textContent = _debugFontSize;
    }
  });
  panel.addEventListener('change', e => {
    if (e.target.id === 'dbg-font') {
      _debugFont = e.target.value;
      textFont(_debugFont);
      if (_sharedInputEl) _sharedInputEl.style.fontFamily = `'${_debugFont}', monospace`;
    }
  });
  panel.querySelector('#dbg-reset').addEventListener('click', () => {
    Object.entries(_palette).forEach(([k, v]) => {
      if (Array.isArray(v) && colorArrays[k]) {
        v.forEach((c, i) => { colorArrays[k][i] = c; });
        panel.querySelectorAll(`[data-color="${k}"]`).forEach(el => {
          const idx = parseInt(el.dataset?.idx ?? el.getAttribute('data-idx'));
          if (!isNaN(idx)) { if (el.tagName === 'INPUT') el.value = v[idx]; else el.textContent = v[idx]; }
        });
      }
    });
    DRUM_S = _palette.DRUM_S; DRUM_B = _palette.DRUM_B;
    DRUM_S_LITE = _palette.DRUM_S_LITE; DRUM_B_LITE = _palette.DRUM_B_LITE;
    scalarDefs.forEach(([name]) => {
      const el = panel.querySelector(`[data-scalar="${name}"]`);
      const vSpan = panel.querySelector(`.dbg-val[data-scalar="${name}"]`);
      const val = _palette[name];
      if (el) el.value = val;
      if (vSpan) vSpan.textContent = val;
    });
    _debugFont = 'Gill Sans'; _debugFontSize = 2;
    textFont('Gill Sans');
    if (_sharedInputEl) _sharedInputEl.style.fontFamily = "'Gill Sans', monospace";
    const fontSel = document.getElementById('dbg-font');
    if (fontSel) fontSel.value = 'Gill Sans';
    const fsEl = document.getElementById('dbg-fontsize');
    if (fsEl) fsEl.value = 0;
    const fsVal = document.getElementById('dbg-fontsize-val');
    if (fsVal) fsVal.textContent = '0';
  });
  // Stop keyboard events from reaching p5
  panel.addEventListener('keydown', e => e.stopPropagation());
  panel.addEventListener('keyup', e => e.stopPropagation());
}

function windowResized() {
  resizeCanvas(max(windowWidth, MIN_WIDTH), windowHeight);
  positionSharedInput(); updateElementVisibility();
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
    // CLR standalone button
    if (mX()>=L.clrX&&mX()<L.clrX+L.standaloneW&&abs(screenMid-mY())<L.btnH/2+2) {
      const ec=editCells(slots[slotIndex]); getActivePads(slots[slotIndex]).forEach(drum=>{if(ec[drum.id])ec[drum.id].fill(false);}); return true;
    }
    // DUP standalone button
    if (mX()>=L.dupX&&mX()<L.dupX+L.standaloneW&&abs(screenMid-mY())<L.btnH/2+2) {
      duplicateSlot(slotIndex); return true;
    }
    // Capsule buttons: S M
    if (mX()>=L.capsuleX&&mX()<L.capsuleX+L.capsuleCellW*2) {
      const cellIdx=Math.floor((mX()-L.capsuleX)/L.capsuleCellW);
      if (cellIdx===0) { slot.soloed=!slot.soloed; return true; }
      if (cellIdx===1) { slot.muted=!slot.muted; return true; }
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
          globalEditMeasure=i;
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
  const playX=SEQ_MARGIN+12+12;
  const recBtnX=playX+12*2+16;
  if (dist(mX(),mY(),playX,ctrlMid)<12) { seqPlaying?stopSequencer():startSequencer(); return true; }
  if (dist(mX(),mY(),recBtnX,ctrlMid)<9) { if (!seqPlaying) startSequencer(); seqRecording=!seqRecording; if (seqRecording) scheduleMetronomeClick(_loopStartTime,true); return true; }
  const bpmLabelX=recBtnX+9+12, bpmSliderX=bpmLabelX+28;
  const bpmNorm=(seqBPM-40)/200, thumbX=bpmSliderX+100*bpmNorm;
  if (abs(mX()-thumbX)<10&&abs(mY()-ctrlMid)<10) { drag={type:'bpm',sliderX:bpmSliderX,sliderW:100}; return true; }
  const tapX=bpmSliderX+100+36, tapW=34, tapH=20;
  if (mX()>tapX&&mX()<tapX+tapW&&mY()>ctrlMid-tapH/2&&mY()<ctrlMid+tapH/2) { handleTap(); return true; }
  // Global measure tabs + padlock
  {
    const maxM=Math.max(...slots.map(s=>s.grid.measures.length));
    if (maxM>=1) {
      const tw=16, tabH=14, lockW=14;
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

// ── Sequencer label click handler ────────────────────────────────────────────

function onSeqLabelClick() {
  const {seqRowHeight,gridTop,gridLeft}=getSeqLayout();
  if (mX()>gridLeft || mX()<SEQ_MARGIN || mY()<gridTop) return false;
  const effY=mY()+seqScrollY;
  for (let slotIndex=0; slotIndex<slots.length; slotIndex++) {
    const slot=slots[slotIndex];
    const seqDrums=getSeqPads(slot), numSeqRows=seqDrums.length;
    const slotGridTopY=getSlotGridTop(slotIndex,gridTop,seqRowHeight);
    if (effY<slotGridTopY||effY>slotGridTopY+numSeqRows*seqRowHeight) continue;
    for (let rowIndex=0; rowIndex<seqDrums.length; rowIndex++) {
      const rowY=slotGridTopY+rowIndex*seqRowHeight;
      if (effY>=rowY&&effY<rowY+seqRowHeight) {
        const drum=seqDrums[rowIndex];
        selectSlot(slotIndex);
        selectPad(drum.id);
        drag={type:'reorderSeqLabel', slotIdx:slotIndex, padId:drum.id, seqRowIdx:rowIndex,
              startX:mX(), startY:mY(), currentX:mX(), currentY:mY(), triggered:false};
        return true;
      }
    }
  }
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
        const isOn=ec[drum.id][stepIdx];
        // Check for pitch icon click: right 30% of an ON cell with cellW >= 14
        const cx0=gridLeft+stepPositions[stepIdx]*seqW, cx1=gridLeft+stepPositions[stepIdx+1]*seqW;
        const cellW=cx1-cx0;
        if (isOn && cellW >= 14 && (mX() - cx0) > cellW * 0.7) {
          const ecp=editCellPitch(slot);
          const curPitch=(ecp[drum.id]&&ecp[drum.id][stepIdx])||0;
          cellPitchDropdown={slotIdx:slotIndex,padId:drum.id,stepIdx,x:cx0,y:rowY-seqScrollY,cellW,cellH:seqRowHeight,currentPitch:curPitch};
          return;
        }
        const newVal=!isOn;
        ec[drum.id][stepIdx]=newVal;
        if (newVal && !seqPlaying) triggerDrumAtTime(slot, drum.id, audioCtx.currentTime);
        drag={type:'seqPaint',slotIdx:slotIndex,drumId:drum.id,seqW,gridLeft,gTop:slotGridTopY,seqRowHeight,rowIndex,value:newVal,lastS:stepIdx};
      }
    });
  });
}

// ── Key grid click handler ───────────────────────────────────────────────────

function onKeyGridClick() {
  const slot = currentSlot();
  const L = getPadAreaLayout();

  // Empty-slot prompt: record / upload icons
  if ((!slotHasAudio(slot) || slot.reuploadPending) && !slot.analyzing) {
    const cx = cW() / 2;
    const cy = L.gridY + L.gridH / 2;
    if (dist(mX(), mY(), cx-50, cy) < 24 && phase === 'ready') { startRecording(); return true; }
    if (mX() > cx+50-24 && mX() < cx+50+24 && mY() > cy-24 && mY() < cy+24 && phase === 'ready') { uploadEl.elt.click(); return true; }
    return false;
  }
  if (slot.analyzing) return false;

  // Bounds check: is click in the grid area?
  if (mX() < L.gridX || mX() > L.gridX + L.gridW || mY() < L.gridY || mY() > L.gridY + L.gridH) return false;

  // Hit test each key
  for (let i = 0; i < slot.activePadIds.length; i++) {
    const id = slot.activePadIds[i];
    const {x, y} = keyXY(i, L);
    if (mX() > x && mX() < x+(L.kw||KEY_W) && mY() > y && mY() < y+(L.kh||KEY_H)) {
      // Select + trigger + flash
      selectPad(id);
      triggerDrum(id);
      padFlash[id] = millis();
      // Start reorder drag (5px threshold distinguishes from click)
      drag = { type: 'reorderPad', padId: id, padIndex: i, startX: mX(), startY: mY(), triggered: false };
      return true;
    }
  }
  return false;
}

// ── Control panel click handler ─────────────────────────────────────────────

function onControlPanelClick() {
  const slot = currentSlot();
  const L = getPadAreaLayout();
  if (!selectedPadId || !slot.activePadIds.includes(selectedPadId)) return false;
  if (!slotHasAudio(slot) || slot.analyzing) return false;

  const def = getPadDef(selectedPadId);
  if (!def) return false;

  // Check classic sub-menu first (can extend past panel bounds)
  if (slot.padMenuOpen[def.id] === 'classic') {
    const C = panelControlLayout(L);
    const inputY = C.ctrlY;
    const inputH = C.inputRowH - 4;
    const iconW = 14, iconsPadR = 4;
    const iconsTotal = 6 * iconW;
    const iconsLeftEdge = L.panelX + L.panelW - iconsPadR - iconsTotal;
    const inputX = C.rowX;
    const inputW = iconsLeftEdge - inputX - 2;
    const classicIconX = iconsLeftEdge;
    const menuY = inputY + inputH + 3;
    const menuX = classicIconX - 2;
    const menuH = 14;
    textSize(5);
    let px = menuX;
    for (const p of availablePrototypes) {
      const pw = textWidth(p) + 8;
      if (mX()>px && mX()<px+pw && mY()>menuY && mY()<menuY+menuH) {
        applyPrototype(slot, def.id, p);
        slot.padMenuOpen[def.id] = false;
        return true;
      }
      px += pw + 2;
    }
    slot.padMenuOpen[def.id] = false;
    return true;
  }

  // Bounds check
  if (mX() < L.panelX || mX() > L.panelX+L.panelW || mY() < L.panelY || mY() > L.panelY+L.panelH) return false;
  if (!def) return false;
  const hasCandidates = slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length > 0;
  const cands = slot.drumCandidates[def.id] || [];
  const finalized = !!slot.padFinalized[def.id];

  const isMappedEarly = !!(slot.padMode[def.id] || hasCandidates);

  // Trim bar at top of panel — handles are at bar edges (waveform is zoomed to trim region)
  const trimX = L.panelX+1, trimY = L.panelY+1, trimW = L.panelW-2;
  if (isMappedEarly && hasCandidates && mY() > trimY && mY() < trimY+TRIM_H && mX() > trimX && mX() < trimX+trimW) {
    const dLeft = abs(mX()-trimX), dRight = abs(mX()-(trimX+trimW));
    if (dLeft < 10 || dRight < 10) {
      const which = dRight <= dLeft ? 'trimEnd' : 'trimStart';
      const ts = slot.drumTrimStart[def.id]||0, te = slot.drumTrimEnd[def.id]??1;
      drag = {type: which, id: def.id, slotIdx: selectedSlotIdx, barX: trimX, barW: trimW,
              origStart: ts, origEnd: te, proposedStart: ts, proposedEnd: te};
      return true;
    }
  }

  // Controls area
  const C = panelControlLayout(L);

  // Sliders and chain are only interactive when pad is mapped
  if (isMappedEarly) {
    // Volume slider handle
    const volNorm = (slot.drumVolumes[def.id]??0.8);
    const volHandleX = C.sliderX + volNorm * C.sliderW;
    if (abs(mX()-volHandleX)<6 && abs(mY()-C.volSliderY)<8) {
      drag = {type: 'panelSlider', param: 'vol', id: def.id, slotIdx: selectedSlotIdx, sldX: C.sliderX, sldW: C.sliderW};
      return true;
    }

    // Pitch slider handle
    const pitchNorm = ((slot.drumPitch[def.id]??0)+12)/24;
    const pitchHandleX = C.sliderX + pitchNorm * C.sliderW;
    if (abs(mX()-pitchHandleX)<6 && abs(mY()-C.pitchSliderY)<8) {
      drag = {type: 'panelSlider', param: 'pitch', id: def.id, slotIdx: selectedSlotIdx, sldX: C.sliderX, sldW: C.sliderW};
      return true;
    }

    // Chain link toggle
    {
      const chainCx = C.chainX;
      if (abs(mX()-chainCx)<6 && abs(mY()-C.chainY)<6) {
        const linked = slot.drumPitchSpeedLinked[def.id] ?? true;
        slot.drumPitchSpeedLinked[def.id] = !linked;
        if (linked) {
          slot.drumSpeed[def.id] = 1.0;
        } else {
          slot.drumSpeed[def.id] = Math.pow(2, (slot.drumPitch[def.id]??0)/12);
        }
        invalidatePitchedCache(selectedSlotIdx, def.id);
        return true;
      }
    }

    // Speed slider handle (always interactive — when linked, drags pitch in 12 increments)
    {
      const linked = slot.drumPitchSpeedLinked[def.id] ?? true;
      const speedVal = linked ? Math.pow(2, (slot.drumPitch[def.id]??0)/12) : (slot.drumSpeed[def.id] ?? 1.0);
      const speedNorm = speedToNorm(speedVal);
      const speedHandleX = C.sliderX + speedNorm * C.sliderW;
      if (abs(mX()-speedHandleX)<6 && abs(mY()-C.speedSliderY)<8) {
        drag = {type: 'panelSlider', param: 'speed', id: def.id, slotIdx: selectedSlotIdx, sldX: C.sliderX, sldW: C.sliderW, linked};
        return true;
      }
    }
  }

  // Horizontal icon layout matching render.js drawControlPanel — all 6 icons always present
  const inputY = C.ctrlY;
  const inputH = C.inputRowH - 4;
  const hasTranscript = slot.transcriptLoaded && slot.lyricsTranscript.length > 0;
  const hasResults = slot.analyzeResults && Object.keys(slot.analyzeResults).length > 0;
  const hasClassic = hasResults && availablePrototypes.length > 0;
  const hasSource = !!slot.sourceBuffer;
  const isMapped = !!(slot.padMode[def.id] || hasCandidates);

  const iconW = 14, iconsPadR = 4;
  const iconsTotal = 6 * iconW;
  const iconsLeftEdge = L.panelX + L.panelW - iconsPadR - iconsTotal;
  const inputX = C.rowX;
  const inputW = iconsLeftEdge - inputX - 2;
  const padText = (slot.padText[def.id] || '').trim();
  const iconCy = inputY + inputH / 2;

  // Walk icons left to right, right-aligned
  let iconCurX = iconsLeftEdge;

  // Classic (drum) icon — only clickable when hasClassic
  {
    const cx = iconCurX + iconW / 2;
    if (hasClassic && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2) {
      slot.padMenuOpen[def.id] = slot.padMenuOpen[def.id] === 'classic' ? false : 'classic';
      return true;
    }
    iconCurX += iconW;
  }

  // Transcript icon — only clickable when transcript loaded
  {
    const cx = iconCurX + iconW / 2;
    if (hasTranscript && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2) {
      slot.padMode[def.id] = 'lyrics';
      slot.padFinalized[def.id] = false;
      if (slot.transcriptLoaded) openPicker(slot, def.id);
      return true;
    }
    iconCurX += iconW;
  }

  // Freestyle [ ] icon — only clickable when hasSource
  {
    const cx = iconCurX + iconW / 2;
    if (hasSource && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2) {
      openCustomClipPicker(slot, def.id);
      return true;
    }
    iconCurX += iconW;
  }

  // Cycle icon — only clickable when > 1 candidate
  {
    const cx = iconCurX + iconW / 2;
    if (cands.length > 1 && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2) {
      slot.drumIdx[def.id] = (slot.drumIdx[def.id]+1) % cands.length;
      const nextCand = cands[slot.drumIdx[def.id]];
      slot.drumTrimStart[def.id] = nextCand.trimStart??0;
      slot.drumTrimEnd[def.id] = nextCand.trimEnd??1;
      invalidatePitchedCache(selectedSlotIdx, def.id);
      padFlash[def.id] = millis(); triggerDrum(def.id);
      return true;
    }
    iconCurX += iconW;
  }

  // Duplicate icon — only clickable when mapped and unmapped pad available
  {
    const cx = iconCurX + iconW / 2;
    const unmappedPadId = slot.activePadIds.find(pid =>
      pid !== def.id && !slot.padMode[pid] && !(slot.drumCandidates[pid] && slot.drumCandidates[pid].length > 0)
    );
    if (isMapped && unmappedPadId && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2) {
      // Duplicate this pad's settings to the leftmost unmapped pad
      const srcId = def.id;
      slot.padMode[unmappedPadId] = slot.padMode[srcId];
      slot.padFinalized[unmappedPadId] = slot.padFinalized[srcId];
      slot.padText[unmappedPadId] = slot.padText[srcId] || '';
      slot.drumCandidates[unmappedPadId] = (slot.drumCandidates[srcId] || []).map(c => ({...c}));
      slot.drumIdx[unmappedPadId] = slot.drumIdx[srcId] || 0;
      slot.drumTrimStart[unmappedPadId] = slot.drumTrimStart[srcId] ?? 0;
      slot.drumTrimEnd[unmappedPadId] = slot.drumTrimEnd[srcId] ?? 1;
      slot.drumVolumes[unmappedPadId] = slot.drumVolumes[srcId] ?? 0.8;
      slot.drumPitch[unmappedPadId] = slot.drumPitch[srcId] ?? 0;
      slot.drumSpeed[unmappedPadId] = slot.drumSpeed[srcId] ?? 1.0;
      slot.drumPitchSpeedLinked[unmappedPadId] = slot.drumPitchSpeedLinked[srcId] ?? true;
      slot.drumEQ[unmappedPadId] = {...(slot.drumEQ[srcId] || { low: 0, mid: 0, high: 0 })};
      syncSharedInput(); positionSharedInput();
      return true;
    }
    iconCurX += iconW;
  }

  // Trash icon — only clickable when mapped
  {
    const cx = iconCurX + iconW / 2;
    if (isMapped && abs(mX()-cx)<iconW/2+2 && abs(mY()-iconCy)<inputH/2) {
      clearPad(def.id);
      return true;
    }
    iconCurX += iconW;
  }

  // X inside text input (when finalized) — clears text and unmaps
  if (finalized && padText) {
    const xX = inputX + inputW - 10;
    const xY = inputY + inputH/2;
    if (dist(mX(), mY(), xX, xY) < 7) {
      clearPad(def.id);
      return true;
    }
  }

  // Inline EQ anchor drag — only when mapped
  if (isMapped && hasCandidates) {
    const eq = slot.drumEQ[def.id] || { low: 0, mid: 0, high: 0 };
    const eqAnchors = [
      { freq: EQ_LOW_FREQ, band: 'low' },
      { freq: EQ_MID_FREQ, band: 'mid' },
      { freq: EQ_HIGH_FREQ, band: 'high' },
    ];
    for (const a of eqAnchors) {
      const ax = eqFreqToX(a.freq, C.eqGraphX, C.eqGraphW);
      const ay = eqGainToY(eq[a.band], C.eqGraphY, C.eqGraphH);
      if (dist(mX(), mY(), ax, ay) < 10) {
        drag = { type: 'eqBand', band: a.band, graphY: C.eqGraphY, graphH: C.eqGraphH,
                 padId: def.id, slotIdx: selectedSlotIdx };
        return true;
      }
    }
  }

  return false;
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

// ── Mouse handlers ───────────────────────────────────────────────────────────

function mousePressed() {
  if (audioCtx.state==='suspended') audioCtx.resume();
  // Close step editor if clicking outside it
  if (_stepEditInput && _stepEditInput.style.display !== 'none' &&
      document.activeElement !== _stepEditInput) closeStepEdit();
  if (pickerOpen) return;
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
  // Cell pitch dropdown intercept — must be before other handlers
  if (cellPitchDropdown) {
    const d = cellPitchDropdown;
    const itemH = 13, menuW = 22, totalItems = 25, zeroIdx = 12;
    const totalH = totalItems * itemH;
    const menuY = d.y + d.cellH / 2 - (zeroIdx + 0.5) * itemH;
    const menuX = d.x + d.cellW / 2 - menuW / 2;
    const clampedY = constrain(menuY, 2, cH() / UI_SCALE - totalH - 2);
    const clampedX = constrain(menuX, 2, cW() / UI_SCALE - menuW - 2);
    if (mX() > clampedX - 2 && mX() < clampedX + menuW + 2 && mY() > clampedY - 2 && mY() < clampedY + totalH + 2) {
      const idx = Math.floor((mY() - clampedY) / itemH);
      if (idx >= 0 && idx < totalItems) {
        const val = 12 - idx;
        const slot = slots[d.slotIdx];
        if (slot) {
          const ecp = editCellPitch(slot);
          if (!ecp[d.padId]) ecp[d.padId] = new Array(slot.grid.steps).fill(0);
          ecp[d.padId][d.stepIdx] = val;
        }
      }
      cellPitchDropdown = null;
      return;
    }
    cellPitchDropdown = null;
    return;
  }
  // Save/Load buttons in header
  if (mY()<HEADER_H) {
    const {saveBtnX, loadBtnX, btnY, btnW, btnH} = headerBtnRects();
    if (mX()>saveBtnX&&mX()<saveBtnX+btnW&&mY()>btnY&&mY()<btnY+btnH) { saveSession(); return; }
    if (mX()>loadBtnX&&mX()<loadBtnX+btnW&&mY()>btnY&&mY()<btnY+btnH) { loadSession(); return; }
  }
  if (onControlPanelClick()) return;
  if (onKeyGridClick()) return;
  if (onSlotHeaderClick()) return;
  if (onSeqControlsClick()) return;
  if (onSeqLabelClick()) return;
  onSeqCellsClick();
}

function mouseDragged() {
  if (!drag) return;
  if (drag.type==='eqBand') {
    const slot = slots[drag.slotIdx];
    if (slot) {
      const eq = slot.drumEQ[drag.padId] || { low: 0, mid: 0, high: 0 };
      const gain = constrain((drag.graphY + drag.graphH/2 - mY()) / (drag.graphH/2) * EQ_GAIN_RANGE, -EQ_GAIN_RANGE, EQ_GAIN_RANGE);
      eq[drag.band] = Math.round(gain * 2) / 2; // snap to 0.5 dB
      slot.drumEQ[drag.padId] = eq;
    }
    return;
  }
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
    const maxDur = trimState.mode === 'customClip' ? dur : TRIM_MAX_SECS;
    if (drag.type==='trimOvlStart') {
      trimState.trimStart=constrain(t,0,trimState.trimEnd-0.1);
      trimState.trimEnd=Math.min(trimState.trimEnd,trimState.trimStart+maxDur);
    } else {
      const maxEnd=Math.min(dur,trimState.trimStart+maxDur);
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
  } else if (drag.type==='panelSlider') {
    const frac=constrain((mX()-drag.sldX)/drag.sldW,0,1);
    const slot=slots[drag.slotIdx||selectedSlotIdx];
    if (drag.param==='vol') { slot.drumVolumes[drag.id]=frac; }
    else if (drag.param==='pitch') { slot.drumPitch[drag.id]=Math.round(frac*24-12); }
    else if (drag.param==='speed') {
      if (drag.linked) {
        // When linked, speed drag moves pitch in semitone steps
        // frac 0→-12, 0.5→0, 1→+12 (log scale: frac maps to speed, speed maps to semitones)
        const semitones = Math.round(normToSpeed(frac) > 0 ? 12 * Math.log2(normToSpeed(frac)) : 0);
        slot.drumPitch[drag.id] = constrain(semitones, -12, 12);
      } else {
        slot.drumSpeed[drag.id]=normToSpeed(frac);
      }
    }
  } else if (drag.type==='trimStart') {
    // Accumulate displacement at current zoom level so handle tracks 1:1 with cursor
    const prevMX = drag.lastMouseX ?? mX();
    const dx = mX() - prevMX;
    drag.lastMouseX = mX();
    const curStart = drag.proposedStart ?? drag.origStart;
    const curRange = (drag.proposedEnd ?? drag.origEnd) - curStart;
    const delta = dx * (Math.max(curRange, 0.01) / drag.barW);
    drag.proposedStart = constrain(curStart + delta, 0, drag.origEnd - 0.002);
    drag.proposedEnd = drag.origEnd;
  } else if (drag.type==='trimEnd') {
    const prevMX = drag.lastMouseX ?? mX();
    const dx = mX() - prevMX;
    drag.lastMouseX = mX();
    const curEnd = drag.proposedEnd ?? drag.origEnd;
    const curRange = curEnd - (drag.proposedStart ?? drag.origStart);
    const delta = dx * (Math.max(curRange, 0.01) / drag.barW);
    drag.proposedStart = drag.origStart;
    drag.proposedEnd = constrain(curEnd + delta, drag.origStart + 0.002, 1);
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
  } else if (drag.type==='reorderSeqLabel') {
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
  if (drag&&drag.type==='panelSlider'&&(drag.param==='pitch'||drag.param==='speed')) {
    invalidatePitchedCache(drag.slotIdx, drag.id);
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
    if (drag.triggered) {
      const L=getPadAreaLayout();
      const slot=currentSlot();
      const tgt=keyReorderTargetIdx(mX(),mY(),L,slot.activePadIds.length);
      if (tgt!==drag.padIndex) reorderPads(drag.padIndex,tgt);
    }
  }
  if (drag&&drag.type==='reorderSeqLabel') {
    if (drag.triggered) {
      const {seqRowHeight,gridTop}=getSeqLayout();
      const slot=slots[drag.slotIdx];
      const seqDrums=getSeqPads(slot);
      const slotGridTopY=getSlotGridTop(drag.slotIdx,gridTop,seqRowHeight);
      const tgt=seqLabelReorderTarget(drag,drag.slotIdx,slotGridTopY,seqRowHeight);
      const fromSeqIdx=drag.seqRowIdx;
      if (tgt!==fromSeqIdx && tgt!==fromSeqIdx+1) {
        // Map seq row indices to activePadIds indices
        const fromPadIdx=slot.activePadIds.indexOf(seqDrums[fromSeqIdx].id);
        let toPadIdx;
        if (tgt>=seqDrums.length) {
          // After last seq row: place after the last seq pad in activePadIds
          toPadIdx=slot.activePadIds.indexOf(seqDrums[seqDrums.length-1].id)+1;
        } else {
          // Before seq row tgt: place at the first position before that seq pad
          // (i.e. right after the previous seq pad, or at 0 if tgt is 0)
          if (tgt===0) {
            toPadIdx=0;
          } else {
            toPadIdx=slot.activePadIds.indexOf(seqDrums[tgt-1].id)+1;
          }
        }
        reorderPads(fromPadIdx,toPadIdx);
      }
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
  if (key==='`') {
    _debugOpen=!_debugOpen;
    const panel=document.getElementById('debug-panel');
    if (panel) panel.style.display=_debugOpen?'block':'none';
    return;
  }
  if (key==='Escape' && cellPitchDropdown) { cellPitchDropdown = null; return; }
  if (key==='r'||key==='R') {
    if (phase==='recording') stopRecording(); else if (phase==='ready') startRecording(); return;
  }
  if (phase==='ready') {
    const id=_kbdMap[key.toLowerCase()];
    if (id) { selectPad(id); triggerDrum(id); padFlash[id]=millis(); padHeld[id]=true; if (seqRecording&&seqPlaying) quantizeToGrid0(id); }
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
  if (!selectedPadId || !slot.activePadIds.includes(selectedPadId)) return;
  const def=getPadDef(selectedPadId);
  if (!def) return;
  const L=getPadAreaLayout();
  const C=panelControlLayout(L);
  const hasCands = slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length > 0;
  const mapped = !!(slot.padMode[def.id] || hasCands);
  if (!mapped) return;
  // Double-click on vol/pitch/speed slider area resets to default
  if (mX()>C.sliderX-4 && mX()<C.sliderX+C.sliderW+4) {
    if (abs(mY()-C.volSliderY)<10) { slot.drumVolumes[def.id]=0.8; return; }
    if (abs(mY()-C.pitchSliderY)<10) { slot.drumPitch[def.id]=0; invalidatePitchedCache(selectedSlotIdx, def.id); return; }
    if (abs(mY()-C.speedSliderY)<10) {
      if (slot.drumPitchSpeedLinked[def.id]??true) { slot.drumPitch[def.id]=0; }
      else { slot.drumSpeed[def.id]=1.0; }
      invalidatePitchedCache(selectedSlotIdx, def.id); return;
    }
  }
  // Double-click on inline EQ graph resets EQ to flat
  if (mX()>C.eqGraphX && mX()<C.eqGraphX+C.eqGraphW && mY()>C.eqGraphY && mY()<C.eqGraphY+C.eqGraphH) {
    slot.drumEQ[def.id] = { low: 0, mid: 0, high: 0 };
    return;
  }
}

// ── Transcript picker ────────────────────────────────────────────────────────

function openPicker(slot, padId) {
  pickerOpen=true; pickerSlot=slot; pickerPadId=padId;
  pickerSel=[]; pickerAnchor=null;
  const L=getPadAreaLayout();
  pickerEl.style.left=Math.min(L.panelX*UI_SCALE,windowWidth-430)+'px';
  pickerEl.style.top=((L.panelY+L.panelH+4)*UI_SCALE)+'px';
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
  const startTime=words[0].start, endTime=words[words.length-1].end;
  const cand=lyricsContextCandidate(slot, startTime, endTime);
  if (!cand) return;
  slot.drumCandidates[pickerPadId]=[cand]; slot.drumIdx[pickerPadId]=0;
  slot.drumTrimStart[pickerPadId]=cand.trimStart; slot.drumTrimEnd[pickerPadId]=cand.trimEnd;
  padFlash[pickerPadId]=millis(); triggerDrum(pickerPadId);
  const text=words.map(w=>w.word).join(' ');
  slot.padText[pickerPadId]=text;
  slot.padFinalized[pickerPadId]=true;
  slot.padMode[pickerPadId]='lyrics';
  syncSharedInput(); positionSharedInput();
  closePicker();
}
