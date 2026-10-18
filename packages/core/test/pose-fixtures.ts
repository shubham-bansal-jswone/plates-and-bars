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

/** Keypoints for one `h`. Side view: far leg half hidden. Front view: both legs, feet apart. */
function keypoints(h: number, view: 'side' | 'front', rnd: () => number, noise: number, low: boolean): Kp[] {
  const n = () => (rnd() + rnd() + rnd() - 1.5) * 2 * noise;
  const ankleY = 0.82;
  const kneeY = 0.62;
  const kp: Kp[] = Array.from({ length: 17 }, (_, i) => ({ x: 0.5 + (i % 2 ? 0.02 : -0.02), y: 0.1 + i * 0.01, score: 0.9 }));
  const legScore = low ? 0.1 : 0.85;
  const shin = Math.hypot(0.02, kneeY - ankleY);
  const hipY = kneeY - h * shin;
  const set = (i: number, x: number, y: number, score: number) => {
    kp[i] = { x: x + n(), y: y + n(), score };
  };
  if (view === 'side') {
    set(11, 0.44, hipY, legScore);
    set(13, 0.52, kneeY, legScore);
    set(15, 0.5, ankleY, legScore);
    set(12, 0.45, hipY, low ? 0.1 : 0.25);
    set(14, 0.53, kneeY, low ? 0.1 : 0.25);
    set(16, 0.51, ankleY, low ? 0.1 : 0.25);
  } else {
    set(11, 0.45, hipY, legScore);
    set(13, 0.44, kneeY, legScore);
    set(15, 0.44, ankleY, legScore);
    set(12, 0.55, hipY, legScore);
    set(14, 0.56, kneeY, legScore);
    set(16, 0.56, ankleY, legScore);
  }
  return kp;
}

/** One noise-free frame at hip height `h` (shin lengths above the knee), for unit tests. */
export function frameAt(h: number, view: 'side' | 'front' = 'side', t = 0): Frame {
  return { t, keypoints: keypoints(h, view, () => 0.5, 0, false) };
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
    frames.push({ t: Math.max(0, t), keypoints: keypoints(h(t), o.view ?? 'side', rnd, o.noise ?? 0, low) });
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
