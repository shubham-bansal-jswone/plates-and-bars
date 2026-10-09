// Extracts the recipe builder's data from the prototype and maps it to three content files:
//   content/raw-ingredients.json  (RAW + RAW_FIB, per 100 g)
//   content/recipes.json          (LIBRARY and PRESETS)
//   content/meal-planning.json    (GROC, MEAL_W, PROT_W, MAXQ, MINQ, ROLE)
// Pure and deterministic: order follows the prototype; ids are derived from names.
// Every row is marked needs_dietitian_review until a dietitian signs it off.
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Bump when any value changes so synced clients see it.
export const UPDATED_AT = '2026-10-09T00:00:00Z';

import { SOURCES as FOOD_SOURCES } from '../foods-import/import.mjs';

export const SOURCES = {
  usda_fdc: FOOD_SOURCES.usda_fdc,
  fssai: FOOD_SOURCES.fssai,
  label_typical: FOOD_SOURCES.label_typical,
  own_recipe: FOOD_SOURCES.own_recipe,
  own_estimate: { code: 'own_estimate', name: 'Plate & Bar own estimate (generic mix or approximation; not weighed)', licence: 'Own work', url: null, reference: null },
};

// USDA entry each usda_fdc row borrows when the prototype's name is not a USDA food name, so the FDC ids (#98) are
// looked up for the right food. Rows not listed here are the USDA food of the same name.
export const USDA_PROXY = {
  'Chana dal (dry)': 'chickpeas, mature seeds, raw',
  'Moong dal (dry)': 'mung beans, mature seeds, raw (whole beans used for split dal)',
  'Moong (whole, dry)': 'mung beans, mature seeds, raw',
  'Chicken curry cut (raw)': 'chicken, broilers or fryers, thigh, meat only, raw',
};

// The prototype's comment on RAW: "USDA SR28 / FoodData Central; paneer, curd and milk derived from FSSAI composition
// standards; poha approximated from rice". Everything else is usda_fdc. Packaged foods are label_typical (ADR 005);
// the generic mixed-vegetable blend has no single USDA entry, so it is our own estimate; fresh cream is a typical label value.
// A row missing here is usda_fdc; a name not in RAW fails the import.
export const SOURCE_OVERRIDE = {
  'Paneer': 'fssai', 'Curd': 'fssai', 'Milk (toned)': 'fssai',
  'Poha (dry)': 'own_estimate', 'Mixed vegetables': 'own_estimate',
  'Fresh cream': 'label_typical', 'Whey protein': 'label_typical', 'Greek yogurt': 'label_typical', 'Makhana': 'label_typical',
};

export function idFor(ns, name) {
  const h = createHash('sha1').update(`plate-and-bar/${ns}/v1:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

const grab = (html, re, what) => {
  const m = re.exec(html);
  if (!m) throw new Error(`${what} not found in the prototype`);
  return m[0];
};

// Evaluates only the data-literal statements below (no other prototype code).
export function extractRecipeData(html) {
  const parts = [
    grab(html, /^const RAW = \{[\s\S]*?^\};$/m, 'RAW'),
    grab(html, /^Object\.assign\(RAW, \{[\s\S]*?\}\);$/m, 'Object.assign(RAW, ...)'),
    grab(html, /^const RAW_FIB = \{[\s\S]*?\};$/m, 'RAW_FIB'),
    grab(html, /^const FATTY = .*;$/m, 'FATTY'),
    grab(html, /^const UNIT_G = .*;$/m, 'UNIT_G'),
    grab(html, /^const KATORI_G = .*;$/m, 'KATORI_G'),
    grab(html, /^const PRESETS = \{[\s\S]*?^\};$/m, 'PRESETS'),
    grab(html, /^const LIBRARY = \{[\s\S]*?^\};$/m, 'LIBRARY'),
    grab(html, /^const GROC = \{[\s\S]*?^\};$/m, 'GROC'),
    grab(html, /^const MEAL_W = .*, PROT_W = .*;$/m, 'MEAL_W/PROT_W'),
    grab(html, /^const ROLE = \{[\s\S]*?^\};$/m, 'ROLE'),
    grab(html, /^Object\.assign\(ROLE, \{.*\}\);$/m, 'Object.assign(ROLE, ...)'),
    grab(html, /^const MAXQ = .*;$/m, 'MAXQ'),
    grab(html, /^ *const MINQ = .*;$/m, 'MINQ'),
  ];
  const ctx = vm.createContext({});
  vm.runInContext(`${parts.join('\n')}\nthis.out = { RAW, RAW_FIB, FATTY: [...FATTY], UNIT_G, KATORI_G, PRESETS, LIBRARY, GROC, MEAL_W, PROT_W, ROLE, MAXQ, MINQ };`, ctx, { timeout: 1000 });
  return JSON.parse(JSON.stringify(ctx.out));
}

const sourceFor = (name) => {
  const src = SOURCES[SOURCE_OVERRIDE[name] ?? 'usda_fdc'];
  return USDA_PROXY[name] ? { ...src, name: `${src.name}; values match USDA "${USDA_PROXY[name]}"` } : src;
};

export function importRaw(p) {
  const unknown = Object.keys(p.RAW_FIB).filter((n) => !(n in p.RAW));
  if (unknown.length) throw new Error(`RAW_FIB names not in RAW: ${unknown.join(', ')}`);
  const badProxy = Object.keys(USDA_PROXY).filter((n) => !(n in p.RAW) || (SOURCE_OVERRIDE[n] ?? 'usda_fdc') !== 'usda_fdc');
  if (badProxy.length) throw new Error(`USDA_PROXY names not usda_fdc rows in RAW: ${badProxy.join(', ')}`);
  const badOverride = Object.keys(SOURCE_OVERRIDE).filter((n) => !(n in p.RAW));
  if (badOverride.length) throw new Error(`SOURCE_OVERRIDE names not in RAW: ${badOverride.join(', ')}`);
  return {
    schema_version: 1,
    source: 'docs/prototype/plate-and-bar.html (RAW, RAW_FIB)',
    per: '100 g raw. Carbs are total carbohydrate including fibre.',
    ingredients: Object.entries(p.RAW).map(([name, [kcal, protein, carbs, fat]]) => ({
      id: idFor('raw', name),
      name,
      name_hi: null,
      aliases: [],
      fatty: p.FATTY.includes(name),
      per_100g: { kcal, protein_g: protein, carbs_g: carbs, fibre_g: p.RAW_FIB[name] ?? 0, fat_g: fat }, // a missing RAW_FIB entry counts as 0, as in the prototype
      source: sourceFor(name),
      needs_dietitian_review: true,
      updated_at: UPDATED_AT,
    })),
  };
}

const recipe = (name, r, kind) => ({
  id: idFor(kind, name),
  name,
  kind,
  ingredients: r.rows.map(([ingredient, amount]) => ({ ingredient, amount, unit: 'g' })),
  katoris: r.k,
  ...(kind === 'library' ? { time_min: r.time, cost: r.cost, tags: r.tags, steps: r.steps } : {}),
  source: SOURCES.own_recipe,
  needs_dietitian_review: true,
  updated_at: UPDATED_AT,
});

export function importRecipes(p) {
  return {
    schema_version: 1,
    source: 'docs/prototype/plate-and-bar.html (LIBRARY, PRESETS)',
    katori_g: p.KATORI_G,
    library: Object.entries(p.LIBRARY).map(([n, r]) => recipe(n, r, 'library')),
    presets: Object.entries(p.PRESETS).map(([n, r]) => recipe(n, r, 'preset')),
  };
}

export function importPlanning(p) {
  return {
    schema_version: 1,
    source: 'docs/prototype/plate-and-bar.html (GROC, MEAL_W, PROT_W, MAXQ, MINQ, ROLE)',
    updated_at: UPDATED_AT,
    needs_dietitian_review: true,
    meal_weights: p.MEAL_W,
    protein_weights: p.PROT_W,
    max_portions: p.MAXQ,
    min_portions: p.MINQ,
    grocery: Object.entries(p.GROC).map(([food, items]) => ({ food, items: items.map(([item, amount, unit]) => ({ item, amount, unit })) })),
    roles: Object.entries(p.ROLE).map(([food, [role, diet]]) => ({ food, role, diet })),
  };
}

export function importAll(html) {
  const p = extractRecipeData(html);
  return { raw: importRaw(p), recipes: importRecipes(p), planning: importPlanning(p) };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
