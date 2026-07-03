// Song catalog + beat maps.
// Each song gets a choreography: one move cue every 2 beats, cycling through
// a hand-authored sequence, starting after an 8-beat intro.

import { MOVE_IDS } from './scoring.js';

export const SONGS = [
  { id: 'salsa-1', title: 'Fuego de la Noche', bpm: 104, duration: 92, file: 'assets/music/salsa-1.mp3' },
  { id: 'salsa-2', title: 'Ritmo Caliente', bpm: 112, duration: 92, file: 'assets/music/salsa-2.mp3' },
  { id: 'salsa-3', title: 'Luna de Havana', bpm: 96, duration: 92, file: 'assets/music/salsa-3.mp3' },
];

// A dance-like sequence: alternating sides, building energy.
const SEQUENCE = [
  'sideStepLeft', 'sideStepRight', 'sideStepLeft', 'sideStepRight',
  'armsUp', 'hipsShake', 'clapHigh', 'hipsShake',
  'pointHighRight', 'pointHighLeft', 'pointHighRight', 'armsUp',
  'kneeLiftLeft', 'kneeLiftRight', 'kneeLiftLeft', 'clapHigh',
  'tPose', 'armsUp', 'sideStepLeft', 'sideStepRight',
  'hipsShake', 'clapHigh', 'pointHighLeft', 'armsUp',
];

// User-provided song (custom MP3 with detected beat). Not in SONGS — it is
// registered at runtime after analysis or after receiving it from the host.
let customSong = null;
export function setCustomSong(song) { customSong = song; }
export function getCustomSong() { return customSong; }

export function getSong(id) {
  if (id === 'custom' && customSong) return customSong;
  return SONGS.find((s) => s.id === id) ?? SONGS[0];
}

// Returns [{ time, moveId }] or [{ time, angles }] — cue times in seconds into the song.
export function buildBeatMap(song) {
  // choreography extracted from a dance video: use its real cues as-is
  if (song.cues?.length) return song.cues.map((c) => ({ ...c }));
  const beat = 60 / song.bpm;
  const cues = [];
  let i = 0;
  const start = (song.offset ?? 0) + 8 * beat;
  for (let t = start; t < song.duration - 4; t += 2 * beat) {
    cues.push({ time: t, moveId: SEQUENCE[i % SEQUENCE.length] });
    i++;
  }
  return cues;
}

// Sanity check: every move in the sequence exists.
for (const m of SEQUENCE) {
  if (!MOVE_IDS.includes(m)) console.error(`[choreography] unknown move: ${m}`);
}
