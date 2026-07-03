// Move library + pose scoring.
// Each move is a set of target limb-segment angles (degrees, image coords: 0 = right, 90 = down, -90 = up).
// The same angle data drives both scoring and the stick-figure pictograms, so what
// the card shows is exactly what gets scored.

// MediaPipe pose landmark indices for each limb segment [proximal, distal].
export const SEGMENTS = {
  lua: [11, 13], // left upper arm  (shoulder -> elbow)
  lfa: [13, 15], // left forearm    (elbow -> wrist)
  rua: [12, 14], // right upper arm
  rfa: [14, 16], // right forearm
  lth: [23, 25], // left thigh      (hip -> knee)
  lsh: [25, 27], // left shin       (knee -> ankle)
  rth: [24, 26], // right thigh
  rsh: [26, 28], // right shin
};

const STAND = { lth: 95, lsh: 92, rth: 85, rsh: 88 };
const LEG_W = 0.5; // default leg weight (arms matter most unless the move is leg-focused)

export const MOVES = {
  armsUp: {
    name: '¡Arriba!',
    angles: { lua: -120, lfa: -110, rua: -60, rfa: -70, ...STAND },
  },
  tPose: {
    name: 'Alas',
    angles: { lua: 180, lfa: 180, rua: 0, rfa: 0, ...STAND },
  },
  clapHigh: {
    name: '¡Palmas!',
    angles: { lua: -70, lfa: -85, rua: -110, rfa: -95, ...STAND },
  },
  pointHighRight: {
    name: 'Fiebre →',
    angles: { rua: -45, rfa: -45, lua: 135, lfa: 135, ...STAND },
  },
  pointHighLeft: {
    name: '← Fiebre',
    angles: { lua: -135, lfa: -135, rua: 45, rfa: 45, ...STAND },
  },
  kneeLiftLeft: {
    name: 'Rodilla ↑',
    angles: { lua: -140, lfa: -95, rua: -40, rfa: -85, lth: 180, lsh: 90, rth: 85, rsh: 88 },
    weights: { lth: 1.6, lsh: 1.2 },
  },
  kneeLiftRight: {
    name: '↑ Rodilla',
    angles: { lua: -140, lfa: -95, rua: -40, rfa: -85, rth: 0, rsh: 90, lth: 95, lsh: 92 },
    weights: { rth: 1.6, rsh: 1.2 },
  },
  sideStepLeft: {
    name: 'Paso ←',
    angles: { lua: -15, lfa: -25, rua: -15, rfa: -25, lth: 130, lsh: 110, rth: 85, rsh: 88 },
    weights: { lth: 1.3 },
  },
  sideStepRight: {
    name: 'Paso →',
    angles: { lua: -165, lfa: -155, rua: -165, rfa: -155, rth: 50, rsh: 70, lth: 95, lsh: 92 },
    weights: { rth: 1.3 },
  },
  hipsShake: {
    name: '¡Cadera!',
    angles: { lua: 130, lfa: -60, rua: 50, rfa: -120, lth: 105, lsh: 95, rth: 75, rsh: 85 },
  },
};

export const MOVE_IDS = Object.keys(MOVES);

const deg = (r) => (r * 180) / Math.PI;

// Signed shortest angular distance, 0..180
function angDist(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

// Extract segment angles from MediaPipe landmarks (normalized coords, y down).
// Returns null for segments whose landmarks aren't visible enough.
export function extractAngles(landmarks) {
  const out = {};
  for (const [seg, [a, b]] of Object.entries(SEGMENTS)) {
    const p = landmarks[a], q = landmarks[b];
    if (!p || !q) { out[seg] = null; continue; }
    const visP = p.visibility ?? 1, visQ = q.visibility ?? 1;
    if (visP < 0.4 || visQ < 0.4) { out[seg] = null; continue; }
    out[seg] = deg(Math.atan2(q.y - p.y, q.x - p.x));
  }
  return out;
}

// Mirror a target pose left<->right (angles reflect across the vertical axis).
function mirrorAngles(angles) {
  const swap = { lua: 'rua', rua: 'lua', lfa: 'rfa', rfa: 'lfa', lth: 'rth', rth: 'lth', lsh: 'rsh', rsh: 'lsh' };
  const m = {};
  for (const [seg, a] of Object.entries(angles)) {
    let r = 180 - a;
    if (r > 180) r -= 360;
    m[swap[seg]] = r;
  }
  return m;
}

function scoreAgainst(playerAngles, targetAngles, weights) {
  let total = 0, wsum = 0;
  for (const [seg, target] of Object.entries(targetAngles)) {
    const actual = playerAngles[seg];
    if (actual === null || actual === undefined) continue;
    const isLeg = seg[1] === 't' || seg[1] === 's';
    const w = weights?.[seg] ?? (isLeg ? LEG_W : 1.0);
    const d = angDist(actual, target);
    total += w * Math.max(0, 1 - d / 90);
    wsum += w;
  }
  return wsum > 0 ? total / wsum : 0;
}

// A "move" is either a built-in move id (string) or a raw descriptor
// { angles, weights?, name? } — e.g. extracted from a dance video.
export function resolveMove(m) {
  return typeof m === 'string' ? MOVES[m] : m;
}

// Similarity 0..1 between the player's pose and a move.
// The mirrored version also counts (the webcam view is mirrored, so be forgiving).
export function scorePose(landmarks, moveOrId) {
  const move = resolveMove(moveOrId);
  const player = extractAngles(landmarks);
  const s1 = scoreAgainst(player, move.angles, move.weights);
  const s2 = scoreAgainst(player, mirrorAngles(move.angles), move.weights);
  return Math.max(s1, s2);
}

export function grade(similarity) {
  if (similarity >= 0.82) return { label: 'PERFECT', cls: 'perfect', points: 100 };
  if (similarity >= 0.68) return { label: '¡BIEN!', cls: 'good', points: 60 };
  if (similarity >= 0.52) return { label: 'OK', cls: 'ok', points: 30 };
  return { label: 'MISS', cls: 'miss', points: 0 };
}

// ===== Pictogram rendering (stick figure from the same angle data) =====
const LIMB_LEN = { ua: 0.20, fa: 0.18, th: 0.24, sh: 0.24 };

export function drawMovePictogram(canvas, moveOrId, color = '#ffd166') {
  const move = resolveMove(moveOrId);
  if (!move?.angles) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const S = Math.min(W, H);
  const cx = W / 2, cy = H * 0.42;
  const P = (x, y) => [cx + x * S, cy + y * S];

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = Math.max(3, S * 0.05);
  ctx.lineCap = 'round';

  const rad = (d) => (d * Math.PI) / 180;
  const lsho = [-0.14, -0.18], rsho = [0.14, -0.18];
  const lhip = [-0.09, 0.12], rhip = [0.09, 0.12];

  // head + torso
  ctx.beginPath();
  ctx.arc(...P(0, -0.32), S * 0.085, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(...P(...lsho)); ctx.lineTo(...P(...rsho));
  ctx.lineTo(...P(...rhip)); ctx.lineTo(...P(...lhip));
  ctx.closePath();
  ctx.stroke();

  const limb = (origin, segA, segB, lenA, lenB) => {
    const a = move.angles[segA], b = move.angles[segB];
    if (a === undefined) return;
    const mid = [origin[0] + Math.cos(rad(a)) * lenA, origin[1] + Math.sin(rad(a)) * lenA];
    ctx.beginPath();
    ctx.moveTo(...P(...origin));
    ctx.lineTo(...P(...mid));
    if (b !== undefined) {
      const end = [mid[0] + Math.cos(rad(b)) * lenB, mid[1] + Math.sin(rad(b)) * lenB];
      ctx.lineTo(...P(...end));
    }
    ctx.stroke();
  };

  limb(lsho, 'lua', 'lfa', LIMB_LEN.ua, LIMB_LEN.fa);
  limb(rsho, 'rua', 'rfa', LIMB_LEN.ua, LIMB_LEN.fa);
  limb(lhip, 'lth', 'lsh', LIMB_LEN.th, LIMB_LEN.sh);
  limb(rhip, 'rth', 'rsh', LIMB_LEN.th, LIMB_LEN.sh);
}
