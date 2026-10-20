import fs from 'node:fs';
import path from 'node:path';
import fixtureBundle from '../../../tools/exercise-motion/fixtures/squat-synthetic.motion.json';
import { exerciseMotionEnabled } from '../src/motion/flag';
import { LICENCES, MAX_COORD, MAX_FPS, MIN_FPS, MIN_FRAMES, SKELETON_ID, SOURCES, isMotionBundle, motionAlt, type MotionEntry } from '../src/motion/data';
import { MOTION_ENTRY_NAME, motionFixtureBundle } from './motion-helpers';
import { ALT_MAX } from '../src/workout/figures';
import {
  END_ON_RATIO, JOINT_NAMES, RIG_SEG, jointAt, jointIndex, keyFrameIndex, motionDuration, projectSide, rigJoints, rigPose, sampleFrame, type Frame,
} from '../src/motion/project';

const dist = (a: readonly number[], b: readonly number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
const entry = (): MotionEntry => (motionFixtureBundle() as { motions: Record<string, MotionEntry> }).motions[MOTION_ENTRY_NAME]!;
/** A 57-number frame with the given joints set (x, y, z); every other joint is at the origin. */
function frame(joints: Record<string, [number, number, number]>): Frame {
  const f = new Array<number>(57).fill(0);
  for (const [name, p] of Object.entries(joints)) f.splice(jointIndex(name) * 3, 3, ...p);
  return f;
}
/** A person standing straight, facing +z, heel behind the ankle and toe in front. */
const STANDING = frame({
  head: [0, 0.97, 0], neck: [0, 0.84, 0], r_shoulder: [-0.12, 0.84, 0], r_elbow: [-0.12, 0.65, 0], r_wrist: [-0.12, 0.5, 0],
  l_hip: [0.09, 0.53, 0], r_hip: [-0.09, 0.53, 0], r_knee: [-0.09, 0.29, 0], r_ankle: [-0.09, 0.04, 0],
  r_heel: [-0.09, 0, -0.04], r_toe: [-0.09, 0, 0.12],
});

describe('exercise motion flag', () => {
  it('is off unless the build sets EXPO_PUBLIC_EXERCISE_MOTION to exactly 1', () => {
    expect(exerciseMotionEnabled(undefined)).toBe(false);
    expect(exerciseMotionEnabled('')).toBe(false);
    expect(exerciseMotionEnabled('0')).toBe(false);
    expect(exerciseMotionEnabled('true')).toBe(false);
    expect(exerciseMotionEnabled('1')).toBe(true);
  });
  it('reads the build env when not told (unset under jest, so off)', () => {
    expect(exerciseMotionEnabled()).toBe(false);
  });
});

describe('side-view projection', () => {
  it('puts forward (z) to the right and up (y) up, dropping the sideways axis (x)', () => {
    expect(projectSide([0.3, 0.5, 0.2])).toEqual([0.2, 0.5]);
    expect(projectSide([-0.3, 0.5, 0.2])).toEqual([0.2, 0.5]);
    expect(projectSide([0, 0, -0.1])).toEqual([-0.1, 0]);
  });
  it('reads a joint by name from the 57-number frame', () => {
    expect(jointAt(STANDING, 'r_knee')).toEqual([-0.09, 0.29, 0]);
    expect(jointAt(STANDING, 'r_toe')).toEqual([-0.09, 0, 0.12]);
  });
  it('maps a straight standing pose onto the rig: ankle on the floor mark, leg and torso straight up, foot pointing right', () => {
    const J = rigJoints(STANDING);
    expect(J.ankle[0]).toBeCloseTo(150, 6);
    expect(J.ankle[1]).toBeCloseTo(212, 6);
    expect(J.knee[0]).toBeCloseTo(150, 6);
    expect(J.knee[1]).toBeCloseTo(212 - RIG_SEG.sh, 6);
    expect(J.hip[1]).toBeCloseTo(212 - RIG_SEG.sh - RIG_SEG.th, 6);
    expect(J.sh[1]).toBeCloseTo(212 - RIG_SEG.sh - RIG_SEG.th - RIG_SEG.torso, 6);
    expect(J.toe[0]).toBeCloseTo(150 + RIG_SEG.foot, 6);
    expect(J.toe[1]).toBeCloseTo(212, 6);
  });
  it('takes the foot direction from heel to toe, not from the ankle', () => {
    const f = STANDING.slice();
    f.splice(jointIndex('r_toe') * 3, 3, -0.09, 0.1, 0.12); // toe lifted: heel (0, -0.04) to toe (0.1, 0.12) climbs
    const J = rigJoints(f);
    const a = Math.atan2(212 - J.toe[1], J.toe[0] - J.ankle[0]);
    expect(a).toBeCloseTo(Math.atan2(0.1, 0.16), 6);
  });
  it('lifts the figure when both heel and toe are above the clip floor, scaled to the rig leg', () => {
    const f = STANDING.slice();
    for (const j of ['r_heel', 'r_toe']) f[jointIndex(j) * 3 + 1] = 0.1;
    expect(212 - rigJoints(f).ankle[1]).toBeCloseTo(0.1 * ((RIG_SEG.th + RIG_SEG.sh) / 0.491), 6);
  });
  it('gives finite numbers for a degenerate frame (every joint at one point)', () => {
    const J = rigJoints(new Array<number>(57).fill(0.5));
    for (const p of Object.values(J)) for (const v of p) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('rescaling to the rig', () => {
  it('uses the segment lengths of tools/exercise-figures/rig.mjs', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/exercise-figures/rig.mjs'), 'utf8');
    const m = /const SEG = \{([^}]*)\}/.exec(src)!;
    const rig = Object.fromEntries(m[1]!.split(',').map((kv) => kv.split(':').map((s) => s.trim()))) as Record<string, string>;
    expect(Object.fromEntries(Object.entries(rig).map(([k, v]) => [k, Number(v)]))).toEqual(RIG_SEG);
  });
  it('keeps every rig segment length in every keyframe and at in-between times', () => {
    const e = entry();
    const times = [...e.frames.keys()].map((i) => i / e.fps).concat([0.013, 0.37, 0.91, 1.234, 1.99]);
    for (const t of times) {
      const J = rigJoints(sampleFrame(e, t));
      expect(dist(J.ankle, J.knee)).toBeCloseTo(RIG_SEG.sh, 6);
      expect(dist(J.knee, J.hip)).toBeCloseTo(RIG_SEG.th, 6);
      expect(dist(J.hip, J.sh)).toBeCloseTo(RIG_SEG.torso, 6);
      expect(dist(J.sh, J.head)).toBeCloseTo(RIG_SEG.neck + RIG_SEG.head, 6);
      expect(dist(J.sh, J.el)).toBeCloseTo(RIG_SEG.ua, 6);
      expect(dist(J.el, J.wr)).toBeCloseTo(RIG_SEG.fa, 6);
      expect(dist(J.ankle, J.toe)).toBeCloseTo(RIG_SEG.foot, 6);
    }
  });
  it('keeps the squat reading as a squat: the hip drops and the knee goes forward of the ankle', () => {
    const e = entry();
    const top = rigJoints(e.frames[0]!);
    const low = rigJoints(e.frames[keyFrameIndex(e)]!);
    expect(low.hip[1]).toBeGreaterThan(top.hip[1] + 20);
    expect(low.knee[0]).toBeGreaterThan(low.ankle[0]);
    expect(low.ankle[1]).toBeCloseTo(212, 0);
  });
});

describe('a segment that turns end-on to the camera', () => {
  /** STANDING with the right wrist moved `x` sideways and `z` forward of the elbow (forearm 0.146 long in 3D). */
  const wristAt = (x: number, z: number) => {
    const f = STANDING.slice();
    f.splice(jointIndex('r_wrist') * 3, 3, -0.12 + x, 0.65, z);
    return f;
  };
  it('holds the previous frame direction instead of flipping on noise', () => {
    const bent = wristAt(0, 0.146); // forearm pointing forward, side on
    const before = rigPose(bent);
    expect(before.dirs.wr[0]).toBeCloseTo(1, 6);
    let prev = before.dirs;
    for (const z of [0.002, -0.003, 0.004, -0.001]) { // nearly pointing at the camera, the tiny z flips sign
      const next = rigPose(wristAt(0.146, z), prev);
      expect(next.dirs.wr).toEqual(before.dirs.wr);
      expect(dist(next.joints.el, next.joints.wr)).toBeCloseTo(RIG_SEG.fa, 6);
      prev = next.dirs;
    }
  });
  it('uses the new direction again once the projection is longer than the end-on share of the bone', () => {
    const ok = rigPose(wristAt(0.146 * Math.sqrt(1 - 0.35 ** 2), 0.146 * 0.35), rigPose(wristAt(0, 0.146)).dirs);
    expect(ok.dirs.wr[0]).toBeCloseTo(1, 6);
    expect(END_ON_RATIO).toBeLessThan(0.35);
    const back = rigPose(wristAt(0.146 * Math.sqrt(1 - 0.35 ** 2), -0.146 * 0.35), rigPose(wristAt(0, 0.146)).dirs);
    expect(back.dirs.wr[0]).toBeCloseTo(-1, 6);
  });
  it('without a previous frame uses the default direction (arm down)', () => {
    const J = rigPose(wristAt(0.146, 0.001)).joints;
    expect(J.wr[0]).toBeCloseTo(J.el[0], 6);
    expect(J.wr[1]).toBeCloseTo(J.el[1] + RIG_SEG.fa, 6);
  });
});

describe('interpolation', () => {
  const a = frame({ r_knee: [0, 0.2, 0] });
  const b = frame({ r_knee: [0, 0.4, 0.2] });
  const two = { fps: 5, loop: true, frames: [a, b] };
  it('returns the keyframe at its own time and the midpoint halfway', () => {
    expect(sampleFrame(two, 0)).toEqual(a);
    const mid = sampleFrame(two, 0.1); // 5 fps: 0.2 s per step
    expect(jointAt(mid, 'r_knee')[1]).toBeCloseTo(0.3, 9);
    expect(jointAt(mid, 'r_knee')[2]).toBeCloseTo(0.1, 9);
  });
  it('a loop blends the last frame back into the first and wraps by its period (frames / fps)', () => {
    expect(motionDuration(two)).toBeCloseTo(0.4, 9);
    expect(jointAt(sampleFrame(two, 0.3), 'r_knee')[1]).toBeCloseTo(0.3, 9);
    expect(jointAt(sampleFrame(two, 0.4 + 0.1), 'r_knee')[1]).toBeCloseTo(0.3, 9);
    expect(sampleFrame(two, 0.4)).toEqual(a);
    expect(jointAt(sampleFrame(two, 4.0), 'r_knee')[1]).toBeCloseTo(0.2, 6);
  });
  it('a non-loop clip runs to its last frame (frames - 1 steps) and restarts there', () => {
    const once = { ...two, loop: false };
    expect(motionDuration(once)).toBeCloseTo(0.2, 9);
    expect(sampleFrame(once, 0.2 - 1e-9)[jointIndex('r_knee') * 3 + 1]).toBeCloseTo(0.4, 6);
    expect(sampleFrame(once, 0.2)).toEqual(a);
  });
  it('copes with a negative or huge time', () => {
    expect(jointAt(sampleFrame(two, -0.1), 'r_knee')[1]).toBeCloseTo(jointAt(sampleFrame(two, 0.3), 'r_knee')[1], 9);
    expect(sampleFrame(two, 1e6).every(Number.isFinite)).toBe(true);
  });
  it('handles the lowest rate (5 fps) with smooth steps in between', () => {
    const e = { ...entry(), fps: 5 };
    const p0 = rigJoints(sampleFrame(e, 0)).hip[1];
    const p1 = rigJoints(sampleFrame(e, 0.1)).hip[1];
    const p2 = rigJoints(sampleFrame(e, 0.2)).hip[1];
    expect(p1).toBeGreaterThanOrEqual(Math.min(p0, p2) - 1e-9);
    expect(p1).toBeLessThanOrEqual(Math.max(p0, p2) + 1e-9);
  });
});

describe('static key pose', () => {
  it('is the frame furthest from the first (the bottom of the squat)', () => {
    const e = entry();
    const k = keyFrameIndex(e);
    const hipY = (i: number) => jointAt(e.frames[i]!, 'r_hip')[1];
    expect(k).toBeGreaterThan(0);
    expect(hipY(k)).toBe(Math.min(...e.frames.map((_, i) => hipY(i))));
  });
});

describe('alt text', () => {
  it('says what it is, names the exercise, adds the setup step and stays within the limit', () => {
    const setup = 'Stand with feet shoulder width apart. Keep your chest up. Push your knees out over your toes while you sit back and down.';
    const moving = motionAlt('Bodyweight Squat', false, setup);
    expect(moving.startsWith('Bodyweight Squat: ')).toBe(true);
    expect(moving).toMatch(/looping movement/);
    expect(moving).toMatch(/Stand with feet shoulder width apart\./);
    expect(moving.length).toBeLessThanOrEqual(ALT_MAX);
    const still = motionAlt('Bodyweight Squat', true, setup);
    expect(still).toMatch(/key position/);
    expect(still).not.toMatch(/looping/);
    expect(still.length).toBeLessThanOrEqual(ALT_MAX);
  });
  it('works without a setup step', () => {
    expect(motionAlt('Bodyweight Squat', false, undefined)).toBe('Bodyweight Squat: looping movement.');
  });
});

describe('motion bundle validation', () => {
  it('accepts the empty bundle the app ships with, and a real-source squat entry', () => {
    expect(isMotionBundle({ schema_version: 1, skeleton: 'pb19-v1', joints: fixtureBundle.joints, motions: {} })).toBe(true);
    expect(isMotionBundle(motionFixtureBundle())).toBe(true);
  });
  it('refuses the synthetic fixture source, so a fixture entry can never be played from content', () => {
    expect(isMotionBundle(fixtureBundle)).toBe(false);
  });
  it('refuses a wrong skeleton, an unknown exercise, a wrong frame length, a bad fps and a non-finite number', () => {
    const base = () => JSON.parse(JSON.stringify(motionFixtureBundle())) as Record<string, any>;
    const bad: ((b: Record<string, any>) => void)[] = [
      (b) => { b.skeleton = 'other'; },
      (b) => { b.motions['Not An Exercise'] = b.motions[MOTION_ENTRY_NAME]; },
      (b) => { b.motions[MOTION_ENTRY_NAME].frames[3] = [1, 2, 3]; },
      (b) => { b.motions[MOTION_ENTRY_NAME].fps = 3; },
      (b) => { b.motions[MOTION_ENTRY_NAME].frames[0][0] = null; },
      (b) => { b.motions[MOTION_ENTRY_NAME].licence = 'CC-BY-NC-4.0'; },
      (b) => { Object.defineProperty(b.motions, '__proto__', { value: b.motions[MOTION_ENTRY_NAME], enumerable: true }); },
    ];
    for (const f of bad) {
      const b = base();
      f(b);
      expect(isMotionBundle(b)).toBe(false);
    }
  });
  it('the shipped content/exercise-motion.json passes the app validator', () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../content/exercise-motion.json'), 'utf8'));
    expect(isMotionBundle(shipped)).toBe(true);
  });
  it('the app limits are those of tools/validate/exercise-motion.mjs', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../../tools/validate/exercise-motion.mjs'), 'utf8');
    const num = (n: string) => Number(new RegExp(`export const ${n} = (\\d+);`).exec(src)![1]);
    const str = (n: string) => new RegExp(`export const ${n} = '([^']+)';`).exec(src)![1];
    expect({ MIN_FPS: MIN_FPS, MAX_FPS: MAX_FPS, MIN_FRAMES: MIN_FRAMES, MAX_COORD: MAX_COORD }).toEqual({ MIN_FPS: num('MIN_FPS'), MAX_FPS: num('MAX_FPS'), MIN_FRAMES: num('MIN_FRAMES'), MAX_COORD: num('MAX_COORD') });
    expect(SKELETON_ID).toBe(str('SKELETON_ID'));
    expect(SOURCES).toEqual(/export const SOURCES = \[([^\]]*)\]/.exec(src)![1]!.split(',').map((x) => x.trim().replace(/'/g, '')));
    const lic = /export const LICENCES = \{([^}]*)\}/.exec(src)![1]!;
    expect(LICENCES).toEqual(Object.fromEntries([...lic.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]])));
    const joints = /export const JOINTS = \[([^\]]*)\]/.exec(src)![1]!;
    expect([...joints.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([...JOINT_NAMES]);
  });
  it('the shipped content/exercise-motion.json holds no fixture entry', () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../content/exercise-motion.json'), 'utf8')) as { motions: Record<string, { source: string }> };
    for (const e of Object.values(shipped.motions)) expect(e.source).not.toBe('synthetic_fixture');
  });
});
