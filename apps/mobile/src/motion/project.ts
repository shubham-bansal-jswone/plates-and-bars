/**
 * Projects pb19-v1 keyframes (content/exercise-motion.json, tools/exercise-motion/README.md) onto the v1.1 side-view rig
 * (tools/exercise-figures/rig.mjs) so the motion is drawn with the same figure.
 *
 * Camera: fixed, orthographic, side on. It stands on the figure's right (-x) and looks along +x, so the figure faces to the right
 * of the screen: screen right = z (forward), screen up = y, and x (sideways, the figure's left) is dropped. The near, right-hand limb
 * (r_*) is the one drawn, as the rig draws one limb stack.
 *
 * Joint mapping (pb19 -> rig joint). Only DIRECTIONS are taken from the data; every rig segment then gets the rig's own length (RIG_SEG),
 * so the figure is the v1.1 figure whoever was filmed and foreshortening in the projection cannot shrink a limb:
 *   ankle   r_ankle: height is the lowest of r_heel and r_toe above the clip floor, scaled to the rig leg; z is the ankle's z
 *   knee    ankle -> r_knee direction, length RIG_SEG.sh
 *   hip     r_knee -> midpoint of l_hip and r_hip, length RIG_SEG.th
 *   sh      midpoint of the hips -> neck, length RIG_SEG.torso (the rig's shoulder joint is the top of its torso line)
 *   head    neck -> head, length RIG_SEG.neck + RIG_SEG.head (the rig's head centre)
 *   el      r_shoulder -> r_elbow direction, from the rig's shoulder, length RIG_SEG.ua
 *   wr      r_elbow -> r_wrist direction, length RIG_SEG.fa
 *   toe     r_heel -> r_toe direction (the sole), length RIG_SEG.foot, from the ankle
 * A segment that is nearly end-on to the camera (its projection is under END_ON_RATIO of its 3D length, or it has no length) is drawn in
 * the direction it had in the previous frame (`prev` of rigPose; a default one when there is none: leg down, torso and head up, arm
 * down, foot forward), so a limb pointing at the camera holds still instead of flipping on noise, and no frame produces NaN.
 */

/** The 19 joints of a pb19-v1 frame, in the order of the format. A frame is 57 numbers: x, y, z of each. */
export const JOINT_NAMES = [
  'head', 'neck', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'spine_mid', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
  'l_heel', 'r_heel', 'l_toe', 'r_toe',
] as const;
export const FRAME_LENGTH = JOINT_NAMES.length * 3;
export type Frame = readonly number[];
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];

/** Segment lengths of the v1.1 rig in px (`SEG` in tools/exercise-figures/rig.mjs; a test compares them). */
export const RIG_SEG = { torso: 70, head: 11, neck: 15, ua: 36, fa: 32, th: 50, sh: 48, foot: 15 } as const;
/** Where the rig stands an exercise's ankle (the rig's own `STAND` ankle: x 150, y 212 with the floor line at 226). */
export const RIG_ANKLE: Vec2 = [150, 212];
/** Thigh plus shin in pb19 body heights (BONES in tools/validate/exercise-motion.mjs: 0.245 + 0.246); maps body-height units to rig px. */
const PB19_LEG = 0.491;
export const PX_PER_UNIT = (RIG_SEG.th + RIG_SEG.sh) / PB19_LEG;

/** Position of a joint name in the frame order (-1 when it is not one). */
export const jointIndex = (name: string): number => (JOINT_NAMES as readonly string[]).indexOf(name);
/** One joint of a frame as x, y, z in body heights. */
export function jointAt(frame: Frame, name: string): Vec3 {
  const i = jointIndex(name) * 3;
  return [frame[i]!, frame[i + 1]!, frame[i + 2]!];
}

/** The fixed side-view camera: x (sideways) is dropped, z (forward) goes right, y stays up. Body heights, y up. */
export const projectSide = (p: Vec3): Vec2 => [p[2], p[1]];

/** The playable part of an entry (content/exercise-motion.json `motions[name]`). */
export interface MotionClip { fps: number; loop: boolean; frames: readonly Frame[] }

/** Seconds of one pass: a loop of N frames puts frame k at k/N of the period (the last frame steps back to the first); a clip that is not a loop runs N - 1 steps. */
export const motionDuration = (m: MotionClip): number => (m.loop ? m.frames.length : m.frames.length - 1) / m.fps;

/** The pose at `seconds` (any real number), blending linearly between the two keyframes around it. Entries can be as low as 5 fps. */
export function sampleFrame(m: MotionClip, seconds: number): Frame {
  const n = m.frames.length;
  const dur = motionDuration(m);
  const t = ((seconds % dur) + dur) % dur;
  const pos = t * m.fps;
  const i = Math.min(Math.floor(pos), m.loop ? n - 1 : n - 2);
  const k = pos - i;
  const a = m.frames[i]!;
  if (k < 1e-9) return a;
  const b = m.frames[m.loop ? (i + 1) % n : i + 1]!;
  return a.map((v, j) => v + (b[j]! - v) * k);
}

/** The key pose shown when motion is reduced: the frame furthest from the first (the end position of the move). */
export function keyFrameIndex(m: MotionClip): number {
  const first = m.frames[0]!;
  let best = 0;
  let bestD = -1;
  m.frames.forEach((f, i) => {
    const d = f.reduce((s, v, j) => s + (v - first[j]!) ** 2, 0);
    if (d > bestD) { bestD = d; best = i; }
  });
  return best;
}

/** Joint positions in the rig's 320 x 240 drawing space (px, y down), named as in `joints()` of the rig. */
export interface RigJoints { ankle: Vec2; knee: Vec2; hip: Vec2; sh: Vec2; head: Vec2; el: Vec2; wr: Vec2; toe: Vec2 }

/** A segment is end-on when its side-view length is under this share of its 3D length. */
export const END_ON_RATIO = 0.3;
/** The unit direction (px space, y down) of each drawn rig segment: what the next frame holds when a segment is end-on. */
export interface RigDirs { knee: Vec2; hip: Vec2; sh: Vec2; head: Vec2; el: Vec2; wr: Vec2; toe: Vec2 }
const DEFAULT_DIRS: RigDirs = { knee: [0, -1], hip: [0, -1], sh: [0, -1], head: [0, -1], el: [0, 1], wr: [0, 1], toe: [1, 0] };

/** Unit vector (px space, y down) from projected `a` to projected `b`, or `fallback` when the segment is end-on. */
function dir(a: Vec3, b: Vec3, fallback: Vec2): Vec2 {
  const pa = projectSide(a);
  const pb = projectSide(b);
  const dx = pb[0] - pa[0];
  const dy = -(pb[1] - pa[1]);
  const len = Math.hypot(dx, dy);
  const full = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  return full < 1e-6 || len < full * END_ON_RATIO ? fallback : [dx / len, dy / len];
}
const along = (p: Vec2, d: Vec2, len: number): Vec2 => [p[0] + d[0] * len, p[1] + d[1] * len];
const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

/** The rig joints for one pb19 frame, and the segment directions used (pass them as `prev` for the next frame; see the end-on rule at the top). */
export function rigPose(frame: Frame, prev: RigDirs = DEFAULT_DIRS): { joints: RigJoints; dirs: RigDirs } {
  const J = (n: string) => jointAt(frame, n);
  const hips = mid(J('l_hip'), J('r_hip'));
  const ankleP = projectSide(J('r_ankle'));
  const lift = Math.max(0, Math.min(J('r_heel')[1], J('r_toe')[1]));
  const ankle: Vec2 = [RIG_ANKLE[0] + ankleP[0] * PX_PER_UNIT, RIG_ANKLE[1] - lift * PX_PER_UNIT];
  const dirs: RigDirs = {
    knee: dir(J('r_ankle'), J('r_knee'), prev.knee),
    hip: dir(J('r_knee'), hips, prev.hip),
    sh: dir(hips, J('neck'), prev.sh),
    head: dir(J('neck'), J('head'), prev.head),
    el: dir(J('r_shoulder'), J('r_elbow'), prev.el),
    wr: dir(J('r_elbow'), J('r_wrist'), prev.wr),
    toe: dir(J('r_heel'), J('r_toe'), prev.toe),
  };
  const knee = along(ankle, dirs.knee, RIG_SEG.sh);
  const hip = along(knee, dirs.hip, RIG_SEG.th);
  const sh = along(hip, dirs.sh, RIG_SEG.torso);
  const head = along(sh, dirs.head, RIG_SEG.neck + RIG_SEG.head);
  const el = along(sh, dirs.el, RIG_SEG.ua);
  const wr = along(el, dirs.wr, RIG_SEG.fa);
  const toe = along(ankle, dirs.toe, RIG_SEG.foot);
  return { joints: { ankle, knee, hip, sh, head, el, wr, toe }, dirs };
}

/** The rig joints for one pb19 frame with no previous frame. */
export const rigJoints = (frame: Frame): RigJoints => rigPose(frame).joints;
