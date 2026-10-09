import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCards, validateLabels, validateMeasures } from '../validate/cards.mjs';
import { extractScience, importCards, importLabels, importMeasures, serialize } from '../cards-import/import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');
const load = (f) => JSON.parse(readFileSync(`${repo}/content/${f}`, 'utf8'));
const raw = (f) => readFileSync(`${repo}/content/${f}`, 'utf8');

test('content files equal a fresh import of the prototype (drift) and validate', () => {
  assert.equal(raw('cards.json'), serialize(importCards(html)));
  assert.equal(raw('measures.json'), serialize(importMeasures(html)));
  assert.equal(raw('labels.json'), serialize(importLabels(html)));
  assert.deepEqual(validateCards(load('cards.json')), []);
  assert.deepEqual(validateMeasures(load('measures.json')), []);
  assert.deepEqual(validateLabels(load('labels.json')), []);
});

test('all 20 KB cards carry over in prototype order with title, summary, evidence and source unchanged', () => {
  const p = extractScience(html);
  const cards = load('cards.json').cards;
  assert.equal(cards.length, 20);
  assert.deepEqual(cards.map((c) => c.id), Object.keys(p.KB));
  for (const c of cards) {
    const k = p.KB[c.id];
    assert.deepEqual([c.title, c.summary, c.evidence, c.source], [k.t, k.s, k.ev, k.src]);
  }
});

test('static card bodies are identical to the prototype text; personalised ones use placeholders', () => {
  const p = extractScience(html);
  const personalised = ['targets', 'protein', 'split'];
  for (const c of load('cards.json').cards) {
    if (personalised.includes(c.id)) assert.ok(c.placeholders.length > 0, c.id);
    else { assert.equal(c.body, p.KB[c.id].body); assert.equal(c.placeholders, undefined); }
  }
});

test('the 12 LEARN cards keep their order; bulky is the female-only extra', () => {
  const cards = load('cards.json').cards;
  const learn = cards.filter((c) => c.learn_order !== null).sort((a, b) => a.learn_order - b.learn_order).map((c) => c.id);
  assert.deepEqual(learn, extractScience(html).LEARN);
  assert.equal(learn.length, 12);
  assert.equal(cards.find((c) => c.id === 'bulky').audience, 'female');
});

test('a card without a source (or with an empty one) fails validation', () => {
  const c = load('cards.json');
  delete c.cards[0].source;
  assert.ok(validateCards(c).some((e) => e.includes('source missing')));
  c.cards[0].source = '  ';
  assert.ok(validateCards(c).some((e) => e.includes('source missing')));
});

test('bad evidence, duplicate id or title, and placeholder mismatches fail', () => {
  const c = load('cards.json');
  c.cards[1].evidence = 'High';
  c.cards[2].id = c.cards[3].id;
  c.cards[4].title = c.cards[5].title;
  c.cards[6].body += ' {nope}';
  const e = validateCards(c);
  for (const frag of ['is not one of', 'duplicate id', 'duplicate title', 'not listed in placeholders']) assert.ok(e.some((m) => m.includes(frag)), frag);
});

test('labels match the prototype and reproduce its replacement text', () => {
  const l = load('labels.json');
  assert.equal(Object.keys(l.muscles).length, 15);
  assert.equal(l.muscles.hams, 'hamstrings');
  assert.equal(l.joints['lower-back'], 'lower back');
  const listJoin = (a) => (a.length < 2 ? a[0] || '' : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const r = l.replacement_reasons;
  const text = [r.works.replace('{muscles}', listJoin(['chest', 'triceps'].map((m) => l.muscles[m]))), r.same_movement, r.spares_joint.replace('{joint}', l.joints.knee)].join(', ');
  assert.equal(text.charAt(0).toUpperCase() + text.slice(1), 'Works your chest and triceps, same movement, doesn’t load the knee');
  const bad = load('labels.json');
  bad.muscles.chest = '';
  delete bad.replacement_reasons.done_before;
  const e = validateLabels(bad);
  assert.ok(e.some((m) => m.includes('muscles.chest')) && e.some((m) => m.includes('done_before')));
});

test('measures keep the prototype list; hips default to female profiles only', () => {
  const m = load('measures.json');
  assert.deepEqual(m.measures.map((x) => [x.key, x.label]), extractScience(html).MEASURES);
  assert.equal(m.measures.find((x) => x.key === 'hips').default_for, 'female');
  m.measures[1].key = m.measures[0].key;
  assert.ok(validateMeasures(m).some((e) => e.includes('duplicate key')));
});

test('importer fails loudly when the prototype loses a replacement phrase or a block', () => {
  assert.throws(() => importLabels(html.replace("'same movement'", "'similar'")), /same_movement/);
  assert.throws(() => importCards(html.replace('const KB = {', 'const KBX = {')), /KB not found/);
});
