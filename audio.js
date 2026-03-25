// ── BOXER — Audio: scheduler, drum triggering, recording, CLAP queries, lyrics ─

// ── Timing helpers ───────────────────────────────────────────────────────────

function loopDuration() { return 4 * (60.0 / seqBPM); }

function loopFraction() {
  if (!seqPlaying) return 0;
  const dur = loopDuration(), pos = audioCtx.currentTime - _loopStartTime;
  if (pos < 0) return 0;
  return ((pos % dur) + dur) % dur / dur;
}

/** Per-slot loop fraction accounting for multiple measures.
 *  Returns { measureIdx, fraction } where fraction is [0,1] within that measure. */
function slotLoopFraction(slotIndex) {
  if (!seqPlaying) return { measureIdx: 0, fraction: 0 };
  const slot = slots[slotIndex], grid = slot.grid;
  const nM = grid.measures.length;
  const dur = loopDuration();
  const pos = audioCtx.currentTime - _loopStartTime;
  if (pos < 0) return { measureIdx: 0, fraction: 0 };
  const fracInBase = ((pos % dur) + dur) % dur / dur;
  // _measurePhase tracks which measure the current base loop corresponds to.
  // fracInBase > ~0.95 and lookahead may have already pre-scheduled into next measure.
  const phase = _measurePhase[slotIndex] || 0;
  return {
    measureIdx: phase % nM,
    fraction: fracInBase,
  };
}

// ── Swing/humanize step positions ────────────────────────────────────────────

function swingOffset(stepInLoop, stepDuration, swing) {
  if (swing<=0) return stepInLoop*stepDuration;
  const pair=Math.floor(stepInLoop/2), isOdd=stepInLoop%2===1;
  return isOdd ? pair*2*stepDuration+stepDuration*(1+swing*0.5) : pair*2*stepDuration;
}

/** Returns normalised [0,1] positions for all steps + end-of-loop sentinel.
 *  Enforces monotonicity so cells always have positive width. */
function computeStepPositions(grid, slot) {
  const steps=grid.steps, stepDuration=1/steps;
  const swing=slot.swing??0, humVal=slot.humanize??0;
  const seeds=slot.humanizeSeeds;
  const pos=[];
  for (let i=0;i<steps;i++) {
    let p=swingOffset(i,stepDuration,swing);
    if (humVal>0&&seeds) p+=seeds[i%seeds.length]*humVal*stepDuration*0.3;
    pos.push(constrain(p,0,1));
  }
  pos.push(1.0);
  for (let i=1;i<pos.length-1;i++) pos[i]=Math.max(pos[i],pos[i-1]+0.001);
  return pos;
}

/** Given a normalised position [0,1] return which step it falls in. */
function posToStep(pos, stepPositions) {
  for (let i=0;i<stepPositions.length-1;i++) if (pos<stepPositions[i+1]) return i;
  return stepPositions.length-2;
}

// ── Sequencer ────────────────────────────────────────────────────────────────

function startSequencer() {
  if (audioCtx.state==='suspended') audioCtx.resume();
  _nextSteps=slots.map(()=>0);
  _measurePhase=slots.map(()=>0);
  _loopStartTime=audioCtx.currentTime+0.05;
  seqPlaying=true; scheduleLoop();
}

function stopSequencer() {
  seqPlaying=false; seqRecording=false;
  if (scheduleTimer) { clearTimeout(scheduleTimer); scheduleTimer=null; }
  slots.forEach(slot => { slot.humanizeSeeds=makeHumanizeSeeds(); });
}

function scheduleLoop() {
  if (!seqPlaying) return;
  const now=audioCtx.currentTime, loopDur=loopDuration();
  while (now>=_loopStartTime+loopDur) {
    _loopStartTime+=loopDur;
    slots.forEach((slot,slotIndex) => {
      if (_nextSteps[slotIndex]!==undefined) _nextSteps[slotIndex]=Math.max(0,(_nextSteps[slotIndex]||0)-slot.grid.steps);
      const nM=slot.grid.measures.length;
      if (nM>1&&!globalMeasureLock) _measurePhase[slotIndex]=((_measurePhase[slotIndex]||0)+1)%nM;
      slot.humanizeSeeds=makeHumanizeSeeds();
    });
    if (seqRecording) scheduleMetronomeClick(_loopStartTime,true);
  }
  const anySoloed=slots.some(s=>s.soloed);
  slots.forEach((slot,slotIndex) => {
    if (_nextSteps[slotIndex]===undefined) _nextSteps[slotIndex]=0;
    const slotSilenced=slot.muted||(anySoloed&&!slot.soloed);
    const grid=slot.grid, stepDuration=loopDur/grid.steps;
    const nM=grid.measures.length;
    const swingVal=slot.swing??0, humVal=slot.humanize??0;
    const seeds=slot.humanizeSeeds;
    while (_nextSteps[slotIndex]<grid.steps*2) {
      const stepInMeasure=_nextSteps[slotIndex]%grid.steps;
      const baseLoopOffset=Math.floor(_nextSteps[slotIndex]/grid.steps); // 0 or 1 (lookahead)
      const measureIdx=globalMeasureLock?(globalEditMeasure%nM):((_measurePhase[slotIndex]||0)+baseLoopOffset)%nM;
      const loopBase=_loopStartTime+Math.floor(_nextSteps[slotIndex]/grid.steps)*loopDur;
      const seed=seeds?seeds[stepInMeasure%seeds.length]:0;
      const humOffset=humVal>0?seed*humVal*stepDuration*0.3:0;
      const time=loopBase+swingOffset(stepInMeasure,stepDuration,swingVal)+humOffset;
      if (time>now+SCHEDULE_AHEAD) break;
      if (!slotSilenced) {
        const mCells=grid.measures[measureIdx].cells;
        getActivePads(slot).forEach(drum => {
          if (mCells[drum.id]&&mCells[drum.id][stepInMeasure])
            triggerDrumAtTime(slot,drum.id,time);
        });
      }
      if (slotIndex===0&&seqRecording&&stepInMeasure%4===0&&stepInMeasure>0)
        scheduleMetronomeClick(time,false);
      _nextSteps[slotIndex]++;
    }
  });
  scheduleTimer=setTimeout(scheduleLoop,LOOKAHEAD_MS);
}

// ── Drum playback ────────────────────────────────────────────────────────────

function playCandidate(slot, id, cand, when, volScale=1.0) {
  const src=audioCtx.createBufferSource();
  src.playbackRate.value=Math.pow(2,(slot.drumPitch[id]??0)/12);
  const effectiveVol=(slot.drumVolumes[id]??0.8)*volScale;
  let dest=gainNodes[id];
  if (effectiveVol!==1.0) { const gainNode=audioCtx.createGain(); gainNode.gain.value=effectiveVol; gainNode.connect(dest); dest=gainNode; }
  if (cand.buffer) {
    src.buffer=cand.buffer; src.connect(dest);
    const dur=cand.buffer.duration;
    src.start(when,(slot.drumTrimStart[id]??0)*dur,((slot.drumTrimEnd[id]??1)-(slot.drumTrimStart[id]??0))*dur);
  } else {
    if (!slot.sourceBuffer) return;
    src.buffer=slot.sourceBuffer;
    const normGain=audioCtx.createGain(); normGain.gain.value=cand.normGain??1.0;
    src.connect(normGain); normGain.connect(dest);
    const ctxDur=(cand.ctxEnd||1)-(cand.ctxStart||0);
    const offset=(cand.ctxStart||0)+(slot.drumTrimStart[id]??0)*ctxDur;
    const duration=((slot.drumTrimEnd[id]??1)-(slot.drumTrimStart[id]??0))*ctxDur;
    src.start(when,offset,duration);
  }
}

function triggerDrumAtTime(slot, id, when) {
  const cands=slot.drumCandidates[id]; if (!cands||!cands.length) return;
  const cand=cands[slot.drumIdx[id]||0]; if (!cand) return;
  playCandidate(slot,id,cand,when,slot.gridVolume??1.0);
}

function triggerDrum(id) {
  const slot=currentSlot();
  const cands=slot.drumCandidates[id]; if (!cands||!cands.length) return;
  const cand=cands[slot.drumIdx[id]||0]; if (!cand) return;
  if (audioCtx.state==='suspended') audioCtx.resume();
  playCandidate(slot,id,cand,0); padFlash[id]=millis();
}

function scheduleMetronomeClick(when, isDownbeat) {
  const osc=audioCtx.createOscillator(), env=audioCtx.createGain();
  osc.connect(env); env.connect(audioCtx.destination);
  osc.frequency.value=isDownbeat?1200:800; osc.type='sine';
  env.gain.setValueAtTime(0.3,when); env.gain.exponentialRampToValueAtTime(0.001,when+0.04);
  osc.start(when); osc.stop(when+0.05);
}

function quantizeToGrid0(id) {
  const slot=currentSlot();
  const now=audioCtx.currentTime, loopDur=loopDuration();
  let pos=(now-_loopStartTime)%loopDur; if (pos<0) pos+=loopDur;
  const step=Math.round((pos/loopDur)*16)%16;
  const { measureIdx } = slotLoopFraction(0);
  const mCells = slot.grid.measures[measureIdx].cells;
  if (!mCells[id]) mCells[id]=new Array(slot.grid.steps).fill(false);
  mCells[id][step]=!mCells[id][step];
}

// ── Trimmer helpers ──────────────────────────────────────────────────────────

function computeWfPeaks(buffer, numBins) {
  const channel=buffer.getChannelData(0), step=Math.max(1,Math.floor(channel.length/numBins));
  const peaks=new Float32Array(numBins);
  for (let i=0;i<numBins;i++) {
    let peak=0; for (let j=i*step;j<Math.min((i+1)*step,channel.length);j++) peak=Math.max(peak,Math.abs(channel[j]));
    peaks[i]=peak;
  }
  return peaks;
}

function audioBufferToWav(buffer, startSec, endSec) {
  const sr=buffer.sampleRate;
  const start=Math.floor(startSec*sr), end=Math.min(Math.ceil(endSec*sr),buffer.length);
  const len=end-start, numChannels=buffer.numberOfChannels;
  const mono=new Float32Array(len);
  for (let c=0;c<numChannels;c++) { const ch=buffer.getChannelData(c); for (let i=0;i<len;i++) mono[i]+=ch[start+i]/numChannels; }
  const pcm=new Int16Array(len);
  for (let i=0;i<len;i++) pcm[i]=Math.max(-32768,Math.min(32767,Math.round(mono[i]*32767)));
  const wav=new ArrayBuffer(44+len*2), view=new DataView(wav);
  const setBig4=(o,x)=>view.setUint32(o,x,false), setLit4=(o,x)=>view.setUint32(o,x,true), setLit2=(o,x)=>view.setUint16(o,x,true);
  setBig4(0,0x52494646); setLit4(4,36+len*2); setBig4(8,0x57415645);
  setBig4(12,0x666d7420); setLit4(16,16); setLit2(20,1); setLit2(22,1); setLit4(24,sr); setLit4(28,sr*2); setLit2(32,2); setLit2(34,16);
  setBig4(36,0x64617461); setLit4(40,len*2);
  new Int16Array(wav,44).set(pcm);
  return wav;
}

async function openTrimmer(blob, buffer) {
  trimState = {
    blob, buffer,
    fileName: blob.name || 'mic recording',
    trimStart: 0,
    trimEnd: Math.min(buffer.duration, TRIM_MAX_SECS),
    wfPeaks: computeWfPeaks(buffer, 600),
    dragging: null,
  };
  setPhase('trimming');
}

function confirmTrim() {
  if (!trimState) return;
  stopTrimPreview();
  const {buffer, trimStart, trimEnd, fileName} = trimState;
  const safeDur = Math.min(trimEnd - trimStart, TRIM_MAX_SECS - 1/buffer.sampleRate);
  const wav = audioBufferToWav(buffer, trimStart, trimStart + safeDur);
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'audio';
  const wavFile = new File([wav], baseName+'.wav', {type:'audio/wav'});
  trimState = null;
  setPhase('ready');
  submitAudio(wavFile);
}

function stopTrimPreview() {
  if (trimPlaySrc) { try { trimPlaySrc.stop(); } catch(e) {} trimPlaySrc = null; }
}

// ── Recording pipeline ───────────────────────────────────────────────────────

async function startRecording() {
  try { recStream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); }
  catch(e) { errorMsg='Microphone access denied'; setPhase('error'); return; }
  const src=audioCtx.createMediaStreamSource(recStream);
  analyserNode=audioCtx.createAnalyser(); analyserNode.fftSize=512;
  waveformData=new Uint8Array(analyserNode.frequencyBinCount);
  src.connect(analyserNode);
  recChunks=[]; mediaRecorder=new MediaRecorder(recStream);
  mediaRecorder.ondataavailable=e=>{if(e.data.size>0)recChunks.push(e.data);};
  mediaRecorder.onstop=onRecordingStop;
  mediaRecorder.start(100); recStart=millis(); setPhase('recording');
}

function stopRecording() {
  if (mediaRecorder&&mediaRecorder.state!=='inactive') {
    mediaRecorder.stop(); recStream.getTracks().forEach(t=>t.stop()); analyserNode=null;
  }
}

function onRecordingStop() {
  const blob=new Blob(recChunks,{type:'audio/webm'});
  setPhase('ready');
  blob.arrayBuffer().then(ab=>audioCtx.decodeAudioData(ab).then(buf=>openTrimmer(blob,buf)).catch(()=>submitAudio(blob)));
}

function onFileSelected() {
  const file=uploadEl.elt.files[0]; if(!file) return;
  uploadEl.elt.value='';
  file.arrayBuffer().then(ab=>audioCtx.decodeAudioData(ab.slice(0)).then(buf=>openTrimmer(file,buf)).catch(()=>submitAudio(file)));
}

async function submitAudio(blob) {
  if (!blob) return;
  if (phase==='recording') setPhase('ready');
  const slot=currentSlot();
  slot.fileName = blob.name || 'mic recording';
  const arrayBuf=await blob.arrayBuffer();
  const newSourceBuffer=await audioCtx.decodeAudioData(arrayBuf.slice(0));
  slot.analyzing=true; slot.transcriptLoaded=false;
  slot.lyricsTranscript=[];

  const transcribeForm=new FormData(); transcribeForm.append('file',blob,'audio');
  fetch(`${BACKEND}/transcribe`,{method:'POST',body:transcribeForm})
    .then(r=>r.ok?r.json():null)
    .then(data=>{
      if (!data) return;
      slot.lyricsTranscript=data.words||[]; slot.transcriptLoaded=true;
      slot.activePadIds.forEach(id=>{if(slot.padMode[id]==='lyrics')applyLyricsQuery(slot,id);});
    }).catch(e=>console.warn('[transcribe] failed:',e));

  const analyzeForm=new FormData(); analyzeForm.append('file',blob,'audio');
  const customTexts={};
  slot.activePadIds.forEach(id=>{
    const el=slot.padInputEls[id];
    const val=el?el.elt.value.trim():'';
    if(val) customTexts[id]=val;
  });
  analyzeForm.append('custom_texts',JSON.stringify(customTexts));
  let data;
  try {
    const resp=await fetch(`${BACKEND}/analyze`,{method:'POST',body:analyzeForm});
    if (!resp.ok) { const e=await resp.json().catch(()=>({detail:resp.statusText})); throw new Error(e.detail||resp.statusText); }
    data=await resp.json();
  } catch(e) { slot.analyzing=false; errorMsg=e.message; setPhase('error'); return; }

  slot.sourceBuffer=newSourceBuffer; slot.sessionId=data.session_id||null; slot.reuploadPending=false;
  slot.analyzeResults=data.drums||{};
  // Re-populate existing pads from new results
  slot.activePadIds.forEach(id=>{
    slot.drumCandidates[id]=[]; slot.drumIdx[id]=0;
    slot.drumTrimStart[id]=0; slot.drumTrimEnd[id]=1;
    if (slot.padMode[id]==='prototype') {
      const el=slot.padInputEls[id];
      const protoName=el?el.elt.value.trim():'';
      if (protoName && slot.analyzeResults[protoName]) {
        applyPrototype(slot, id, protoName);
      }
    }
  });
  slot.analyzing=false;
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
  if (phase!=='ready') setPhase('ready');
}

// ── Per-pad recording ────────────────────────────────────────────────────────

async function startPadRecording(id) {
  const slot=currentSlot();
  if (slot.padRecording[id]) return;
  let stream;
  try { stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false}); }
  catch(e) { errorMsg='Microphone access denied'; setPhase('error'); return; }
  const src=audioCtx.createMediaStreamSource(stream);
  padRecAnalyser=audioCtx.createAnalyser(); padRecAnalyser.fftSize=512;
  padRecWaveformData=new Uint8Array(padRecAnalyser.frequencyBinCount);
  src.connect(padRecAnalyser);
  padRecordingId=id;
  const chunks=[], recorder=new MediaRecorder(stream);
  const recState={cancelled:false};
  recorder.ondataavailable=e=>{if(e.data.size>0)chunks.push(e.data);};
  recorder.onstop=()=>{if(!recState.cancelled)submitPadRecording(slot,id,new Blob(chunks,{type:'audio/webm'}));};
  recorder.start(100);
  const limitTimer=setTimeout(()=>{if(slot.padRecording[id])stopPadRecording(id);},10000);
  slot.padRecorders[id]={mediaRecorder:recorder,chunks,stream,limitTimer,startTime:Date.now(),recState};
  slot.padRecording[id]=true;
}

function stopPadRecording(id) {
  const slot=currentSlot(); const rec=slot.padRecorders[id]; if (!rec) return;
  const elapsed=Date.now()-rec.startTime;
  if (elapsed<300) {
    rec.recState.cancelled=true;
    errorMsg='Hold the record button longer'; setPhase('error');
  }
  clearTimeout(rec.limitTimer); rec.mediaRecorder.stop();
  rec.stream.getTracks().forEach(t=>t.stop());
  slot.padRecording[id]=false; slot.padRecorders[id]=null;
  padRecAnalyser=null; padRecWaveformData=null; padRecordingId=null;
}

async function submitPadRecording(slot, id, blob) {
  const form=new FormData();
  form.append('file',blob,'pad.webm'); form.append('slot_id',id); form.append('top_k','5');
  try {
    const resp=await fetch(`${BACKEND}/record-custom`,{method:'POST',body:form});
    if (!resp.ok) { const e=await resp.json().catch(()=>({detail:resp.statusText})); throw new Error(e.detail||resp.statusText); }
    const data=await resp.json();
    const bin=atob(data.audio), bytes=new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
    const buf=await audioCtx.decodeAudioData(bytes.buffer.slice(0));
    slot.drumCandidates[id]=[{buffer:buf,score:1.0,time:0}];
    slot.drumIdx[id]=0; slot.drumTrimStart[id]=0; slot.drumTrimEnd[id]=1;
    slot.padRecLabels[id]=data.labels;
    if (data.labels&&data.labels.length>0) {
      const el=slot.padInputEls[id];
      if (el) el.elt.value=data.labels[0].term;
    }
    slot.padFinalized[id]=true; slot.padMode[id]='record';
    positionPadInputs();
    padFlash[id]=millis(); triggerDrum(id);
  } catch(e) { errorMsg=e.message; setPhase('error'); }
}

// ── Live CLAP re-query ───────────────────────────────────────────────────────

let _clapQueryTimers={};
function queryClapLive(slot, id) {
  clearTimeout(_clapQueryTimers[id]);
  _clapQueryTimers[id]=setTimeout(async()=>{
    const el=slot.padInputEls[id];
    const text=el?el.elt.value.trim():'';
    if (!text) return;
    // Wait for analysis to finish if still in progress
    if (!slot.sessionId && slot.analyzing) {
      await new Promise(resolve => {
        const check=()=>{ if(slot.sessionId||!slot.analyzing) resolve(); else setTimeout(check,200); };
        check();
      });
    }
    if (!slot.sessionId) return;
    try {
      const form=new FormData();
      form.append('session_id',slot.sessionId); form.append('text',text);
      form.append('mode','clap'); form.append('top_k','3');
      const resp=await fetch(`${BACKEND}/query-custom`,{method:'POST',body:form});
      if (!resp.ok) return;
      const data=await resp.json();
      const decoded=data.candidates.map(c=>({
        ctxStart:c.ctx_start_s, ctxEnd:c.ctx_end_s,
        trimStart:c.trim_start??0, trimEnd:c.trim_end??1,
        normGain:c.norm_gain??1.0, score:c.score, time:c.time,
      }));
      if (decoded.length>0) {
        slot.drumCandidates[id]=decoded; slot.drumIdx[id]=0;
        slot.drumTrimStart[id]=decoded[0].trimStart; slot.drumTrimEnd[id]=decoded[0].trimEnd;
        padFlash[id]=millis();
      }
    } catch(e) { console.warn('CLAP live query failed:',e); }
  },400);
}

// ── Lyrics query ─────────────────────────────────────────────────────────────

function mergeWordBuffers(slot, words) {
  if (!slot.sourceBuffer||words.length===0) return null;
  const sr=slot.sourceBuffer.sampleRate, srcData=slot.sourceBuffer.getChannelData(0);
  const ranges=words.map((word,i)=>{
    const startSamp=Math.max(0,Math.round(word.start*sr));
    const rawEndSamp=Math.min(slot.sourceBuffer.length,Math.round(word.end*sr));
    const paddedEnd=i===words.length-1?Math.min(slot.sourceBuffer.length,Math.round((word.end+LYRIC_POST_ROLL)*sr)):rawEndSamp;
    return {s:startSamp,e:paddedEnd,len:paddedEnd-startSamp};
  });
  const total=ranges.reduce((acc,r)=>acc+r.len,0); if (total<=0) return null;
  const out=audioCtx.createBuffer(1,total,sr), channel=out.getChannelData(0);
  let pos=0; ranges.forEach(r=>{channel.set(srcData.subarray(r.s,r.e),pos);pos+=r.len;});
  return out;
}

function applyLyricsQuery(slot, id) {
  const el=slot.padInputEls[id];
  const raw=el?el.elt.value.trim():'';
  const query=raw.toLowerCase().replace(/[.,!?;:'"()\-\u2014\u2013]/g,'').trim();
  if (!query) { slot.drumCandidates[id]=[]; slot.drumIdx[id]=0; return; }
  if (slot.lyricsTranscript.length===0) { slot.drumCandidates[id]=[]; slot.drumIdx[id]=0; return; }
  const tokens=query.split(/\s+/).filter(Boolean), numTokens=tokens.length, transcript=slot.lyricsTranscript, hits=[];
  for (let i=0;i<=transcript.length-numTokens;i++) {
    let ok=true;
    for (let j=0;j<numTokens-1;j++) if(transcript[i+j].word!==tokens[j]){ok=false;break;}
    if (ok&&!transcript[i+numTokens-1].word.startsWith(tokens[numTokens-1])) ok=false;
    if (ok) hits.push({words:transcript.slice(i,i+numTokens),start:transcript[i].start,end:transcript[i+numTokens-1].end});
  }
  const candidates=hits.slice(0,N_CANDIDATES), decoded=[];
  for (const hit of candidates) {
    const buf=mergeWordBuffers(slot,hit.words);
    if (buf) decoded.push({buffer:buf,score:1.0,time:hit.start,trimStart:0,trimEnd:1});
  }
  slot.drumCandidates[id]=decoded; slot.drumIdx[id]=0;
  slot.drumTrimStart[id]=0; slot.drumTrimEnd[id]=1;
  if (decoded.length>0) padFlash[id]=millis();
}

// ── Prototype assignment ─────────────────────────────────────────────────────

function applyPrototype(slot, padId, prototypeName, silent=false) {
  const results = slot.analyzeResults[prototypeName];
  if (!results || !results.candidates || results.candidates.length === 0) return;
  const candidates = results.candidates.map(c => ({
    ctxStart: c.ctx_start_s, ctxEnd: c.ctx_end_s,
    trimStart: c.trim_start ?? 0, trimEnd: c.trim_end ?? 1,
    normGain: c.norm_gain ?? 1.0, score: c.score, time: c.time,
  }));
  slot.drumCandidates[padId] = candidates;
  slot.drumIdx[padId] = 0;
  slot.drumTrimStart[padId] = candidates[0].trimStart;
  slot.drumTrimEnd[padId] = candidates[0].trimEnd;
  const el = slot.padInputEls[padId];
  if (el) el.elt.value = prototypeName;
  slot.padFinalized[padId] = true;
  slot.padMode[padId] = 'prototype';
  slot.padMenuOpen[padId] = false;
  positionPadInputs();
  if (!silent) { padFlash[padId] = millis(); triggerDrum(padId); }
}

// ── Session save/load ────────────────────────────────────────────────────────

async function saveSession() {
  const zip = new JSZip();
  const manifest = {
    version: 2,
    savedAt: new Date().toISOString(),
    seqBPM,
    selectedSlotIdx,
    globalMeasureLock,
    globalEditMeasure,
    slots: [],
  };

  for (let si = 0; si < slots.length; si++) {
    const slot = slots[si];
    const slotData = {
      index: si,
      fileName: slot.fileName,
      sourceWavPath: null,
      grid: {
        steps: slot.grid.steps,
        measures: slot.grid.measures.map(m => ({
          cells: Object.fromEntries(Object.entries(m.cells).map(([k, v]) => [k, [...v]])),
        })),
      },
      gridVolume: slot.gridVolume ?? 1.0,
      swing: slot.swing ?? 0,
      humanize: slot.humanize ?? 0,
      muted: !!slot.muted,
      soloed: !!slot.soloed,
      hueOffset: slot.hueOffset || 0,
      activePadIds: [...slot.activePadIds],
      pads: {},
    };

    // Save source audio
    if (slot.sourceBuffer) {
      const wavPath = `slots/${si}/source.wav`;
      const wav = audioBufferToWav(slot.sourceBuffer, 0, slot.sourceBuffer.duration);
      zip.file(wavPath, wav);
      slotData.sourceWavPath = wavPath;
    }

    // Save transcript so we don't need to re-run Whisper on load
    if (slot.lyricsTranscript && slot.lyricsTranscript.length > 0) {
      slotData.lyricsTranscript = slot.lyricsTranscript;
    }

    // Save pad state
    for (const id of slot.activePadIds) {
      const el = slot.padInputEls[id];
      const padData = {
        mode: slot.padMode[id] || null,
        finalized: !!slot.padFinalized[id],
        inputText: el ? el.elt.value : '',
        volume: slot.drumVolumes[id] ?? 0.8,
        pitch: slot.drumPitch[id] ?? 0,
        trimStart: slot.drumTrimStart[id] ?? 0,
        trimEnd: slot.drumTrimEnd[id] ?? 1,
        candidateIdx: slot.drumIdx[id] ?? 0,
        recLabels: slot.padRecLabels[id] || [],
        recordWavPath: null,
      };

      // Save candidates metadata (enables instant playback on load)
      const cands = slot.drumCandidates[id];
      if (cands && cands.length > 0) {
        padData.candidates = cands.map(c => ({
          ctxStart: c.ctxStart, ctxEnd: c.ctxEnd,
          trimStart: c.trimStart, trimEnd: c.trimEnd,
          normGain: c.normGain, score: c.score, time: c.time,
        }));
      }

      // Save record-mode pad audio
      if (slot.padMode[id] === 'record') {
        if (cands && cands.length > 0 && cands[0].buffer) {
          const wavPath = `pads/${id}_slot_${si}.wav`;
          const wav = audioBufferToWav(cands[0].buffer, 0, cands[0].buffer.duration);
          zip.file(wavPath, wav);
          padData.recordWavPath = wavPath;
        }
      }

      slotData.pads[id] = padData;
    }

    manifest.slots.push(slotData);
  }

  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  const blob = await zip.generateAsync({ type: 'blob' });

  // Try native Save As dialog (Chrome/Edge), fall back to <a> download
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: 'session.boxer',
        types: [{ description: 'Boxer Session', accept: { 'application/octet-stream': ['.boxer'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
      // API error — fall through to <a> download
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'session.boxer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function loadSession() {
  let file;
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Boxer Session', accept: { 'application/octet-stream': ['.boxer', '.zip'] } }]
      });
      file = await handle.getFile();
    } catch (e) {
      if (e.name === 'AbortError') return; // user cancelled
      // API error — fall through to <input> picker
    }
  }
  if (!file) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.boxer,.zip';
    input.style.display = 'none';
    document.body.appendChild(input);
    file = await new Promise(resolve => {
      input.addEventListener('change', () => resolve(input.files[0]));
      input.click();
    });
    document.body.removeChild(input);
    if (!file) return;
  }

  const zip = await JSZip.loadAsync(file);
  const manifestText = await zip.file('manifest.json').async('string');
  const manifest = JSON.parse(manifestText);
  if (manifest.version !== 1 && manifest.version !== 2) { errorMsg = 'Unsupported session version'; setPhase('error'); return; }

  // Stop sequencer, clear state
  if (seqPlaying) stopSequencer();
  clearAllSlots();

  seqBPM = manifest.seqBPM ?? 120;
  globalMeasureLock = !!manifest.globalMeasureLock;
  globalEditMeasure = manifest.globalEditMeasure ?? 0;
  // Keep one empty slot so draw() never sees an empty array
  slots = [createSlot()];
  selectedSlotIdx = 0;

  const loadedSlots = [];
  for (let si = 0; si < manifest.slots.length; si++) {
    const sd = manifest.slots[si];
    const slot = createSlot();
    slot.fileName = sd.fileName;
    slot.grid.steps = sd.grid.steps ?? 16;
    slot.gridVolume = sd.gridVolume ?? 1.0;
    slot.swing = sd.swing ?? 0;
    slot.humanize = sd.humanize ?? 0;
    slot.muted = !!sd.muted;
    slot.soloed = !!sd.soloed;
    if (sd.hueOffset !== undefined) slot.hueOffset = sd.hueOffset;
    // Legacy: per-slot measureLock → global
    if (sd.measureLock) globalMeasureLock = true;

    // Restore grid cells (v2: measures array, v1: flat cells -> migrate)
    if (sd.grid.measures) {
      slot.grid.measures = sd.grid.measures.map(m => ({
        cells: Object.fromEntries(Object.entries(m.cells).map(([k, v]) => [k, [...v]])),
      }));
    } else if (sd.grid.cells) {
      slot.grid.measures = [{ cells: Object.fromEntries(Object.entries(sd.grid.cells).map(([k, v]) => [k, [...v]])) }];
    }
    slot.grid.editMeasure = 0;

    // Decode source audio
    if (sd.sourceWavPath) {
      const wavData = await zip.file(sd.sourceWavPath).async('arraybuffer');
      slot.sourceBuffer = await audioCtx.decodeAudioData(wavData.slice(0));
    }

    // Restore pads
    for (const id of sd.activePadIds) {
      const def = getPadDef(id);
      if (!def) continue;
      const pd = sd.pads[id];
      if (!pd) continue;

      slot.padMode[id] = pd.mode;
      slot.padFinalized[id] = pd.finalized;
      slot.drumVolumes[id] = pd.volume;
      slot.drumPitch[id] = pd.pitch;
      slot.drumTrimStart[id] = pd.trimStart;
      slot.drumTrimEnd[id] = pd.trimEnd;
      slot.drumIdx[id] = pd.candidateIdx;
      slot.padRecLabels[id] = pd.recLabels || [];

      _addPadToSlot(slot, def);
      const el = slot.padInputEls[id];
      if (el) {
        el.elt.value = pd.inputText || '';
        if (pd.finalized) el.elt.readOnly = true;
      }

      // Restore saved candidates immediately (enables playback before analysis)
      if (pd.mode === 'record' && pd.recordWavPath) {
        const padWav = await zip.file(pd.recordWavPath).async('arraybuffer');
        const buf = await audioCtx.decodeAudioData(padWav.slice(0));
        slot.drumCandidates[id] = [{ buffer: buf, score: 1.0, time: 0, trimStart: 0, trimEnd: 1 }];
      } else if (pd.candidates && pd.candidates.length > 0) {
        slot.drumCandidates[id] = pd.candidates.map(c => ({
          ctxStart: c.ctxStart, ctxEnd: c.ctxEnd,
          trimStart: c.trimStart, trimEnd: c.trimEnd,
          normGain: c.normGain, score: c.score, time: c.time,
        }));
      }
    }

    loadedSlots.push(slot);
  }

  // Remove placeholder and swap in loaded slots
  Object.values(slots[0].padInputEls).forEach(w => w.elt.remove());
  slots = loadedSlots.length > 0 ? loadedSlots : [createSlot()];
  _nextSteps = slots.map(() => 0);
  selectedSlotIdx = Math.min(manifest.selectedSlotIdx ?? 0, slots.length - 1);
  // Mark slots for re-analysis before updating visibility
  slots.forEach(slot => { if (slot.sourceBuffer) slot.analyzing = true; });
  rebuildKbdMap(); positionPadInputs(); updateElementVisibility();

  // Re-analyze slots that have source audio (async, parallel)
  slots.forEach((slot, si) => {
    const sd = manifest.slots[si];
    if (!slot.sourceBuffer || !sd) return;
    const wav = audioBufferToWav(slot.sourceBuffer, 0, slot.sourceBuffer.duration);
    const wavBlob = new Blob([wav], { type: 'audio/wav' });

    // Restore transcript from manifest (or fall back to re-transcribing)
    if (sd.lyricsTranscript && sd.lyricsTranscript.length > 0) {
      slot.lyricsTranscript = sd.lyricsTranscript;
      slot.transcriptLoaded = true;
      // Re-apply lyrics pads immediately using saved transcript
      slot.activePadIds.forEach(id => {
        const pd = sd.pads[id];
        if (pd && pd.mode === 'lyrics') {
          applyLyricsQuery(slot, id);
          slot.drumTrimStart[id] = pd.trimStart;
          slot.drumTrimEnd[id] = pd.trimEnd;
          slot.drumIdx[id] = pd.candidateIdx;
        }
      });
    } else {
      // Legacy .boxer files without saved transcript — re-transcribe
      const transcribeForm = new FormData();
      transcribeForm.append('file', wavBlob, 'audio.wav');
      fetch(`${BACKEND}/transcribe`, { method: 'POST', body: transcribeForm })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data) return;
          slot.lyricsTranscript = data.words || [];
          slot.transcriptLoaded = true;
          slot.activePadIds.forEach(id => {
            const pd = sd.pads[id];
            if (pd && pd.mode === 'lyrics') {
              applyLyricsQuery(slot, id);
              slot.drumTrimStart[id] = pd.trimStart;
              slot.drumTrimEnd[id] = pd.trimEnd;
              slot.drumIdx[id] = pd.candidateIdx;
            }
          });
        }).catch(e => console.warn('[load:transcribe] failed:', e));
    }

    // Analyze
    const analyzeForm = new FormData();
    analyzeForm.append('file', wavBlob, 'audio.wav');
    const customTexts = {};
    slot.activePadIds.forEach(id => {
      const pd = sd.pads[id];
      if (pd && pd.inputText) customTexts[id] = pd.inputText;
    });
    analyzeForm.append('custom_texts', JSON.stringify(customTexts));
    fetch(`${BACKEND}/analyze`, { method: 'POST', body: analyzeForm })
      .then(r => { if (!r.ok) throw new Error('analyze failed'); return r.json(); })
      .then(data => {
        slot.sessionId = data.session_id || null;
        slot.analyzeResults = data.drums || {};
        // Re-apply prototype and custom (describe) pads
        slot.activePadIds.forEach(id => {
          const pd = sd.pads[id];
          if (!pd) return;
          if (pd.mode === 'prototype') {
            const protoName = pd.inputText;
            if (protoName && slot.analyzeResults[protoName]) {
              applyPrototype(slot, id, protoName, true);
              slot.drumTrimStart[id] = pd.trimStart;
              slot.drumTrimEnd[id] = pd.trimEnd;
              slot.drumIdx[id] = pd.candidateIdx;
            }
          } else if (!pd.mode && pd.inputText) {
            // Custom CLAP text query pad — results come back keyed by pad ID
            const results = slot.analyzeResults[id];
            if (results && results.candidates && results.candidates.length > 0) {
              const candidates = results.candidates.map(c => ({
                ctxStart: c.ctx_start_s, ctxEnd: c.ctx_end_s,
                trimStart: c.trim_start ?? 0, trimEnd: c.trim_end ?? 1,
                normGain: c.norm_gain ?? 1.0, score: c.score, time: c.time,
              }));
              slot.drumCandidates[id] = candidates;
              slot.drumIdx[id] = pd.candidateIdx;
              slot.drumTrimStart[id] = pd.trimStart;
              slot.drumTrimEnd[id] = pd.trimEnd;
            }
          }
        });
        slot.analyzing = false;
        rebuildKbdMap(); positionPadInputs(); updateElementVisibility();
      })
      .catch(e => {
        console.warn('[load:analyze] failed:', e);
        slot.analyzing = false;
      });
  });
}

// ── Tap tempo ────────────────────────────────────────────────────────────────

function handleTap() {
  const now=millis(); tapTimes.push(now);
  tapTimes=tapTimes.filter(t=>now-t<3000).slice(-8);
  if (tapTimes.length>=2) {
    const intervals=[]; for (let i=1;i<tapTimes.length;i++) intervals.push(tapTimes[i]-tapTimes[i-1]);
    seqBPM=constrain(60000/(intervals.reduce((a,b)=>a+b,0)/intervals.length),40,240);
  }
}
