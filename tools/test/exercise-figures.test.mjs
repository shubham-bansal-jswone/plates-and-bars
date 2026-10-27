import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { AN } from '../exercise-figures/rig.mjs';
import { buildBundle, renderFrame, serialize, slug, COLOURS, ISOMETRIC } from '../exercise-figures/generate.mjs';
import { validateExerciseImages, MAX_FRAME_BYTES } from '../validate/exercise-images.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const names = Object.keys(JSON.parse(readFileSync(`${repo}/content/exercises.json`, 'utf8')).tags);
const committed = readFileSync(`${repo}/content/exercise-images.json`, 'utf8');
const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');

test('the rig has the 31 prototype poses plus batches 2, 3 and 4 (12 poses each) and Dead Bug and every one is an exercise in the app', () => {
  assert.equal(AN.names.length, 68);
  for (const n of AN.names) assert.ok(names.includes(n), `${n} is not in exercises.json`);
  assert.deepEqual(Object.keys(buildBundle(names).images).sort(), [...AN.names].sort());
});

test('the ported rig draws exactly what the prototype rig draws, for every pose', () => {
  const start = html.indexOf('const AN = (() => {');
  const end = html.indexOf('\n})();', start) + '\n})();'.length;
  assert.ok(start > 0 && end > start);
  const proto = vm.runInNewContext(`${html.slice(start, end)}; AN`, {});
  assert.equal(proto.names.length, 31);
  assert.deepEqual(AN.names.slice(0, 31), [...proto.names]); // batch 2 poses are appended after the prototype's
  const C = { body: 'B', arm: 'A', hl: 'H', eq: 'E', bg: 'G' };
  for (const n of proto.names) for (const k of [0, 0.25, 0.5, 1]) assert.equal(AN.frame(n, k, C), proto.frame(n, k, C), `${n} at ${k}`);
});

test('output is deterministic: two builds and the committed bundle are byte-identical', () => {
  assert.equal(serialize(buildBundle(names)), serialize(buildBundle(names)));
  assert.equal(committed, serialize(buildBundle(names)));
  const r = spawnSync(process.execPath, [`${repo}/tools/exercise-figures/cli.mjs`, '--check'], { encoding: 'utf8', env: { ...process.env, TZ: 'Pacific/Kiritimati' } });
  assert.equal(r.status, 0, r.stderr);
});

test('the bundle passes the validator and every frame is well inside the size limit', () => {
  const bundle = JSON.parse(committed);
  assert.deepEqual(validateExerciseImages(bundle, names), []);
  const sizes = Object.values(bundle.images).flatMap((i) => i.frames.map((f) => Buffer.byteLength(f.svg)));
  assert.equal(sizes.length, 133); // 65 exercises with two frames, the three isometric holds with one
  assert.ok(Math.max(...sizes) <= 4096, `largest frame ${Math.max(...sizes)} bytes`);
  assert.ok(Math.max(...sizes) < MAX_FRAME_BYTES);
  assert.ok(Math.min(...sizes) > 500, 'a frame this small is probably empty');
});

test('no colour is baked in: only currentColor and var(--fig-*) tokens', () => {
  for (const [name, im] of Object.entries(JSON.parse(committed).images)) for (const f of im.frames) {
    assert.doesNotMatch(f.svg, /#[0-9a-f]{3,8}\b|rgb\(|hsl\(/i, name);
    const used = new Set([...f.svg.matchAll(/(?:fill|stroke)="([^"]*)"/g)].map((m) => m[1]));
    for (const v of used) assert.ok(['none', 'currentColor', ...Object.values(COLOURS)].includes(v), `${name}: ${v}`);
  }
});

// Isometric holds have one static frame, used for both start and end (#653 decision). Every entry must be a timed
// exercise in the catalogue (meta type "time"), so the list cannot drift to cover a moving exercise.
const isometricProblems = (list, meta) => list.flatMap((n) => !meta[n] ? [`${n}: not in the catalogue`] : meta[n].type !== 'time' ? [`${n}: catalogue type is "${meta[n].type}", not "time"`] : []);
const catalogueMeta = JSON.parse(readFileSync(`${repo}/content/exercises.json`, 'utf8')).meta;

test('the isometric allowlist only holds timed exercises of the catalogue', () => {
  assert.deepEqual(isometricProblems(ISOMETRIC, catalogueMeta), []);
  assert.equal(new Set(ISOMETRIC).size, ISOMETRIC.length);
  // the check bites: a moving exercise, or a name the catalogue does not have, is reported
  assert.equal(isometricProblems([...ISOMETRIC, 'Barbell Bench Press'], catalogueMeta).length, 1);
  assert.equal(isometricProblems(['Not An Exercise'], catalogueMeta).length, 1);
});

test('start and end frames differ (except the isometric allowlist, which has one static frame), and each entry credits Plate & Bar under CC BY 4.0', () => {
  for (const [name, im] of Object.entries(JSON.parse(committed).images)) {
    if (ISOMETRIC.includes(name)) {
      assert.equal(im.frames.length, 1, `${name}: an isometric hold has one static frame`);
      assert.equal(renderFrame(name, 0), renderFrame(name, 1), `${name}: the pose must not change between start and end`);
    } else {
      assert.equal(im.frames.length, 2, name);
      assert.notEqual(im.frames[0].svg, im.frames[1].svg, `${name}: start equals end (add it to ISOMETRIC only if it is a timed hold)`);
    }
    assert.deepEqual([im.source, im.licence, im.author], ['own_drawing', 'CC-BY-4.0', 'Plate & Bar authors']);
    assert.equal(im.source_id, `rig-v1/${slug(name)}`);
  }
});

test('every coordinate has at most one decimal (props the rig prints at full precision are rounded)', () => {
  for (const [name, im] of Object.entries(JSON.parse(committed).images)) for (const f of im.frames) {
    assert.doesNotMatch(f.svg, /\d\.\d{2,}/, name);
    assert.doesNotMatch(f.svg, /-0(?=["\s])/, name);
  }
});

test('slugs are unique and the frame is a viewBox-only svg', () => {
  assert.equal(new Set(AN.names.map(slug)).size, AN.names.length);
  assert.equal(slug('Plank (seconds)'), 'plank-seconds');
  assert.match(renderFrame('Lat Pulldown', 0), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 320 240">.*<\/svg>$/);
  assert.doesNotMatch(renderFrame('Lat Pulldown', 0), /\.0"/);
});

test('new poses keep every drawn segment at the rig length in both frames (no stretched limbs)', () => {
  const LEN = { ua: 36, fa: 32, th: 50, sh: 48, torso: 70 }, TOL = 1;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  for (const n of AN.names.slice(31)) for (const k of [0, 1]) {
    const j = AN.joints(n, k);
    if (!j) continue; // front-view poses use fixed lengths
    const { J, uaS } = j;
    const got = { ua: d(J.sh, J.el), fa: d(J.el, J.wr), th: d(J.hip, J.knee), sh: d(J.knee, J.ankle), torso: d(J.hip, J.sh) };
    const want = { ...LEN, ua: LEN.ua * uaS };
    for (const s of Object.keys(LEN)) assert.ok(Math.abs(got[s] - want[s]) <= TOL, `${n} k=${k}: ${s} is ${got[s].toFixed(1)}, rig length ${want[s]}`);
  }
});

test('rear and free legs drawn in props are reachable and keep rig length; split squats and lunges stay planted', () => {
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const withRear = AN.names.filter((n) => AN.joints(n, 0)?.rear);
  const planted = AN.names.filter((n) => /split squat|walking lunge/i.test(n));
  assert.equal(planted.length, 4);
  for (const n of planted) assert.ok(withRear.includes(n), n);
  for (const n of ['Single-Leg Glute Bridge', 'Single-Leg Calf Raise', 'Single-Leg Balance (seconds)']) assert.ok(withRear.includes(n), n);
  for (const n of withRear) {
    const toes = [0, 1].map((k) => {
      const j = AN.joints(n, k);
      assert.ok(j && j.rear, `${n}: rear leg must come from joints() (ik or a fixed angle), not hand-placed points`);
      const [hip, knee, foot, toe] = j.rear;
      assert.ok(d(hip, foot) <= 98.01, `${n} k=${k}: rear foot out of reach (${d(hip, foot).toFixed(1)})`);
      assert.ok(Math.abs(d(hip, knee) - 50) <= 1, `${n} k=${k}: rear thigh is ${d(hip, knee).toFixed(1)}`);
      assert.ok(Math.abs(d(knee, foot) - 48) <= 1, `${n} k=${k}: rear shin is ${d(knee, foot).toFixed(1)}`);
      return toe || foot; // the walking lunge keeps its rear toe down and lifts the heel
    });
    if (planted.includes(n)) assert.deepEqual(toes[0], toes[1], `${n}: rear foot slides between frames`);
  }
});
