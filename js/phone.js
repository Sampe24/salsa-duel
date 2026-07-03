// Phone controller page: reads the accelerometer (DeviceMotion) and streams a
// smoothed movement-energy value to the game over the Supabase room channel.
// Debug mode (?debug=1) streams a synthetic energy wave instead — used for testing
// the desktop side without a physical phone.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const code = (location.hash.slice(1) || '').toUpperCase();
const debug = new URLSearchParams(location.search).has('debug');
$('code').textContent = code || '????';

if (!code) {
  $('status').textContent = 'No code — scan the QR from the game.';
  throw new Error('no pairing code');
}

const client = createClient(SUPABASE_URL, SUPABASE_KEY);
const channel = client.channel(`salsa-phone:${code}`);

let energy = 0;      // smoothed acceleration magnitude (m/s², gravity removed)
let lastRaw = 0;

channel.subscribe((status) => {
  if (status === 'SUBSCRIBED') {
    $('status').textContent = debug ? 'Debug mode — streaming fake motion' : 'Connected! Enable motion below 👇';
    channel.send({ type: 'broadcast', event: 'motion', payload: { kind: 'hello' } });
    if (debug) startDebug();
    else $('btn-enable').hidden = false;
  } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
    $('status').textContent = 'Connection failed — reload the page.';
  }
});

$('btn-enable').onclick = async () => {
  try {
    // iOS 13+ requires an explicit permission request from a user gesture
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      const perm = await DeviceMotionEvent.requestPermission();
      if (perm !== 'granted') throw new Error('Motion permission denied');
    }
    window.addEventListener('devicemotion', onMotion);
    startStreaming();
  } catch (e) {
    $('status').textContent = e.message;
  }
};

function onMotion(e) {
  const a = e.acceleration; // gravity already removed on most devices
  if (!a || a.x === null) {
    // fallback: accelerationIncludingGravity minus ~9.81 magnitude
    const g = e.accelerationIncludingGravity;
    if (!g) return;
    lastRaw = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
  } else {
    lastRaw = Math.hypot(a.x, a.y, a.z);
  }
}

function startStreaming() {
  $('btn-enable').hidden = true;
  $('pulse').style.display = 'flex';
  $('meter').style.display = 'block';
  $('status').textContent = '¡Listo! Dance with the phone in your hand 💃';
  setInterval(() => {
    energy = energy * 0.6 + lastRaw * 0.4; // smooth
    channel.send({ type: 'broadcast', event: 'motion', payload: { kind: 'e', e: Math.round(energy * 10) / 10 } });
    const pct = Math.min(100, (energy / 12) * 100);
    $('meter-fill').style.width = pct + '%';
    $('pulse').style.transform = `scale(${1 + Math.min(energy / 12, 0.5)})`;
  }, 90); // ~11 Hz
}

function startDebug() {
  $('pulse').style.display = 'flex';
  $('meter').style.display = 'block';
  let t = 0;
  setInterval(() => {
    t += 0.09;
    // energetic bursts: ~1s of strong motion, ~1s calm, repeating
    const e = (Math.sin(t * Math.PI) > 0 ? 6 + 3 * Math.random() : 0.2);
    channel.send({ type: 'broadcast', event: 'motion', payload: { kind: 'e', e } });
    $('meter-fill').style.width = Math.min(100, (e / 12) * 100) + '%';
  }, 90);
}
