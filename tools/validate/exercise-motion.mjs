// Validator for content/exercise-motion.json (issue #1069). Returns a list of error strings.
// Shape: { schema_version: 1, skeleton: "pb15-v1", joints: [15 names], motions: { "<exercise name>": entry } }.
// An entry holds fps, loop, frames (each frame is 45 numbers: x, y, z of the 15 joints in the order of `joints`),
// and provenance (source, ids, licence). Units are body heights (the figure is 1.0 tall), x is the figure's left,
// y is up, z is forward, y = 0 is the floor and the ankle midpoint is pinned at x = z = 0.
// The JSON Schema in validate/schemas/exercise-motion.schema.json documents the shape; keep the two in step
// (test/exercise-motion.test.mjs compares the constants below with the schema).
import { nonEmpty } from './text.mjs';

export const SKELETON_ID = 'pb15-v1';
// Joint order is part of the format: a frame is the joints in this order, three numbers each.
export const JOINTS = [
  'head', 'neck', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'spine_mid', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
];
// Our own mannequin: [parent, child, length in body heights], parents before children, root spine_mid.
// Proportions are our own round numbers, not taken from a person or from any body model.
export const BONES = [
  ['spine_mid', 'neck', 0.15], ['neck', 'head', 0.13],
  ['neck', 'l_shoulder', 0.12], ['neck', 'r_shoulder', 0.12],
  ['l_shoulder', 'l_elbow', 0.186], ['r_shoulder', 'r_elbow', 0.186],
  ['l_elbow', 'l_wrist', 0.146], ['r_elbow', 'r_wrist', 0.146],
  ['spine_mid', 'l_hip', 0.18], ['spine_mid', 'r_hip', 0.18],
  ['l_hip', 'l_knee', 0.245], ['r_hip', 'r_knee', 0.245],
  ['l_knee', 'l_ankle', 0.246], ['r_knee', 'r_ankle', 0.246],
];
// Own filming only; a synthetic fixture source exists for tests and is refused unless the caller passes allowFixture.
export const SOURCES = ['own_filming'];
export const FIXTURE_SOURCE = 'synthetic_fixture';
export const LICENCES = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
export const MIN_FPS = 5;
export const MAX_FPS = 30;
export const MIN_FRAMES = 2;
export const MAX_COORD = 2;
export const MAX_ENTRY_BYTES = 8192;
export const BONE_TOLERANCE = 0.03;
const FIELDS = ['fps', 'loop', 'frames', 'source', 'source_id', 'clip_id', 'release_id', 'licence', 'licence_url', 'author', 'author_url', 'tools', 'note'];
const isHttps = (s) => typeof s === 'string' && /^https:\/\/[^\s]+$/.test(s);
const nullOrString = (v) => v === null || nonEmpty(v);
const at = (frame, name) => JOINTS.indexOf(name) * 3;
const step = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

/**
 * @param content parsed content/exercise-motion.json
 * @param exerciseNames the names in content/exercises.json (tags)
 * @param options { allowFixture } accept source "synthetic_fixture" (tests and golden files only)
 */
export function validateExerciseMotion(content, exerciseNames, options = {}) {
  const errors = [];
  if (!content || typeof content !== 'object' || Array.isArray(content)) return ['bundle must be an object'];
  if (content.schema_version !== 1) errors.push('schema_version must be 1');
  if (content.skeleton !== SKELETON_ID) errors.push(`skeleton must be ${SKELETON_ID}`);
  if (!Array.isArray(content.joints) || content.joints.join() !== JOINTS.join()) errors.push(`joints must be ${JOINTS.join(', ')}`);
  for (const k of Object.keys(content)) if (!['schema_version', 'skeleton', 'joints', 'motions'].includes(k)) errors.push(`unknown top-level field "${k}"`);
  const motions = content.motions;
  if (!motions || typeof motions !== 'object' || Array.isArray(motions)) return [...errors, 'motions must be an object keyed by exercise name'];
  const names = new Set(exerciseNames);
  const sources = options.allowFixture ? [...SOURCES, FIXTURE_SOURCE] : SOURCES;
  const sourceIds = new Map();
  const clipIds = new Map();

  for (const [name, e] of Object.entries(motions)) {
    const err = (m) => errors.push(`${name}: ${m}`);
    if (!names.has(name)) err('no such exercise in exercises.json');
    if (!e || typeof e !== 'object' || Array.isArray(e)) { err('entry must be an object'); continue; }
    for (const f of FIELDS) if (!(f in e)) err(`field "${f}" missing`);
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) err(`unknown field "${k}" (the video itself is never shipped)`);

    if (!Number.isInteger(e.fps) || e.fps < MIN_FPS || e.fps > MAX_FPS) err(`fps must be an integer from ${MIN_FPS} to ${MAX_FPS}`);
    if (typeof e.loop !== 'boolean') err('loop must be true or false');
    const size = Buffer.byteLength(JSON.stringify(e));
    if (size > MAX_ENTRY_BYTES) err(`entry is ${size} bytes, the limit is ${MAX_ENTRY_BYTES}`);

    let shapeOk = Array.isArray(e.frames) && e.frames.length >= MIN_FRAMES;
    if (!shapeOk) err(`frames must be a list of at least ${MIN_FRAMES} frames`);
    else e.frames.forEach((fr, i) => {
      const ferr = (m) => { shapeOk = false; err(`frame ${i + 1}: ${m}`); };
      if (!Array.isArray(fr) || fr.length !== JOINTS.length * 3 || fr.some((v) => typeof v !== 'number' || !Number.isFinite(v))) return ferr(`must hold ${JOINTS.length * 3} numbers`);
      if (fr.some((v) => Math.abs(v) > MAX_COORD)) ferr(`coordinate out of range (body heights, at most ${MAX_COORD} either way)`);
    });
    if (shapeOk) {
      e.frames.forEach((fr, i) => {
        for (const [p, c, len] of BONES) {
          const a = at(fr, p), b = at(fr, c);
          const d = Math.hypot(fr[a] - fr[b], fr[a + 1] - fr[b + 1], fr[a + 2] - fr[b + 2]);
          if (Math.abs(d - len) / len > BONE_TOLERANCE) { err(`frame ${i + 1}: bone ${p}-${c} is ${d.toFixed(3)} long, expected ${len} (within ${BONE_TOLERANCE * 100}%)`); break; }
        }
      });
      // A loop closes when the jump from the last frame back to the first is no bigger than the biggest jump inside it.
      if (e.loop === true) {
        const inner = Math.max(...e.frames.slice(1).map((f, k) => step(e.frames[k], f)));
        if (step(e.frames.at(-1), e.frames[0]) > inner * 1.25 + 0.005) err('loop does not close (the last frame is far from the first)');
      }
    }

    if (!sources.includes(e.source)) err(`source must be ${SOURCES.join(', ')} (third-party video is not accepted)`);
    for (const f of ['source_id', 'clip_id', 'release_id', 'licence', 'author', 'tools']) if (f in e && !nonEmpty(e[f])) err(`${f} must be a non-empty string`);
    if (nonEmpty(e.licence)) {
      if (!Object.hasOwn(LICENCES, e.licence)) err(`licence "${e.licence}" is not on the allowlist (${Object.keys(LICENCES).join(', ')})`);
      else if (e.licence_url !== LICENCES[e.licence]) err(`licence_url must be ${LICENCES[e.licence]}`);
    }
    for (const [f, seen] of [['source_id', sourceIds], ['clip_id', clipIds]]) {
      if (!nonEmpty(e[f])) continue;
      if (seen.has(e[f])) err(`duplicate ${f} ${e[f]} (also ${seen.get(e[f])})`);
      seen.set(e[f], name);
    }
    if (e.author_url !== null && e.author_url !== undefined && !isHttps(e.author_url)) err('author_url must be an https URL or null');
    if ('note' in e && !nullOrString(e.note)) err('note must be a non-empty string or null');
  }
  return errors;
}
