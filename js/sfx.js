// Feedback sound effects, synthesized with WebAudio (no audio files).
// Slot-machine feel: hit sounds rise in pitch as the combo grows, and combo
// milestones trigger a coin-cascade "payout".

let ctx = null;
const ac = () => (ctx ??= new (window.AudioContext || window.webkitAudioContext)());

// One enveloped oscillator note.
function tone({ freq, endFreq, type = 'sine', dur = 0.15, vol = 0.25, delay = 0 }) {
  const c = ac();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t0 + dur);
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(gain).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Short filtered-noise burst (shimmer / thud texture).
function noise({ dur = 0.12, vol = 0.15, freq = 4000, type = 'highpass', delay = 0 }) {
  const c = ac();
  const t0 = c.currentTime + delay;
  const len = Math.ceil(dur * c.sampleRate);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filt = c.createBiquadFilter();
  filt.type = type;
  filt.frequency.value = freq;
  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  src.connect(filt).connect(gain).connect(c.destination);
  src.start(t0);
}

// Combo raises pitch a semitone per step, capped one octave up.
const comboMult = (combo) => Math.pow(2, Math.min(combo, 12) / 12);

export function sfxPerfect(combo = 0) {
  const m = comboMult(combo);
  // sparkly ascending arpeggio + shimmer
  tone({ freq: 880 * m, type: 'triangle', dur: 0.12, vol: 0.22 });
  tone({ freq: 1174 * m, type: 'triangle', dur: 0.12, vol: 0.2, delay: 0.06 });
  tone({ freq: 1760 * m, type: 'sine', dur: 0.22, vol: 0.18, delay: 0.12 });
  noise({ freq: 6000, dur: 0.18, vol: 0.08, delay: 0.1 });
}

export function sfxGood(combo = 0) {
  const m = comboMult(combo);
  tone({ freq: 660 * m, type: 'triangle', dur: 0.1, vol: 0.2 });
  tone({ freq: 990 * m, type: 'sine', dur: 0.16, vol: 0.15, delay: 0.05 });
}

export function sfxOk() {
  // muted woodblock tick
  tone({ freq: 320, endFreq: 260, type: 'square', dur: 0.07, vol: 0.12 });
}

export function sfxMiss() {
  // sad descending buzz + dull thud
  tone({ freq: 220, endFreq: 110, type: 'sawtooth', dur: 0.25, vol: 0.14 });
  noise({ freq: 300, type: 'lowpass', dur: 0.15, vol: 0.18 });
}

// Combo milestone payout: cascade of coin dings, longer at higher milestones.
export function sfxJackpot(combo) {
  const coins = Math.min(4 + Math.floor(combo / 5) * 2, 10);
  for (let i = 0; i < coins; i++) {
    const f = 1320 + (i % 3) * 220 + Math.random() * 60;
    tone({ freq: f, type: 'square', dur: 0.09, vol: 0.1, delay: i * 0.055 });
    tone({ freq: f * 1.5, type: 'sine', dur: 0.12, vol: 0.08, delay: i * 0.055 + 0.02 });
  }
}

export function sfxCountdown(final = false) {
  tone({ freq: final ? 880 : 440, type: 'sine', dur: final ? 0.35 : 0.1, vol: 0.2 });
  if (final) tone({ freq: 1320, type: 'sine', dur: 0.3, vol: 0.12, delay: 0.05 });
}
