/**
 * Synthetic MoveNet keypoint sequences for the pose tests (#947). No real people, no recorded video.
 *
 * A squat is described by its hip height above the knee in shin lengths (`h`, 1 standing, 0 parallel), built from
 * eased segments, then turned into 17 keypoints (normalised x, y, score) at a chosen frame rate, with seeded noise,
 * dropped frames and low-score dropouts. Everything is deterministic: the same options give the same frames.
 *
 * Regenerate the frames as JSON for inspection (Node 22.18 or later runs TypeScript directly):
 *   node packages/core/test/pose-fixtures.ts <outDir>
 * The tests call `makeFrames` directly, so no JSON is committed.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Kp {
  x: number;
  y: number;
  score: number;
}
export interface Frame {
  t: number;
  width?: number;
  height?: number;
  keypoints: Kp[];
}

/** One movement piece: lower to `bottom`, hold, rise (durations in ms), then stand for `rest` ms. */
export interface RepSpec {
  down: number;
  bottom: number;
  hold?: number;
  up: number;
  rest?: number;
}

export interface FixtureOptions {
  fps: number;
  view?: 'side' | 'front';
  /** Std dev of coordinate noise (normalised units; 0.004 is about 1 px of 256). */
  noise?: number;
  /** Chance a frame is missing entirely. */
  dropProb?: number;
  /** Chance the legs score below the trust threshold in a frame. */
  lowScoreProb?: number;
  /** Timestamp jitter as a fraction of the frame interval. */
  timeJitter?: number;
  /** Intervals (ms, from clip start) with no person: the model returns very low scores. */
  absent?: [number, number][];
  /** Intervals (ms) with no frames at all (camera stalled). */
  missing?: [number, number][];
  /** Frame size in pixels (default 1000 x 1000, square). Keypoints are normalised by it, so a portrait frame skews x against y. */
  width?: number;
  height?: number;
  /** Bad frames: from `atMs`, `count` consecutive frames report hip height `h` (a hip/knee swap, a weight taken for a hip) with normal scores. */
  outliers?: { atMs: number; count: number; h: number }[];
  /** Hand the analyser `width` and `height` on each frame (default true). False models a caller that forgot. */
  sendSize?: boolean;
  seed?: number;
  /** Standing time before the first rep, ms. */
  lead?: number;
  /** Extra standing time after the last piece, ms. */
  tail?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Piecewise `h(t)`: cosine ease down, hold, ease up. Starts and ends at 1. */
export function profile(reps: RepSpec[], lead = 1000, tail = 1000): { h: (t: number) => number; end: number } {
  const segs: { t0: number; t1: number; from: number; to: number }[] = [];
  let t = lead;
  for (const r of reps) {
    segs.push({ t0: t, t1: t + r.down, from: 1, to: r.bottom });
    t += r.down;
    if (r.hold) {
      segs.push({ t0: t, t1: t + r.hold, from: r.bottom, to: r.bottom });
      t += r.hold;
    }
    segs.push({ t0: t, t1: t + r.up, from: r.bottom, to: 1 });
    t += r.up + (r.rest ?? 600);
  }
  const end = t + tail;
  return {
    end,
    h: (x) => {
      for (const s of segs) {
        if (x >= s.t0 && x <= s.t1) {
          const u = (x - s.t0) / (s.t1 - s.t0);
          return s.from + (s.to - s.from) * (0.5 - 0.5 * Math.cos(Math.PI * u));
        }
      }
      return 1;
    },
  };
}

/**
 * Shin tilt in degrees as the hip drops: nearly upright standing, 35 degrees forward at parallel and below (the ankle
 * stays planted, so the knee travels forward along a fixed-length shin).
 */
export function shinTiltDeg(h: number): number {
  return 3 + 32 * (1 - Math.min(1, Math.max(0, h)));
}

/**
 * Keypoints for one `h`, built in pixels then normalised by the frame size. Shin length is 0.2 of the frame height; the thigh
 * is as long as the shin. Side view: the knee moves forward with the tilt, the hip goes back along the thigh, and the far leg
 * is half hidden. Front view: the camera sees the shin shortened by cos(tilt), so the signal reads |h| larger by 1 / cos(tilt).
 */
function keypoints(h: number, view: 'side' | 'front', rnd: () => number, noise: number, low: boolean, W: number, H: number): Kp[] {
  const n = () => (rnd() + rnd() + rnd() - 1.5) * 2 * noise;
  const L = 0.2 * H;
  const tilt = (shinTiltDeg(h) * Math.PI) / 180;
  const ankleY = 0.82 * H;
  const legScore = low ? 0.1 : 0.85;
  const kp: Kp[] = Array.from({ length: 17 }, (_, i) => ({ x: 0.5 + (i % 2 ? 0.02 : -0.02), y: 0.1 + i * 0.01, score: 0.9 }));
  const set = (i: number, px: number, py: number, score: number) => {
    kp[i] = { x: px / W + n(), y: py / H + n(), score };
  };
  const side = view === 'side';
  const ankleX = 0.5 * W;
  const kneeX = ankleX + (side ? L * Math.sin(tilt) : 0);
  const kneeY = ankleY - L * Math.cos(tilt);
  const hipY = kneeY - h * L;
  const back = side ? L * Math.sqrt(Math.max(0, 1 - Math.min(1, h * h))) : 0;
  const far = low ? 0.1 : 0.25;
  if (side) {
    set(11, kneeX - back, hipY, legScore);
    set(13, kneeX, kneeY, legScore);
    set(15, ankleX, ankleY, legScore);
    set(12, kneeX - back + 0.01 * W, hipY, far);
    set(14, kneeX + 0.01 * W, kneeY, far);
    set(16, ankleX + 0.01 * W, ankleY, far);
  } else {
    for (const [dx, hi, ki, ai] of [[-0.06, 11, 13, 15], [0.06, 12, 14, 16]] as const) {
      set(hi, ankleX + dx * W, hipY, legScore);
      set(ki, ankleX + dx * W * 0.9, kneeY, legScore);
      set(ai, ankleX + dx * W * 0.9, ankleY, legScore);
    }
  }
  return kp;
}

/** One noise-free frame at hip height `h` (shin lengths above the knee), for unit tests. */
export function frameAt(h: number, view: 'side' | 'front' = 'side', t = 0, W = 1000, H = 1000): Frame {
  return { t, width: W, height: H, keypoints: keypoints(h, view, () => 0.5, 0, false, W, H) };
}

/** Build a frame sequence for the given reps. */
export function makeFrames(reps: RepSpec[], o: FixtureOptions): Frame[] {
  const rnd = mulberry32(o.seed ?? 1);
  const { h, end } = profile(reps, o.lead ?? 1000, o.tail ?? 1000);
  const dt = 1000 / o.fps;
  const within = (t: number, spans?: [number, number][]) => !!spans?.some(([a, b]) => t >= a && t <= b);
  const frames: Frame[] = [];
  for (let k = 0; k * dt <= end; k++) {
    const t = Math.round(k * dt + (o.timeJitter ? (rnd() - 0.5) * 2 * o.timeJitter * dt : 0));
    if (within(t, o.missing)) continue;
    if (o.dropProb && rnd() < o.dropProb) continue;
    const absent = within(t, o.absent);
    const low = absent || (!!o.lowScoreProb && rnd() < o.lowScoreProb);
    const bad = o.outliers?.find((x) => k >= Math.round(x.atMs / dt) && k < Math.round(x.atMs / dt) + x.count);
    const W = o.width ?? 1000;
    const H = o.height ?? 1000;
    const f: Frame = { t: Math.max(0, t), keypoints: keypoints(bad ? bad.h : h(t), o.view ?? 'side', rnd, o.noise ?? 0, low, W, H) };
    if (o.sendSize !== false) {
      f.width = W;
      f.height = H;
    }
    frames.push(f);
  }
  return frames;
}

/** `count` identical reps. */
export function repeat(count: number, rep: RepSpec): RepSpec[] {
  return Array.from({ length: count }, () => ({ ...rep }));
}

if (process.argv[1]?.endsWith('pose-fixtures.ts') && process.argv[2]) {
  const dir = process.argv[2];
  mkdirSync(dir, { recursive: true });
  const clean = makeFrames(repeat(5, { down: 1500, bottom: -0.2, up: 1000 }), { fps: 30 });
  writeFileSync(join(dir, 'clean-5-reps-30fps.json'), JSON.stringify(clean));
  const noisy = makeFrames(repeat(5, { down: 1500, bottom: -0.2, up: 1000 }), { fps: 15, noise: 0.008, dropProb: 0.1, lowScoreProb: 0.1, seed: 7 });
  writeFileSync(join(dir, 'noisy-5-reps-15fps.json'), JSON.stringify(noisy));
}
