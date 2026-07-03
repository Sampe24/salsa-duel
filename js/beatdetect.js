// Automatic beat detection for user-provided songs.
// Strategy: lowpass the track (kick/conga/bass), build an energy envelope,
// pick onset peaks, get tempo candidates from inter-peak intervals, then
// refine BPM + phase (offset) by scoring beat grids against the envelope.

const HOP = 512; // envelope hop size in samples

async function lowpassEnvelope(buffer) {
  const off = new OfflineAudioContext(1, buffer.length, buffer.sampleRate);
  const src = off.createBufferSource();
  src.buffer = buffer;
  const lp = off.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 150;
  lp.Q.value = 1;
  src.connect(lp);
  lp.connect(off.destination);
  src.start();
  const rendered = await off.startRendering();
  const data = rendered.getChannelData(0);

  const n = Math.floor(data.length / HOP);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = i * HOP, e = j + HOP; j < e; j++) s += data[j] * data[j];
    env[i] = Math.sqrt(s / HOP);
  }
  return env;
}

function pickPeaks(env, sr) {
  const frameDur = HOP / sr;
  const half = Math.round(1.0 / frameDur); // ±1s adaptive window
  const minGap = Math.round(0.28 / frameDur);
  const peaks = [];
  let last = -minGap;
  for (let i = 1; i < env.length - 1; i++) {
    if (env[i] <= env[i - 1] || env[i] < env[i + 1]) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - half); j < Math.min(env.length, i + half); j++) { s += env[j]; c++; }
    if (env[i] > 1.35 * (s / c) && i - last >= minGap) {
      peaks.push(i);
      last = i;
    }
  }
  return peaks.map((i) => i * frameDur); // seconds
}

// Fold a BPM into the danceable 80–170 range.
function foldBpm(bpm) {
  while (bpm < 80) bpm *= 2;
  while (bpm > 170) bpm /= 2;
  return bpm;
}

function tempoCandidates(peakTimes) {
  const bins = new Map(); // rounded BPM -> weight
  for (let i = 0; i < peakTimes.length; i++) {
    for (let j = i + 1; j < Math.min(i + 9, peakTimes.length); j++) {
      const dt = peakTimes[j] - peakTimes[i];
      if (dt < 0.25 || dt > 4) continue;
      const bpm = Math.round(foldBpm(60 / dt));
      bins.set(bpm, (bins.get(bpm) ?? 0) + 1);
    }
  }
  // merge ±1 BPM neighbours, take top 6
  const cands = [...bins.entries()]
    .map(([bpm, w]) => [bpm, w + (bins.get(bpm - 1) ?? 0) + (bins.get(bpm + 1) ?? 0)])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([bpm]) => bpm);
  return cands.length ? cands : [100];
}

// Score a (bpm, phase) grid: mean envelope energy at beat positions.
function gridScore(env, frameDur, bpm, phase) {
  const period = 60 / bpm;
  let s = 0, c = 0;
  for (let t = phase; t < env.length * frameDur; t += period) {
    const i = Math.round(t / frameDur);
    if (i < env.length) { s += env[i]; c++; }
  }
  return c ? s / c : 0;
}

function bestPhase(env, frameDur, bpm) {
  const period = 60 / bpm;
  let best = 0, bestScore = -1;
  for (let k = 0; k < 32; k++) {
    const phase = (k / 32) * period;
    const sc = gridScore(env, frameDur, bpm, phase);
    if (sc > bestScore) { bestScore = sc; best = phase; }
  }
  return { phase: best, score: bestScore };
}

// Main entry. Returns { bpm, offset } — offset = seconds to the first beat.
export async function detectBeat(buffer) {
  const env = await lowpassEnvelope(buffer);
  const frameDur = HOP / buffer.sampleRate;
  const peaks = pickPeaks(env, buffer.sampleRate);
  const candidates = tempoCandidates(peaks);

  let best = { bpm: candidates[0], phase: 0, score: -1 };
  for (const cand of candidates) {
    // refine each candidate ±2% in small steps
    for (let f = -0.02; f <= 0.02; f += 0.005) {
      const bpm = cand * (1 + f);
      const { phase, score } = bestPhase(env, frameDur, bpm);
      if (score > best.score) best = { bpm, phase, score };
    }
  }
  return { bpm: Math.round(best.bpm * 10) / 10, offset: best.phase };
}

// Re-fit the grid phase for a user-supplied BPM (tap tempo correction).
export async function refitOffset(buffer, bpm) {
  const env = await lowpassEnvelope(buffer);
  return bestPhase(env, HOP / buffer.sampleRate, bpm).phase;
}
