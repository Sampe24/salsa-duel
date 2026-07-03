// Song transfer between players: WebRTC data channel (peer-to-peer, the music
// never touches a server) with automatic fallback to chunked Supabase Realtime
// messages on restrictive networks. Signaling runs over the existing room channel
// via room.sendXfer / room.onXfer (single 'xfer' event, payload.kind discriminates).

const RTC_CONFIG = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
const RTC_CHUNK = 16 * 1024;        // data channel message size
const CH_CHUNK = 45 * 1024;          // raw bytes per Realtime fallback message
const RTC_CONNECT_TIMEOUT = 8000;

const b64encode = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
};
const b64decode = (str) => {
  const bin = atob(str);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== HOST side =====
// Sends the song, resolves when the peer confirms full receipt.
export async function sendSong(room, meta, arrayBuffer, onStatus) {
  const bytes = new Uint8Array(arrayBuffer);
  let resolveAck, resolveReceived, rtcAnswer, onIce;
  const ackP = new Promise((r) => (resolveAck = r));
  const receivedP = new Promise((r) => (resolveReceived = r));
  const answerP = new Promise((r) => (rtcAnswer = r));

  const prevHandler = room.onXfer;
  room.onXfer = (p) => {
    if (p.kind === 'meta-ack') resolveAck();
    else if (p.kind === 'received') resolveReceived();
    else if (p.kind === 'rtc-answer') rtcAnswer(p.desc);
    else if (p.kind === 'ice') onIce?.(p.candidate);
  };

  try {
    onStatus?.('Contacting rival…');
    room.sendXfer({ kind: 'meta', ...meta, size: bytes.length });
    await Promise.race([ackP, sleep(10000).then(() => { throw new Error('Rival did not respond'); })]);

    let sent = false;
    try {
      await sendViaRTC(room, bytes, onStatus, answerP, (fn) => (onIce = fn));
      sent = true;
    } catch (e) {
      console.warn('[transfer] WebRTC failed, falling back to relay:', e.message);
    }
    if (!sent) {
      room.sendXfer({ kind: 'use-relay' });
      await sendViaChannel(room, bytes, onStatus);
    }

    onStatus?.('Waiting for confirmation…');
    await Promise.race([receivedP, sleep(30000).then(() => { throw new Error('Peer never confirmed receipt'); })]);
  } finally {
    room.onXfer = prevHandler;
  }
}

async function sendViaRTC(room, bytes, onStatus, answerP, setIceHandler) {
  const pc = new RTCPeerConnection(RTC_CONFIG);
  try {
    const dc = pc.createDataChannel('song', { ordered: true });
    dc.binaryType = 'arraybuffer';
    pc.onicecandidate = (e) => {
      if (e.candidate) room.sendXfer({ kind: 'ice', from: 'host', candidate: e.candidate.toJSON() });
    };
    setIceHandler((cand) => pc.addIceCandidate(cand).catch(() => {}));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    room.sendXfer({ kind: 'rtc-offer', desc: pc.localDescription.toJSON() });

    const desc = await Promise.race([
      answerP,
      sleep(RTC_CONNECT_TIMEOUT).then(() => { throw new Error('no answer'); }),
    ]);
    await pc.setRemoteDescription(desc);

    await Promise.race([
      new Promise((res, rej) => {
        dc.onopen = res;
        dc.onerror = () => rej(new Error('data channel error'));
      }),
      sleep(RTC_CONNECT_TIMEOUT).then(() => { throw new Error('data channel never opened'); }),
    ]);

    for (let i = 0; i < bytes.length; i += RTC_CHUNK) {
      while (dc.bufferedAmount > 4 * 1024 * 1024) await sleep(40);
      dc.send(bytes.subarray(i, i + RTC_CHUNK));
      if (i % (RTC_CHUNK * 16) === 0) {
        onStatus?.(`Sending song… ${Math.round((i / bytes.length) * 100)}% (direct)`);
      }
    }
    while (dc.bufferedAmount > 0) await sleep(50);
    onStatus?.('Sending song… 100%');
    await sleep(300); // let the tail flush before closing
  } finally {
    setTimeout(() => pc.close(), 2000);
  }
}

async function sendViaChannel(room, bytes, onStatus) {
  const n = Math.ceil(bytes.length / CH_CHUNK);
  for (let i = 0; i < n; i++) {
    const chunk = bytes.subarray(i * CH_CHUNK, (i + 1) * CH_CHUNK);
    room.sendXfer({ kind: 'chunk', i, n, data: b64encode(chunk) });
    onStatus?.(`Sending song… ${Math.round(((i + 1) / n) * 100)}% (relay)`);
    await sleep(140); // stay under Realtime rate limits
  }
}

// ===== JOINER side =====
// Call once when entering the lobby; resolves {meta, arrayBuffer} if/when the
// host sends a custom song. Never resolves for built-in songs (that's fine —
// the promise is just abandoned).
export function receiveSong(room, onStatus) {
  return new Promise((resolve, reject) => {
    let meta = null;
    let pc = null;
    let received = 0;
    let parts = [];
    let relayParts = null;

    const finish = () => {
      onStatus?.('Song received ✔');
      room.sendXfer({ kind: 'received' });
      const all = new Uint8Array(meta.size);
      let off = 0;
      for (const p of parts) { all.set(p, off); off += p.length; }
      setTimeout(() => pc?.close(), 1000);
      resolve({ meta, arrayBuffer: all.buffer });
    };

    room.onXfer = async (p) => {
      try {
        if (p.kind === 'meta') {
          meta = p;
          onStatus?.('Receiving song… 0%');
          room.sendXfer({ kind: 'meta-ack' });
        } else if (p.kind === 'rtc-offer') {
          pc = new RTCPeerConnection(RTC_CONFIG);
          pc.onicecandidate = (e) => {
            if (e.candidate) room.sendXfer({ kind: 'ice', from: 'joiner', candidate: e.candidate.toJSON() });
          };
          pc.ondatachannel = (e) => {
            const dc = e.channel;
            dc.binaryType = 'arraybuffer';
            dc.onmessage = (m) => {
              const chunk = new Uint8Array(m.data);
              parts.push(chunk);
              received += chunk.length;
              onStatus?.(`Receiving song… ${Math.round((received / meta.size) * 100)}% (direct)`);
              if (received >= meta.size) finish();
            };
          };
          await pc.setRemoteDescription(p.desc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          room.sendXfer({ kind: 'rtc-answer', desc: pc.localDescription.toJSON() });
        } else if (p.kind === 'ice' && p.from === 'host') {
          pc?.addIceCandidate(p.candidate).catch(() => {});
        } else if (p.kind === 'use-relay') {
          // host gave up on WebRTC; discard any partial RTC data
          parts = [];
          received = 0;
          relayParts = new Array(0);
        } else if (p.kind === 'chunk') {
          relayParts ??= [];
          relayParts[p.i] = b64decode(p.data);
          const got = relayParts.filter(Boolean).length;
          onStatus?.(`Receiving song… ${Math.round((got / p.n) * 100)}% (relay)`);
          if (got === p.n) {
            parts = relayParts;
            received = meta.size;
            finish();
          }
        }
      } catch (e) {
        reject(e);
      }
    };
  });
}
