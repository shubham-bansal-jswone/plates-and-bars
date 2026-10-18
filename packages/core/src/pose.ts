/**
 * Pose analysis for live squat tracking (#947, slice 1): a rep counter and a squat analyser over MoveNet frames.
 * New in v1.1, so there is no prototype function to mirror (the prototype's form review is film-and-check, not pose).
 * Pure functions, no camera or model code, no clock: timestamps come from the frames. Output is numbers and cue keys only,
 * never keypoints (keypoints must not reach logs or breadcrumbs).
 *
 * Signal: `h = (knee.y - hip.y) / shin`, the hip's height above the knee in shin lengths (image y grows downward).
 * Standing is about 1, "about parallel" is 0, below parallel is negative. Dividing by the shin length makes it
 * independent of camera distance, and works from a side or a front view. It is smoothed with a time-based EMA so the
 * result does not depend on the frame rate (10 to 30 fps).
 */

/** MoveNet keypoint order (17 points). Only hips, knees and ankles are read in slice 1. */
export const MOVENET = { leftHip: 11, rightHip: 12, leftKnee: 13, rightKnee: 14, leftAnkle: 15, rightAnkle: 16 } as const;

/**
 * A MoveNet keypoint: x and y normalised to 0..1 of the frame (y grows downward), score 0..1. Normalised x is a fraction of
 * the frame width and y of its height, so a frame that is not square must say so in `PoseFrame.width`/`height`.
 */
export interface PoseKeypoint {
  readonly x: number;
  readonly y: number;
  readonly score: number;
}

/** One model output: 17 keypoints and the frame timestamp in milliseconds. */
export interface PoseFrame {
  readonly t: number;
  /** Pixel size of the frame the normalised keypoints refer to; only the ratio matters. Both default to 1 (square or letterboxed input). */
  readonly width?: number;
  readonly height?: number;
  readonly keypoints: readonly PoseKeypoint[];
}

/** A keypoint below this score is not trusted. */
export const MIN_SCORE = 0.3;
/** Smaller shin lengths (frame-height units) are noise, not a leg. */
export const MIN_SHIN = 0.03;
/** Smoothing time constant (ms) of the EMA. */
export const SMOOTH_TAU_MS = 80;
/** Standing: a rep starts when `h` falls below this and ends when it rises back above it. */
export const TOP_H = 0.7;
/** A descent counts as a rep only if `h` goes below this (hysteresis against `TOP_H`: shallow bends are ignored). */
export const DOWN_H = 0.3;
/**
 * Hip within this many shin lengths above the knee still counts as "about parallel". Joint-centre level is not quite the
 * visual "thighs parallel" (the thigh is thicker at the hip, and MoveNet's hip point tends to sit high), so this may be
 * lenient; it is left at 0.05 and calibrated by the device accuracy gate (#947 section 8), not here.
 */
export const PARALLEL_H = 0.05;
/** Samples within this of the lowest point count as the bottom (pause detection). */
export const BOTTOM_BAND = 0.04;
/** No usable frame for longer than this (ms) means the person left or was lost: the open rep is dropped. */
export const MAX_GAP_MS = 1500;

/**
 * Outlier rejection. A raw sample that is further from the smoothed signal than `JUMP_H + MAX_SPEED_H_PER_S x dt` is
 * implausible (a hip/knee swap, the goblet weight taken for a hip). It is held back and only accepted when jumps of the
 * same size persist for `JUMP_DWELL_MS`, so one or two bad frames never move the count at any frame rate (at 10 fps two
 * frames span 100 ms, at 30 fps 33 ms; a real change is accepted after about 120 ms, 3 frames at 10 fps).
 * A median of 3 would not survive two bad frames in a row at 30 fps, and a dwell on the threshold crossings alone would
 * still let the outlier pull the smoothed depth, so the dwell sits in front of the smoothing.
 * Limits: a wrong reading shorter than about 130 ms (up to two frames at 10 fps, four at 30 fps) never changes the count;
 * a longer mis-track can, because it looks like a real move. The device accuracy gate tunes these three constants.
 * The jump is measured against the lagging smoothed value, not the raw one, so at 10 fps the margin for very fast reps
 * is thin: a 350 ms lowering moves the raw signal about 0.5 per frame, against a limit of 0.6.
 */
export const JUMP_H = 0.4;
export const MAX_SPEED_H_PER_S = 2;
export const JUMP_DWELL_MS = 120;

/** One counted rep. Times in whole milliseconds, depth in shin lengths (2 decimals). */
export interface SquatRep {
  /** 1-based. */
  readonly index: number;
  /** When the hip left the top (interpolated crossing of `TOP_H`). */
  readonly startMs: number;
  readonly endMs: number;
  /** Lowest smoothed `h`: 0 is hip level with the knee, negative is below parallel. */
  readonly depth: number;
  readonly reachedParallel: boolean;
  /** Lowering time: leaving the top until first reaching the bottom. */
  readonly eccentricMs: number;
  /** Time held at the bottom (0 when there is no pause). */
  readonly pauseMs: number;
  /** Rising time: leaving the bottom until back at the top. */
  readonly concentricMs: number;
}

interface Sample {
  readonly t: number;
  readonly h: number;
}

/** Samples of the open excursion as a linked list, newest first: appending is O(1) and nothing is copied per frame. */
interface Trail extends Sample {
  readonly prev: Trail | null;
}

/** Incremental state of `stepRepCounter`. Treat as opaque. */
export interface RepCounterState {
  readonly phase: 'unarmed' | 'top' | 'excursion';
  /** Last accepted smoothed sample. */
  readonly last: Sample | null;
  readonly startMs: number;
  readonly trail: Trail | null;
  /** Lowest smoothed `h` of the open excursion. */
  readonly min: number;
  /** A held-back implausible raw value: when it started and what it is. */
  readonly pending: Sample | null;
  readonly reps: readonly SquatRep[];
  /** Times a gap longer than `MAX_GAP_MS` reset tracking. */
  readonly gaps: number;
}

/** A fresh counter: waits for the first standing sample before it arms. */
export function initRepCounter(): RepCounterState {
  return { phase: 'unarmed', last: null, startMs: 0, trail: null, min: Infinity, pending: null, reps: [], gaps: 0 };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

function cross(a: Sample, b: Sample, level: number): number {
  return a.t + ((a.h - level) / (a.h - b.h)) * (b.t - a.t);
}

/** Walks the trail once, when a rep ends. Two dips with no standing between them are one excursion: one rep, and `pauseMs` spans both. */
function makeRep(state: RepCounterState, endMs: number): SquatRep | null {
  const min = state.min;
  if (min >= DOWN_H) return null;
  let first = 0;
  let last = Number.NaN;
  for (let n = state.trail; n; n = n.prev) {
    if (n.h <= min + BOTTOM_BAND) {
      first = n.t;
      if (Number.isNaN(last)) last = n.t;
    }
  }
  return {
    index: state.reps.length + 1,
    startMs: Math.round(state.startMs),
    endMs: Math.round(endMs),
    depth: round2(min),
    reachedParallel: min <= PARALLEL_H,
    eccentricMs: Math.round(first - state.startMs),
    pauseMs: Math.round(last - first),
    concentricMs: Math.round(endMs - last),
  };
}

/**
 * Feed one raw `h` (or `null` for a frame with no usable legs) at time `t`. Returns the new state; a frame whose time
 * is not after the last used one is ignored. Missing frames shorter than `MAX_GAP_MS` are bridged; longer ones drop the
 * open rep and wait for the next standing sample, so the count never goes down and never includes a half-seen rep.
 * Implausible jumps are held back for `JUMP_DWELL_MS` (see `JUMP_H`). The smoothing is a time-based EMA (zero-order
 * hold): it lags a ramp by roughly 40 ms at 10 fps and 64 ms at 30 fps, so rates agree closely but not exactly.
 */
export function stepRepCounter(state: RepCounterState, t: number, raw: number | null): RepCounterState {
  if (raw === null || !Number.isFinite(raw) || !Number.isFinite(t)) return state;
  const prev = state.last;
  if (prev && t <= prev.t) return state;
  if (!prev) {
    return { ...state, last: { t, h: raw }, phase: raw >= TOP_H ? 'top' : 'unarmed' };
  }
  if (t - prev.t > MAX_GAP_MS) {
    return { ...state, last: { t, h: raw }, phase: raw >= TOP_H ? 'top' : 'unarmed', trail: null, pending: null, gaps: state.gaps + 1 };
  }
  let h: number;
  let pending: Sample | null = null;
  if (Math.abs(raw - prev.h) > JUMP_H + (MAX_SPEED_H_PER_S * (t - prev.t)) / 1000) {
    const p = state.pending;
    pending = p && Math.abs(raw - p.h) <= JUMP_H ? { t: p.t, h: raw } : { t, h: raw };
    if (t - pending.t < JUMP_DWELL_MS) return { ...state, pending };
    h = raw; // the jump persisted: it is real, snap to it
    pending = null;
  } else {
    h = prev.h + (1 - Math.exp(-(t - prev.t) / SMOOTH_TAU_MS)) * (raw - prev.h);
  }
  const cur = { t, h };
  const base = { ...state, last: cur, pending };
  if (state.phase === 'unarmed') return { ...base, phase: h >= TOP_H ? 'top' : 'unarmed' };
  if (state.phase === 'top') {
    if (h >= TOP_H) return base;
    const startMs = cross(prev, cur, TOP_H);
    return { ...base, phase: 'excursion', startMs, min: h, trail: { t: cur.t, h, prev: { t: startMs, h: TOP_H, prev: null } } };
  }
  const trail: Trail = { t, h, prev: state.trail };
  const min = Math.min(state.min, h);
  if (h < TOP_H) return { ...base, trail, min };
  const rep = makeRep({ ...state, trail, min }, cross(prev, cur, TOP_H));
  return { ...base, phase: 'top', trail: null, min: Infinity, reps: rep ? [...state.reps, rep] : state.reps };
}

/** True when the set ended mid-rep (the person was down or rising and never got back to the top): that rep is not counted. */
export function repInProgress(state: RepCounterState): boolean {
  return state.phase === 'excursion' && state.min < DOWN_H;
}

/**
 * The hip-above-knee signal of one frame, or `null` when no leg is usable. A leg is usable when its hip, knee and ankle all
 * score at least `MIN_SCORE` and the shin is longer than `MIN_SHIN`. With both legs usable (front view) they are averaged,
 * weighted by their lowest keypoint score, so a half-hidden far leg in a side view counts for less.
 */
export function squatSignal(frame: PoseFrame): number | null {
  const kp = frame.keypoints;
  if (!kp || kp.length < 17) return null;
  // x in frame-height units, so x and y share one scale (a tilted shin in a portrait frame keeps its true length)
  const w = frame.width && frame.height && frame.width > 0 && frame.height > 0 ? frame.width / frame.height : 1;
  let sum = 0;
  let weight = 0;
  for (const [hi, ki, ai] of [
    [MOVENET.leftHip, MOVENET.leftKnee, MOVENET.leftAnkle],
    [MOVENET.rightHip, MOVENET.rightKnee, MOVENET.rightAnkle],
  ] as const) {
    const hip = kp[hi]!;
    const knee = kp[ki]!;
    const ankle = kp[ai]!;
    const score = Math.min(hip.score, knee.score, ankle.score);
    if (!(score >= MIN_SCORE)) continue;
    const shin = Math.hypot((knee.x - ankle.x) * w, (knee.y - ankle.y));
    if (!(shin >= MIN_SHIN)) continue;
    sum += score * ((knee.y - hip.y) / shin);
    weight += score;
  }
  return weight > 0 ? sum / weight : null;
}

/** Exercises the slice-1 analyser has cues for: the bodyweight and goblet squat cards. */
export type PoseExercise = 'Bodyweight Squat' | 'Goblet Squat';

/** A cue taken verbatim from an exercise card in `content/exercises.json` (a test checks the text still exists there). */
export interface PoseCue {
  readonly exercise: PoseExercise;
  readonly list: 'key_cues' | 'common_mistakes';
  readonly text: string;
}

/** The card cue shown when a counted rep stops above parallel. Slice 1 has no knee or trunk cues. */
export const DEPTH_CUES: Readonly<Record<PoseExercise, PoseCue>> = {
  'Bodyweight Squat': { exercise: 'Bodyweight Squat', list: 'key_cues', text: 'Lower until your thighs are about parallel' },
  'Goblet Squat': { exercise: 'Goblet Squat', list: 'key_cues', text: 'Lower until your thighs are about parallel' },
};

/** Result of `analyseSquat`: numbers and cue keys only. */
export interface SquatReport {
  readonly count: number;
  /** Reps that reached about parallel. */
  readonly parallelCount: number;
  readonly reps: readonly SquatRep[];
  /** The clip ended mid-rep; that rep is not in `count`. */
  readonly partialAtEnd: boolean;
  /** Frames with a usable signal / frames given. */
  readonly framesUsed: number;
  readonly framesTotal: number;
  /** Gaps longer than `MAX_GAP_MS` (person left the frame or was lost). */
  readonly gaps: number;
  readonly cues: readonly PoseCue[];
}

/**
 * Analyse a set's frames: `squatSignal` per frame, then the smoothed rep state machine. `exercise` picks the card cue;
 * with none, no cues are returned. Frames must be for one person; if more than one is detected the caller pauses.
 */
export function analyseSquat(frames: readonly PoseFrame[], exercise?: PoseExercise): SquatReport {
  let state = initRepCounter();
  let used = 0;
  for (const f of frames) {
    const h = squatSignal(f);
    if (h !== null) used += 1;
    state = stepRepCounter(state, f.t, h);
  }
  const reps = state.reps;
  const shallow = reps.some((r) => !r.reachedParallel);
  return {
    count: reps.length,
    parallelCount: reps.filter((r) => r.reachedParallel).length,
    reps,
    partialAtEnd: repInProgress(state),
    framesUsed: used,
    framesTotal: frames.length,
    gaps: state.gaps,
    cues: exercise && shallow ? [DEPTH_CUES[exercise]] : [],
  };
}
