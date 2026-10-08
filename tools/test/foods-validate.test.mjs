import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateFoods } from '../validate/foods.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = () => JSON.parse(readFileSync(`${repo}/content/foods.json`, 'utf8'));
const withFood = (fn, i = 0) => { const c = load(); fn(c.foods[i], c); return validateFoods(c); };
const paneer = () => load().foods.findIndex((f) => f.name === 'Paneer');

test('shipped content passes', () => assert.deepEqual(validateFoods(load()), []));

test('missing licence, unknown source code and missing source fail', () => {
  assert.ok(withFood((f) => { f.source.licence = ''; }).some((e) => e.includes('source.licence missing')));
  assert.ok(withFood((f) => { f.source.code = 'ifct'; }).some((e) => e.includes('is not one of')));
  assert.ok(withFood((f) => { delete f.source; }).some((e) => e.includes('"source" missing')));
});

test('duplicate names and ids fail', () => {
  const c = load();
  c.foods[1].name = c.foods[0].name.toUpperCase();
  c.foods[1].id = c.foods[0].id;
  const e = validateFoods(c);
  assert.ok(e.some((m) => m.includes('duplicate name')));
  assert.ok(e.some((m) => m.includes('duplicate id')));
});

test('duplicate aliases in a row and an alias that is another food name fail', () => {
  assert.ok(withFood((f) => { f.aliases = ['x', 'X']; }).some((e) => e.includes('duplicate alias')));
  const c = load();
  c.foods[0].aliases.push(c.foods[1].name);
  assert.ok(validateFoods(c).some((e) => e.includes('is the name of')));
});

test('macro sanity: macros over the serving weight, kcal mismatch, fibre over carbs', () => {
  const i = paneer();
  assert.ok(withFood((f) => { f.per_serving.fat_g = 90; f.per_serving.kcal = 1000; }, i).some((e) => e.includes('more than the 100 g serving')));
  assert.ok(withFood((f) => { f.per_serving.kcal = 900; }, i).some((e) => e.includes('does not match macros')));
  assert.ok(withFood((f) => { f.per_serving.fibre_g = 99; }, i).some((e) => e.includes('fibre_g exceeds carbs_g')));
  assert.ok(withFood((f) => { f.per_serving.protein_g = -1; }, i).some((e) => e.includes('protein_g must be')));
});

test('grams logging: a weight-only label must carry its grams', () => {
  assert.ok(withFood((f) => { f.serving.grams = null; }, paneer()).some((e) => e.includes('is in grams but serving.grams')));
});

test('grams: label weight must match, and a weightless label must have null grams', () => {
  const dal = load().foods.findIndex((f) => f.name === 'Dal');
  assert.ok(withFood((f) => { f.serving.grams = null; }, dal).some((e) => e.includes('is in grams but serving.grams')));
  const milk = load().foods.findIndex((f) => f.name === 'Toned milk');
  assert.ok(withFood((f) => { f.serving.grams = 250; }, milk).some((e) => e.includes('has no weight in grams')));
  assert.ok(withFood((f) => { f.serving.grams = 0; }, paneer()).some((e) => e.includes('must be a number > 0 or null')));
});

test('each remaining field check fails on a bad value', () => {
  assert.ok(withFood((f) => { f.name_hi = ''; }).some((e) => e.includes('name_hi must be')));
  assert.ok(withFood((f) => { f.updated_at = 'yesterday'; }).some((e) => e.includes('updated_at must be')));
  assert.ok(withFood((f) => { f.fruit_veg_servings = -1; }).some((e) => e.includes('fruit_veg_servings must be')));
  assert.ok(withFood((f) => { delete f.fruit_veg_servings; }).some((e) => e.includes('"fruit_veg_servings" missing')));
  assert.ok(withFood((f) => { f.source.name = ' '; }).some((e) => e.includes('source.name missing')));
  assert.ok(withFood((f) => { f.per_serving.added_sugar_g = 99; }).some((e) => e.includes('added_sugar_g exceeds carbs_g')));
});

test('schema: unknown and missing fields, bad id', () => {
  assert.ok(withFood((f) => { f.extra = 1; }).some((e) => e.includes('unknown field "extra"')));
  assert.ok(withFood((f) => { delete f.aliases; }).some((e) => e.includes('field "aliases" missing')));
  assert.ok(withFood((f) => { f.id = 'nope'; }).some((e) => e.includes('id must be')));
  assert.deepEqual(validateFoods({ foods: [] }), ['foods must be a non-empty array']);
});

test('own_estimate is an accepted source code', () => {
  assert.ok(!withFood((f) => { f.source.code = 'own_estimate'; }).some((e) => e.includes('is not one of')));
});
