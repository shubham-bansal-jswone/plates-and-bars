import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateExerciseMotion, JOINTS, BONES, SKELETON_ID, SOURCES, LICENCES, MAX_ENTRY_BYTES, BONE_TOLERANCE, FLOOR_TOLERANCE, MIN_FPS, MAX_FPS,
} from '../validate/exercise-motion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..');
const load = (f) => JSON.parse(readFileSync(`${repo}/content/${f}`, 'utf8'));
const names = Object.keys(load('exercises.json').tags);

// A rigid standing pose built from the bone table; the whole body bobs up and down so the loop closes.
const OFFSET = {
  spine_mid: [0, 0.686, 0], neck: [0, 0.836, 0], head: [0, 0.966, 0],
  l_shoulder: [0.12, 0.836, 0], r_shoulder: [-0.12, 0.836, 0],
  l_elbow: [0.12, 0.65, 0], r_elbow: [-0.12, 0.65, 0], l_wrist: [0.12, 0.504, 0], r_wrist: [-0.12, 0.504, 0],
  l_hip: [0.09, 0.53, 0], r_hip: [-0.09, 0.53, 0],
  l_knee: [0.09, 0.285, 0], r_knee: [-0.09, 0.285, 0], l_ankle: [0.09, 0.039, 0], r_ankle: [-0.09, 0.039, 0],
  l_heel: [0.09, 0, -0.032], r_heel: [-0.09, 0, -0.032], l_toe: [0.09, 0, 0.124], r_toe: [-0.09, 0, 0.124],
};
const frame = (k, n) => {
  const dy = 0.02 * (1 - Math.cos((2 * Math.PI * k) / n)); // bobs up from the floor, so the clip's lowest point stays at 0
  return JOINTS.flatMap((j) => [OFFSET[j][0], Math.round((OFFSET[j][1] + dy) * 1000) / 1000, OFFSET[j][2]]);
};
const goodEntry = () => ({
  fps: 10, loop: true, frames: Array.from({ length: 12 }, (_, k) => frame(k, 12)),
  source: 'own_filming', source_id: 'clip/bodyweight-squat-side-001', source_url: null, retrieved: null, clip_id: 'bodyweight-squat-side-001',
  release_id: 'release-2026-001', licence: 'CC-BY-4.0', licence_url: LICENCES['CC-BY-4.0'],
  author: 'Plate & Bar authors', author_url: null, tools: 'exercise-motion 1', note: null,
});
const good = () => ({ schema_version: 1, skeleton: SKELETON_ID, joints: [...JOINTS], motions: { 'Bodyweight Squat': goodEntry() } });
const check = (fn, opts) => { const c = good(); fn(c.motions['Bodyweight Squat'], c); return validateExerciseMotion(c, names, opts); };
const only = (errors, re) => { assert.equal(errors.length, 1, errors.join('\n')); assert.match(errors[0], re); };

test('the skeleton has the 19 fixed joint names (15 body joints and heels and toes) and an 18-bone tree over them', () => {
  assert.deepEqual(JOINTS, [
    'head', 'neck', 'l_shoulder', 'r_shoulder', 'l_elbow', 'r_elbow', 'l_wrist', 'r_wrist',
    'spine_mid', 'l_hip', 'r_hip', 'l_knee', 'r_knee', 'l_ankle', 'r_ankle', 'l_heel', 'r_heel', 'l_toe', 'r_toe',
  ]);
  assert.equal(BONES.length, 18);
  for (const [p, c, len] of BONES) { assert.ok(JOINTS.includes(p) && JOINTS.includes(c)); assert.ok(len > 0 && len < 0.5); }
  assert.equal(new Set(BONES.map((b) => b[1])).size, 18, 'every non-root joint has exactly one parent');
});

test('the committed bundle ships no entries and is valid; a complete example entry is valid', () => {
  const bundle = load('exercise-motion.json');
  assert.deepEqual(bundle.motions, {});
  assert.deepEqual(validateExerciseMotion(bundle, names), []);
  assert.deepEqual(validateExerciseMotion(good(), names), []);
});

test('the command line passes on the repository content', () => {
  const r = spawnSync(process.execPath, [`${here}/../validate/exercise-motion-cli.mjs`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /exercise-motion ok/);
});

test('the shared validator command runs the motion check too', () => {
  const r = spawnSync(process.execPath, [`${here}/../validate/cli.mjs`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /exercise motion ok/);
});

test('the JSON Schema agrees with the validator constants', () => {
  const s = JSON.parse(readFileSync(`${here}/../validate/schemas/exercise-motion.schema.json`, 'utf8'));
  assert.deepEqual(s.properties.joints.const, JOINTS);
  assert.equal(s.properties.skeleton.const, SKELETON_ID);
  const e = s.$defs.motion;
  assert.deepEqual(e.properties.source.enum, SOURCES);
  assert.deepEqual(e.properties.licence.enum, Object.keys(LICENCES));
  assert.equal(e.properties.fps.minimum, MIN_FPS);
  assert.equal(e.properties.fps.maximum, MAX_FPS);
  assert.equal(e.properties.frames.items.minItems, JOINTS.length * 3);
  assert.equal(e.properties.frames.items.maxItems, JOINTS.length * 3);
  assert.deepEqual([...e.required].sort(), [...Object.keys(e.properties)].sort());
  assert.equal(e['x-max-entry-bytes'], MAX_ENTRY_BYTES);
  assert.equal(e['x-bone-tolerance'], BONE_TOLERANCE);
  assert.equal(e['x-floor-tolerance'], FLOOR_TOLERANCE);
});

test('rejects a bad bundle header', () => {
  only(check((e, c) => { c.schema_version = 2; }), /schema_version must be 1/);
  only(check((e, c) => { c.skeleton = 'pb15-v1'; }), /skeleton must be pb19-v1/);
  only(check((e, c) => { c.joints = [...c.joints].reverse(); }), /joints must be/);
  only(check((e, c) => { c.extra = 1; }), /unknown top-level field "extra"/);
  assert.deepEqual(validateExerciseMotion([], names), ['bundle must be an object']);
});

test('rejects an unknown exercise, a missing or unknown field, a third-party source and a bad licence', () => {
  only(check((e, c) => { c.motions['Nonsense Lift'] = c.motions['Bodyweight Squat']; delete c.motions['Bodyweight Squat']; }), /no such exercise/);
  only(check((e) => { delete e.release_id; }), /field "release_id" missing/);
  only(check((e) => { e.video_url = 'https://example.com/v.mp4'; }), /unknown field "video_url"/);
  only(check((e) => { e.source = 'stock_video'; }), /source must be own_filming, cc_licensed/);
  only(check((e) => { e.licence = 'CC-BY-NC-4.0'; }), /not on the allowlist/);
  only(check((e) => { e.licence_url = 'https://example.com'; }), /licence_url must be/);
  only(check((e) => { e.release_id = ' '; }), /release_id must be a non-empty string/);
  only(check((e) => { e.author_url = 'http://x.test'; }), /author_url must be an https URL or null/);
});

test('rejects bad fps, loop flag and frame shape', () => {
  only(check((e) => { e.fps = 2; }), /fps must be an integer from 5 to 30/);
  only(check((e) => { e.fps = 12.5; }), /fps must be an integer/);
  only(check((e) => { e.loop = 'yes'; }), /loop must be true or false/);
  only(check((e) => { e.frames = [e.frames[0]]; }), /frames must be a list of at least 2/);
  only(check((e) => { e.frames[3] = e.frames[3].slice(0, 56); }), /frame 4: must hold 57 numbers/);
  only(check((e) => { e.frames[3][7] = null; }), /frame 4: must hold 57 numbers/);
  only(check((e) => { e.frames[3][1] = 9; }), /frame 4: coordinate out of range/);
});

test('rejects bone lengths that change, and an entry over the size cap', () => {
  const errs = check((e) => { e.frames[5][JOINTS.indexOf('l_wrist') * 3 + 1] += 0.1; });
  assert.ok(errs.some((m) => /frame 6: bone l_elbow-l_wrist is/.test(m)), errs.join('\n'));
  const big = check((e) => {
    e.frames = Array.from({ length: 40 }, (_, k) => frame(k, 40).map((v) => v + 0.123456789 * 0));
    e.frames = e.frames.map((f) => f.map((v, i) => Math.round((v + 0.0001 * ((i % 7) + 1)) * 1e6) / 1e6));
  });
  assert.ok(big.some((m) => /entry is \d+ bytes, the limit is 8192/.test(m)), big.join('\n'));
});

test('rejects a clip whose lowest point is not on the floor', () => {
  const lift = (dy) => (e) => { e.frames = e.frames.map((f) => f.map((v, i) => (i % 3 === 1 ? Math.round((v + dy) * 1000) / 1000 : v))); };
  assert.ok(check(lift(0.1)).some((m) => /lowest point of the clip is y = 0\.1\d\d, expected 0/.test(m)));
  assert.ok(check(lift(-0.05)).some((m) => /lowest point of the clip is y = -0\.0/.test(m)));
  assert.deepEqual(check(lift(0.005)), []);
});

test('rejects bone lengths that change in the new foot bones too', () => {
  const errs = check((e) => { e.frames[2][JOINTS.indexOf('l_toe') * 3 + 2] += 0.1; });
  assert.ok(errs.some((m) => /frame 3: bone l_ankle-l_toe is/.test(m)), errs.join('\n'));
});

test('rejects a loop that does not close, but accepts the same frames as a non-loop', () => {
  const jump = (e) => { for (let k = 6; k < 12; k++) e.frames[k] = e.frames[k].map((v, i) => (i % 3 === 0 ? v + 0.15 * (k - 5) : v)); };
  const errs = check((e) => { jump(e); });
  assert.ok(errs.some((m) => /loop does not close/.test(m)), errs.join('\n'));
  assert.deepEqual(check((e) => { jump(e); e.loop = false; }), []);
});

test('rejects duplicate clip and source ids', () => {
  const c = good();
  c.motions['Goblet Squat'] = goodEntry();
  const errs = validateExerciseMotion(c, names);
  assert.ok(errs.some((m) => /duplicate source_id/.test(m)));
  assert.ok(errs.some((m) => /duplicate clip_id/.test(m)));
});

const cc = (e) => Object.assign(e, {
  source: 'cc_licensed', source_id: 'commons/File_Bodyweight_squat.webm', source_url: 'https://commons.wikimedia.org/wiki/File:Bodyweight_squat.webm',
  retrieved: '2026-10-20', clip_id: 'File_Bodyweight_squat.webm', release_id: null, licence: 'CC-BY-4.0', licence_url: LICENCES['CC-BY-4.0'],
  author: 'Jane Example, CC BY 4.0, via Wikimedia Commons',
});

test('a cc_licensed entry needs source_url, retrieval date and attribution, and takes no release id', () => {
  assert.deepEqual(check(cc), []);
  for (const l of ['CC0-1.0']) assert.deepEqual(check((e) => { cc(e); e.licence = l; e.licence_url = LICENCES[l]; }), []);
  assert.ok(check((e) => { cc(e); delete e.source_url; }).some((m) => /field "source_url" missing/.test(m)));
  only(check((e) => { cc(e); e.source_url = null; }), /source_url must be an https URL for a cc_licensed clip/);
  only(check((e) => { cc(e); e.retrieved = null; }), /retrieved must be the retrieval date/);
  only(check((e) => { cc(e); e.retrieved = '20 Oct 2026'; }), /retrieved must be the retrieval date/);
  only(check((e) => { cc(e); e.author = ' '; }), /author must be a non-empty string/);
  only(check((e) => { cc(e); e.release_id = 'rel-1'; }), /release_id must be null for a cc_licensed clip/);
});

test('NC and ND licences are rejected, and so is YouTube', () => {
  for (const l of ['CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'CC-BY-NC-SA-4.0', 'CC-BY-NC-ND-4.0', 'CC-BY-SA-4.0', 'CC-BY-SA-3.0']) {
    only(check((e) => { cc(e); e.licence = l; e.licence_url = `https://creativecommons.org/licenses/${l.toLowerCase()}/`; }), /not on the allowlist/);
  }
  for (const u of ['https://www.youtube.com/watch?v=abc', 'https://youtu.be/abc', 'https://m.youtube.com/watch?v=abc']) {
    only(check((e) => { cc(e); e.source_url = u; }), /YouTube/);
  }
});

test('an own_filming entry needs a release id and takes no source_url or retrieval date', () => {
  only(check((e) => { e.release_id = null; }), /release_id must be a non-empty string/);
  only(check((e) => { e.source_url = 'https://example.com/x'; }), /source_url must be null unless the source is cc_licensed/);
  only(check((e) => { e.retrieved = '2026-10-20'; }), /retrieved must be null unless/);
});

test('a synthetic fixture source is accepted only when the caller asks for it', () => {
  const fixture = (e) => { e.source = 'synthetic_fixture'; };
  only(check(fixture), /source must be own_filming, cc_licensed/);
  assert.deepEqual(check(fixture, { allowFixture: true }), []);
});
