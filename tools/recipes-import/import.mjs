// Extracts the recipe builder's data from the prototype and maps it to three content files:
//   content/raw-ingredients.json  (RAW + RAW_FIB, per 100 g)
//   content/recipes.json          (LIBRARY and PRESETS)
//   content/meal-planning.json    (GROC, MEAL_W, PROT_W, MAXQ, MINQ, ROLE)
// Pure and deterministic: order follows the prototype; ids are derived from names.
// Every row is marked needs_dietitian_review until a dietitian signs it off.
import { createHash } from 'node:crypto';
import vm from 'node:vm';

// Bump when any value changes so synced clients see it.
export const UPDATED_AT = '2026-10-17T00:00:00Z';

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

// FDC record behind each usda_fdc row of RAW (SR Legacy, FoodData Central April 2018 release; public domain; issue #98).
// RAW values are per 100 g, so no serving scaling applies. Each id was matched by comparing kcal, protein, carbs, fibre and fat
// with the SR Legacy record (all agree to the rounding RAW uses). A value after " - " says the record is a proxy or has an
// identical twin. "Oil" has no entry and is a typical label value instead (SOURCE_OVERRIDE): the prototype's 884 kcal / 100 g fat
// fits every refined cooking oil, so no one FDC record is right (#576).
export const FDC_RAW = {
  'Toor dal (dry)': [172436, 'Pigeon peas (red gram), mature seeds, raw'],
  'Urad dal (dry)': [174259, 'Mungo beans, mature seeds, raw', 'USDA name for black gram (urad)'],
  'Moong dal (dry)': [174256, 'Mung beans, mature seeds, raw', 'whole beans used as a proxy for split dal'],
  'Masoor dal (dry)': [172420, 'Lentils, raw'],
  'Chana dal (dry)': [173756, 'Chickpeas (garbanzo beans, bengal gram), mature seeds, raw', 'proxy: the split-gram dal itself is not an SR Legacy item'],
  'Rajma (dry)': [173744, 'Beans, kidney, red, mature seeds, raw'],
  'Kabuli chana (dry)': [173756, 'Chickpeas (garbanzo beans, bengal gram), mature seeds, raw'],
  'Rice (raw)': [168877, 'Rice, white, long-grain, regular, raw, enriched', 'unenriched FDC 169756 has identical values'],
  'Atta (whole wheat flour)': [168893, 'Wheat flour, whole-grain'],
  'Besan': [174288, 'Chickpea flour (besan)'],
  'Oats': [169705, 'Oats'],
  'Soya chunks': [174275, 'Soy flour, defatted', 'proxy: closest SR Legacy item to dry textured soya, not the branded product'],
  'Chicken breast (raw)': [171077, 'Chicken, broiler or fryers, breast, skinless, boneless, meat only, raw'],
  'Chicken curry cut (raw)': [173627, 'Chicken, broilers or fryers, dark meat, thigh, meat only, raw', 'proxy for curry-cut pieces'],
  'Egg': [171287, 'Egg, whole, raw, fresh'],
  'Potato': [170026, 'Potatoes, flesh and skin, raw'],
  'Onion': [170000, 'Onions, raw'],
  'Tomato': [170457, 'Tomatoes, red, ripe, raw, year round average'],
  'Spinach': [168462, 'Spinach, raw'],
  'Bhindi': [169260, 'Okra, raw'],
  'Cauliflower': [169986, 'Cauliflower, raw'],
  'Green peas': [170419, 'Peas, green, raw'],
  'Ghee': [171314, 'Butter, Clarified butter (ghee)', 'same record as the foods.json Ghee row; the prototype\'s 876 kcal matched FDC 173412 Butter oil, anhydrous, see VALUE_OVERRIDE'],
  'Butter': [173410, 'Butter, salted', 'unsalted FDC 173430 has identical values; RAW rounds protein and carbs up'],
  'Sugar': [169655, 'Sugars, granulated'],
  'Cashews': [170162, 'Nuts, cashew nuts, raw'],
  'Coconut (fresh)': [170169, 'Nuts, coconut meat, raw'],
  'Sabudana': [169717, 'Tapioca, pearl, dry'],
  'Peanuts': [172430, 'Peanuts, all types, raw'],
  'Moong (whole, dry)': [174256, 'Mung beans, mature seeds, raw'],
  'Rava (sooji)': [169715, 'Semolina, enriched', 'unenriched FDC 168933 has identical values'],
  'Capsicum': [170427, 'Peppers, sweet, green, raw', 'green only; other colours differ'],
  'Cucumber': [168409, 'Cucumber, with peel, raw'],
  'Kuttu atta': [170687, 'Buckwheat flour, whole-groat'],
};

// Content-over-prototype values (decided in #576, 2026-10-17): both Ghee rows use FDC 171314 (900 kcal / 100 g) so the app
// shows one value. [kcal, protein, carbs, fat] per 100 g; `from` is the prototype's RAW row and the import fails if it changes.
export const VALUE_OVERRIDE = {
  'Ghee': { from: [876, 0.3, 0, 99.5], set: [900, 0, 0, 100] },
};

// The prototype's comment on RAW: "USDA SR28 / FoodData Central; paneer, curd and milk derived from FSSAI composition
// standards; poha approximated from rice". Everything else is usda_fdc. Packaged foods are label_typical (ADR 005);
// the generic mixed-vegetable blend has no single USDA entry, so it is our own estimate; fresh cream is a typical label value.
// A row missing here is usda_fdc; a name not in RAW fails the import.
export const SOURCE_OVERRIDE = {
  'Paneer': 'fssai', 'Curd': 'fssai', 'Milk (toned)': 'fssai',
  'Poha (dry)': 'own_estimate', 'Mixed vegetables': 'own_estimate',
  'Oil': 'label_typical', 'Fresh cream': 'label_typical', 'Whey protein': 'label_typical', 'Greek yogurt': 'label_typical', 'Makhana': 'label_typical',
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
  const named = USDA_PROXY[name] ? { ...src, name: `${src.name}; values match USDA "${USDA_PROXY[name]}"` } : src;
  const fdc = FDC_RAW[name];
  return fdc ? { ...named, reference: `FDC ${fdc[0]} (SR Legacy: ${fdc[1]}), per 100 g${fdc[2] ? ` - ${fdc[2]}` : ''}` } : named;
};

export function importRaw(p) {
  const unknown = Object.keys(p.RAW_FIB).filter((n) => !(n in p.RAW));
  if (unknown.length) throw new Error(`RAW_FIB names not in RAW: ${unknown.join(', ')}`);
  const badProxy = Object.keys(USDA_PROXY).filter((n) => !(n in p.RAW) || (SOURCE_OVERRIDE[n] ?? 'usda_fdc') !== 'usda_fdc');
  if (badProxy.length) throw new Error(`USDA_PROXY names not usda_fdc rows in RAW: ${badProxy.join(', ')}`);
  const badFdc = Object.keys(FDC_RAW).filter((n) => !(n in p.RAW) || (SOURCE_OVERRIDE[n] ?? 'usda_fdc') !== 'usda_fdc');
  if (badFdc.length) throw new Error(`FDC_RAW names not usda_fdc rows in RAW: ${badFdc.join(', ')}`);
  for (const [n, o] of Object.entries(VALUE_OVERRIDE)) {
    if (JSON.stringify(p.RAW[n]) !== JSON.stringify(o.from)) throw new Error(`RAW '${n}' changed since the #576 value override was written; review VALUE_OVERRIDE`);
  }
  const badOverride = Object.keys(SOURCE_OVERRIDE).filter((n) => !(n in p.RAW));
  if (badOverride.length) throw new Error(`SOURCE_OVERRIDE names not in RAW: ${badOverride.join(', ')}`);
  return {
    schema_version: 1,
    source: 'docs/prototype/plate-and-bar.html (RAW, RAW_FIB)',
    per: '100 g raw. Carbs are total carbohydrate including fibre.',
    ingredients: Object.entries(p.RAW).map(([name, row]) => [name, VALUE_OVERRIDE[name]?.set ?? row]).map(([name, [kcal, protein, carbs, fat]]) => ({
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
