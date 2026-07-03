// Generate salsa/latino tracks with Google's Lyria RealTime (Gemini API) and
// save them as MP3s in assets/music/. Local-only tool — reads GEMINI_API_KEY
// from ../.env. Usage: node tools/generate_music.mjs
import { GoogleGenAI } from '@google/genai';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'assets', 'music');

const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const apiKey = env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim();
if (!apiKey) throw new Error('GEMINI_API_KEY not found in .env');

const SAMPLE_RATE = 48000; // Lyria outputs 16-bit stereo PCM @48kHz
const CHANNELS = 2;

// Must match js/choreography.js (id, bpm, duration).
const TRACKS = [
  {
    id: 'salsa-1', bpm: 104, seconds: 92,
    prompts: [
      { text: 'upbeat cuban salsa, congas, timbales, brass section stabs, piano montuno, energetic party', weight: 1.0 },
      { text: 'latin percussion groove', weight: 0.6 },
    ],
  },
  {
    id: 'salsa-2', bpm: 112, seconds: 92,
    prompts: [
      { text: 'fast salsa dura, driving bongos and cowbell, trumpet melody, call and response horns, fiery latin dance', weight: 1.0 },
      { text: 'salsa piano montuno', weight: 0.5 },
    ],
  },
  {
    id: 'salsa-3', bpm: 96, seconds: 92,
    prompts: [
      { text: 'smooth latin groove, romantic havana night, warm bass tumbao, soft brass, claves and guiro', weight: 1.0 },
      { text: 'cuban son montuno guitar', weight: 0.5 },
    ],
  },
];

function wavHeader(dataLen) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + dataLen, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20);
  h.writeUInt16LE(CHANNELS, 22); h.writeUInt32LE(SAMPLE_RATE, 24);
  h.writeUInt32LE(SAMPLE_RATE * CHANNELS * 2, 28); h.writeUInt16LE(CHANNELS * 2, 32);
  h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(dataLen, 40);
  return h;
}

async function generateTrack(ai, track) {
  console.log(`\n=== ${track.id} (${track.bpm} BPM, ${track.seconds}s) ===`);
  const chunks = [];
  let bytesNeeded = track.seconds * SAMPLE_RATE * CHANNELS * 2;
  let bytesGot = 0;
  let resolveDone, rejectDone;
  const done = new Promise((res, rej) => { resolveDone = res; rejectDone = rej; });

  const session = await ai.live.music.connect({
    model: 'models/lyria-realtime-exp',
    callbacks: {
      onmessage: (msg) => {
        const audio = msg.serverContent?.audioChunks;
        if (!audio) return;
        for (const c of audio) {
          const buf = Buffer.from(c.data, 'base64');
          chunks.push(buf);
          bytesGot += buf.length;
        }
        process.stdout.write(`\r  ${Math.min(100, Math.round((bytesGot / bytesNeeded) * 100))}%`);
        if (bytesGot >= bytesNeeded) resolveDone();
      },
      onerror: (e) => rejectDone(new Error('Lyria stream error: ' + (e.message ?? e))),
      onclose: () => resolveDone(),
    },
  });

  await session.setWeightedPrompts({ weightedPrompts: track.prompts });
  await session.setMusicGenerationConfig({
    musicGenerationConfig: { bpm: track.bpm, temperature: 1.1, guidance: 4.0 },
  });
  await session.play();

  const timeout = setTimeout(() => rejectDone(new Error('timed out waiting for audio')), (track.seconds + 90) * 1000);
  try {
    await done;
  } finally {
    clearTimeout(timeout);
    try { session.stop(); session.close(); } catch { /* already closed */ }
  }

  let pcm = Buffer.concat(chunks);
  if (pcm.length < bytesNeeded * 0.5) throw new Error(`only received ${pcm.length} bytes`);
  pcm = pcm.subarray(0, bytesNeeded);

  const wavPath = path.join(OUT, `${track.id}.wav`);
  fs.writeFileSync(wavPath, Buffer.concat([wavHeader(pcm.length), pcm]));

  const mp3Path = path.join(OUT, `${track.id}.mp3`);
  execFileSync('ffmpeg', ['-y', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '160k',
    '-af', 'afade=t=in:d=1,afade=t=out:st=' + (track.seconds - 2) + ':d=2', mp3Path]);
  fs.unlinkSync(wavPath);
  console.log(`\n  saved ${mp3Path} (${(fs.statSync(mp3Path).size / 1e6).toFixed(1)} MB)`);
}

const ai = new GoogleGenAI({ apiKey, apiVersion: 'v1alpha' });
fs.mkdirSync(OUT, { recursive: true });
for (const track of TRACKS) {
  await generateTrack(ai, track);
}
console.log('\nAll tracks generated ✔');
