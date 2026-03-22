// ── BOXER — Global mutable state and slot/pad management ─────────────────────

// ── Slot state ───────────────────────────────────────────────────────────────
let slots = [createSlot()];
let selectedSlotIdx = 0;
function currentSlot() { return slots[selectedSlotIdx]; }

/** Get all drum definitions (standard + active custom) for a slot. */
function getAllDrums(slot) {
  return [...DRUMS, ...slot.activePadIds.map(id => CUSTOM_DEFS.find(d => d.id === id))];
}

/** Get drums visible in the sequencer (not hidden, and custom pads with content). */
function getSeqDrums(slot) {
  return getAllDrums(slot).filter(drum => {
    if (slot.hiddenDrumIds.has(drum.id)) return false;
    if (!isCustomId(drum.id)) return true;
    const customIndex = slot.activePadIds.indexOf(drum.id);
    const textValue = customIndex >= 0 && slot.customInputEls[customIndex]
      ? slot.customInputEls[customIndex].elt.value.trim() : '';
    return (slot.drumCandidates[drum.id] && slot.drumCandidates[drum.id].length > 0) || textValue !== '';
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
let scheduleTimer  = null;
let _loopStartTime = 0;
let _nextSteps     = [0];
let tapTimes = [];
let mediaRecorder = null, recChunks = [], recStream = null;
let recStart = 0, analyserNode = null, waveformData = null;
let audioCtx = null, uploadEl = null, analyzing = false;
let pickerOpen = false, pickerSlot = null, pickerPadId = null;
let pickerPadCustomIdx = null, pickerSel = [], pickerAnchor = null, pickerEl = null;
let errorMsg = '', spinAngle = 0;
let trimState = null;
let trimPlaySrc = null;
let trimPlayStartTime = 0, trimPlayStartSec = 0;

// ── Keyboard map ─────────────────────────────────────────────────────────────
let _kbdMap = {};
function rebuildKbdMap() {
  _kbdMap = {};
  DRUMS.forEach(drum => { _kbdMap[drum.kbd.toLowerCase()] = drum.id; });
  currentSlot().activePadIds.forEach((id, i) => {
    const def = CUSTOM_DEFS[i]; if (def) _kbdMap[def.kbd.toLowerCase()] = id;
  });
}
rebuildKbdMap();

// ── Slot management ──────────────────────────────────────────────────────────

function addSlot() {
  const slot = createSlot();
  slots.push(slot);
  if (seqPlaying) _nextSteps.push(0);
  selectSlot(slots.length-1);
}

function removeSlot(slotIndex) {
  if (slots.length <= 1) return;
  if (pickerSlot === slots[slotIndex]) closePicker();
  slots[slotIndex].customInputEls.forEach(wrapper => wrapper.elt.remove());
  slots.splice(slotIndex, 1);
  if (seqPlaying) { _nextSteps.splice(slotIndex, 1); }
  selectedSlotIdx = Math.min(selectedSlotIdx, slots.length - 1);
  rebuildKbdMap(); positionCustomInputs(); updateElementVisibility();
}

function duplicateSlot(slotIndex) {
  const src = slots[slotIndex], dst = createSlot();
  dst.grid = {
    steps: src.grid.steps,
    cells: Object.fromEntries(Object.entries(src.grid.cells).map(([k, v]) => [k, [...v]])),
  };
  dst.gridVolume = src.gridVolume; dst.swing = src.swing??0; dst.humanize = src.humanize??0;
  dst.humanizeSeeds = [...(src.humanizeSeeds||makeHumanizeSeeds())];
  getAllDrums(src).forEach(drum => {
    dst.drumCandidates[drum.id] = [...(src.drumCandidates[drum.id] || [])];
    dst.drumIdx[drum.id]       = src.drumIdx[drum.id] || 0;
    dst.drumVolumes[drum.id]   = src.drumVolumes[drum.id] ?? 0.8;
    dst.drumPitch[drum.id]     = src.drumPitch[drum.id] ?? 0;
    dst.drumTrimStart[drum.id] = src.drumTrimStart[drum.id] ?? 0;
    dst.drumTrimEnd[drum.id]   = src.drumTrimEnd[drum.id] ?? 1;
  });
  dst.sessionId = src.sessionId; dst.sourceBuffer = src.sourceBuffer;
  dst.lyricsTranscript = [...src.lyricsTranscript]; dst.transcriptLoaded = src.transcriptLoaded;
  dst.hiddenDrumIds = new Set(src.hiddenDrumIds);
  dst.fileName = src.fileName;
  src.activePadIds.forEach((id, i) => {
    const def = getCustomDef(id); if (!def) return;
    dst.padLyricsMode[id] = src.padLyricsMode[id] ?? false;
    dst.padFinalized[id]  = src.padFinalized[id]  ?? false;
    dst.padRecLabels[id]  = [...(src.padRecLabels[id] || [])];
    _addCustomPadToSlot(dst, def);
  });
  src.activePadIds.forEach((id, i) => {
    const srcEl = src.customInputEls[i], dstEl = dst.customInputEls[i];
    if (srcEl && dstEl) dstEl.elt.value = srcEl.elt.value;
  });
  slots.splice(slotIndex + 1, 0, dst);
  if (seqPlaying) _nextSteps.splice(slotIndex + 1, 0, 0);
}

function selectSlot(slotIndex) {
  if (slotIndex < 0 || slotIndex >= slots.length || slotIndex === selectedSlotIdx) return;
  const old = currentSlot();
  old.customInputEls.forEach(el => { el.elt.style.display = 'none'; });
  selectedSlotIdx = slotIndex;
  rebuildKbdMap(); positionCustomInputs(); updateElementVisibility();
  if (pickerOpen && pickerSlot !== currentSlot()) closePicker();
}

// ── Custom pad management ────────────────────────────────────────────────────

function _addCustomPadToSlot(slot, def) {
  slot.activePadIds.push(def.id);
  padFlash[def.id] = padFlash[def.id] ?? -9999;
  padHeld[def.id]  = padHeld[def.id]  ?? false;
  slot.drumVolumes[def.id]    = slot.drumVolumes[def.id]    ?? 0.8;
  slot.drumPitch[def.id]      = slot.drumPitch[def.id]      ?? 0;
  slot.drumTrimStart[def.id]  = slot.drumTrimStart[def.id]  ?? 0;
  slot.drumTrimEnd[def.id]    = slot.drumTrimEnd[def.id]    ?? 1;
  slot.drumCandidates[def.id] = slot.drumCandidates[def.id] || [];
  slot.drumIdx[def.id]        = slot.drumIdx[def.id]        || 0;
  slot.padLyricsMode[def.id]  = slot.padLyricsMode[def.id]  ?? false;
  slot.padRecording[def.id]   = false;
  slot.padRecLabels[def.id]   = slot.padRecLabels[def.id]   || [];
  slot.padRecorders[def.id]   = null;
  slot.padFinalized[def.id]   = slot.padFinalized[def.id]   ?? false;
  slot.grid.cells[def.id]     = slot.grid.cells[def.id]     || new Array(slot.grid.steps).fill(false);
  if (!gainNodes[def.id]) {
    const node = audioCtx.createGain(); node.gain.value = 1.0;
    node.connect(audioCtx.destination); gainNodes[def.id] = node;
  }
  const inputEl = document.createElement('input');
  inputEl.type = 'text'; inputEl.className = 'custom-input'; inputEl.placeholder = 'describe\u2026';
  inputEl.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key==='Enter') {
      if (inputEl.value.trim()) { slot.padFinalized[def.id]=true; positionCustomInputs(); }
      inputEl.blur();
    }
  });
  inputEl.addEventListener('input', () => {
    if (slot.padFinalized[def.id]) return;
    const customIndex = slot.activePadIds.indexOf(def.id); if (customIndex < 0) return;
    if (slot.padLyricsMode[def.id]) applyLyricsQuery(slot, def.id, customIndex);
    else if (slot.sessionId) queryClapLive(slot, def.id, customIndex);
  });
  document.body.appendChild(inputEl);
  slot.customInputEls.push(makeInputWrapper(inputEl));
}

function addCustomPad() {
  const slot = currentSlot();
  if (slot.activePadIds.length >= CUSTOM_DEFS.length) return;
  const def = CUSTOM_DEFS.find(d => !slot.activePadIds.includes(d.id));
  if (!def) return;
  _addCustomPadToSlot(slot, def);
  rebuildKbdMap(); positionCustomInputs(); updateElementVisibility();
}

function removeCustomPad(id) {
  const slot = currentSlot();
  const padIndex = slot.activePadIds.indexOf(id); if (padIndex < 0) return;
  if (pickerPadId === id) closePicker();
  slot.activePadIds.splice(padIndex, 1);
  const wrapper = slot.customInputEls.splice(padIndex, 1)[0]; wrapper.elt.remove();
  delete slot.padFinalized[id];
  delete slot.drumCandidates[id]; delete slot.drumIdx[id];
  delete slot.drumVolumes[id];    delete slot.drumPitch[id];
  delete slot.drumTrimStart[id];  delete slot.drumTrimEnd[id];
  delete padFlash[id];            delete padHeld[id];
  delete slot.padLyricsMode[id];  delete slot.padRecording[id];
  delete slot.padRecLabels[id];   delete slot.padRecorders[id];
  delete slot.grid.cells[id];
  rebuildKbdMap(); positionCustomInputs(); updateElementVisibility();
}

// ── Step count control ───────────────────────────────────────────────────────
function setStepCount(slotIndex, newSteps) {
  const slot = slots[slotIndex];
  newSteps = constrain(Math.round(newSteps), 3, 32);
  if (newSteps === slot.grid.steps) return;
  const oldCells = slot.grid.cells, newCells = {};
  getAllDrums(slot).forEach(drum => {
    const old = oldCells[drum.id] || [];
    newCells[drum.id] = new Array(newSteps).fill(false).map((_, i) => i < old.length ? old[i] : false);
  });
  slot.grid.steps = newSteps; slot.grid.cells = newCells;
}

// ── Slot reordering ──────────────────────────────────────────────────────────
function reorderSlots(fromIdx, toIdx) {
  const slot = slots.splice(fromIdx, 1)[0];
  const nextStepVal = seqPlaying ? _nextSteps.splice(fromIdx, 1)[0] : undefined;
  const insertAt = toIdx > fromIdx ? toIdx - 1 : toIdx;
  slots.splice(insertAt, 0, slot);
  if (seqPlaying && nextStepVal !== undefined) _nextSteps.splice(insertAt, 0, nextStepVal);
  selectedSlotIdx = insertAt; rebuildKbdMap();
}

function reorderTargetIdx(mouseYPos, gridTop, seqRowHeight) {
  for (let i = 0; i < slots.length; i++) {
    if (mouseYPos < getSlotHeaderY(i, gridTop, seqRowHeight) + SLOT_HDR_H/2) return i;
  }
  return slots.length;
}

// ── Phase management ─────────────────────────────────────────────────────────
function setPhase(newPhase) { phase = newPhase; updateElementVisibility(); }
