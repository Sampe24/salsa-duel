// Screen flow: menu -> character select -> (lobby) -> game -> results.
import { PoseTracker } from './pose.js';
import { MusicPlayer } from './audio.js';
import { Game } from './game.js';
import { SONGS, getSong } from './choreography.js';
import { Room, makeRoomCode } from './multiplayer.js';

const $ = (id) => document.getElementById(id);
const CHAR_IMG = {
  yossi: 'assets/characters/yossi.png',
  samuel: 'assets/characters/samuel.png',
};
const CHAR_NAME = { yossi: 'Yossi', samuel: 'Samuel' };

const state = {
  mode: 'solo',        // solo | host | join
  joinCode: '',
  character: null,
  songId: SONGS[0].id,
  room: null,
  tracker: null,
  player: null,
  game: null,
  peerFinish: null,
  mySummary: null,
};

// ===== screen switching =====
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}
function loading(text) {
  $('loading-text').textContent = text;
  $('loading-overlay').hidden = !text;
}
function menuError(msg) { $('menu-error').textContent = msg; }

// ===== menu =====
$('btn-solo').onclick = () => { state.mode = 'solo'; openCharacterScreen(); };
$('btn-create').onclick = () => { state.mode = 'host'; openCharacterScreen(); };
$('btn-join').onclick = () => {
  const code = $('input-room-code').value.trim().toUpperCase();
  if (code.length !== 4) return menuError('Enter the 4-letter room code');
  menuError('');
  state.mode = 'join';
  state.joinCode = code;
  openCharacterScreen();
};

document.querySelectorAll('.back-btn').forEach((b) => {
  b.onclick = () => {
    state.room?.leave();
    state.room = null;
    state.game?.stop();
    state.tracker?.stop();
    state.tracker = null;
    show(b.dataset.back);
  };
});

// ===== character + song select =====
function openCharacterScreen() {
  // joiner doesn't pick the song (host does)
  $('song-row').parentElement.querySelectorAll('.small-heading').forEach((h) => {
    h.style.display = state.mode === 'join' ? 'none' : '';
  });
  $('song-row').style.display = state.mode === 'join' ? 'none' : '';
  show('screen-character');
  updateContinue();
}

document.querySelectorAll('.char-card').forEach((card) => {
  card.onclick = () => {
    document.querySelectorAll('.char-card').forEach((c) => c.classList.remove('selected'));
    card.classList.add('selected');
    state.character = card.dataset.char;
    updateContinue();
  };
});

for (const song of SONGS) {
  const chip = document.createElement('button');
  chip.className = 'song-chip' + (song.id === state.songId ? ' selected' : '');
  chip.textContent = `🎵 ${song.title} (${song.bpm} BPM)`;
  chip.onclick = () => {
    document.querySelectorAll('.song-chip').forEach((c) => c.classList.remove('selected'));
    chip.classList.add('selected');
    state.songId = song.id;
  };
  $('song-row').appendChild(chip);
}

function updateContinue() { $('btn-char-continue').disabled = !state.character; }

$('btn-char-continue').onclick = async () => {
  try {
    if (state.mode === 'solo') {
      await prepareStage();
      startGame(getSong(state.songId), 3);
    } else {
      await enterLobby();
    }
  } catch (e) {
    loading(null);
    show('screen-menu');
    menuError(e.message);
  }
};

// ===== lobby =====
async function enterLobby() {
  loading('Connecting to room…');
  state.room = new Room();
  const code = state.mode === 'host' ? makeRoomCode() : state.joinCode;

  const room = state.room;
  room.onPeerJoin = (peer) => renderLobby(peer);
  room.onPeerLeave = () => renderLobby(null);
  room.onPeerReady = () => { renderLobby(room.peer); maybeStart(); };
  room.onStart = async ({ songId, startAtEpochMs }) => {
    await prepareStage();
    const delay = Math.max(0.5, (startAtEpochMs - Date.now()) / 1000);
    startGame(getSong(songId), delay);
  };

  await room.join(code, { character: state.character, isHost: state.mode === 'host' });
  loading(null);

  $('lobby-code').textContent = code;
  $('lobby-song').textContent = state.mode === 'host'
    ? `Song: ${getSong(state.songId).title}`
    : 'The host picks the song';
  $('lobby-me').querySelector('img').src = CHAR_IMG[state.character];
  $('lobby-me').querySelector('.slot-name').textContent = `You (${CHAR_NAME[state.character]})`;
  $('lobby-me').querySelector('.slot-status').textContent = '';
  $('btn-ready').disabled = false;
  renderLobby(room.peer);
  show('screen-lobby');
}

function renderLobby(peer) {
  const slot = $('lobby-them');
  if (peer) {
    slot.querySelector('img').src = CHAR_IMG[peer.character] ?? '';
    slot.querySelector('.slot-name').textContent = CHAR_NAME[peer.character] ?? 'Rival';
    slot.querySelector('.slot-status').textContent = state.room.peerReady ? '✔ Ready!' : 'Not ready';
  } else {
    slot.querySelector('img').src = '';
    slot.querySelector('.slot-name').textContent = 'Waiting…';
    slot.querySelector('.slot-status').textContent = '';
  }
}

$('btn-ready').onclick = () => {
  state.room.sendReady();
  $('lobby-me').querySelector('.slot-status').textContent = '✔ Ready!';
  $('btn-ready').disabled = true;
  maybeStart();
};

// Host starts the match once both are ready.
function maybeStart() {
  const room = state.room;
  if (!room || !room.isHost || !room.bothReady()) return;
  const { songId, startAtEpochMs } = room.sendStart(state.songId);
  room.onStart({ songId, startAtEpochMs }); // broadcast self:false, so trigger locally
}

// ===== game =====
async function prepareStage() {
  show('screen-game');
  if (!state.tracker) {
    loading('Starting camera & body tracking…');
    state.tracker = new PoseTracker($('webcam'));
    await state.tracker.init();
  }
  loading(null);
}

function startGame(song, delaySec) {
  state.peerFinish = null;
  state.mySummary = null;

  // (re)load correct song if multiplayer host picked a different one
  const ui = {
    canvas: $('stage-canvas'),
    moveTrack: $('move-track'),
    hitPictogram: $('hit-pictogram'),
    feedback: $('feedback'),
    countdown: $('countdown'),
    calibrationHint: $('calibration-hint'),
    meScore: $('hud-me-score'),
    meCombo: $('hud-me-combo'),
    songName: $('hud-song-name'),
  };

  $('hud-me-img').src = CHAR_IMG[state.character];
  $('hud-me-name').textContent = CHAR_NAME[state.character];

  const room = state.room;
  const themBox = $('hud-them');
  if (room?.peer) {
    themBox.hidden = false;
    $('hud-them-img').src = CHAR_IMG[room.peer.character] ?? '';
    $('hud-them-name').textContent = CHAR_NAME[room.peer.character] ?? 'Rival';
    $('hud-them-score').textContent = '0';
    room.onScore = ({ score }) => { $('hud-them-score').textContent = String(score); };
    room.onFinish = (payload) => {
      state.peerFinish = payload;
      if (state.mySummary) showResults();
    };
  } else {
    themBox.hidden = true;
  }

  state.game = new Game({ tracker: state.tracker, player: state.player, ui });
  state.game.onScore = (score, combo) => room?.sendScore(score, combo);
  state.game.onFinish = (summary) => {
    state.mySummary = summary;
    if (room?.peer) {
      room.sendFinish(summary);
      // give the peer up to 5s to finish, then show results anyway
      setTimeout(() => { if (!document.querySelector('#screen-results.active')) showResults(); }, 5000);
      if (state.peerFinish) showResults();
    } else {
      showResults();
    }
  };

  show('screen-game');

  (async () => {
    state.player = new MusicPlayer();
    await state.player.load(song);
    state.game.player = state.player;
    state.game.start(song, delaySec);
  })();
}

// ===== results =====
function showResults() {
  if (document.querySelector('#screen-results.active')) return;
  const s = state.mySummary;
  const room = state.room;
  const row = $('results-row');
  row.innerHTML = '';

  const card = (name, img, score, winner) => {
    const d = document.createElement('div');
    d.className = 'result-card' + (winner ? ' winner' : '');
    d.innerHTML = `<div class="r-crown">${winner ? '👑' : ''}</div>
      <img src="${img}" alt=""><div class="r-name">${name}</div>
      <div class="r-score">${score}</div>`;
    return d;
  };

  if (room?.peer && state.peerFinish) {
    const meWins = s.score >= state.peerFinish.score;
    row.appendChild(card(CHAR_NAME[state.character], CHAR_IMG[state.character], s.score, meWins));
    row.appendChild(card(CHAR_NAME[room.peer.character] ?? 'Rival', CHAR_IMG[room.peer.character] ?? '', state.peerFinish.score, !meWins));
    $('results-title').textContent = meWins ? '¡Ganaste! You win! 🎉' : 'You lose… rematch? 💃';
  } else {
    row.appendChild(card(CHAR_NAME[state.character], CHAR_IMG[state.character], s.score, true));
    $('results-title').textContent = '¡Olé! Great dancing!';
  }

  $('results-stats').innerHTML =
    `Perfect: <b>${s.counts.PERFECT ?? 0}</b> · Bien: <b>${s.counts['¡BIEN!'] ?? 0}</b> · ` +
    `OK: <b>${s.counts.OK ?? 0}</b> · Miss: <b>${s.counts.MISS ?? 0}</b><br>` +
    `Accuracy: <b>${s.accuracy}%</b> of ${s.total} moves`;

  show('screen-results');
}

$('btn-again').onclick = () => {
  state.room?.leave();
  state.room = null;
  openCharacterScreen();
};
