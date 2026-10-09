import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCards, validateLabels, validateMeasures } from '../validate/cards.mjs';
import { extractScience, importCards, importLabels, importMeasures, prototypeBody, renderBody, serialize } from '../cards-import/import.mjs';

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

const NUM = { kcal: '{kcal}', protein_g: '{protein_g}', tdee: '{tdee}', bmr: '{bmr}', movement: '{movement}', training: '{training}', digestion: '{digestion}', weight: '{weight}', protein_floor: '{protein_floor}', minutes: '{minutes}' };

test('static card bodies are identical to the prototype text', () => {
  const p = extractScience(html);
  for (const c of load('cards.json').cards) {
    if (c.placeholders) continue;
    assert.equal(c.body, p.KB[c.id].body, c.id);
  }
});

test('personalised bodies: all sections off equals the prototype with no profile, all on equals it with a profile', () => {
  const cards = load('cards.json').cards;
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  for (const id of ['targets', 'protein']) {
    const c = byId[id];
    assert.equal(renderBody(c.body, [], NUM), prototypeBody(html, id, 'none'), `${id} off`);
    assert.equal(renderBody(c.body, c.sections, NUM), prototypeBody(html, id, 'profile'), `${id} on`);
  }
  const split = byId.split;
  const names = load('cards.json').split_names;
  assert.deepEqual(Object.keys(names), ['2', '3', '4', '5', '6']);
  for (const d of [2, 3, 4, 5, 6]) {
    const v = { ...NUM, days: d, split_name: names[String(d)] };
    assert.equal(renderBody(split.body, [], v), prototypeBody(html, 'split', 'none', d), `split ${d} off`);
    assert.equal(renderBody(split.body, split.sections, v), prototypeBody(html, 'split', 'all', d), `split ${d} on`);
    assert.equal(renderBody(split.body, ['minutes'], v), prototypeBody(html, 'split', 'minutes', d), `split ${d} minutes`);
    assert.equal(renderBody(split.body, ['new_lifter'], v), prototypeBody(html, 'split', 'new', d), `split ${d} new`);
  }
});

test('drift: editing the split text, its name map or the new-lifter clause changes the import', () => {
  const base = serialize(importCards(html));
  const edits = [
    ['which trains each muscle about twice a week', 'which trains each muscle about once a week'],
    ['4:\'an upper/lower split\'', '4:\'an upper-lower split\''],
    ['starting with 2 sets per exercise', 'starting with 3 sets per exercise'],
    ['about ${p.minutes} minutes', 'roughly ${p.minutes} minutes'],
  ];
  for (const [from, to] of edits) {
    assert.ok(html.includes(from), `fixture string present: ${from}`);
    assert.notEqual(serialize(importCards(html.replace(from, to))), base, from);
  }
});

test('the 12 LEARN cards keep their order; bulky is the female-only extra', () => {
  const cards = load('cards.json').cards;
  const learn = cards.filter((c) => c.learn_order !== null).sort((a, b) => a.learn_order - b.learn_order).map((c) => c.id);
  assert.deepEqual(learn, extractScience(html).LEARN);
  assert.equal(learn.length, 12);
  const bulky = cards.find((c) => c.id === 'bulky');
  assert.equal(bulky.audience, 'female');
  assert.equal(bulky.learn_order, null);
  assert.equal(bulky.learn_insert_at, Number(/list\.splice\((\d+), 0, 'bulky'\)/.exec(html)[1]));
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
  c.cards[0].body = c.cards[0].body.replace('{/tdee}', '');
  c.cards[1].body = c.cards[1].body.replace('{?weight}', '{?other}');
  const e = validateCards(c);
  for (const frag of ['is not one of', 'duplicate id', 'duplicate title', 'not listed in placeholders', 'is not closed', 'not listed in sections']) assert.ok(e.some((m) => m.includes(frag)), frag);
});

test('{:} outside a section, or twice in one section, fails', () => {
  const c = load('cards.json');
  const split = c.cards.find((x) => x.id === 'split');
  split.body = split.body.replace('{?minutes}', '{:}{?minutes}');
  assert.ok(validateCards(c).some((e) => e.includes('{:} outside a section')));
  const d = load('cards.json');
  const s2 = d.cards.find((x) => x.id === 'split');
  s2.body = s2.body.replace('your time{/minutes}', 'your time{:}more{/minutes}');
  assert.ok(validateCards(d).some((e) => e.includes('more than one {:}')));
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

test('measures keep the prototype list; hips rule is encoded in full', () => {
  const m = load('measures.json');
  assert.deepEqual(m.measures.map((x) => [x.key, x.label]), extractScience(html).MEASURES);
  assert.deepEqual(m.measures.find((x) => x.key === 'hips').show, { sex: 'female', or_entered_that_day: true });
  assert.ok(m.measures.filter((x) => x.key !== 'hips').every((x) => x.show === 'always'));
  m.measures[1].key = m.measures[0].key;
  assert.ok(validateMeasures(m).some((e) => e.includes('duplicate key')));
});

test('importer fails loudly when the prototype loses a replacement phrase or a block', () => {
  assert.throws(() => importLabels(html.replace("'same movement'", "'similar'")), /same_movement/);
  assert.throws(() => importCards(html.replace('const KB = {', 'const KBX = {')), /KB not found/);
});
