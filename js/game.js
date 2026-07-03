// Gameplay loop: countdown, scrolling move cards, per-cue scoring, HUD.
import { drawStage } from './pose.js';
import { scorePose, grade, drawMovePictogram } from './scoring.js';
import { buildBeatMap } from './choreography.js';
import { sfxPerfect, sfxGood, sfxOk, sfxMiss, sfxJackpot, sfxCountdown } from './sfx.js';

const CARD_SPEED = 180;      // px per second toward the hit zone
const WINDOW_BEFORE = 0.5;   // seconds before cue time that scoring opens
const WINDOW_AFTER = 0.3;    // seconds after cue time that scoring closes
const LOOKAHEAD = 6;         // seconds of upcoming cards to render

export class Game {
  constructor({ tracker, player, ui, phone = null, phoneOnly = false }) {
    this.tracker = tracker;   // PoseTracker (null in phone-only mode)
    this.player = player;     // MusicPlayer
    this.ui = ui;             // dom refs
    this.phone = phone;       // PhoneLink (optional motion sensor)
    this.phoneOnly = phoneOnly;
    this.onScore = null;      // cb(score, combo) for multiplayer broadcast
    this.onFinish = null;     // cb(summary)
    this.running = false;
  }

  // startDelaySec > 0 schedules a synchronized multiplayer start.
  async start(song, startDelaySec = 3) {
    this.song = song;
    this.cues = buildBeatMap(song).map((c) => ({
      ...c,
      move: c.moveId ?? { angles: c.angles }, // built-in id or raw extracted angles
      best: 0,
      graded: false,
      el: null,
    }));
    this.score = 0;
    this.combo = 0;
    this.counts = { PERFECT: 0, '¡BIEN!': 0, OK: 0, MISS: 0 };
    this.running = true;
    this._lastCount = null;
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

    let landmarks = null;
    if (this.tracker) {
      landmarks = this.tracker.detect();
      drawStage(canvas, this.tracker.video, landmarks);
    } else {
      this._drawPhoneStage(canvas, t);
    }

    // countdown + calibration hint
    if (t < 0) {
      const n = Math.ceil(-t);
      if (n !== this._lastCount) {
        this._lastCount = n;
        sfxCountdown(false);
      }
      this.ui.countdown.textContent = n;
    } else if (t < 1 && this.ui.countdown.textContent) {
      this.ui.countdown.textContent = '¡VAMOS!';
      sfxCountdown(true);
      setTimeout(() => (this.ui.countdown.textContent = ''), 700);
    }
    this.ui.calibrationHint.classList.toggle('show', !!this.tracker && t < 2 && !this.tracker.fullBodyVisible());

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
        drawMovePictogram(c, cue.move);
        el.appendChild(c);
        this.ui.moveTrack.appendChild(el);
        cue.el = el;
      }
      cue.el.style.transform = `translateX(${hitX - 55 + dt * CARD_SPEED}px)`;
      // highlight the active card
      const active = dt < WINDOW_BEFORE && dt > -WINDOW_AFTER;
      cue.el.style.borderColor = active ? '#ffd166' : '';
      if (active) drawMovePictogram(this.ui.hitPictogram, cue.move, '#ff9f1c');
    }
  }

  _updateScoring(t, landmarks) {
    for (const cue of this.cues) {
      if (cue.graded) continue;
      const dt = t - cue.time;
      if (dt < -WINDOW_BEFORE) break; // cues are sorted; nothing active yet
      if (dt <= WINDOW_AFTER) {
        if (this.phoneOnly) {
          // no camera: score by movement energy peaks from the phone
          const peak = this.phone?.peakEnergy((WINDOW_BEFORE + WINDOW_AFTER) * 1000) ?? 0;
          cue.best = Math.max(cue.best, Math.min(1, peak / 7));
        } else if (landmarks) {
          cue.best = Math.max(cue.best, scorePose(landmarks, cue.move));
        }
      } else {
        cue.graded = true;
        this._applyGrade(cue);
      }
    }
  }

  _applyGrade(cue) {
    let g = grade(cue.best);
    let energyBonus = 1;

    // Boost mode: phone paired alongside the camera — reward real movement
    // energy, and don't let statue-still poses score top grades.
    if (this.phone?.connected() && !this.phoneOnly) {
      const e = this.phone.avgEnergy((WINDOW_BEFORE + WINDOW_AFTER) * 1000);
      if (g.points >= 60 && e < 0.3) {
        g = grade(0.55); // standing still: downgrade to OK
      } else if (g.points >= 60 && e > 4) {
        energyBonus = 1 + Math.min(e / 40, 0.25);
      }
    }

    this.counts[g.label] = (this.counts[g.label] ?? 0) + 1;
    if (g.points > 0) {
      this.combo = g.label === 'OK' ? 0 : this.combo + 1;
      const mult = 1 + Math.min(this.combo, 10) * 0.1;
      this.score += Math.round(g.points * mult * energyBonus);
    } else {
      this.combo = 0;
    }

    // feedback sounds — pitch climbs with the combo, milestones pay out like a slot machine
    if (g.cls === 'perfect') sfxPerfect(this.combo);
    else if (g.cls === 'good') sfxGood(this.combo);
    else if (g.cls === 'ok') sfxOk();
    else sfxMiss();
    if (this.combo > 0 && this.combo % 5 === 0) sfxJackpot(this.combo);
    // feedback flash (⚡ marks an energy bonus from the phone)
    const fb = this.ui.feedback;
    fb.textContent = energyBonus > 1.1 ? `${g.label} ⚡` : g.label;
    fb.className = `feedback show ${g.cls}`;
    clearTimeout(this._fbTimer);
    this._fbTimer = setTimeout(() => fb.classList.remove('show'), 450);

    this.ui.meScore.textContent = String(this.score);
    this.ui.meCombo.textContent = this.combo >= 2 ? `🔥 x${this.combo}` : '';
    this.onScore?.(this.score, this.combo);
  }

  // Phone-only mode stage: big target pictogram + live energy meter instead of video.
  _drawPhoneStage(canvas, t) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const grad = ctx.createRadialGradient(W / 2, H * 0.35, 60, W / 2, H * 0.4, H);
    grad.addColorStop(0, '#3d1560');
    grad.addColorStop(1, '#12081f');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // target move, big in the center
    const next = this.cues.find((c) => !c.graded && c.time - t > -WINDOW_AFTER);
    if (next) {
      if (!this._bigPicto) {
        this._bigPicto = document.createElement('canvas');
        this._bigPicto.width = this._bigPicto.height = 420;
      }
      drawMovePictogram(this._bigPicto, next.move, '#ffd166');
      const size = Math.min(W, H) * 0.45;
      ctx.globalAlpha = 0.95;
      ctx.drawImage(this._bigPicto, (W - size) / 2, H * 0.16, size, size);
      ctx.globalAlpha = 1;
    }

    // live energy meter
    const e = this.phone?.avgEnergy(300) ?? 0;
    const pct = Math.min(1, e / 10);
    const bw = W * 0.4, bh = 18;
    const bx = (W - bw) / 2, by = H - 190;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = pct > 0.6 ? '#ff4d2e' : pct > 0.25 ? '#ffd166' : '#2ec4b6';
    ctx.fillRect(bx, by, bw * pct, bh);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('📱 MOVE! Energy', W / 2, by - 8);
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
    });
  }
}
