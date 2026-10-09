import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRaw, validateRecipes, validatePlanning } from '../validate/recipes.mjs';
import { extractRecipeData, importAll, serialize, idFor, SOURCE_OVERRIDE } from '../recipes-import/import.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const html = readFileSync(`${repo}/docs/prototype/plate-and-bar.html`, 'utf8');
const load = (f) => JSON.parse(readFileSync(`${repo}/content/${f}`, 'utf8'));
const foodNames = () => new Set(load('foods.json').foods.map((f) => f.name));
const rawNames = () => new Set(load('raw-ingredients.json').ingredients.map((i) => i.name));
const raw = (fn) => { const c = load('raw-ingredients.json'); fn(c); return validateRaw(c); };
const rec = (fn) => { const c = load('recipes.json'); fn(c); return validateRecipes(c, rawNames()); };
const plan = (fn) => { const c = load('meal-planning.json'); fn(c); return validatePlanning(c, foodNames()); };

test('content files equal a fresh import of the prototype and pass validation', () => {
  const out = importAll(html);
  assert.equal(readFileSync(`${repo}/content/raw-ingredients.json`, 'utf8'), serialize(out.raw));
  assert.equal(readFileSync(`${repo}/content/recipes.json`, 'utf8'), serialize(out.recipes));
  assert.equal(readFileSync(`${repo}/content/meal-planning.json`, 'utf8'), serialize(out.planning));
  assert.deepEqual(validateRaw(load('raw-ingredients.json')), []);
  assert.deepEqual(validateRecipes(load('recipes.json'), rawNames()), []);
  assert.deepEqual(validatePlanning(load('meal-planning.json'), foodNames()), []);
});

test('raw ingredients carry the prototype numbers, including fibre, in prototype order', () => {
  const p = extractRecipeData(html);
  const c = load('raw-ingredients.json');
  assert.deepEqual(c.ingredients.map((i) => i.name), Object.keys(p.RAW));
  for (const i of c.ingredients) {
    const [kcal, protein, carbs, fat] = p.RAW[i.name];
    assert.deepEqual(i.per_100g, { kcal, protein_g: protein, carbs_g: carbs, fibre_g: p.RAW_FIB[i.name] ?? 0, fat_g: fat });
  }
  const toor = c.ingredients.find((i) => i.name === 'Toor dal (dry)');
  assert.deepEqual(toor.per_100g, { kcal: 343, protein_g: 21.7, carbs_g: 62.8, fibre_g: 15, fat_g: 1.5 });
  assert.deepEqual(c.ingredients.filter((i) => i.fatty).map((i) => i.name), ['Butter', 'Ghee', 'Oil', 'Fresh cream'].sort((a, b) => Object.keys(p.RAW).indexOf(a) - Object.keys(p.RAW).indexOf(b)));
  assert.equal(idFor('raw', 'Toor dal (dry)'), toor.id);
});

test('sources: only ADR 005 codes, FSSAI for dairy, label values for packaged, every row flagged for dietitian review', () => {
  const c = load('raw-ingredients.json');
  const by = (n) => c.ingredients.find((i) => i.name === n).source.code;
  assert.equal(by('Paneer'), 'fssai');
  assert.equal(by('Whey protein'), 'label_typical');
  assert.equal(by('Poha (dry)'), 'own_estimate');
  assert.equal(by('Toor dal (dry)'), 'usda_fdc');
  assert.deepEqual(Object.keys(SOURCE_OVERRIDE).filter((n) => !(n in extractRecipeData(html).RAW)), []);
  for (const i of c.ingredients) { assert.ok(i.source.licence); assert.equal(i.needs_dietitian_review, true); }
  for (const r of [...load('recipes.json').library, ...load('recipes.json').presets]) assert.equal(r.needs_dietitian_review, true);
  assert.equal(load('meal-planning.json').needs_dietitian_review, true);
});

test('recipes: 9 library recipes and 8 presets, steps/time/cost/tags unchanged', () => {
  const p = extractRecipeData(html);
  const c = load('recipes.json');
  assert.equal(c.library.length, 9);
  assert.deepEqual(c.library.map((r) => r.name), Object.keys(p.LIBRARY));
  assert.deepEqual(c.presets.map((r) => r.name), Object.keys(p.PRESETS));
  for (const r of c.library) {
    const L = p.LIBRARY[r.name];
    assert.deepEqual(r.steps, L.steps);
    assert.deepEqual([r.time_min, r.cost, r.tags, r.katoris], [L.time, L.cost, L.tags, L.k]);
    assert.deepEqual(r.ingredients.map((g) => [g.ingredient, g.amount]), L.rows);
  }
  assert.equal(c.katori_g, 150);
});

test('meal planning: weights, caps and grocery map match the prototype', () => {
  const p = extractRecipeData(html);
  const c = load('meal-planning.json');
  assert.deepEqual(c.meal_weights, { Breakfast: 0.25, Lunch: 0.35, Snacks: 0.1, Dinner: 0.3 });
  assert.deepEqual(c.protein_weights, p.PROT_W);
  assert.deepEqual(c.max_portions, p.MAXQ);
  assert.deepEqual(c.min_portions, { 'Soya chunks, dry': 0.5, 'Whey protein': 0.5, 'Egg, whole': 2, 'Egg white': 2 });
  assert.deepEqual(c.grocery.map((g) => [g.food, g.items.map((i) => [i.item, i.amount, i.unit])]), Object.entries(p.GROC));
});

test('meal planning roles equal the prototype ROLE table in order, with a valid role and diet each', () => {
  const p = extractRecipeData(html);
  const c = load('meal-planning.json');
  assert.deepEqual(c.roles.map((r) => [r.food, r.role, r.diet]), Object.entries(p.ROLE).map(([f, [r, d]]) => [f, r, d]));
  assert.equal(c.roles.length, 37);
  assert.deepEqual(c.roles.find((r) => r.food === 'Egg, whole'), { food: 'Egg, whole', role: 'bp', diet: 'e' });
});

test('planning roles: unknown food, bad role or diet, duplicates and extra fields fail', () => {
  assert.ok(plan((c) => { c.roles[0].food = 'Mystery'; }).some((e) => e.includes('roles/Mystery: not a food in foods.json')));
  assert.ok(plan((c) => { c.roles[0].role = 'x'; }).some((e) => e.includes('is not one of')));
  assert.ok(plan((c) => { c.roles[0].diet = 'vegan'; }).some((e) => e.includes('diet "vegan" is not one of')));
  assert.ok(plan((c) => { c.roles[1].food = c.roles[0].food; }).some((e) => e.includes('duplicate food')));
  assert.ok(plan((c) => { c.roles[0].extra = 1; }).some((e) => e.includes('unknown field "extra"')));
  assert.ok(plan((c) => { c.roles = []; }).some((e) => e.includes('roles must be a non-empty array')));
});

test('raw: missing licence, unknown source, bad macros, duplicates fail', () => {
  assert.ok(raw((c) => { c.ingredients[0].source.licence = ''; }).some((e) => e.includes('source.licence missing')));
  assert.ok(raw((c) => { c.ingredients[0].source.code = 'indb'; }).some((e) => e.includes('is not one of')));
  assert.ok(raw((c) => { c.ingredients[0].per_100g.kcal = 900; }).some((e) => e.includes('does not match macros')));
  assert.ok(raw((c) => { c.ingredients[0].per_100g.protein_g = 90; c.ingredients[0].per_100g.carbs_g = 60; }).some((e) => e.includes('more than 100 g')));
  assert.ok(raw((c) => { c.ingredients[0].per_100g.fibre_g = 99; }).some((e) => e.includes('fibre_g exceeds')));
  const e = raw((c) => { c.ingredients[1].name = c.ingredients[0].name; c.ingredients[1].id = c.ingredients[0].id; });
  assert.ok(e.some((m) => m.includes('duplicate ingredient name')) && e.some((m) => m.includes('duplicate id')));
  assert.ok(raw((c) => { c.ingredients[0].aliases = [c.ingredients[1].name]; }).some((m) => m.includes('is the name of')));
  assert.ok(raw((c) => { delete c.ingredients[0].needs_dietitian_review; }).some((m) => m.includes('"needs_dietitian_review" missing')));
  assert.ok(raw((c) => { c.ingredients[0].extra = 1; }).some((m) => m.includes('unknown field "extra"')));
  assert.ok(validateRaw({ ingredients: [] }).includes('ingredients must be a non-empty array'));
  assert.ok(raw((c) => { c.extra = 1; }).some((m) => m.includes('unknown field "extra"')));
  assert.ok(rec((c) => { c.extra = 1; }).some((m) => m.includes('unknown field "extra"')));
  assert.ok(raw((c) => { c.ingredients[0].per_100g.fibre_g = null; }).some((m) => m.includes('fibre_g must be')));
});

test('recipes: unknown ingredient, bad amount, missing steps, bad cost, duplicates fail', () => {
  assert.ok(rec((c) => { c.library[0].ingredients[0].ingredient = 'Mystery'; }).some((e) => e.includes('not in raw-ingredients.json')));
  assert.ok(rec((c) => { c.presets[0].ingredients[0].amount = 0; }).some((e) => e.includes('amount must be')));
  assert.ok(rec((c) => { c.library[0].steps = []; }).some((e) => e.includes('steps must be')));
  assert.ok(rec((c) => { c.library[0].cost = 'Cheap'; }).some((e) => e.includes('cost must be')));
  assert.ok(rec((c) => { c.library[0].katoris = 0; }).some((e) => e.includes('katoris must be')));
  assert.ok(rec((c) => { c.library[1].name = c.library[0].name; }).some((e) => e.includes('duplicate library name')));
  assert.ok(rec((c) => { c.library[0].source.licence = ''; }).some((e) => e.includes('source.licence missing')));
  assert.ok(rec((c) => { c.library[0].source.code = 'ifct'; }).some((e) => e.includes('is not one of')));
  assert.ok(rec((c) => { c.presets[0].steps = ['x']; }).some((e) => e.includes('unknown field "steps"')));
});

test('planning: weights must sum to 1, caps need a known food, min may not exceed max, bad grocery rows fail', () => {
  assert.ok(plan((c) => { c.meal_weights.Lunch = 0.5; }).some((e) => e.includes('must sum to 1')));
  assert.ok(plan((c) => { delete c.protein_weights.Snacks; }).some((e) => e.includes('protein_weights must have exactly')));
  assert.ok(plan((c) => { c.max_portions.Mystery = 1; }).some((e) => e.includes('not a food in foods.json')));
  assert.ok(plan((c) => { c.min_portions['Egg, whole'] = 5; }).some((e) => e.includes('above max_portions')));
  assert.ok(plan((c) => { c.grocery[0].items[0].unit = 'cups'; }).some((e) => e.includes('unit must be')));
  assert.ok(plan((c) => { c.grocery[1].food = c.grocery[0].food; }).some((e) => e.includes('duplicate food')));
  assert.ok(plan((c) => { c.grocery[0].items = []; }).some((e) => e.includes('items must be')));
});

test('the IFCT/INDB ban covers the new files', async () => {
  const { scanContent } = await import('../check-no-ifct/check.mjs');
  assert.deepEqual(scanContent(`${repo}/content`), []);
});

test('golden cross-check: raw100g and rawFibre100g in docs/spec/golden/foods.json match the content', () => {
  const g = JSON.parse(readFileSync(`${repo}/docs/spec/golden/foods.json`, 'utf8'));
  const c = load('raw-ingredients.json').ingredients;
  assert.deepEqual(c.map((i) => i.name), Object.keys(g.raw100g));
  for (const i of c) {
    const [kcal, protein, carbs, fat] = g.raw100g[i.name];
    assert.deepEqual(i.per_100g, { kcal, protein_g: protein, carbs_g: carbs, fibre_g: g.rawFibre100g[i.name] ?? 0, fat_g: fat }, i.name);
  }
  for (const n of Object.keys(g.rawFibre100g)) assert.ok(n in g.raw100g, n);
});

test('fresh cream is a label value; borrowed USDA entries are recorded in the source name', () => {
  const by = (n) => load('raw-ingredients.json').ingredients.find((i) => i.name === n).source;
  assert.equal(by('Fresh cream').code, 'label_typical');
  assert.match(by('Chana dal (dry)').name, /chickpeas/);
  assert.match(by('Moong dal (dry)').name, /mung/);
  assert.match(by('Chicken curry cut (raw)').name, /thigh/);
  assert.doesNotMatch(by('Toor dal (dry)').name, /values match/);
});
