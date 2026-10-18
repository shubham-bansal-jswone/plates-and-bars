import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSvgFrame, svgByteLength } from '../validate/svg-allowlist.mjs';
import {
  validateExerciseImages, SOURCES, LICENCES, MAX_FRAME_BYTES, MAX_ALT, MAX_DIMENSION, FILE_PATTERN,
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

test('every source except own_drawing is refused, whatever the licence', () => {
  const linked = { author_url: 'https://example.com/a', source_url: 'https://example.com/s' };
  for (const [source, licence] of [['wger', 'CC-BY-4.0'], ['wikimedia_commons', 'CC0-1.0'], ['wger', 'CC-BY-SA-4.0']]) {
    const e = check((i) => { Object.assign(i, linked, { source, licence, licence_url: LICENCES[licence] ?? 'https://creativecommons.org/licenses/by-sa/4.0/' }); });
    assert.ok(e.some((m) => /source must be own_drawing/.test(m)), `${source} ${licence}`);
  }
  only(check((i) => { i.source = 'flickr'; }), /source must be own_drawing/);
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
    assert.ok(check((i) => { i.frames[0].svg = SVG.replace('stroke="currentColor"', `stroke="${bad}"`); }).some((e) => /colour|url\(/.test(e)), bad);
  }
  assert.ok(check((i) => { i.frames[0].svg = SVG.replace(' fill="var(--fig-bg)"', ' fill="#fff"'); }).some((e) => /bakes in a colour: fill="#fff"/.test(e)));
});

// The 15 bypasses of the earlier denylist (PR review), each placed in an otherwise valid frame: all must now fail.
const BYPASSES = {
  'slash before attribute': '<circle cx="1"/onclick="alert(1)"/>',
  'img with onerror': '<img src="x"/onerror="alert(1)">',
  'img external': '<img src="https://evil.example/t.gif">',
  embed: '<embed src="https://evil.example/x">',
  'meta refresh': '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  'prefixed script': '<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>',
  'prefixed foreignObject': '<x:foreignObject xmlns:x="http://www.w3.org/2000/svg"></x:foreignObject>',
  'filter url external': '<circle r="1" filter="url(https://evil.example/f.svg#f)"/>',
  'mask url data': '<circle r="1" mask="url(data:image/svg+xml;base64,AAAA)"/>',
  'slash before style': '<circle r="1"/style="fill:red"/>',
  animateTransform: '<animateTransform attributeName="transform" type="rotate"/>',
  'single-quoted colour': "<circle r=\"1\" fill='#ff0000'/>",
  'spaced colour': '<circle r="1" fill = "red"/>',
  'unquoted colour': '<circle r="1" fill=red/>',
  feFlood: '<feFlood flood-color="red"/>',
};
test('the allowlist refuses every known bypass', () => {
  assert.equal(Object.keys(BYPASSES).length, 15);
  for (const [why, bad] of Object.entries(BYPASSES)) {
    assert.ok(check((i) => { i.frames[0].svg = SVG.replace('</svg>', `${bad}</svg>`); }).length > 0, why);
  }
});

test('the allowlist refuses other markup and accepts what the generator emits', () => {
  const frame = (inner, root = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 240">') => `${root}${inner}</svg>`;
  const errs = (svg) => checkSvgFrame(svg, 320, 240);
  const bad = [
    frame('<!-- x -->'), frame('<![CDATA[x]]>'), frame('<?xml version="1.0"?>'), frame('<g/>text'), frame('<circle r="1" fill="red"/>'),
    frame('<circle r="1" href="#a"/>'), frame('<circle r="1" onclick="x"/>'), frame('<circle r="1" r="2"/>'), frame('<circle r="1&nbsp;"/>'),
    frame('<circle r="1" xlink:href="#a"/>'), frame('<SCRIPT/>'), frame('<script/>'), frame('<style/>'), frame('<a/>'), frame('<use/>'),
    frame('<circle r="1" style="x"/>'), frame('<circle r="1" class="x"/>'), frame('<circle r="x"/>'), frame('<path d="M0 0 url(#a)"/>'),
    frame('<g><circle r="1"/>'), frame('<g></circle></g>'), frame('<circle r="1"/>') + '<g/>', '<svg viewBox="0 0 320 240"><svg/></svg>',
    '<svg xmlns="http://evil" viewBox="0 0 320 240"></svg>', '<g viewBox="0 0 320 240"/>', frame('', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">'),
    '<svg xmlns:x="a" viewBox="0 0 320 240"></svg>', frame('<title>&bogus;</title>'), frame('<circle r="1" fill="none" />x'), '',
    frame('<circle r="1" transform="x(1)"/>'),
  ];
  for (const b of bad) assert.ok(errs(b).length > 0, b);
  const ok = [
    frame('<line x1="1.5" y1="-2" x2="3" y2="4" stroke="var(--fig-eq)" stroke-width="5" stroke-linecap="round"/>'),
    frame('<g opacity="0.5"><circle cx="1" cy="2" r="3" fill="none" stroke="currentColor"/><ellipse cx="1" cy="1" rx="2" ry="3"/><rect x="1" y="2" width="3" height="4" rx="1"/></g>'),
    frame('<title>A &amp; B</title><path d="M0 0L10 10z" transform="translate(1,2)"/>'),
    frame('\n  <circle r="1" fill="var(--fig-bg)"/>\n'),
  ];
  for (const g of ok) assert.deepEqual(errs(g), [], g);
  assert.ok(errs(frame('', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 241">')).some((e) => /viewBox must be/.test(e)));
});

const NS = 'xmlns="http://www.w3.org/2000/svg"';
const wrap = (inner, attrs = `${NS} viewBox="0 0 320 240"`) => `<svg ${attrs}>${inner}</svg>`;
const bad = (svg) => checkSvgFrame(svg, 320, 240).length > 0;
const good2 = (svg) => assert.deepEqual(checkSvgFrame(svg, 320, 240), [], svg);

test('content model: title is text only, shapes are empty, only svg and g contain elements', () => {
  for (const x of ['<title><circle r="1"/></title>', '<title><title>x</title></title>', '<line x1="1"><g><circle r="1"/></g></line>',
    '<circle r="1"><circle r="2"/></circle>', '<path d="M0 0"><title>x</title></path>', '<circle r="1">text</circle>']) assert.ok(bad(wrap(x)), x);
  for (const x of ['<g><g><circle r="1"/></g></g>', '<title>t</title>', '<circle r="1"></circle>', '<circle r="1"/>', '<g><title>t</title></g>']) good2(wrap(x));
});

test('viewBox is read from the parsed attribute: any whitespace may precede it', () => {
  good2(`<svg ${NS}\nviewBox="0 0 320 240"></svg>`);
  good2(`<svg\tviewBox="0 0 320 240"\n${NS}></svg>`);
  assert.ok(bad(`<svg ${NS}\n viewBox="0 0 320 241"></svg>`));
  assert.ok(bad(wrap('', NS)));
});

test('xmlns is required on the root', () => {
  assert.ok(bad('<svg viewBox="0 0 320 240"></svg>'));
  assert.ok(bad(wrap('', 'viewBox="0 0 320 240"')));
});

test('value shapes: no negative size, opacity 0 to 1, bounded numbers, strict path data and transforms', () => {
  for (const x of ['<circle r="-5"/>', '<rect width="-1" height="1"/>', '<rect width="1" height="-1"/>', '<ellipse rx="-1" ry="1"/>', '<line stroke-width="-2"/>',
    '<g opacity="1000"/>', '<g opacity="-0.1"/>', '<g fill-opacity="1.5"/>', `<circle r="${'9'.repeat(400)}"/>`, '<circle cx="1234567"/>', '<circle cx="1.1234567"/>',
    '<circle cx="1e3"/>', '<circle cx="Infinity"/>', '<path d="MLZ eE"/>', '<path d="1 2 3"/>', '<path d="M0 0 L1"/>', '<path d="Z1"/>', '<path d="M 0 0 X 1 1"/>',
    '<path d=""/>', '<path d="M0 0 url(#a)"/>', '<g transform="rotate()"/>', '<g transform="rotate(1 2)"/>', '<g transform="translate(1 2 3)"/>', '<g transform="matrix(1 2 3)"/>',
    '<g transform=""/>', '<g transform="scale(a)"/>']) assert.ok(bad(wrap(x)), x);
  for (const x of ['<circle r="0"/>', '<circle cx="-12.5" cy="0" r="3"/>', '<g opacity="0"/>', '<g opacity="1"/>', '<g opacity="0.25"/>', '<g opacity="1.0"/>',
    '<path d="M0 0 L10 10 H5 V3 C1 2 3 4 5 6 Q1 1 2 2 A1 1 0 0 1 5 5 Z"/>', '<path d="M0,0L10,10z"/>', '<g transform="rotate(45) translate(1,2) scale(2)"/>',
    '<g transform="rotate(45 10 10)"/>']) good2(wrap(x));
});

test('byte size helper counts UTF-8 bytes without Buffer', () => {
  assert.equal(svgByteLength('abc'), 3);
  assert.equal(svgByteLength('é'), 2);
  assert.equal(svgByteLength('€'), 3);
  assert.equal(svgByteLength('😀'), 4);
  assert.equal(svgByteLength(''), 0);
  assert.equal(svgByteLength(SVG), Buffer.byteLength(SVG));
  assert.doesNotMatch(readFileSync(`${repo}/tools/validate/svg-allowlist.mjs`, 'utf8').replace(/\/\/.*|\/\*\*.*\*\//g, ''), /Buffer|node:/);
});

test('viewBox is read from the parsed root only', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>viewBox="0 0 320 240"</title></svg>';
  assert.ok(checkSvgFrame(svg, 320, 240).some((e) => /viewBox must be/.test(e)));
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
  assert.ok(check((i) => { i.changes = ''; }).some((e) => /changes must be/.test(e)));
  assert.ok(check((i) => { i.note = ''; }).some((e) => /note must be/.test(e)));
  assert.ok(check((i) => { i.licence = 'toString'; }).some((e) => /not on the allowlist/.test(e)));
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
  assert.equal(schema.$defs.frame.properties.w.maximum, MAX_DIMENSION);
  assert.equal(schema.$defs.frame.properties.h.maximum, MAX_DIMENSION);
  assert.equal(schema.$defs.frame.properties.file.pattern, FILE_PATTERN.replace(/\//g, '/'));
  for (const f of ['changes', 'alt', 'note']) assert.equal(image.properties[f].minLength, 1, f);
  assert.equal(schema.$defs.frame.properties.svg.maxLength, MAX_FRAME_BYTES);
  assert.deepEqual([...image.required].sort(), Object.keys(good().images['Barbell Bench Press']).sort());
  assert.deepEqual([...schema.$defs.frame.required], ['file', 'w', 'h', 'svg']);
});
