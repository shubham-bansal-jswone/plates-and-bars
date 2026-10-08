import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateEatOut } from '../validate/foods.mjs';
import { dishId, extractEatOut, importEatOut, serialize } from '../eatout-import/import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');
const load = () => JSON.parse(readFileSync(`${repo}/content/eatout.json`, 'utf8'));
const mutate = (fn) => { const c = load(); fn(c); return validateEatOut(c); };
const dish = (c, name) => c.cuisines.flatMap((x) => x.dishes).find((d) => d.name === name);

test('content/eatout.json equals a fresh import of the prototype and passes validation', () => {
  assert.equal(readFileSync(`${repo}/content/eatout.json`, 'utf8'), serialize(importEatOut(html)));
  assert.deepEqual(validateEatOut(load()), []);
});

test('prototype values are carried over unchanged, in prototype order', () => {
  const proto = extractEatOut(html);
  const c = load();
  assert.deepEqual(c.cuisines.map((x) => x.name), ['North Indian', 'South Indian', 'Indo-Chinese', 'Fast food', 'Biryani', 'Drinks']);
  for (const cu of c.cuisines) {
    assert.deepEqual(cu.tips, proto[cu.name].tips);
    assert.deepEqual(cu.dishes.map((d) => [d.name, d.per_serving.kcal, d.per_serving.protein_g, d.per_serving.carbs_g, d.per_serving.fat_g]), proto[cu.name].dishes);
  }
  assert.deepEqual(dish(c, 'Butter naan').per_serving, { kcal: 300, protein_g: 8, carbs_g: 45, fibre_g: null, added_sugar_g: null, fat_g: 10 });
  assert.equal(dishId('Butter naan'), dish(c, 'Butter naan').id);
});

test('alcoholic drinks are flagged and only they', () => {
  const flagged = load().cuisines.flatMap((c) => c.dishes).filter((d) => d.alcohol).map((d) => d.name);
  assert.deepEqual(flagged, ['Beer (330 ml)', 'Whisky, rum or vodka (30 ml)', 'Wine (150 ml)', 'Cocktail, sweet (200 ml)']);
});

test('every dish has a permitted source and licence', () => {
  for (const d of load().cuisines.flatMap((c) => c.dishes)) {
    assert.equal(d.source.code, 'own_estimate');
    assert.ok(d.source.licence);
  }
});

test('missing licence, unknown source code and duplicate names fail', () => {
  assert.ok(mutate((c) => { c.cuisines[0].dishes[0].source.licence = ''; }).some((e) => e.includes('source.licence missing')));
  assert.ok(mutate((c) => { c.cuisines[0].dishes[0].source.code = 'indb'; }).some((e) => e.includes('is not one of')));
  const e = mutate((c) => { c.cuisines[1].dishes[0].name = c.cuisines[0].dishes[0].name; c.cuisines[1].dishes[0].id = c.cuisines[0].dishes[0].id; });
  assert.ok(e.some((m) => m.includes('duplicate name')));
  assert.ok(e.some((m) => m.includes('duplicate id')));
});

test('macro sanity applies to dishes; alcohol only lifts the upper kcal bound', () => {
  assert.ok(mutate((c) => { c.cuisines[0].dishes[0].per_serving.kcal = 900; }).some((e) => e.includes('does not match macros')));
  const drinks = (c) => c.cuisines.find((x) => x.name === 'Drinks').dishes;
  assert.ok(mutate((c) => { delete drinks(c)[0].alcohol; }).some((e) => e.includes('does not match macros')));
  assert.ok(mutate((c) => { drinks(c)[0].per_serving.kcal = 1; }).some((e) => e.includes('below what the macros give')));
  assert.ok(mutate((c) => { drinks(c)[0].alcohol = false; }).some((e) => e.includes('alcohol must be true')));
});

test('alcohol flag outside Drinks fails even when kcal would otherwise be exempt', () => {
  const e = mutate((c) => {
    const naan = c.cuisines[0].dishes.find((d) => d.name === 'Butter naan');
    naan.alcohol = true;
    naan.per_serving.kcal = 900;
  });
  assert.ok(e.some((m) => m.includes('only allowed in the Drinks cuisine')));
});

test('structure: cuisine mismatch, empty tips, unknown fields, empty file', () => {
  assert.ok(mutate((c) => { c.cuisines[0].dishes[0].cuisine = 'Other'; }).some((e) => e.includes('does not match its group')));
  assert.ok(mutate((c) => { c.cuisines[0].tips = []; }).some((e) => e.includes('tips must be')));
  assert.ok(mutate((c) => { c.cuisines[0].dishes[0].extra = 1; }).some((e) => e.includes('unknown field "extra"')));
  assert.ok(mutate((c) => { c.cuisines.push(structuredClone(c.cuisines[0])); }).some((e) => e.includes('duplicate cuisine')));
  assert.deepEqual(validateEatOut({ cuisines: [] }), ['cuisines must be a non-empty array']);
});

test('foods.json rows may not carry eat-out only fields', async () => {
  const { validateFoods } = await import('../validate/foods.mjs');
  const c = JSON.parse(readFileSync(`${repo}/content/foods.json`, 'utf8'));
  c.foods[0].alcohol = true;
  assert.ok(validateFoods(c).some((e) => e.includes('unknown field "alcohol"')));
});
