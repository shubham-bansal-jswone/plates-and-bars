import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HELD_BACK, PRODUCE, SOURCES, SOURCE_OF, foodId, importFoods, serialize, servingGrams,
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
  assert.deepEqual(dal.serving, { label: '1 katori (35 g dal)', grams: null });
  for (const g of golden.foods) {
    const f = byName[g.name];
    if (!f) continue;
    assert.equal(f.per_serving.kcal, g.kcal);
    assert.equal(f.per_serving.carbs_g, g.carbs);
    assert.equal(f.per_serving.fibre_g, golden.fibreAndAddedSugarPerServing[g.name][0]);
  }
});

test('grams logging only where the serving is a plain weight', () => {
  assert.equal(servingGrams('100 g'), 100);
  assert.equal(servingGrams('50 g'), 50);
  assert.equal(servingGrams('1 medium (30 g atta)'), null);
  assert.equal(servingGrams('1 glass (250 ml)'), null);
  assert.equal(servingGrams('1 tbsp'), null);
  assert.equal(byName.Paneer.serving.grams, 100);
  assert.equal(byName['Soya chunks, dry'].serving.grams, 50);
  assert.equal(byName['Roti / chapati'].serving.grams, null);
});

test('aliases are preserved from the golden file and searchable', () => {
  assert.deepEqual(byName['Makhana, roasted'].aliases, ['fox', 'nut', 'phool', 'makhana', 'lotus', 'seed']);
  assert.deepEqual(byName['Egg, whole'].aliases, ['anda', 'ande', 'eggs']);
  assert.deepEqual(byName['Brown bread'].aliases, []);
  for (const [name, str] of Object.entries(golden.aliases)) {
    const f = byName[name];
    if (!f) continue;
    assert.equal(f.aliases.join(' '), str);
    // the prototype's foodMatch: query is a substring of the alias string
    for (const a of f.aliases) assert.ok(str.includes(a));
  }
});

test('sources: contract codes, packaged foods are label_typical, FSSAI dairy per the prototype note', () => {
  for (const n of ['Whey protein', 'Greek yogurt, plain', 'Makhana, roasted']) assert.equal(byName[n].source.code, 'label_typical');
  for (const n of ['Paneer', 'Curd / dahi', 'Toned milk']) assert.equal(byName[n].source.code, 'fssai');
  assert.equal(byName['Poha'].source.code, 'own_recipe');
  assert.equal(byName['Egg, whole'].source.code, 'usda_fdc');
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

test('a golden food with no source assignment fails the import', () => {
  const bad = structuredClone(golden);
  bad.foods.push({ name: 'Mystery', unit: '1 g', kcal: 1, protein: 0, carbs: 0, fat: 0 });
  assert.throws(() => importFoods(bad), /Mystery: no source assigned/);
  assert.throws(() => importFoods({}), /missing/);
});
