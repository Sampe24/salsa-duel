// Online rooms via Supabase Realtime broadcast channels.
// Flow: host creates a room code -> both join channel `salsa:<CODE>` ->
// presence handshake with chosen character -> both press Ready ->
// host broadcasts a synchronized start time -> scores stream during play.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no easily-confused chars

export function makeRoomCode() {
  let c = '';
  for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return c;
}

export class Room {
  constructor() {
    this.client = createClient(SUPABASE_URL, SUPABASE_KEY);
    this.channel = null;
    this.code = null;
    this.isHost = false;
    this.me = null;        // { id, character }
    this.peer = null;      // { id, character }
    this.peerReady = false;
    this.myReady = false;
    // callbacks assigned by the UI layer:
    this.onPeerJoin = null;
    this.onPeerLeave = null;
    this.onPeerReady = null;
    this.onStart = null;   // ({ songId, startAtEpochMs })
    this.onScore = null;   // ({ score, combo })
    this.onFinish = null;  // ({ score, counts })
    this.onXfer = null;    // song-transfer signaling/data (see transfer.js)
  }

  async join(code, { character, isHost }) {
    this.code = code.toUpperCase();
    this.isHost = isHost;
    this.me = { id: crypto.randomUUID(), character };

    this.channel = this.client.channel(`salsa:${this.code}`, {
      config: { presence: { key: this.me.id }, broadcast: { self: false } },
    });

    this.channel
      .on('presence', { event: 'sync' }, () => this._syncPresence())
      .on('broadcast', { event: 'ready' }, ({ payload }) => {
        if (payload.id !== this.me.id) {
          this.peerReady = true;
          this.onPeerReady?.();
        }
      })
      .on('broadcast', { event: 'start' }, ({ payload }) => this.onStart?.(payload))
      .on('broadcast', { event: 'score' }, ({ payload }) => {
        if (payload.id !== this.me.id) this.onScore?.(payload);
      })
      .on('broadcast', { event: 'finish' }, ({ payload }) => {
        if (payload.id !== this.me.id) this.onFinish?.(payload);
      })
      .on('broadcast', { event: 'xfer' }, ({ payload }) => this.onXfer?.(payload));

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Could not reach the game server')), 10000);
      this.channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer);
          await this.channel.track({ id: this.me.id, character, host: isHost });
          resolve();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          clearTimeout(timer);
          reject(new Error('Connection failed: ' + status));
        }
      });
    });

    // A joiner should find a host already present.
    if (!isHost) {
      await new Promise((r) => setTimeout(r, 800)); // allow presence sync
      if (!this.peer) throw new Error('Room not found — check the code');
    }
  }

  _syncPresence() {
    const state = this.channel.presenceState();
    const others = Object.values(state).flat().filter((p) => p.id !== this.me.id);
    const had = !!this.peer;
    this.peer = others[0] ?? null;
    if (this.peer && !had) this.onPeerJoin?.(this.peer);
    if (!this.peer && had) {
      this.peerReady = false;
      this.onPeerLeave?.();
    }
  }

  sendReady() {
    this.myReady = true;
    this.channel.send({ type: 'broadcast', event: 'ready', payload: { id: this.me.id } });
  }

  bothReady() {
    return this.myReady && this.peerReady;
  }

  // Host schedules a synchronized start ~4s in the future (epoch-based; small
  // clock skew between machines is acceptable for a dance game).
  sendStart(songId) {
    const payload = { songId, startAtEpochMs: Date.now() + 4000 };
    this.channel.send({ type: 'broadcast', event: 'start', payload });
    return payload;
  }

  sendScore(score, combo) {
    const now = performance.now();
    if (this._lastScoreSent && now - this._lastScoreSent < 250) return; // throttle ~4/s
    this._lastScoreSent = now;
    this.channel.send({ type: 'broadcast', event: 'score', payload: { id: this.me.id, score, combo } });
  }

  sendXfer(payload) {
    this.channel.send({ type: 'broadcast', event: 'xfer', payload });
  }

  sendFinish(summary) {
    this.channel.send({
      type: 'broadcast',
      event: 'finish',
      payload: { id: this.me.id, score: summary.score, accuracy: summary.accuracy },
    });
  }

  leave() {
    if (this.channel) this.client.removeChannel(this.channel);
    this.channel = null;
    this.peer = null;
    this.myReady = this.peerReady = false;
  }
}
