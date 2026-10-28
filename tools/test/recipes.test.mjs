import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRaw, validateRecipes, validatePlanning } from '../validate/recipes.mjs';

// The one deliberate content-over-prototype value (#576): FDC 171314 instead of the prototype's 876 kcal row.
const VALUE_OVERRIDE = { Ghee: { from: [876, 0.3, 0, 99.5], set: [900, 0, 0, 100] } };

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (f) => JSON.parse(readFileSync(`${repo}/content/${f}`, 'utf8'));
const foodNames = () => new Set(load('foods.json').foods.map((f) => f.name));
const rawNames = () => new Set(load('raw-ingredients.json').ingredients.map((i) => i.name));
const raw = (fn) => { const c = load('raw-ingredients.json'); fn(c); return validateRaw(c); };
const rec = (fn) => { const c = load('recipes.json'); fn(c); return validateRecipes(c, rawNames()); };
const plan = (fn) => { const c = load('meal-planning.json'); fn(c); return validatePlanning(c, foodNames()); };

test('content files pass validation', () => {
  assert.deepEqual(validateRaw(load('raw-ingredients.json')), []);
  assert.deepEqual(validateRecipes(load('recipes.json'), rawNames()), []);
  assert.deepEqual(validatePlanning(load('meal-planning.json'), foodNames()), []);
});

test('raw ingredient: Toor dal values, the fatty ones and the stable id', () => {
  const c = load('raw-ingredients.json');
  const toor = c.ingredients.find((i) => i.name === 'Toor dal (dry)');
  assert.deepEqual(toor.per_100g, { kcal: 343, protein_g: 21.7, carbs_g: 62.8, fibre_g: 15, fat_g: 1.5 });
  assert.deepEqual(c.ingredients.filter((i) => i.fatty).map((i) => i.name).sort(), ['Butter', 'Fresh cream', 'Ghee', 'Oil']);
});

test('sources: only ADR 005 codes, FSSAI for dairy, label values for packaged, every row flagged for dietitian review', () => {
  const c = load('raw-ingredients.json');
  const by = (n) => c.ingredients.find((i) => i.name === n).source.code;
  assert.equal(by('Paneer'), 'fssai');
  assert.equal(by('Whey protein'), 'label_typical');
  assert.equal(by('Poha (dry)'), 'own_estimate');
  assert.equal(by('Toor dal (dry)'), 'usda_fdc');
  for (const i of c.ingredients) { assert.ok(i.source.licence); assert.equal(i.needs_dietitian_review, true); }
  for (const r of [...load('recipes.json').library, ...load('recipes.json').presets]) assert.equal(r.needs_dietitian_review, true);
  assert.equal(load('meal-planning.json').needs_dietitian_review, true);
});

test('recipes: 9 library recipes and 8 presets', () => {
  const c = load('recipes.json');
  assert.equal(c.library.length, 9);
  assert.equal(c.presets.length, 8);
  assert.equal(c.katori_g, 150);
});

test('meal planning: meal weights and minimum portions', () => {
  const c = load('meal-planning.json');
  assert.deepEqual(c.meal_weights, { Breakfast: 0.25, Lunch: 0.35, Snacks: 0.1, Dinner: 0.3 });
  assert.deepEqual(c.min_portions, { 'Soya chunks, dry': 0.5, 'Whey protein': 0.5, 'Egg, whole': 2, 'Egg white': 2 });
});

test('meal planning roles: 37 rows and a known entry', () => {
  const c = load('meal-planning.json');
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

test('planning: the validator rejects a name that is not in the food names it is given, such as an eat-out dish (#342)', () => {
  const dish = load('eatout.json').cuisines.flatMap((c) => c.dishes).map((d) => d.name).find((n) => !foodNames().has(n));
  assert.ok(dish);
  assert.ok(plan((c) => { c.roles[0].food = dish; }).some((e) => e.includes(`roles/${dish}: not a food in foods.json`)));
  assert.ok(plan((c) => { c.max_portions[dish] = 1; }).some((e) => e.includes(`max_portions.${dish}: not a food in foods.json`)));
  assert.ok(plan((c) => { c.grocery[0].food = dish; }).some((e) => e.includes(`grocery/${dish}: not a food in foods.json`)));
});

test('recipes CLI: known planning foods are foods.json names only, so an eat-out dish fails (#342)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'recipes-cli-'));
  try {
    for (const f of ['raw-ingredients.json', 'recipes.json', 'foods.json', 'eatout.json']) copyFileSync(`${repo}/content/${f}`, `${dir}/${f}`);
    const dish = load('eatout.json').cuisines.flatMap((c) => c.dishes).map((d) => d.name).find((n) => !foodNames().has(n));
    const planning = load('meal-planning.json');
    planning.roles[0].food = dish;
    writeFileSync(`${dir}/meal-planning.json`, JSON.stringify(planning));
    const r = spawnSync(process.execPath, [`${repo}/tools/validate/recipes-cli.mjs`, dir], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`meal-planning.json: roles/${dish}: not a food in foods.json`), r.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
    // Ghee is the one deliberate content-over-prototype value (#576): FDC 171314 instead of the prototype's 876 kcal row.
    const [kcal, protein, carbs, fat] = VALUE_OVERRIDE[i.name]?.set ?? g.raw100g[i.name];
    if (VALUE_OVERRIDE[i.name]) assert.deepEqual(g.raw100g[i.name], VALUE_OVERRIDE[i.name].from, i.name);
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

test('every usda_fdc raw row names its FDC id, except the listed generic one; other sources carry none (#98)', () => {
  for (const i of load('raw-ingredients.json').ingredients) {
    if (i.source.code !== 'usda_fdc') assert.equal(i.source.reference, null, i.name);
    else assert.match(i.source.reference, /^FDC \d+ \(SR Legacy: .+\), per 100 g/, i.name);
  }
});

test('#576: Ghee uses FDC 171314 in both files with one value; Oil stays generic with source label typical', () => {
  const ing = (n) => load('raw-ingredients.json').ingredients.find((i) => i.name === n);
  const ghee = ing('Ghee');
  assert.match(ghee.source.reference, /^FDC 171314 /);
  assert.deepEqual(ghee.per_100g, { kcal: 900, protein_g: 0, carbs_g: 0, fibre_g: 0, fat_g: 100 });
  const foodsGhee = load('foods.json').foods.find((f) => f.name === 'Ghee');
  assert.match(foodsGhee.source.reference, /^FDC 171314 /);
  assert.equal(foodsGhee.per_serving.kcal, Math.round(ghee.per_100g.kcal * 4.9 / 100));
  const oil = ing('Oil');
  assert.equal(oil.source.code, 'label_typical');
  assert.equal(oil.source.reference, null);
  assert.deepEqual(oil.per_100g, { kcal: 884, protein_g: 0, carbs_g: 0, fibre_g: 0, fat_g: 100 });
});
