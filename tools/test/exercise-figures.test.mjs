import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { AN } from '../exercise-figures/rig.mjs';
import { buildBundle, renderFrame, serialize, slug, COLOURS } from '../exercise-figures/generate.mjs';
import { validateExerciseImages, MAX_FRAME_BYTES } from '../validate/exercise-images.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const names = Object.keys(JSON.parse(readFileSync(`${repo}/content/exercises.json`, 'utf8')).tags);
const committed = readFileSync(`${repo}/content/exercise-images.json`, 'utf8');
const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');

test('the rig has the 31 prototype poses and every one is an exercise in the app', () => {
  assert.equal(AN.names.length, 31);
  for (const n of AN.names) assert.ok(names.includes(n), `${n} is not in exercises.json`);
  assert.deepEqual(Object.keys(buildBundle(names).images).sort(), [...AN.names].sort());
});

test('the ported rig draws exactly what the prototype rig draws, for every pose', () => {
  const start = html.indexOf('const AN = (() => {');
  const end = html.indexOf('\n})();', start) + '\n})();'.length;
  assert.ok(start > 0 && end > start);
  const proto = vm.runInNewContext(`${html.slice(start, end)}; AN`, {});
  assert.deepEqual([...proto.names], AN.names);
  const C = { body: 'B', arm: 'A', hl: 'H', eq: 'E', bg: 'G' };
  for (const n of AN.names) for (const k of [0, 0.25, 0.5, 1]) assert.equal(AN.frame(n, k, C), proto.frame(n, k, C), `${n} at ${k}`);
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
  assert.equal(sizes.length, 62);
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

test('start and end frames differ, and each entry credits Plate & Bar under CC BY 4.0', () => {
  for (const [name, im] of Object.entries(JSON.parse(committed).images)) {
    assert.equal(im.frames.length, 2, name);
    assert.notEqual(im.frames[0].svg, im.frames[1].svg, `${name}: start equals end`);
    assert.deepEqual([im.source, im.licence, im.author], ['own_drawing', 'CC-BY-4.0', 'Plate & Bar authors']);
    assert.equal(im.source_id, `rig-v1/${slug(name)}`);
  }
});

test('slugs are unique and the frame is a viewBox-only svg', () => {
  assert.equal(new Set(AN.names.map(slug)).size, AN.names.length);
  assert.equal(slug('Plank (seconds)'), 'plank-seconds');
  assert.match(renderFrame('Lat Pulldown', 0), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 320 240">.*<\/svg>$/);
  assert.doesNotMatch(renderFrame('Lat Pulldown', 0), /\.0"/);
});
