import content from '../../../content/exercises.json';
import {
  DEPTH_CUES,
  JUMP_DWELL_MS,
  MAX_GAP_MS,
  analyseSquat,
  initRepCounter,
  repInProgress,
  squatSignal,
  stepRepCounter,
  type PoseFrame,
} from '../src/index';
import { frameAt, makeFrames, shinTiltDeg, repeat, type Frame, type RepSpec } from './pose-fixtures';

const rep = (bottom: number, extra: Partial<RepSpec> = {}): RepSpec => ({ down: 1500, bottom, up: 1000, ...extra });

describe('squatSignal', () => {
  const frame = (h: number, view: 'side' | 'front' = 'side'): Frame => frameAt(h, view);
  it('is the hip height above the knee in shin lengths', () => {
    expect(squatSignal(frame(1))).toBeCloseTo(1, 5);
    expect(squatSignal(frame(0))).toBeCloseTo(0, 5);
    expect(squatSignal(frame(-0.3))).toBeCloseTo(-0.3, 5);
  });
  it('reads a front view with both legs', () => {
    expect(squatSignal(frame(1, 'front'))).toBeCloseTo(1, 2);
  });
  it('is null with fewer than 17 keypoints or low scores', () => {
    const f = frame(1);
    expect(squatSignal({ t: 0, keypoints: f.keypoints.slice(0, 10) })).toBeNull();
    expect(squatSignal({ t: 0, keypoints: f.keypoints.map((k) => ({ ...k, score: 0.1 })) })).toBeNull();
    expect(squatSignal({ t: 0, keypoints: f.keypoints.map((k) => ({ ...k, score: NaN })) })).toBeNull();
  });
  it('is null when the shin collapses to a point', () => {
    const f = frame(1);
    const kp = f.keypoints.map((k) => ({ ...k }));
    kp[15] = { ...kp[13]! };
    kp[16] = { ...kp[14]! };
    expect(squatSignal({ t: 0, keypoints: kp })).toBeNull();
  });
  it('uses the only trusted leg and ignores the half-hidden one', () => {
    const f = frame(1);
    const kp = f.keypoints.map((k) => ({ ...k }));
    kp[12] = { x: 0.9, y: 0.1, score: 0.29 };
    expect(squatSignal({ t: 0, keypoints: kp })).toBeCloseTo(1, 5);
  });
});

describe('clean reps', () => {
  const r = analyseSquat(makeFrames(repeat(5, rep(-0.2)), { fps: 30 }), 'Bodyweight Squat');
  it('counts every rep and all reach parallel', () => {
    expect(r.count).toBe(5);
    expect(r.parallelCount).toBe(5);
    expect(r.partialAtEnd).toBe(false);
    expect(r.gaps).toBe(0);
    expect(r.cues).toEqual([]);
    expect(r.framesUsed).toBe(r.framesTotal);
    expect(r.reps.map((x) => x.index)).toEqual([1, 2, 3, 4, 5]);
  });
  it('measures depth and tempo', () => {
    for (const x of r.reps) {
      expect(x.depth).toBeLessThan(-0.1);
      expect(x.depth).toBeGreaterThan(-0.25);
      // Cosine ease: h crosses 0.7 a third of the way down (1000 ms left of 1500), and the flat bottom puts the
      // first sample within 0.04 of the lowest point about 170 ms early, so a clean rep reads about 840 ms down,
      // 270 ms at the bottom and 570 ms up (golden values of this synthetic profile).
      expect(Math.abs(x.eccentricMs - 840)).toBeLessThan(60);
      expect(Math.abs(x.pauseMs - 267)).toBeLessThan(60);
      expect(Math.abs(x.concentricMs - 568)).toBeLessThan(60);
      expect(x.endMs - x.startMs).toBe(x.eccentricMs + x.pauseMs + x.concentricMs);
    }
  });
  it('front view gives the same count', () => {
    expect(analyseSquat(makeFrames(repeat(5, rep(-0.2)), { fps: 30, view: 'front' })).count).toBe(5);
  });
});

describe('depth against about parallel', () => {
  it('splits shallow from parallel reps and cues the card line', () => {
    const r = analyseSquat(makeFrames([rep(-0.1), rep(0.15), rep(-0.1), rep(0.15)], { fps: 30 }), 'Goblet Squat');
    expect(r.count).toBe(4);
    expect(r.reps.map((x) => x.reachedParallel)).toEqual([true, false, true, false]);
    expect(r.parallelCount).toBe(2);
    expect(r.cues).toEqual([DEPTH_CUES['Goblet Squat']]);
  });
  it('treats hip level with the knee as parallel and a hand-width above as shallow', () => {
    const r = analyseSquat(makeFrames([rep(0.03), rep(0.12)], { fps: 30 }));
    expect(r.reps.map((x) => x.reachedParallel)).toEqual([true, false]);
  });
  it('counts a shallow rep but ignores a bend that stays above the rep depth', () => {
    const r = analyseSquat(makeFrames([rep(0.15), rep(0.5), rep(0.15)], { fps: 30 }));
    expect(r.count).toBe(2);
  });
  it('has no cues when no exercise is named', () => {
    expect(analyseSquat(makeFrames([rep(0.2)], { fps: 30 })).cues).toEqual([]);
  });
});

describe('tempo', () => {
  it('reports a pause at the bottom', () => {
    const r = analyseSquat(makeFrames([rep(-0.2, { hold: 2000 }), rep(-0.2)], { fps: 30 }));
    expect(r.count).toBe(2);
    expect(Math.abs(r.reps[0]!.pauseMs - 2000)).toBeLessThan(250);
    expect(r.reps[1]!.pauseMs).toBeLessThan(400);
  });
  it('tells a slow lowering from a fast one', () => {
    const r = analyseSquat(makeFrames([{ down: 3000, bottom: -0.2, up: 900 }, { down: 900, bottom: -0.2, up: 900 }], { fps: 30 }));
    expect(r.reps[0]!.eccentricMs).toBeGreaterThan(r.reps[1]!.eccentricMs * 2);
  });
});

describe('end of set and missing person', () => {
  it('leaves a half rep at the end out of the count', () => {
    // rep 4 starts at 1000 + 3 x 3100 ms and is at its lowest 1500 ms later; the clip stops 200 ms after that
    const partial = makeFrames(repeat(4, rep(-0.2)), { fps: 30 }).filter((f) => f.t <= 10300 + 1700);
    const r = analyseSquat(partial);
    expect(r.count).toBe(3);
    expect(r.partialAtEnd).toBe(true);
  });
  it('is not partial when the set ends on a bend that never got deep', () => {
    const frames = makeFrames([rep(-0.2), rep(0.5)], { fps: 30, tail: 0 });
    const r = analyseSquat(frames.filter((f) => f.t <= 5700));
    expect(r.partialAtEnd).toBe(false);
  });
  it('drops the rep when the person leaves at the bottom, and keeps earlier reps', () => {
    // rep 2 is at its lowest at 5.6 s; the person is gone from 5.0 s to 8.5 s
    const r = analyseSquat(makeFrames(repeat(4, rep(-0.2)), { fps: 30, absent: [[5000, 8500]] }));
    expect(r.gaps).toBeGreaterThanOrEqual(1);
    expect(r.count).toBe(2); // rep 1, and rep 3 after they came back; rep 2 was lost
    expect(r.framesUsed).toBeLessThan(r.framesTotal);
  });
  it('counts reps on both sides of a standing-still absence', () => {
    // reps 1 and 2 end by 6.6 s, rep 3 starts at 10.6 s; nobody in frame from 7 s to 10 s
    const specs = [rep(-0.2), rep(-0.2, { rest: 4000 }), rep(-0.2), rep(-0.2)];
    const r = analyseSquat(makeFrames(specs, { fps: 30, absent: [[7000, 10000]] }));
    expect(r.count).toBe(4);
  });
  it('never counts a rep that was lost across a long gap of missing frames', () => {
    const r = analyseSquat(makeFrames(repeat(3, rep(-0.2)), { fps: 30, missing: [[3600, 5600]] }));
    expect(r.gaps).toBe(1);
    expect(r.count).toBe(2);
  });
  it('bridges a gap shorter than the limit', () => {
    const r = analyseSquat(makeFrames(repeat(3, rep(-0.2)), { fps: 30, missing: [[1500, 1500 + MAX_GAP_MS - 300]] }));
    expect(r.gaps).toBe(0);
  });
});

describe('noise and frame rate', () => {
  it('counts through jitter, dropped frames and low scores', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const r = analyseSquat(makeFrames(repeat(6, rep(-0.2)), { fps: 20, noise: 0.008, dropProb: 0.1, lowScoreProb: 0.1, seed }));
      expect(r.count).toBe(6);
      expect(r.parallelCount).toBe(6);
    }
  });
  it('does not invent reps from standing jitter or a shallow wobble', () => {
    const r = analyseSquat(makeFrames([rep(0.55), rep(0.55)], { fps: 15, noise: 0.01, seed: 9 }));
    expect(r.count).toBe(0);
  });
  it.each([10, 15, 20, 24, 30])('gives the same count and depth at %i fps with timestamp jitter', (fps) => {
    const r = analyseSquat(makeFrames(repeat(5, rep(-0.2)), { fps, timeJitter: 0.3, noise: 0.004, seed: fps }));
    expect(r.count).toBe(5);
    expect(r.parallelCount).toBe(5);
    for (const x of r.reps) {
      expect(Math.abs(x.depth - -0.2)).toBeLessThan(0.15);
      expect(Math.abs(x.eccentricMs - 840)).toBeLessThan(250);
    }
  });
  it('counts never decrease as frames arrive (property)', () => {
    const frames = makeFrames(repeat(5, rep(-0.2)), { fps: 12, noise: 0.01, dropProb: 0.15, seed: 11 });
    let state = initRepCounter();
    let last = 0;
    for (const f of frames) {
      state = stepRepCounter(state, f.t, squatSignal(f));
      expect(state.reps.length).toBeGreaterThanOrEqual(last);
      last = state.reps.length;
    }
    expect(last).toBe(5);
  });
  it('is stable under extra small noise (property)', () => {
    const a = analyseSquat(makeFrames(repeat(5, rep(-0.2)), { fps: 30, noise: 0.002, seed: 3 }));
    const b = analyseSquat(makeFrames(repeat(5, rep(-0.2)), { fps: 30, noise: 0.008, seed: 4 }));
    expect(b.count).toBe(a.count);
    expect(b.parallelCount).toBe(a.parallelCount);
  });
});

describe('rep counter edge cases', () => {
  const feed = (pairs: [number, number | null][]) => pairs.reduce((s, [t, h]) => stepRepCounter(s, t, h), initRepCounter());
  it('waits for a standing sample before arming (clip starts mid-squat)', () => {
    // 0.25 steps per 100 ms are plausible motion (the 0.4 + 2 per s jump limit is not hit)
    const down = [[0, 0], [100, 0], [200, 0.25], [300, 0.5], [400, 0.75], [500, 1], [600, 1], [700, 0.75], [800, 0.5], [900, 0.25], [1000, 0], [1100, 0], [1200, 0.25], [1300, 0.5], [1400, 0.75], [1500, 1], [1600, 1]] as [number, number][];
    expect(feed(down).reps.length).toBe(1);
  });
  it('ignores non-increasing times, nulls and non-finite values', () => {
    let s = feed([[0, 1], [100, 1]]);
    const before = s;
    s = stepRepCounter(s, 100, 0);
    s = stepRepCounter(s, 50, 0);
    s = stepRepCounter(s, 200, null);
    s = stepRepCounter(s, 200, NaN);
    s = stepRepCounter(s, NaN, 1);
    expect(s).toBe(before);
  });
  it('restarts after a gap and reports in-progress only for a deep excursion', () => {
    let s = feed([[0, 1], [100, 1], [200, 0], [300, -0.2], [400, -0.2], [500, -0.2]]);
    expect(repInProgress(s)).toBe(true);
    s = stepRepCounter(s, 500 + MAX_GAP_MS + 1, 0.2);
    expect(s.gaps).toBe(1);
    expect(repInProgress(s)).toBe(false);
    expect(s.reps.length).toBe(0);
    const g = feed([[0, 0.1], [MAX_GAP_MS + 100, 1]]);
    expect(g.gaps).toBe(1);
    expect(g.phase).toBe('top');
  });
  it('starts armed when the first sample is standing', () => {
    expect(feed([[0, 1]]).phase).toBe('top');
    expect(feed([[0, 0.1]]).phase).toBe('unarmed');
  });
});

describe('cues come from the exercise cards', () => {
  const cards = (content as unknown as { cards: Record<string, { key_cues: string[]; common_mistakes: string[] }> }).cards;
  it.each(Object.entries(DEPTH_CUES))('%s cue text is on the card', (name, cue) => {
    expect(cue.exercise).toBe(name);
    expect(cards[name]![cue.list]).toContain(cue.text);
  });
});

describe('numbers only', () => {
  it('a report has no keypoints in it', () => {
    const frames: PoseFrame[] = makeFrames([rep(0.2)], { fps: 30 });
    const json = JSON.stringify(analyseSquat(frames, 'Bodyweight Squat'));
    expect(json).not.toContain('keypoints');
    expect(json).not.toContain('score');
  });
});

const RATES = [10, 15, 20, 30];

describe('outlier frames never change the count (any frame rate)', () => {
  const three = repeat(3, rep(-0.2)); // rep 1 is lowest at 2.5 s, rep 2 at 5.6 s, rep 3 at 8.7 s; standing between
  const cases: [string, { atMs: number; count: number; h: number }][] = [
    ['one frame at h=0 while standing', { atMs: 500, count: 1, h: 0 }],
    ['one frame at h=-0.5 while standing', { atMs: 500, count: 1, h: -0.5 }],
    ['two frames at h=-1 while standing', { atMs: 500, count: 2, h: -1 }],
    ['one frame at h=0 between reps', { atMs: 3800, count: 1, h: 0 }],
    ['one frame at h=1.5 at the bottom', { atMs: 2500, count: 1, h: 1.5 }],
    ['one frame at h=3 at the bottom', { atMs: 2500, count: 1, h: 3 }],
    ['two frames at h=1.5 at the bottom', { atMs: 2500, count: 2, h: 1.5 }],
    ['two frames at h=3 at the bottom', { atMs: 5600, count: 2, h: 3 }],
  ];
  for (const fps of RATES) {
    it.each(cases)(`%s at ${fps} fps`, (_name, o) => {
      const base = analyseSquat(makeFrames(three, { fps }));
      const r = analyseSquat(makeFrames(three, { fps, outliers: [o] }));
      expect(base.count).toBe(3);
      expect(r.count).toBe(3);
      expect(r.parallelCount).toBe(3);
      r.reps.forEach((x, i) => expect(Math.abs(x.depth - base.reps[i]!.depth)).toBeLessThan(0.03));
    });
  }
  it('a shallow rep is not made parallel by one deep frame', () => {
    for (const fps of RATES) {
      const r = analyseSquat(makeFrames([rep(0.15)], { fps, outliers: [{ atMs: 2500, count: 1, h: -0.8 }] }));
      expect(r.reps.map((x) => x.reachedParallel)).toEqual([false]);
    }
  });
  it('accepts a jump that persists, so a real fast move is not lost', () => {
    let s = initRepCounter();
    for (const [t, h] of [[0, 1], [100, 1], [200, 0], [300, 0], [400, 0], [500, 0]] as const) s = stepRepCounter(s, t, h);
    expect(s.phase).toBe('excursion');
    expect(s.pending).toBeNull();
  });
  it('holds a jump back until the dwell is over, then takes it', () => {
    let s = stepRepCounter(stepRepCounter(initRepCounter(), 0, 1), 100, 1);
    s = stepRepCounter(s, 200, 0);
    expect(s.pending).not.toBeNull();
    expect(s.last!.t).toBe(100);
    s = stepRepCounter(s, 200 + JUMP_DWELL_MS, 0.1);
    expect(s.pending).toBeNull();
    expect(s.last).toEqual({ t: 320, h: 0.1 });
  });
  it('restarts the dwell when the held values disagree', () => {
    let s = stepRepCounter(stepRepCounter(initRepCounter(), 0, 1), 100, 1);
    s = stepRepCounter(s, 200, -1);
    s = stepRepCounter(s, 300, 3);
    expect(s.pending).toEqual({ t: 300, h: 3 });
  });
});

describe('frame size and tilted shins', () => {
  it('reads the true h of a 35 degree shin in a portrait 9:16 frame', () => {
    expect(shinTiltDeg(0.06)).toBeGreaterThan(30);
    for (const h of [0.06, -0.2, 0.5]) {
      expect(squatSignal(frameAt(h, 'side', 0, 1080, 1920))).toBeCloseTo(h, 6);
      expect(squatSignal(frameAt(h, 'side', 0, 1920, 1080))).toBeCloseTo(h, 6);
    }
  });
  it('would misread the same frame if the size were ignored', () => {
    const f = frameAt(0.06, 'side', 0, 1080, 1920);
    const blind = squatSignal({ t: 0, keypoints: f.keypoints })!;
    expect(Math.abs(blind - 0.06)).toBeGreaterThan(0.01);
  });
  it('flags a portrait shallow rep as shallow and a parallel one as parallel', () => {
    const r = analyseSquat(makeFrames([rep(0.1), rep(0.0)], { fps: 30, width: 1080, height: 1920 }));
    expect(r.reps.map((x) => x.reachedParallel)).toEqual([false, true]);
  });
  it('front view reads |h| larger by 1 / cos(tilt) and still counts', () => {
    const f = frameAt(-0.2, 'front');
    expect(squatSignal(f)!).toBeCloseTo(-0.2 / Math.cos((35 * Math.PI) / 180), 3);
    const r = analyseSquat(makeFrames(repeat(4, rep(-0.2)), { fps: 15, view: 'front' }));
    expect(r.count).toBe(4);
    expect(r.parallelCount).toBe(4);
  });
});

describe('frame-rate independence and leg weighting', () => {
  it('measures the same depth and tempo at 10 and 30 fps (a fixed-weight EMA would not)', () => {
    const slow = analyseSquat(makeFrames(repeat(3, rep(-0.2)), { fps: 10 }));
    const fast = analyseSquat(makeFrames(repeat(3, rep(-0.2)), { fps: 30 }));
    expect(slow.count).toBe(3);
    slow.reps.forEach((x, i) => {
      const y = fast.reps[i]!;
      expect(Math.abs(x.depth - y.depth)).toBeLessThanOrEqual(0.02);
      expect(Math.abs(x.eccentricMs - y.eccentricMs)).toBeLessThanOrEqual(50);
      expect(Math.abs(x.concentricMs - y.concentricMs)).toBeLessThanOrEqual(50);
    });
  });
  it('weights two usable legs by their lowest score, not a plain average', () => {
    const f = frameAt(1, 'front');
    const kp = f.keypoints.map((k) => ({ ...k }));
    for (const i of [11, 13, 15]) kp[i] = { ...kp[i]!, score: 0.9 };
    for (const i of [12, 14, 16]) kp[i] = { ...kp[i]!, score: 0.3 };
    kp[12] = { ...kp[12]!, y: kp[14]!.y }; // right leg reads h = 0
    const left = squatSignal({ ...f, keypoints: kp.map((k, i) => ([12, 14, 16].includes(i) ? { ...k, score: 0 } : k)) })!;
    const right = squatSignal({ ...f, keypoints: kp.map((k, i) => ([11, 13, 15].includes(i) ? { ...k, score: 0 } : k)) })!;
    expect(left).toBeCloseTo(1, 2);
    expect(right).toBeCloseTo(0, 2);
    const both = squatSignal({ ...f, keypoints: kp })!;
    expect(both).toBeCloseTo((0.9 * left + 0.3 * right) / 1.2, 6);
    expect(Math.abs(both - (left + right) / 2)).toBeGreaterThan(0.2);
  });
  it('merges two dips without standing into one rep, pause spanning both', () => {
    // a profile that dips, rises to 0.5 (below TOP_H) and dips again
    let s = initRepCounter();
    const path: [number, number][] = [[0, 1], [100, 1], [200, 0.75], [300, 0.5], [400, 0.25], [500, 0], [600, 0.25], [700, 0.5], [800, 0.25], [900, 0], [1000, 0.25], [1100, 0.5], [1200, 0.75], [1300, 1], [1400, 1]];
    for (const [t, h] of path) s = stepRepCounter(s, t, h);
    expect(s.reps.length).toBe(1);
    expect(s.reps[0]!.pauseMs).toBeGreaterThan(300);
  });
});
