import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALIAS_PHRASES, HELD_BACK, PRODUCE, SOURCES, SOURCE_OF, UNIT_GRAMS_RE, foodId, importFoods, serialize, servingGrams,
} from '../foods-import/import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const golden = JSON.parse(readFileSync(`${repo}/docs/spec/golden/foods.json`, 'utf8'));
const out = importFoods(golden);
const byName = Object.fromEntries(out.foods.map((f) => [f.name, f]));

test('content/foods.json equals a fresh import of the golden file', () => {
  assert.equal(readFileSync(`${repo}/content/foods.json`, 'utf8'), serialize(importFoods(golden)));
});

test('import is deterministic and ids are stable uuids', () => {
  assert.equal(serialize(importFoods(structuredClone(golden))), serialize(out));
  assert.equal(foodId('Dal'), foodId('Dal'));
  assert.notEqual(foodId('Dal'), foodId('Paneer'));
  assert.equal(foodId('Dal'), '7c66f843-caa7-5a2f-ab30-a692b3cfbc60'); // changing this orphans synced logs
  assert.match(foodId('Dal'), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('every golden food is imported or explicitly held back, in golden order', () => {
  const names = golden.foods.map((f) => f.name).filter((n) => !HELD_BACK.includes(n));
  assert.deepEqual(out.foods.map((f) => f.name), names);
  for (const n of HELD_BACK) assert.ok(golden.foods.some((f) => f.name === n), `${n} not in golden`);
});

test('values are per serving and unchanged; carbs include fibre', () => {
  const dal = byName.Dal;
  assert.deepEqual(dal.per_serving, {
    kcal: 161, protein_g: 7.8, carbs_g: 23.3, fibre_g: 5.5, added_sugar_g: 0, fat_g: 4.6,
  });
  assert.deepEqual(dal.serving, { label: '1 katori (35 g dal)', grams: 35 });
  for (const g of golden.foods) {
    const f = byName[g.name];
    if (!f) continue;
    assert.equal(f.per_serving.kcal, g.kcal);
    assert.equal(f.per_serving.carbs_g, g.carbs);
    assert.equal(f.per_serving.fibre_g, golden.fibreAndAddedSugarPerServing[g.name][0]);
  }
});

test('grams logging reads the first weight in the label, as the prototype unitGrams does', () => {
  assert.equal(servingGrams('100 g'), 100);
  assert.equal(servingGrams('50 g'), 50);
  assert.equal(servingGrams('1 medium (30 g atta)'), 30);
  assert.equal(servingGrams('1 cup (50 g raw)'), 50);
  assert.equal(servingGrams('1 glass (250 ml)'), null);
  assert.equal(servingGrams('1 tbsp'), null);
  assert.equal(byName.Paneer.serving.grams, 100);
  assert.equal(byName['Soya chunks, dry'].serving.grams, 50);
  assert.deepEqual(['Roti / chapati', 'Rice, cooked', 'Dal', 'Rajma / chole'].map((n) => byName[n].serving.grams), [30, 50, 35, 40]);
  assert.equal(byName['Toned milk'].serving.grams, null);
});

test('aliases are preserved from the golden file and searchable', () => {
  assert.deepEqual(byName['Makhana, roasted'].aliases, ['fox nut', 'phool makhana', 'lotus seed']);
  assert.deepEqual(byName['Egg, whole'].aliases, ['anda', 'ande', 'eggs']);
  assert.deepEqual(byName['Brown bread'].aliases, []);
  for (const [name, str] of Object.entries(golden.aliases)) {
    const f = byName[name];
    if (!f) continue;
    assert.equal(f.aliases.join(' '), str);
    // the prototype's foodMatch: query is a substring of the alias string
  }
});

test('multi-word queries match an alias entry, as the prototype matches the alias string', () => {
  const queries = {
    'Makhana, roasted': ['fox nut', 'lotus seed', 'phool makhana'],
    Paneer: ['cottage cheese'],
    'Whey protein': ['protein shake'],
    Poha: ['flattened rice'],
    'Rajma / chole': ['chana masala'],
    'Roasted chana': ['bhuna chana'],
    'Fruit bowl': ['fruit chaat'],
    Ghee: ['desi ghee'],
    'Sprouts salad': ['sprouted moong'],
    'Egg white': ['anda safedi'],
  };
  for (const [name, qs] of Object.entries(queries)) {
    for (const q of qs) {
      assert.ok(golden.aliases[name].includes(q), `prototype matches "${q}" on ${name}`);
      assert.ok(byName[name].aliases.some((a) => a.includes(q)), `"${q}" matches an alias of ${name}`);
    }
  }
  const used = Object.values(golden.aliases).join(' ');
  for (const p of ALIAS_PHRASES) assert.ok(used.includes(p), `phrase "${p}" unused`);
});

test('sources: contract codes, packaged foods are label_typical, FSSAI dairy per the prototype note', () => {
  for (const n of ['Whey protein', 'Greek yogurt, plain', 'Makhana, roasted']) assert.equal(byName[n].source.code, 'label_typical');
  for (const n of ['Paneer', 'Curd / dahi', 'Toned milk']) assert.equal(byName[n].source.code, 'fssai');
  assert.equal(byName['Poha'].source.code, 'own_recipe');
  assert.equal(byName['Egg, whole'].source.code, 'usda_fdc');
  assert.equal(byName['Chicken breast, cooked'].source.code, 'own_recipe'); // raw value / cooking yield
  assert.equal(byName['Buttermilk (chaas)'].source.code, 'own_recipe'); // 80 g curd in the prototype
  assert.deepEqual(HELD_BACK, ['Beer', 'Whisky, rum or vodka', 'Wine']);
  for (const f of out.foods) {
    assert.ok(Object.hasOwn(SOURCES, f.source.code));
    assert.ok(f.source.licence);
  }
  assert.deepEqual(Object.keys(SOURCES), ['usda_fdc', 'fssai', 'own_recipe', 'kitchen_test', 'label_typical']);
  assert.ok(Object.keys(SOURCE_OF).every((n) => golden.foods.some((f) => f.name === n)));
});

test('fruit and veg servings match PRODUCE in the prototype', () => {
  const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');
  const line = /const PRODUCE = \{(.*?)\};/.exec(html)[1];
  const proto = Object.fromEntries([...line.matchAll(/'([^']+)':([\d.]+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(PRODUCE, proto);
  assert.equal(byName['Fruit bowl'].fruit_veg_servings, 2);
  assert.equal(byName.Paneer.fruit_veg_servings, 0);
});

test('search and grams equal the prototype: foodMatch rows and unitGrams for every row', () => {
  const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');
  const aliasSrc = /const ALIAS = \{.*?\};/s.exec(html)[0];
  const matchSrc = /const foodMatch = .*?;\n/.exec(html)[0];
  const gramsSrc = /const unitGrams = .*?;\n/.exec(html)[0];
  const proto = new Function(`${aliasSrc}\n${matchSrc}\n${gramsSrc}\nreturn { foodMatch, unitGrams };`)();
  const protoRows = (q) => out.foods.filter((f) => proto.foodMatch([f.name], q)).map((f) => f.name);
  const contentRows = (q) => out.foods
    .filter((f) => f.name.toLowerCase().includes(q) || f.aliases.some((a) => a.includes(q))).map((f) => f.name);
  const phrases = ['fox nut', 'lotus seed', 'phool makhana', 'cottage cheese', 'protein shake', 'flattened rice',
    'chana masala', 'bhuna chana', 'fruit chaat', 'desi ghee', 'sprouted moong', 'anda safedi'];
  const words = new Set(phrases);
  for (const f of out.foods) {
    f.name.toLowerCase().split(/[^a-z]+/).filter(Boolean).forEach((w) => words.add(w));
    f.aliases.flatMap((a) => a.split(' ')).forEach((w) => words.add(w));
  }
  assert.ok(words.size > 100);
  for (const q of words) {
    assert.ok(protoRows(q).length > 0, `prototype finds "${q}"`);
    assert.deepEqual(contentRows(q), protoRows(q), `rows for "${q}"`);
  }
  for (const f of out.foods) assert.equal(f.serving.grams ?? 0, proto.unitGrams([f.name, f.serving.label]), f.name);
});

test('a golden food with no source assignment fails the import', () => {
  const bad = structuredClone(golden);
  bad.foods.push({ name: 'Mystery', unit: '1 g', kcal: 1, protein: 0, carbs: 0, fat: 0 });
  assert.throws(() => importFoods(bad), /Mystery: no source assigned/);
  assert.throws(() => importFoods({}), /missing/);
});

// Core's unitGrams (packages/core/src/food.ts) and the prototype's are the reference; the tools mirror them.
const REGEX_IN = /\.match\((\/.*\/)\);/;
const regexFrom = (file, fnMarker) => {
  const text = readFileSync(`${repo}/${file}`, 'utf8');
  const at = text.indexOf(fnMarker);
  assert.ok(at >= 0, `${fnMarker} not found in ${file}`);
  const lit = REGEX_IN.exec(text.slice(at, at + 400))?.[1];
  assert.ok(lit, `regex not found in ${file}`);
  return lit;
};
const coreLiteral = regexFrom('packages/core/src/food.ts', 'export function unitGrams');
const protoLiteral = regexFrom('docs/prototype/plate-and-bar.html', 'const unitGrams');
const refGrams = (literal, label) => {
  const m = String(label).match(new RegExp(literal.slice(1, literal.lastIndexOf('/'))));
  return m ? +(m[1] ?? m[2]).replace(/,/g, '') : 0;
};

test('tools use the same grams pattern as core and the prototype', () => {
  assert.equal(coreLiteral, protoLiteral);
  assert.equal(UNIT_GRAMS_RE.source, coreLiteral.slice(1, coreLiteral.lastIndexOf('/')));
  assert.ok(!/\(\?<[=!]/.test(UNIT_GRAMS_RE.source), 'no lookbehind');
});

test('servingGrams agrees with core unitGrams on a label set (0 in core is null here)', () => {
  const labels = [
    '100 g', '1 medium (30 g atta)', '1 glass (250 ml)', '1 tbsp', '1 plate (1,250 g)', '1,250 g', '1,00,000 g',
    '1,234,567 g', '1,5 g', '0,500 g', '1234,567 g', '1.5 g scoop', '2 x 1,250 ml', '12 g', '0 g', '',
    ...JSON.parse(readFileSync(`${repo}/content/foods.json`, 'utf8')).foods.map((f) => f.serving.label),
  ];
  for (const l of labels) assert.equal(servingGrams(l), refGrams(coreLiteral, l) || null, `label "${l}"`);
  assert.equal(servingGrams('1 plate (1,250 g)'), 1250);
  assert.equal(servingGrams('1,5 g'), 5);
});
