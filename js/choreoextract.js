// Import choreography from a dance video: MediaPipe watches the dancer in the
// video and samples their joint angles on every 2nd beat — the same rhythm the
// built-in choreographies use. The video's own audio track becomes the song.
// Everything runs locally in the browser; the video file never leaves the machine.
import { createLandmarker } from './pose.js';
import { extractAngles } from './scoring.js';
import { detectBeat } from './beatdetect.js';

const MAX_DURATION = 6 * 60; // seconds

export async function extractChoreography(file, onProgress) {
  onProgress?.('Reading file…');
  const bytes = await file.arrayBuffer();

  // 1) music + beat from the video's audio track
  onProgress?.('Analyzing the beat… 🥁');
  const actx = new (window.AudioContext || window.webkitAudioContext)();
  let audioBuffer;
  try {
    audioBuffer = await actx.decodeAudioData(bytes.slice(0));
  } catch (e) {
    actx.close();
    throw new Error('Could not read audio from this video (' + e.message + ')');
  }
  actx.close();
  const { bpm, offset } = await detectBeat(audioBuffer);
  const beat = 60 / bpm;

  // 2) prepare the video element
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.src = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    video.onloadedmetadata = res;
    video.onerror = () => rej(new Error('Could not open this video file'));
  });
  const duration = Math.min(video.duration, audioBuffer.duration, MAX_DURATION);

  // 3) sample the dancer's pose at each cue time
  onProgress?.('Loading pose model…');
  const landmarker = await createLandmarker();

  const seekTo = (t) => new Promise((res) => {
    video.onseeked = () => res();
    video.currentTime = t;
  });

  const times = [];
  for (let t = offset + 8 * beat; t < duration - 4; t += 2 * beat) times.push(t);
  if (times.length < 8) throw new Error('Video too short for a choreography');

  const cues = [];
  let missed = 0;
  let lastAngles = null;
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    await seekTo(t);
    const result = landmarker.detectForVideo(video, performance.now());
    const lm = result.landmarks?.[0];
    let angles = lm ? extractAngles(lm) : null;
    // require at least the arms to be readable
    const usable = angles && ['lua', 'rua'].every((s) => angles[s] !== null);
    if (usable) {
      // round + fill leg gaps from the previous cue (dancer's legs often crop out)
      for (const k of Object.keys(angles)) {
        angles[k] = angles[k] === null ? (lastAngles?.[k] ?? null) : Math.round(angles[k]);
        if (angles[k] === null) delete angles[k];
      }
      lastAngles = angles;
      cues.push({ time: Math.round(t * 100) / 100, angles });
    } else if (lastAngles) {
      cues.push({ time: Math.round(t * 100) / 100, angles: lastAngles });
      missed++;
    } else {
      missed++;
    }
    onProgress?.(`Extracting moves… ${Math.round(((i + 1) / times.length) * 100)}%`);
  }
  landmarker.close();
  URL.revokeObjectURL(video.src);

  if (cues.length < 8 || missed > times.length * 0.7) {
    throw new Error('Could not find a dancer in this video — try one where the person is clearly visible');
  }

  return {
    id: 'custom',
    title: file.name.replace(/\.[^.]+$/, '') + ' 🎬',
    bpm, offset,
    duration,
    audioBuffer,
    // For multiplayer we transfer compact audio (mono 22 kHz WAV), never the video.
    bytes: encodeWav(audioBuffer, 22050),
    cues,
  };
}

// Downmix + resample an AudioBuffer into a mono 16-bit WAV ArrayBuffer.
function encodeWav(buffer, targetRate) {
  const ratio = buffer.sampleRate / targetRate;
  const n = Math.floor(buffer.length / ratio);
  const chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));

  const out = new DataView(new ArrayBuffer(44 + n * 2));
  const wr = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  wr(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE');
  wr(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true);
  out.setUint16(22, 1, true); out.setUint32(24, targetRate, true);
  out.setUint32(28, targetRate * 2, true); out.setUint16(32, 2, true);
  out.setUint16(34, 16, true); wr(36, 'data'); out.setUint32(40, n * 2, true);

  for (let i = 0; i < n; i++) {
    const src = Math.floor(i * ratio);
    let s = 0;
    for (const ch of chans) s += ch[src];
    s /= chans.length;
    out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 0x7fff, true);
  }
  return out.buffer;
}
