// Desktop side of the phone motion controller: subscribes to the phone's
// energy stream and answers questions like "how much did the player move in
// the last N ms?" for the scoring code.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const STALE_MS = 5000;

export function makePhoneCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export class PhoneLink {
  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
    this.channel = null;
    this.code = null;
    this.samples = []; // { t: performance.now(), e }
    this.lastSeen = 0;
    this.onConnect = null;
  }

  async start(code) {
    this.code = code;
    this.channel = this.client.channel(`salsa-phone:${code}`);
    this.channel.on('broadcast', { event: 'motion' }, ({ payload }) => {
      const first = this.lastSeen === 0;
      this.lastSeen = performance.now();
      if (payload.kind === 'e') {
        this.samples.push({ t: this.lastSeen, e: payload.e });
        if (this.samples.length > 400) this.samples.splice(0, 200);
      }
      if (first) this.onConnect?.();
    });
    await new Promise((res, rej) => {
      this.channel.subscribe((s) => {
        if (s === 'SUBSCRIBED') res();
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') rej(new Error('phone channel failed'));
      });
    });
  }

  connected() {
    return this.lastSeen > 0 && performance.now() - this.lastSeen < STALE_MS;
  }

  _window(ms) {
    const cutoff = performance.now() - ms;
    return this.samples.filter((s) => s.t >= cutoff);
  }

  // Mean movement energy over the last `ms` milliseconds (m/s²-ish).
  avgEnergy(ms) {
    const w = this._window(ms);
    return w.length ? w.reduce((a, s) => a + s.e, 0) / w.length : 0;
  }

  // Peak movement energy over the last `ms` milliseconds.
  peakEnergy(ms) {
    const w = this._window(ms);
    return w.length ? Math.max(...w.map((s) => s.e)) : 0;
  }

  stop() {
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
    this.samples = [];
    this.lastSeen = 0;
  }
}
