import content from '../../../content/exercises.json';
import {
  DEPTH_CUES,
  MAX_GAP_MS,
  analyseSquat,
  initRepCounter,
  repInProgress,
  squatSignal,
  stepRepCounter,
  type PoseFrame,
} from '../src/index';
import { frameAt, makeFrames, repeat, type Frame, type RepSpec } from './pose-fixtures';

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
    const s = feed([[0, 0], [100, 0], [200, 1], [300, 1], [400, 0], [500, 0], [600, 0], [700, 1.2], [800, 1.2], [900, 1.2]]);
    expect(s.reps.length).toBe(1);
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
