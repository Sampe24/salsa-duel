// Webcam + MediaPipe PoseLandmarker wrapper.
import { FilesetResolver, PoseLandmarker } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';

const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

// Skeleton connections for the overlay (subset of the 33 landmarks).
const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
  [27, 31], [28, 32],
];

export class PoseTracker {
  constructor(videoEl) {
    this.video = videoEl;
    this.landmarker = null;
    this.landmarks = null; // latest result (array of 33 {x,y,z,visibility})
    this.lastVideoTime = -1;
  }

  async init() {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await new Promise((res) => (this.video.onloadedmetadata = res));
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
  }

  // Call once per rendered frame; updates this.landmarks.
  detect() {
    if (!this.landmarker || this.video.readyState < 2) return this.landmarks;
    const t = this.video.currentTime;
    if (t === this.lastVideoTime) return this.landmarks;
    this.lastVideoTime = t;
    const result = this.landmarker.detectForVideo(this.video, performance.now());
    this.landmarks = result.landmarks?.[0] ?? null;
    return this.landmarks;
  }

  // True when the whole body (incl. ankles) is confidently in frame.
  fullBodyVisible() {
    const lm = this.landmarks;
    if (!lm) return false;
    const needed = [11, 12, 23, 24, 27, 28]; // shoulders, hips, ankles
    return needed.every((i) => (lm[i]?.visibility ?? 0) > 0.5);
  }

  stop() {
    this.video.srcObject?.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }
}

// Draw mirrored webcam frame + neon skeleton to the stage canvas.
export function drawStage(canvas, video, landmarks) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.save();
  ctx.translate(W, 0);
  ctx.scale(-1, 1); // mirror

  // cover-fit the video
  const vw = video.videoWidth || 16, vh = video.videoHeight || 9;
  const scale = Math.max(W / vw, H / vh);
  const dw = vw * scale, dh = vh * scale;
  const dx = (W - dw) / 2, dy = (H - dh) / 2;
  if (video.readyState >= 2) ctx.drawImage(video, dx, dy, dw, dh);

  if (landmarks) {
    const px = (l) => [dx + l.x * dw, dy + l.y * dh];
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(46, 196, 182, 0.9)';
    ctx.shadowColor = '#2ec4b6';
    ctx.shadowBlur = 12;
    for (const [a, b] of BONES) {
      const la = landmarks[a], lb = landmarks[b];
      if (!la || !lb || (la.visibility ?? 1) < 0.4 || (lb.visibility ?? 1) < 0.4) continue;
      ctx.beginPath();
      ctx.moveTo(...px(la));
      ctx.lineTo(...px(lb));
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffd166';
    for (const i of [15, 16, 27, 28]) { // hands + feet highlighted
      const l = landmarks[i];
      if (!l || (l.visibility ?? 1) < 0.4) continue;
      ctx.beginPath();
      ctx.arc(...px(l), 10, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
