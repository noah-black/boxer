// ── BOXER — Global mutable state and slot/pad management ─────────────────────

// ── Slot state ───────────────────────────────────────────────────────────────
let slots = [createSlot()];
let selectedSlotIdx = 0;
function currentSlot() { return slots[selectedSlotIdx]; }

function slotHasAudio(slot) { return !!slot.sourceBuffer; }

/** Get all active pad definitions for a slot. */
function getActivePads(slot) {
  return slot.activePadIds.map(id => getPadDef(id));
}

/** Get pads visible in the sequencer (with content). */
function getSeqPads(slot) {
  return getActivePads(slot).filter(def => {
    const el = slot.padInputEls[def.id];
    const textValue = el ? el.elt.value.trim() : '';
    return (slot.drumCandidates[def.id] && slot.drumCandidates[def.id].length > 0) || textValue !== '';
  });
}

// ── Global (non-slot) state ──────────────────────────────────────────────────
let phase = 'ready';
let gainNodes = {};
let padFlash  = {};
let padHeld   = {};
let drag      = null;
let seqBPM      = 120;
let seqScrollY  = 0;
let seqPlaying  = false;
let seqRecording = false;
let globalMeasureLock = false;
let globalEditMeasure = 0;
let scheduleTimer  = null;
let _loopStartTime = 0;
let _nextSteps     = [0];
let _measurePhase  = [0];
let tapTimes = [];
let mediaRecorder = null, recChunks = [], recStream = null;
let _stepEditInput = null;
let _stepEditSlotIdx = -1;
let recStart = 0, analyserNode = null, waveformData = null;
let audioCtx = null, uploadEl = null;
let pickerOpen = false, pickerSlot = null, pickerPadId = null;
let pickerSel = [], pickerAnchor = null, pickerEl = null, pickerDragging = false;
let errorMsg = '', spinAngle = 0;
let trimState = null;
let trimPlaySrc = null;
let trimPlayStartTime = 0, trimPlayStartSec = 0;
let padRecAnalyser = null, padRecWaveformData = null, padRecordingId = null;

// ── Keyboard map ─────────────────────────────────────────────────────────────
let _kbdMap = {};
function rebuildKbdMap() {
  _kbdMap = {};
  currentSlot().activePadIds.forEach((id, i) => {
    // Assign keys by position so they're always a contiguous prefix of ASDFGHJKZXCVBNM,
    if (i < PAD_DEFS.length) _kbdMap[PAD_DEFS[i].kbd.toLowerCase()] = id;
  });
}
/** Get the display key for a pad based on its position (not its fixed PAD_DEFS key). */
function padDisplayKey(id) {
  const idx = currentSlot().activePadIds.indexOf(id);
  return idx >= 0 && idx < PAD_DEFS.length ? PAD_DEFS[idx].kbd : '';
}
rebuildKbdMap();

// ── Slot management ──────────────────────────────────────────────────────────

function addSlot() {
  const slot = createSlot();
  slots.push(slot);
  if (seqPlaying) { _nextSteps.push(0); _measurePhase.push(0); }
  selectSlot(slots.length-1);
}

function clearAllSlots() {
  if (pickerOpen) closePicker();
  slots.forEach(slot => {
    Object.values(slot.padInputEls).forEach(w => w.elt.remove());
  });
  slots = [createSlot()];
  selectedSlotIdx = 0;
  _nextSteps = [0]; _measurePhase = [0];
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
}

function removeSlot(slotIndex) {
  if (slots.length <= 1) return;
  if (pickerSlot === slots[slotIndex]) closePicker();
  Object.values(slots[slotIndex].padInputEls).forEach(w => w.elt.remove());
  slots.splice(slotIndex, 1);
  if (seqPlaying) { _nextSteps.splice(slotIndex, 1); _measurePhase.splice(slotIndex, 1); }
  selectedSlotIdx = Math.min(selectedSlotIdx, slots.length - 1);
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
}

function duplicateSlot(slotIndex) {
  const src = slots[slotIndex], dst = createSlot();
  dst.grid = {
    steps: src.grid.steps,
    measures: src.grid.measures.map(m => ({
      cells: Object.fromEntries(Object.entries(m.cells).map(([k, v]) => [k, [...v]])),
    })),
    editMeasure: src.grid.editMeasure,
  };
  dst.gridVolume = src.gridVolume; dst.swing = src.swing??0; dst.humanize = src.humanize??0;
  dst.muted = src.muted; dst.soloed = src.soloed;
  dst.humanizeSeeds = [...(src.humanizeSeeds||makeHumanizeSeeds())];
  src.activePadIds.forEach(id => {
    dst.drumCandidates[id] = [...(src.drumCandidates[id] || [])];
    dst.drumIdx[id]       = src.drumIdx[id] || 0;
    dst.drumVolumes[id]   = src.drumVolumes[id] ?? 0.8;
    dst.drumPitch[id]     = src.drumPitch[id] ?? 0;
    dst.drumTrimStart[id] = src.drumTrimStart[id] ?? 0;
    dst.drumTrimEnd[id]   = src.drumTrimEnd[id] ?? 1;
    dst.padMode[id]       = src.padMode[id] ?? null;
    dst.padFinalized[id]  = src.padFinalized[id] ?? false;
    dst.padRecLabels[id]  = [...(src.padRecLabels[id] || [])];
  });
  dst.sessionId = src.sessionId; dst.sourceBuffer = src.sourceBuffer;
  dst.analyzeResults = JSON.parse(JSON.stringify(src.analyzeResults || {}));
  dst.lyricsTranscript = [...src.lyricsTranscript]; dst.transcriptLoaded = src.transcriptLoaded;
  dst.fileName = src.fileName;
  src.activePadIds.forEach(id => {
    const def = getPadDef(id); if (!def) return;
    _addPadToSlot(dst, def);
    const srcEl = src.padInputEls[id], dstEl = dst.padInputEls[id];
    if (srcEl && dstEl) dstEl.elt.value = srcEl.elt.value;
  });
  slots.splice(slotIndex + 1, 0, dst);
  if (seqPlaying) { _nextSteps.splice(slotIndex + 1, 0, 0); _measurePhase.splice(slotIndex + 1, 0, 0); }
}

function selectSlot(slotIndex) {
  if (slotIndex < 0 || slotIndex >= slots.length || slotIndex === selectedSlotIdx) return;
  const old = currentSlot();
  Object.values(old.padInputEls).forEach(el => { el.elt.style.display = 'none'; });
  selectedSlotIdx = slotIndex;
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
  if (pickerOpen && pickerSlot !== currentSlot()) closePicker();
}

// ── Pad management ──────────────────────────────────────────────────────────

function _addPadToSlot(slot, def) {
  if (!slot.activePadIds.includes(def.id)) slot.activePadIds.push(def.id);
  padFlash[def.id] = padFlash[def.id] ?? -9999;
  padHeld[def.id]  = padHeld[def.id]  ?? false;
  slot.drumVolumes[def.id]    = slot.drumVolumes[def.id]    ?? 0.8;
  slot.drumPitch[def.id]      = slot.drumPitch[def.id]      ?? 0;
  slot.drumTrimStart[def.id]  = slot.drumTrimStart[def.id]  ?? 0;
  slot.drumTrimEnd[def.id]    = slot.drumTrimEnd[def.id]    ?? 1;
  slot.drumCandidates[def.id] = slot.drumCandidates[def.id] || [];
  slot.drumIdx[def.id]        = slot.drumIdx[def.id]        || 0;
  slot.padMode[def.id]        = slot.padMode[def.id]        ?? null;
  slot.padRecording[def.id]   = false;
  slot.padRecLabels[def.id]   = slot.padRecLabels[def.id]   || [];
  slot.padRecorders[def.id]   = null;
  slot.padFinalized[def.id]   = slot.padFinalized[def.id]   ?? false;
  slot.padMenuOpen[def.id]    = false;
  slot.grid.measures.forEach(m => {
    m.cells[def.id] = m.cells[def.id] || new Array(slot.grid.steps).fill(false);
  });
  if (!gainNodes[def.id]) {
    const node = audioCtx.createGain(); node.gain.value = 1.0;
    node.connect(audioCtx.destination); gainNodes[def.id] = node;
  }
  if (!slot.padInputEls[def.id]) {
    const inputEl = document.createElement('input');
    inputEl.type = 'text'; inputEl.className = 'pad-input'; inputEl.placeholder = 'describe\u2026';
    inputEl.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key==='Enter') {
        if (inputEl.value.trim()) { slot.padFinalized[def.id]=true; positionPadInputs(); }
        inputEl.blur();
      }
    });
    inputEl.addEventListener('input', () => {
      if (slot.padFinalized[def.id]) return;
      const mode = slot.padMode[def.id];
      if (mode==='lyrics') applyLyricsQuery(slot, def.id);
      else if (slot.sessionId) queryClapLive(slot, def.id);
    });
    document.body.appendChild(inputEl);
    slot.padInputEls[def.id] = makeInputWrapper(inputEl);
  }
}

function addPad() {
  const slot = currentSlot();
  if (slot.activePadIds.length >= PAD_DEFS.length) return;
  const def = PAD_DEFS.find(d => !slot.activePadIds.includes(d.id));
  if (!def) return;
  _addPadToSlot(slot, def);
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
}

function addPadWithPrototype(prototypeName) {
  const slot = currentSlot();
  if (slot.activePadIds.length >= PAD_DEFS.length) return;
  const def = PAD_DEFS.find(d => !slot.activePadIds.includes(d.id));
  if (!def) return;
  _addPadToSlot(slot, def);
  applyPrototype(slot, def.id, prototypeName);
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
}

function removePad(id) {
  const slot = currentSlot();
  const padIndex = slot.activePadIds.indexOf(id); if (padIndex < 0) return;
  if (pickerPadId === id) closePicker();
  slot.activePadIds.splice(padIndex, 1);
  const wrapper = slot.padInputEls[id]; if (wrapper) wrapper.elt.remove();
  delete slot.padInputEls[id];
  delete slot.padFinalized[id]; delete slot.padMode[id]; delete slot.padMenuOpen[id];
  delete slot.drumCandidates[id]; delete slot.drumIdx[id];
  delete slot.drumVolumes[id];    delete slot.drumPitch[id];
  delete slot.drumTrimStart[id];  delete slot.drumTrimEnd[id];
  delete padFlash[id];            delete padHeld[id];
  delete slot.padRecording[id];   delete slot.padRecLabels[id]; delete slot.padRecorders[id];
  slot.grid.measures.forEach(m => { delete m.cells[id]; });
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
}

/** Re-initialize a pad: clear its sound and restore the editable state. */
function clearPad(id) {
  const slot = currentSlot();
  slot.padFinalized[id] = false;
  slot.padMode[id] = null;
  slot.padMenuOpen[id] = false;
  const el = slot.padInputEls[id];
  if (el) { el.elt.value = ''; el.elt.readOnly = false; }
  slot.drumCandidates[id] = []; slot.drumIdx[id] = 0;
  slot.drumTrimStart[id] = 0; slot.drumTrimEnd[id] = 1;
  positionPadInputs();
}

// ── Measure management ──────────────────────────────────────────────────────
function addMeasure(slotIndex) {
  const slot = slots[slotIndex], grid = slot.grid;
  if (grid.measures.length >= MAX_MEASURES) return;
  const newCells = {};
  getActivePads(slot).forEach(def => {
    newCells[def.id] = new Array(grid.steps).fill(false);
  });
  grid.measures.push({ cells: newCells });
  grid.editMeasure = grid.measures.length - 1;
}

function duplicateMeasure(slotIndex, measureIdx) {
  const slot = slots[slotIndex], grid = slot.grid;
  if (grid.measures.length >= MAX_MEASURES) return;
  const src = grid.measures[measureIdx];
  const cloned = { cells: Object.fromEntries(Object.entries(src.cells).map(([k, v]) => [k, [...v]])) };
  grid.measures.splice(measureIdx + 1, 0, cloned);
  grid.editMeasure = measureIdx + 1;
}

function removeMeasure(slotIndex, measureIdx) {
  const grid = slots[slotIndex].grid;
  if (grid.measures.length <= 1) return;
  grid.measures.splice(measureIdx, 1);
  if (grid.editMeasure >= grid.measures.length) grid.editMeasure = grid.measures.length - 1;
}

function reorderMeasures(slotIndex, fromIdx, toIdx) {
  const measures = slots[slotIndex].grid.measures;
  const [moved] = measures.splice(fromIdx, 1);
  const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
  measures.splice(insertAt, 0, moved);
  slots[slotIndex].grid.editMeasure = insertAt;
}

/** Get the cells object for the currently-edited measure of a slot. */
function editCells(slot) {
  return slot.grid.measures[slot.grid.editMeasure].cells;
}

// ── Step count control ───────────────────────────────────────────────────────
function setStepCount(slotIndex, newSteps) {
  const slot = slots[slotIndex];
  newSteps = constrain(Math.round(newSteps), 3, 64);
  if (newSteps === slot.grid.steps) return;
  // Extend arrays if growing, but never shrink — preserves steps beyond the visible range
  if (newSteps > slot.grid.steps) {
    slot.grid.measures.forEach(m => {
      getActivePads(slot).forEach(def => {
        const old = m.cells[def.id];
        if (old && old.length < newSteps) {
          m.cells[def.id] = old.concat(new Array(newSteps - old.length).fill(false));
        }
      });
    });
  }
  slot.grid.steps = newSteps;
}

function openStepEdit(slotIndex, screenX, screenY, w, h) {
  if (!_stepEditInput) {
    _stepEditInput = document.createElement('input');
    _stepEditInput.type = 'text';
    _stepEditInput.inputMode = 'numeric';
    _stepEditInput.style.cssText = [
      "position:fixed", "z-index:200", "text-align:center",
      "font-family:'Silkscreen',monospace", "font-size:"+(7*UI_SCALE)+"px",
      "border:none", "outline:none", "background:transparent", "color:#222",
      "padding:0", "display:none",
    ].join(';');
    document.body.appendChild(_stepEditInput);
    _stepEditInput.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' || e.key === 'Tab') { commitStepEdit(); e.preventDefault(); }
      if (e.key === 'Escape') { closeStepEdit(); e.preventDefault(); }
    });
    _stepEditInput.addEventListener('blur', () => commitStepEdit());
  }
  _stepEditSlotIdx = slotIndex;
  _stepEditInput.style.left = (screenX * UI_SCALE) + 'px';
  _stepEditInput.style.top = (screenY * UI_SCALE) + 'px';
  _stepEditInput.style.width = (w * UI_SCALE) + 'px';
  _stepEditInput.style.height = (h * UI_SCALE) + 'px';
  _stepEditInput.style.display = 'block';
  _stepEditInput.value = slots[slotIndex].grid.steps;
  // Defer focus so p5's mousePressed doesn't steal it back
  setTimeout(() => { _stepEditInput.focus(); _stepEditInput.select(); }, 0);
}

let _stepEditCommitting = false;
function commitStepEdit() {
  if (_stepEditCommitting) return;
  if (!_stepEditInput || _stepEditInput.style.display === 'none') return;
  _stepEditCommitting = true;
  const val = parseInt(_stepEditInput.value, 10);
  if (!isNaN(val) && _stepEditSlotIdx >= 0 && _stepEditSlotIdx < slots.length) {
    setStepCount(_stepEditSlotIdx, val);
  }
  closeStepEdit();
  _stepEditCommitting = false;
}

function closeStepEdit() {
  if (_stepEditInput) { _stepEditInput.style.display = 'none'; _stepEditInput.blur(); }
  _stepEditSlotIdx = -1;
}

// ── Slot reordering ──────────────────────────────────────────────────────────
function reorderSlots(fromIdx, toIdx) {
  const slot = slots.splice(fromIdx, 1)[0];
  const nextStepVal = seqPlaying ? _nextSteps.splice(fromIdx, 1)[0] : undefined;
  const phaseVal = seqPlaying ? _measurePhase.splice(fromIdx, 1)[0] : undefined;
  const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
  slots.splice(insertAt, 0, slot);
  if (seqPlaying && nextStepVal !== undefined) { _nextSteps.splice(insertAt, 0, nextStepVal); _measurePhase.splice(insertAt, 0, phaseVal); }
  selectedSlotIdx = insertAt; rebuildKbdMap();
}

function reorderTargetIdx(mouseYPos, gridTop, seqRowHeight) {
  for (let i = 0; i < slots.length; i++) {
    if (mouseYPos < getSlotHeaderY(i, gridTop, seqRowHeight) + SLOT_HDR_H/2) return i;
  }
  return slots.length;
}

// ── Pad reordering ──────────────────────────────────────────────────────────
function reorderPads(fromIdx, toIdx) {
  const slot = currentSlot();
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return;
  const id = slot.activePadIds.splice(fromIdx, 1)[0];
  const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
  slot.activePadIds.splice(insertAt, 0, id);
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
}

// ── Phase management ─────────────────────────────────────────────────────────
function setPhase(newPhase) { phase = newPhase; updateElementVisibility(); }
