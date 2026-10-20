// Validator for content/exercise-motion.json (issue #1069). Returns a list of error strings.
// Shape: { schema_version: 1, skeleton: "pb19-v1", joints: [19 names], motions: { "<exercise name>": entry } }.
// An entry holds fps, loop, frames (each frame is 57 numbers: x, y, z of the 19 joints in the order of `joints`),
// and provenance (source, ids, licence). Units are body heights (the figure is 1.0 tall), x is the figure's left,
// y is up, z is forward, y = 0 is the lowest point of any joint over the whole clip (checked within FLOOR_TOLERANCE) and the ankle midpoint of each frame is at x = z = 0.
// The JSON Schema in validate/schemas/exercise-motion.schema.json documents the shape; keep the two in step
// (test/exercise-motion.test.mjs compares the constants below with the schema).
import { nonEmpty } from './text.mjs';

export const SKELETON_ID = 'pb19-v1';
// Joint order is part of the format: a frame is the joints in this order, three numbers each.
export const JOINTS = [
  'head', 'neck', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
  'spine_mid', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle',
  'l_heel', 'r_heel', 'l_toe', 'r_toe',
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
  ['l_ankle', 'l_heel', 0.05], ['r_ankle', 'r_heel', 0.05],
  ['l_ankle', 'l_toe', 0.13], ['r_ankle', 'r_toe', 0.13],
];
// Own filming, or a clip under CC0 or CC BY (no NC, no ND, no share-alike: content stays CC BY 4.0, see CONTENT-LICENSE). A synthetic fixture
// source exists for tests and is refused unless the caller passes allowFixture.
export const SOURCES = ['own_filming', 'cc_licensed'];
export const FIXTURE_SOURCE = 'synthetic_fixture';
export const LICENCES = {
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
};
// A cc_licensed clip must come from Wikimedia Commons: an allowlist of exact hosts, so YouTube (whose terms forbid downloading),
// redirectors, look-alike hosts and other sites are all refused without a list of bad ones.
export const SOURCE_HOSTS = ['commons.wikimedia.org', 'upload.wikimedia.org'];
/** @returns an error message, or null when `u` is an https URL on an allowed host with no userinfo and no port */
export function checkSourceUrl(u) {
  if (typeof u !== 'string') return 'source_url must be an https URL on Wikimedia Commons for a cc_licensed clip';
  let url;
  try { url = new URL(u); } catch { return 'source_url must be a valid URL'; }
  if (url.protocol !== 'https:') return 'source_url must be https';
  if (url.username || url.password) return 'source_url must not carry a user name or password';
  if (url.port) return 'source_url must use the default port';
  if (!SOURCE_HOSTS.includes(url.hostname)) return `source_url host must be ${SOURCE_HOSTS.join(' or ')} (Wikimedia Commons only; YouTube and other sites are not accepted)`;
  return null;
}
const realDate = (s) => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
// Pose Landmarker model files whose licence was checked (Apache-2.0, tools/exercise-motion/README.md), by sha256.
export const PINNED_MODELS = {
  '4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad': 'pose_landmarker_full float16',
  '64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b': 'pose_landmarker_heavy float16',
};
export const MIN_FPS = 5;
export const MAX_FPS = 30;
export const MIN_FRAMES = 2;
export const MAX_COORD = 2;
export const MAX_ENTRY_BYTES = 8192;
export const BONE_TOLERANCE = 0.03;
export const FLOOR_TOLERANCE = 0.01;
const FIELDS = ['fps', 'loop', 'frames', 'source', 'source_id', 'source_url', 'retrieved', 'clip_id', 'release_id', 'licence', 'licence_url', 'author', 'author_url', 'tools', 'note'];
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
      // Floor rule: y = 0 is the lowest point of any joint over the whole clip.
      const minY = Math.min(...e.frames.flatMap((fr) => JOINTS.map((_, j) => fr[j * 3 + 1])));
      if (Math.abs(minY) > FLOOR_TOLERANCE) err(`the lowest point of the clip is y = ${minY.toFixed(3)}, expected 0 (within ${FLOOR_TOLERANCE})`);
      // A loop closes when the jump from the last frame back to the first is no bigger than the biggest jump inside it.
      if (e.loop === true) {
        const inner = Math.max(...e.frames.slice(1).map((f, k) => step(e.frames[k], f)));
        if (step(e.frames.at(-1), e.frames[0]) > inner * 1.25 + 0.005) err('loop does not close (the last frame is far from the first)');
      }
    }

    if (!sources.includes(e.source)) err(`source must be ${SOURCES.join(', ')} (other third-party video is not accepted)`);
    if (e.source !== FIXTURE_SOURCE && nonEmpty(e.tools)) {
      const sha = /\bsha256 ([0-9a-f]{64})\b/.exec(e.tools)?.[1];
      if (!sha || !Object.hasOwn(PINNED_MODELS, sha) || !e.tools.includes(PINNED_MODELS[sha])) err('tools must name a pinned pose model and its sha256 (as written by the pipeline)');
    }
    for (const f of ['source_id', 'clip_id', 'licence', 'author', 'tools']) if (f in e && !nonEmpty(e[f])) err(`${f} must be a non-empty string`);
    if (e.source === 'cc_licensed') {
      const urlError = checkSourceUrl(e.source_url);
      if (urlError) err(urlError);
      if (!realDate(e.retrieved)) err('retrieved must be the retrieval date, a real calendar date as YYYY-MM-DD');
      else if (e.retrieved > new Date().toISOString().slice(0, 10)) err('retrieved is in the future');
      if (e.release_id !== null && e.release_id !== undefined) err('release_id must be null for a cc_licensed clip (the licence is the permission)');
    } else {
      if ('release_id' in e && !nonEmpty(e.release_id)) err('release_id must be a non-empty string');
      for (const f of ['source_url', 'retrieved']) if (e[f] !== null && e[f] !== undefined) err(`${f} must be null unless the source is cc_licensed`);
    }
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
