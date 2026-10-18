import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validateExerciseImages, SOURCES, LICENCES, MAX_FRAME_BYTES, MAX_ALT,
} from '../validate/exercise-images.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (f) => JSON.parse(readFileSync(`${repo}/content/${f}`, 'utf8'));
const names = Object.keys(load('exercises.json').tags);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240"><line x1="1" y1="2" x2="3" y2="4" stroke="currentColor" stroke-width="5"/><circle cx="9" cy="9" r="4" fill="var(--fig-bg)" stroke="var(--fig-body)"/></svg>';
const SVG_B = SVG.replace('x2="3"', 'x2="30"');

const good = () => ({
  schema_version: 1,
  images: {
    'Barbell Bench Press': {
      frames: [
        { file: 'svg/barbell-bench-press-a.svg', w: 320, h: 240, svg: SVG },
        { file: 'svg/barbell-bench-press-b.svg', w: 320, h: 240, svg: SVG_B },
      ],
      source: 'own_drawing', source_id: 'rig-v1/barbell-bench-press', licence: 'CC-BY-4.0',
      licence_url: LICENCES['CC-BY-4.0'], author: 'Plate & Bar authors', author_url: null, source_url: null,
      changes: null, alt: null, note: null,
    },
  },
});
const check = (fn) => { const c = good(); fn(c.images['Barbell Bench Press'], c); return validateExerciseImages(c, names); };
const only = (errors, re) => { assert.equal(errors.length, 1, errors.join('\n')); assert.match(errors[0], re); };

test('the shipped bundle and an example entry are valid', () => {
  assert.deepEqual(validateExerciseImages(load('exercise-images.json'), names), []);
  assert.deepEqual(validateExerciseImages(good(), names), []);
});

test('the command line passes on the repository content', () => {
  const r = spawnSync(process.execPath, [`${repo}/tools/validate/exercise-images-cli.mjs`], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /exercise-images ok/);
});

test('licence must be on the allowlist and its url must match', () => {
  only(check((i) => { i.licence = 'CC-BY-SA-3.0'; }), /not on the allowlist/);
  only(check((i) => { i.licence = 'All rights reserved'; }), /not on the allowlist/);
  only(check((i) => { i.licence_url = 'https://example.com/'; }), /licence_url must be/);
  assert.deepEqual(check((i) => { i.licence = 'CC0-1.0'; i.licence_url = LICENCES['CC0-1.0']; }), []);
});

test('third-party sources are refused for want of an allowed licence, and need links', () => {
  const third = (i) => { i.source = 'wger'; i.licence = 'CC-BY-SA-4.0'; i.licence_url = 'https://creativecommons.org/licenses/by-sa/4.0/'; };
  assert.ok(check(third).some((e) => /not on the allowlist/.test(e)));
  assert.ok(check((i) => { i.source = 'wikimedia_commons'; }).some((e) => /source_url/.test(e)));
  only(check((i) => { i.source = 'flickr'; }), /source must be one of/);
});

test('source, source_id, licence and author are required and non-blank', () => {
  for (const f of ['source_id', 'licence', 'author']) {
    assert.ok(check((i) => { i[f] = ''; }).some((e) => e.includes(f)), f);
    assert.ok(check((i) => { i[f] = '   '; }).some((e) => e.includes(f)), f);
    assert.ok(check((i) => { delete i[f]; }).some((e) => e.includes(`"${f}" missing`)), f);
  }
  assert.ok(check((i) => { delete i.source; }).some((e) => /"source" missing/.test(e)));
});

test('unknown fields are refused, so no AI-generated flag can slip in', () => {
  assert.ok(check((i) => { i.is_ai_generated = true; }).some((e) => /unknown field "is_ai_generated"/.test(e)));
  assert.ok(validateExerciseImages({ ...good(), extra: 1 }, names).some((e) => /unknown top-level/.test(e)));
});

test('every key must be an exercise in exercises.json', () => {
  const c = good();
  c.images['Not An Exercise'] = c.images['Barbell Bench Press'];
  const e = validateExerciseImages(c, names);
  assert.ok(e.some((m) => m.startsWith('Not An Exercise: no such exercise')));
});

test('frame size, count and dimensions are limited', () => {
  const big = SVG.replace('</svg>', `<!--${'x'.repeat(MAX_FRAME_BYTES)}--></svg>`);
  assert.ok(check((i) => { i.frames[0].svg = big; }).some((e) => /bytes, the limit is 8192/.test(e)));
  const edge = SVG.replace('</svg>', `${' '.repeat(MAX_FRAME_BYTES - SVG.length)}</svg>`.slice(0, -6) + '</svg>');
  assert.equal(Buffer.byteLength(edge), MAX_FRAME_BYTES);
  assert.deepEqual(check((i) => { i.frames[0].svg = edge; }), []);
  assert.ok(check((i) => { i.frames.push({ ...i.frames[0], file: 'svg/c.svg', svg: SVG.replace('x2="3"', 'x2="31"') }); }).some((e) => /1 to 2 frames/.test(e)));
  assert.ok(check((i) => { i.frames = []; }).some((e) => /1 to 2 frames/.test(e)));
  assert.ok(check((i) => { i.frames[0].w = 5000; i.frames[0].svg = SVG.replace('0 0 320 240', '0 0 5000 240'); }).some((e) => /w must be an integer/.test(e)));
  assert.ok(check((i) => { i.frames[0].h = 0; }).some((e) => /h must be an integer/.test(e)));
  assert.ok(check((i) => { i.frames[0].w = 300; }).some((e) => /viewBox must be "0 0 300 240"/.test(e)));
});

test('one frame is allowed for moves without an end pose', () => {
  assert.deepEqual(check((i) => { i.frames.pop(); }), []);
});

test('no colour may be baked into the SVG', () => {
  for (const bad of ['#ff0000', 'red', 'rgb(0,0,0)', 'var(--other)', 'url(#g)']) {
    assert.ok(check((i) => { i.frames[0].svg = SVG.replace('stroke="currentColor"', `stroke="${bad}"`); }).some((e) => /bakes in a colour/.test(e)), bad);
  }
  assert.ok(check((i) => { i.frames[0].svg = SVG.replace(' fill="var(--fig-bg)"', ' fill="#fff"'); }).some((e) => /bakes in a colour: fill="#fff"/.test(e)));
});

test('scripts, links, styles and classes are refused', () => {
  for (const bad of ['<script>1</script>', '<foreignObject/>', '<image/>', '<a/>', '<use/>', '<circle onclick="x()"/>', '<circle href="x"/>', '<circle style="fill:red"/>', '<circle class="a"/>']) {
    assert.ok(check((i) => { i.frames[0].svg = SVG.replace('</svg>', `${bad}</svg>`); }).some((e) => /forbidden/.test(e)), bad);
  }
  assert.ok(check((i) => { i.frames[0].svg = '<div/>'; }).some((e) => /start with <svg/.test(e)));
});

test('duplicate files, source ids and drawings are flagged', () => {
  assert.ok(check((i) => { i.frames[1].file = i.frames[0].file; }).some((e) => /duplicate file/.test(e)));
  assert.ok(check((i) => { i.frames[1].svg = i.frames[0].svg; }).some((e) => /same drawing/.test(e)));
  assert.ok(check((i) => { i.frames[0].file = 'Bad Name.svg'; }).some((e) => /file must look like/.test(e)));
  const c = good();
  c.images['Incline Dumbbell Press'] = JSON.parse(JSON.stringify(c.images['Barbell Bench Press']));
  const e = validateExerciseImages(c, names);
  assert.ok(e.some((m) => /duplicate file/.test(m)) && e.some((m) => /duplicate source_id/.test(m)) && e.some((m) => /same drawing/.test(m)));
});

test('alt is optional but limited; urls and notes are validated', () => {
  assert.deepEqual(check((i) => { i.alt = 'Bench press, start and end.'; i.note = 'Your gym may differ'; }), []);
  assert.ok(check((i) => { i.alt = 'x'.repeat(MAX_ALT + 1); }).some((e) => /alt is/.test(e)));
  assert.ok(check((i) => { i.alt = ''; }).some((e) => /alt must be/.test(e)));
  assert.ok(check((i) => { i.author_url = 'http://example.com'; }).some((e) => /author_url must be an https/.test(e)));
});

test('a malformed bundle is reported, not thrown', () => {
  assert.deepEqual(validateExerciseImages(null, names), ['bundle must be an object']);
  assert.ok(validateExerciseImages({ schema_version: 2, images: [] }, names).length >= 2);
  assert.ok(check((i, c) => { c.images['Barbell Bench Press'] = null; }).length >= 1);
});

test('the JSON Schema agrees with the validator constants', () => {
  const schema = JSON.parse(readFileSync(`${repo}/tools/validate/schemas/exercise-images.schema.json`, 'utf8'));
  const image = schema.$defs.image;
  assert.deepEqual(image.properties.source.enum, SOURCES);
  assert.deepEqual(image.properties.licence.enum, Object.keys(LICENCES));
  assert.equal(image.properties.frames.maxItems, 2);
  assert.equal(image.properties.alt.maxLength, MAX_ALT);
  assert.equal(schema.$defs.frame.properties.svg.maxLength, MAX_FRAME_BYTES);
  assert.deepEqual([...image.required].sort(), Object.keys(good().images['Barbell Bench Press']).sort());
  assert.deepEqual([...schema.$defs.frame.required], ['file', 'w', 'h', 'svg']);
});
