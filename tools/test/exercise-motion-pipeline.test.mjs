import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPipeline, runPipelineFit, DEFAULTS, savitzkyGolay, PipelineError, PINNED_MODELS } from '../exercise-motion/pipeline.mjs';
import { buildFixture, serializeFixture } from '../exercise-motion/make-fixture.mjs';
import { validateExerciseMotion, JOINTS, BONES, BONE_TOLERANCE } from '../validate/exercise-motion.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const tools = resolve(here, '..');
const repo = resolve(tools, '..');
const fx = (f) => `${tools}/exercise-motion/fixtures/${f}`;
const landmarks = () => JSON.parse(readFileSync(fx('squat-synthetic.landmarks.json'), 'utf8'));
const names = Object.keys(JSON.parse(readFileSync(`${repo}/content/exercises.json`, 'utf8')).tags);
const PROV = {
  source: 'synthetic_fixture', source_id: 'fixture/squat-synthetic', clip_id: 'fixture-squat-synthetic', release_id: 'none-synthetic',
  licence: 'CC0-1.0', author: 'Plate & Bar authors', note: 'Synthetic fixture, not a person.',
};
const run = (input = landmarks(), options = {}) => runPipeline(input, { ...PROV, ...options });
const J = (name) => JOINTS.indexOf(name) * 3;
const dist = (f, a, b) => Math.hypot(f[J(a)] - f[J(b)], f[J(a) + 1] - f[J(b) + 1], f[J(a) + 2] - f[J(b) + 2]);

test('the committed fixture is what the generator writes (so it can be regenerated, never edited)', () => {
  assert.equal(readFileSync(fx('squat-synthetic.landmarks.json'), 'utf8'), serializeFixture(buildFixture()));
});

test('output matches the schema validator', () => {
  const entry = run();
  const bundle = { schema_version: 1, skeleton: 'pb19-v1', joints: [...JOINTS], motions: { 'Bodyweight Squat': entry } };
  assert.deepEqual(validateExerciseMotion(bundle, names, { allowFixture: true }), []);
  assert.equal(entry.loop, true);
  assert.equal(entry.fps, DEFAULTS.outputFps);
  assert.ok(JSON.stringify(entry).length <= 8192);
});

test('output is deterministic and equals the golden file', () => {
  const a = JSON.stringify(run());
  assert.equal(a, JSON.stringify(run()));
  const golden = JSON.parse(readFileSync(fx('squat-synthetic.motion.json'), 'utf8'));
  assert.equal(a, JSON.stringify(golden.motions['Bodyweight Squat']));
});

test('bone lengths are constant in every frame', () => {
  for (const f of run().frames) for (const [p, c, len] of BONES) {
    assert.ok(Math.abs(dist(f, p, c) - len) / len <= BONE_TOLERANCE, `${p}-${c}`);
  }
});

test('the figure is normalised: feet on the floor, ankles centred, body about one unit tall, left on +x', () => {
  const { frames } = run();
  const lowest = Math.min(...frames.flatMap((f) => JOINTS.map((j) => f[J(j) + 1])));
  assert.ok(Math.abs(lowest) < 0.01, `lowest joint y ${lowest}`);
  for (const f of frames) {
    const foot = Math.min(...['l_heel', 'r_heel', 'l_toe', 'r_toe'].map((j) => f[J(j) + 1]));
    assert.ok(foot < 0.01, 'a foot point is on the floor in every frame');
    assert.ok(Math.abs((f[J('l_ankle')] + f[J('r_ankle')]) / 2) < 0.01 && Math.abs((f[J('l_ankle') + 2] + f[J('r_ankle') + 2]) / 2) < 0.01);
    assert.ok(f[J('l_toe') + 2] - f[J('l_heel') + 2] > 0.1, 'toes point forward of the heels');
  }
  for (const f of frames) {
    assert.ok(f[J('head') + 1] < 1.1 && f[J('head') + 1] > 0.5);
    assert.ok(f[J('l_hip')] > f[J('r_hip')], 'left hip is on +x');
  }
  const top = Math.max(...frames.map((f) => f[J('head') + 1]));
  assert.ok(top > 0.9 && top < 1.05, `standing head height ${top}`);
});

test('the squat actually moves: hips go down by a believable amount and come back', () => {
  const { frames } = run();
  const hip = frames.map((f) => (f[J('l_hip') + 1] + f[J('r_hip') + 1]) / 2);
  assert.ok(Math.max(...hip) - Math.min(...hip) > 0.15);
  assert.ok(Math.abs(hip[0] - hip.at(-1)) < 0.06);
});

test('the loop closes: the step from last to first is no bigger than the biggest step inside', () => {
  const { frames } = run();
  const step = (a, b) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  const inner = Math.max(...frames.slice(1).map((f, k) => step(frames[k], f)));
  assert.ok(step(frames.at(-1), frames[0]) <= inner * 1.1);
});

test('the clip is trimmed to one repetition', () => {
  const entry = run();
  const seconds = entry.frames.length / entry.fps;
  assert.ok(seconds > 1.6 && seconds < 2.4, `loop lasts ${seconds}s (fixture rep is 2.0 s)`);
});

test('the same input from a different camera angle gives the same motion (yaw is removed)', () => {
  const a = run(buildFixture({ yawDeg: 35 }));
  const b = run(buildFixture({ yawDeg: 90 }));
  assert.equal(a.frames.length, b.frames.length);
  const worst = Math.max(...a.frames.flatMap((f, k) => f.map((v, i) => Math.abs(v - b.frames[k][i]))));
  assert.ok(worst < 0.03, `max difference ${worst}`);
});

test('smoothing reduces noise and keeps a clean signal', () => {
  const sg = savitzkyGolay(Array.from({ length: 21 }, (_, i) => 0.5 * i * i - 3 * i + 2), 7, 2);
  sg.forEach((v, i) => assert.ok(Math.abs(v - (0.5 * i * i - 3 * i + 2)) < 1e-9, 'a quadratic passes through unchanged'));
  const clean = Array.from({ length: 41 }, (_, i) => Math.sin(i / 6));
  const noisy = clean.map((v, i) => v + (i % 2 ? 0.1 : -0.1));
  const out = savitzkyGolay(noisy, 7, 2);
  const rms = (a) => Math.sqrt(a.reduce((s, v, i) => s + (v - clean[i]) ** 2, 0) / a.length);
  assert.ok(rms(out) < rms(noisy) * 0.3, `error ${rms(out)} against ${rms(noisy)}`);
});

test('a short low-visibility gap is filled; the fixture contains one', () => {
  const input = landmarks();
  const bad = input.frames.filter((fr) => fr && fr.some((l) => l[3] < DEFAULTS.minVisibility));
  assert.ok(bad.length >= 2, 'the fixture has a visibility gap');
  assert.ok(run(input).frames.every((f) => f.every(Number.isFinite)));
  // The gap carries garbage coordinates; if they leaked into the output the left wrist would jump.
  const w = run(input).frames.map((f) => f[J('l_wrist') + 1]);
  const jump = Math.max(...w.slice(1).map((v, i) => Math.abs(v - w[i])));
  assert.ok(jump < 0.15, `left wrist jumps ${jump}`);
});

test('a missing frame (no detection) inside the clip counts as a gap and is filled', () => {
  const input = landmarks();
  input.frames[10] = null;
  input.frames[11] = null;
  assert.ok(run(input).frames.every((f) => f.every(Number.isFinite)));
});

test('a gap longer than the limit is rejected, not invented', () => {
  const input = landmarks();
  for (let k = 8; k < 8 + DEFAULTS.maxGapFrames + 1; k++) input.frames[k] = null;
  assert.throws(() => run(input), (e) => e instanceof PipelineError && /gap of \d+ frames/.test(e.message));
});

test('bad frames at the ends are trimmed, and a mostly invisible clip is rejected', () => {
  const input = landmarks();
  input.frames[0] = null;
  input.frames[1] = null;
  assert.ok(run(input).frames.length > 5);
  const dark = landmarks();
  dark.frames = dark.frames.map((fr, k) => (k % 3 === 0 ? fr : null));
  assert.throws(() => run(dark), PipelineError);
});

test('an entry over the size cap steps the fps down and says which fps it chose', () => {
  const long = buildFixture({ repSeconds: 3.4, seconds: 5.6 });
  assert.ok(JSON.stringify(run(long).frames).length > 8192, 'a 3.4 s loop at 10 fps does not fit');
  const { entry, requestedFps } = runPipelineFit(long, { ...PROV });
  assert.equal(requestedFps, 10);
  assert.ok(entry.fps < 10 && entry.fps >= 5, `chose ${entry.fps} fps`);
  assert.ok(Buffer.byteLength(JSON.stringify(entry)) <= 8192);
  assert.equal(runPipelineFit(landmarks(), { ...PROV }).entry.fps, 10, 'a loop that fits keeps the requested fps');
});

test('a loop that does not fit even at 5 fps fails and names the longest that does', () => {
  assert.throws(() => runPipelineFit(buildFixture({ repSeconds: 8, seconds: 13 }), { ...PROV }),
    (e) => e instanceof PipelineError && /even at 5 fps; the longest that fits is about \d+\.\d s/.test(e.message));
});

test('tools is built from the model block; no block or an unpinned model is refused unless the source is the fixture', () => {
  const sha = Object.keys(PINNED_MODELS)[0];
  const own = { ...PROV, source: 'own_filming', licence: 'CC-BY-4.0' };
  const withModel = { ...landmarks(), model: { name: 'whatever the file says', sha256: sha, mediapipe: '1.1.1' } };
  const entry = runPipeline(withModel, own);
  assert.match(entry.tools, new RegExp(`pose_landmarker_full float16 sha256 ${sha}; mediapipe 1\\.1\\.1`));
  assert.equal(entry.source, 'own_filming');
  assert.throws(() => runPipeline(landmarks(), own), /no model block/);
  assert.throws(() => runPipeline({ ...landmarks(), model: { name: 'x', sha256: 'ab'.repeat(32) } }, own), /not one we have checked the licence of/);
  assert.match(run().tools, /synthetic fixture, no model/);
});

test('a cc_licensed clip goes through with its source details and no release id (the CLI insists on them)', () => {
  const sha = Object.keys(PINNED_MODELS)[0];
  const input = { ...landmarks(), model: { name: 'x', sha256: sha, mediapipe: '1.1.1' } };
  const entry = runPipeline(input, { ...PROV, source: 'cc_licensed', release_id: null, licence: 'CC-BY-SA-4.0', source_url: 'https://commons.wikimedia.org/wiki/File:X.webm', retrieved: '2026-10-20' });
  assert.equal(entry.release_id, null);
  assert.equal(entry.licence_url, 'https://creativecommons.org/licenses/by-sa/4.0/');
  const bundle = { schema_version: 1, skeleton: 'pb19-v1', joints: [...JOINTS], motions: { 'Bodyweight Squat': entry } };
  assert.deepEqual(validateExerciseMotion(bundle, names), []);
  const dir = mkdtempSync(join(tmpdir(), 'motion-cc-'));
  const file = join(dir, 'in.json');
  writeFileSync(file, JSON.stringify(input));
  const base = [`${tools}/exercise-motion/cli.mjs`, file, '--exercise', 'Bodyweight Squat', '--source', 'cc_licensed', '--clip-id', 'X.webm', '--author', 'Jane, CC BY-SA 4.0', '--out', join(dir, 'o.json')];
  const missing = spawnSync(process.execPath, base, { encoding: 'utf8' });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--source-url is required for cc_licensed/);
  const ok = spawnSync(process.execPath, [...base, '--source-url', 'https://commons.wikimedia.org/wiki/File:X.webm', '--retrieved', '2026-10-20', '--licence', 'CC-BY-SA-4.0'], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  const nc = spawnSync(process.execPath, [...base, '--source-url', 'https://commons.wikimedia.org/wiki/File:X.webm', '--retrieved', '2026-10-20', '--licence', 'CC-BY-NC-4.0'], { encoding: 'utf8' });
  assert.notEqual(nc.status, 0);
  assert.match(nc.stderr, /not on the allowlist/);
});

test('rejects input that is not a MediaPipe world-landmark file, or too short, or with no repetition', () => {
  assert.throws(() => run({ format: 'other' }), /format must be mediapipe-world-landmarks-v1/);
  const short = landmarks();
  short.frames = short.frames.slice(0, 5);
  assert.throws(() => run(short), PipelineError);
  const still = landmarks();
  still.frames = still.frames.map((_, k) => still.frames[0]);
  assert.throws(() => run(still), /no repetition found|no movement/);
  const missing = landmarks();
  missing.indices = missing.indices.filter((i) => i !== 25);
  missing.frames = missing.frames.map((f) => f && f.filter((_, k) => landmarks().indices[k] !== 25));
  assert.throws(() => run(missing), /landmark 25/);
});

test('non-looping output keeps the whole clip', () => {
  const entry = run(landmarks(), { loop: false });
  assert.equal(entry.loop, false);
  assert.ok(entry.frames.length > run().frames.length);
});

test('the command line writes a bundle the validator accepts and can merge into a content file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'motion-'));
  const out = join(dir, 'out.json');
  const args = [`${tools}/exercise-motion/cli.mjs`, fx('squat-synthetic.landmarks.json'), '--exercise', 'Bodyweight Squat',
    '--source', 'synthetic_fixture', '--source-id', PROV.source_id, '--clip-id', PROV.clip_id, '--release-id', PROV.release_id,
    '--licence', 'CC0-1.0', '--author', PROV.author, '--note', PROV.note, '--out', out];
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const golden = readFileSync(fx('squat-synthetic.motion.json'), 'utf8');
  assert.equal(readFileSync(out, 'utf8'), golden);

  const target = join(dir, 'exercise-motion.json');
  writeFileSync(target, readFileSync(`${repo}/content/exercise-motion.json`, 'utf8'));
  const filmed = join(dir, 'filmed.json');
  writeFileSync(filmed, JSON.stringify({ ...landmarks(), model: { name: 'x', sha256: Object.keys(PINNED_MODELS)[0], mediapipe: '1.1.1' } }));
  const real = ['--source', 'own_filming', '--source-id', 'clip/real-1', '--clip-id', 'real-1', '--release-id', 'rel-1', '--licence', 'CC-BY-4.0'];
  const m = spawnSync(process.execPath, [`${tools}/exercise-motion/cli.mjs`, filmed, '--exercise', 'Bodyweight Squat', ...real,
    '--author', PROV.author, '--merge', target], { encoding: 'utf8' });
  assert.equal(m.status, 0, m.stderr);
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(target, 'utf8')).motions), ['Bodyweight Squat']);

  const into = spawnSync(process.execPath, [...args.slice(0, -2), '--merge', join(dir, 'never.json')], { encoding: 'utf8' });
  assert.notEqual(into.status, 0);
  assert.match(into.stderr, /synthetic_fixture is only for --out/);
  const bad = spawnSync(process.execPath, args.map((a) => (a === 'Bodyweight Squat' ? 'Nonsense Lift' : a)), { encoding: 'utf8' });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /no such exercise/);
});
