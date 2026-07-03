// Gameplay loop: countdown, scrolling move cards, per-cue scoring, HUD.
import { drawStage } from './pose.js';
import { scorePose, grade, drawMovePictogram, MOVES } from './scoring.js';
import { buildBeatMap } from './choreography.js';

const CARD_SPEED = 180;      // px per second toward the hit zone
const WINDOW_BEFORE = 0.5;   // seconds before cue time that scoring opens
const WINDOW_AFTER = 0.3;    // seconds after cue time that scoring closes
const LOOKAHEAD = 6;         // seconds of upcoming cards to render

export class Game {
  constructor({ tracker, player, ui }) {
    this.tracker = tracker;   // PoseTracker
    this.player = player;     // MusicPlayer
    this.ui = ui;             // dom refs
    this.onScore = null;      // cb(score, combo) for multiplayer broadcast
    this.onFinish = null;     // cb(summary)
    this.running = false;
  }

  // startDelaySec > 0 schedules a synchronized multiplayer start.
  async start(song, startDelaySec = 3) {
    this.song = song;
    this.cues = buildBeatMap(song).map((c) => ({ ...c, best: 0, graded: false, el: null }));
    this.score = 0;
    this.combo = 0;
    this.counts = { PERFECT: 0, '¡BIEN!': 0, OK: 0, MISS: 0 };
    this.running = true;
    this.ui.moveTrack.innerHTML = '';
    this.ui.meScore.textContent = '0';
    this.ui.meCombo.textContent = '';
    this.ui.songName.textContent = `🎵 ${song.title}`;

    this.player.start(startDelaySec);
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  stop() {
    this.running = false;
    this.player.stop();
  }

  _loop() {
    if (!this.running) return;
    const t = this.player.time(); // seconds into song (negative during countdown)

    // resize canvas to viewport
    const canvas = this.ui.canvas;
    if (canvas.width !== canvas.clientWidth || canvas.height !== canvas.clientHeight) {
      canvas.width = canvas.clientWidth;
      canvas.height = canvas.clientHeight;
    }

    const landmarks = this.tracker.detect();
    drawStage(canvas, this.tracker.video, landmarks);

    // countdown + calibration hint
    if (t < 0) {
      this.ui.countdown.textContent = Math.ceil(-t);
    } else if (t < 1 && this.ui.countdown.textContent) {
      this.ui.countdown.textContent = '¡VAMOS!';
      setTimeout(() => (this.ui.countdown.textContent = ''), 700);
    }
    this.ui.calibrationHint.classList.toggle('show', t < 2 && !this.tracker.fullBodyVisible());

    this._updateCards(t);
    this._updateScoring(t, landmarks);

    if (t > this.song.duration) {
      this._finish();
      return;
    }
    requestAnimationFrame(this._loop);
  }

  _updateCards(t) {
    const hitX = 14 + 65; // center of hit zone
    for (const cue of this.cues) {
      const dt = cue.time - t;
      if (dt > LOOKAHEAD || cue.graded) {
        if (cue.graded && cue.el) { cue.el.remove(); cue.el = null; }
        continue;
      }
      if (!cue.el) {
        const el = document.createElement('div');
        el.className = 'move-card';
        const c = document.createElement('canvas');
        c.width = 110; c.height = 110;
        drawMovePictogram(c, cue.moveId);
        el.appendChild(c);
        this.ui.moveTrack.appendChild(el);
        cue.el = el;
      }
      cue.el.style.transform = `translateX(${hitX - 55 + dt * CARD_SPEED}px)`;
      // highlight the active card
      const active = dt < WINDOW_BEFORE && dt > -WINDOW_AFTER;
      cue.el.style.borderColor = active ? '#ffd166' : '';
      if (active) drawMovePictogram(this.ui.hitPictogram, cue.moveId, '#ff9f1c');
    }
  }

  _updateScoring(t, landmarks) {
    for (const cue of this.cues) {
      if (cue.graded) continue;
      const dt = t - cue.time;
      if (dt < -WINDOW_BEFORE) break; // cues are sorted; nothing active yet
      if (dt <= WINDOW_AFTER) {
        if (landmarks) cue.best = Math.max(cue.best, scorePose(landmarks, cue.moveId));
      } else {
        cue.graded = true;
        this._applyGrade(cue);
      }
    }
  }

  _applyGrade(cue) {
    const g = grade(cue.best);
    this.counts[g.label] = (this.counts[g.label] ?? 0) + 1;
    if (g.points > 0) {
      this.combo = g.label === 'OK' ? 0 : this.combo + 1;
      const mult = 1 + Math.min(this.combo, 10) * 0.1;
      this.score += Math.round(g.points * mult);
    } else {
      this.combo = 0;
    }
    // feedback flash
    const fb = this.ui.feedback;
    fb.textContent = g.label;
    fb.className = `feedback show ${g.cls}`;
    clearTimeout(this._fbTimer);
    this._fbTimer = setTimeout(() => fb.classList.remove('show'), 450);

    this.ui.meScore.textContent = String(this.score);
    this.ui.meCombo.textContent = this.combo >= 2 ? `🔥 x${this.combo}` : '';
    this.onScore?.(this.score, this.combo);
  }

  _finish() {
    this.running = false;
    this.player.stop();
    const total = this.cues.length;
    const hits = total - (this.counts.MISS ?? 0);
    this.onFinish?.({
      score: this.score,
      counts: this.counts,
      total,
      accuracy: total ? Math.round((hits / total) * 100) : 0,
      maxMove: MOVES[this.cues[0]?.moveId]?.name,
    });
  }
}
