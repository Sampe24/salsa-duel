// Music playback + beat clock, driven by the WebAudio clock for accurate sync.
// If a song's audio file is missing/unloadable, a synthesized salsa percussion
// loop (clave + conga + bass) is generated so the game still works.

export class MusicPlayer {
  constructor() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.source = null;
    this.startedAt = 0;
    this.buffer = null;
    this.usedFallback = false;
  }

  async load(song) {
    this.usedFallback = false;
    try {
      const resp = await fetch(song.file);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.arrayBuffer();
      this.buffer = await this.ctx.decodeAudioData(data);
    } catch (e) {
      console.warn(`[audio] Could not load ${song.file} (${e.message}) — using synth fallback`);
      this.buffer = synthSalsaLoop(this.ctx, song.bpm, song.duration);
      this.usedFallback = true;
    }
  }

  // startDelaySec lets multiplayer schedule a synchronized start.
  start(startDelaySec = 0) {
    this.ctx.resume();
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.buffer;
    this.source.connect(this.ctx.destination);
    this.startedAt = this.ctx.currentTime + startDelaySec;
    this.source.start(this.startedAt);
  }

  // Seconds into the song (negative while waiting for a scheduled start).
  time() {
    return this.ctx.currentTime - this.startedAt;
  }

  stop() {
    try { this.source?.stop(); } catch (_) { /* already stopped */ }
    this.source = null;
  }

  onEnded(cb) {
    if (this.source) this.source.onended = cb;
  }
}

// ===== Synth fallback: minimal salsa groove rendered into an AudioBuffer =====
function synthSalsaLoop(ctx, bpm, durationSec) {
  const sr = ctx.sampleRate;
  const len = Math.ceil(durationSec * sr);
  const buf = ctx.createBuffer(2, len, sr);
  const L = buf.getChannelData(0), R = buf.getChannelData(1);
  const beat = 60 / bpm;

  const hit = (t, freq, decay, vol, noise = 0) => {
    const start = Math.floor(t * sr);
    const n = Math.floor(decay * sr);
    for (let i = 0; i < n && start + i < len; i++) {
      const env = Math.exp(-4 * i / n);
      let s = Math.sin(2 * Math.PI * freq * (i / sr)) * (1 - noise);
      if (noise) s += (Math.random() * 2 - 1) * noise;
      const v = s * env * vol;
      L[start + i] += v;
      R[start + i] += v * 0.9;
    }
  };

  // Son clave 2-3 pattern over 2 bars (8 beats), plus congas and a simple bass tumbao.
  const clave = [0, 1.5, 3, 5, 6]; // in beats, within an 8-beat cycle
  const nBars2 = Math.ceil(durationSec / (beat * 8));
  for (let c = 0; c < nBars2; c++) {
    const base = c * 8 * beat;
    for (const b of clave) hit(base + b * beat, 1800, 0.06, 0.5, 0.3); // clave "tick"
    for (let q = 0; q < 8; q++) {
      hit(base + q * beat, q % 2 ? 190 : 240, 0.12, 0.35); // conga open/slap alternation
      if (q % 2 === 0) hit(base + (q + 0.5) * beat, 320, 0.05, 0.18, 0.5); // ghost
    }
    // bass tumbao: beats 2.5, 4 of each bar
    for (const bb of [2.5, 4, 6.5, 8]) hit(base + (bb - 1) * beat, 82, 0.3, 0.55);
  }
  return buf;
}
