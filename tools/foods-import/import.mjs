// Maps docs/spec/golden/foods.json to the content/foods.json shape (Food in packages/api/openapi.yaml).
// Pure and deterministic: row order follows the golden file; ids are derived from names.
import { createHash } from 'node:crypto';

// Any change to a food's values must bump this, or synced clients never see it. Ids come from names,
// so renaming a food changes its id.
export const UPDATED_AT = '2026-10-18T00:00:00Z';
const ID_NAMESPACE = 'plate-and-bar/foods/v1';

// FoodSource.code values from the contract, with the descriptive fields the contract asks for.
export const SOURCES = {
  usda_fdc: {
    code: 'usda_fdc',
    name: 'USDA FoodData Central (SR Legacy)',
    licence: 'Public domain (CC0 1.0)',
    url: 'https://fdc.nal.usda.gov/',
    reference: null,
  },
  fssai: {
    code: 'fssai',
    name: 'Values derived from FSSAI composition standards',
    licence: 'Values calculated by us from published standards; no table copied',
    url: null,
    reference: null,
  },
  own_recipe: {
    code: 'own_recipe',
    name: 'Plate & Bar home recipes (calculated by weight from USDA and FSSAI-derived ingredient values)',
    licence: 'Own work',
    url: null,
    reference: null,
  },
  kitchen_test: {
    code: 'kitchen_test',
    name: 'Plate & Bar kitchen test (dish weighed while cooking)',
    licence: 'Own work',
    url: null,
    reference: null,
  },
  label_typical: {
    code: 'label_typical',
    name: 'Typical label values (packaged food)',
    licence: 'Nutrition facts read from product labels; no label database copied',
    url: null,
    reference: null,
  },
};

// Source per golden food. Basis: the prototype note (docs/prototype/plate-and-bar.html, food list hint):
// "calculated from USDA public-domain ingredient data using standard home recipes; paneer, curd and milk
// follow FSSAI composition standards; packaged foods (whey, Greek yogurt, makhana) use typical label
// values", plus ADR 005 (USDA for plain foods, own recipes for dishes). Single plain foods are usda_fdc and
// composed dishes are own_recipe. Chicken breast, cooked is the raw value divided by a cooking yield and
// buttermilk is 80 g curd in the prototype's grocery map, so both are own_recipe. The three drinks are single plain
// items with a matching SR Legacy record (#824), so usda_fdc too.
const FSSAI = ['Paneer', 'Curd / dahi', 'Toned milk'];
const LABEL = ['Whey protein', 'Greek yogurt, plain', 'Makhana, roasted'];
const USDA = [
  'Egg, whole', 'Egg white', 'Soya chunks, dry', 'Oats, dry', 'Ghee', 'Banana',
  'Apple', 'Almonds', 'Roasted chana', 'Peanuts, roasted', 'Sweet potato, boiled', 'Brown bread', 'Peanut butter',
  'Beer', 'Whisky, rum or vodka', 'Wine',
];
const RECIPE = [
  'Roti / chapati', 'Rice, cooked', 'Dal', 'Rajma / chole', 'Mixed veg sabzi', 'Paneer bhurji', 'Chicken curry',
  'Poha', 'Upma', 'Idli', 'Dosa, plain', 'Sambar', 'Aloo paratha', 'Sprouts salad', 'Tea with milk & sugar', 'Chicken breast, cooked', 'Buttermilk (chaas)',
  'Sabudana khichdi', 'Kuttu atta roti', 'Fruit bowl',
];
// FDC record and serving scaling behind each usda_fdc row (SR Legacy, per 100 g x grams; issue #98). Only usda_fdc rows get one.
export const FDC_REFERENCE = {
  "Egg, whole": "FDC 171287 (SR Legacy: Egg, whole, raw, fresh), per 100 g x 50 g (1 large)",
  "Egg white": "FDC 172183 (SR Legacy: Egg, white, raw, fresh), per 100 g x 33 g (1 large)",
  "Soya chunks, dry": "FDC 174275 (SR Legacy: Soy flour, defatted), per 100 g x 50 g; closest SR Legacy item to dry textured soya, not the branded product",
  "Brown bread": "FDC 172688 (SR Legacy: Bread, whole-wheat, commercially prepared), per 100 g x 28 g (1 slice); added_sugar_g has no SR Legacy field behind it",
  "Peanut butter": "FDC 172459 (SR Legacy: Peanut butter, smooth, vitamin and mineral fortified), per 100 g x 16 g (1 tbsp); added_sugar_g has no SR Legacy field behind it",
  "Banana": "FDC 173944 (SR Legacy: Bananas, raw), per 100 g x 118 g (1 medium)",
  "Apple": "FDC 171688 (SR Legacy: Apples, raw, with skin), per 100 g x 182 g (1 medium)",
  "Almonds": "FDC 170567 (SR Legacy: Nuts, almonds), per 100 g x 12 g (10 almonds at 1.2 g each)",
  "Oats, dry": "FDC 169705 (SR Legacy: Oats), per 100 g x 40 g",
  "Roasted chana": "FDC 173756 (SR Legacy: Chickpeas, mature seeds, raw), per 100 g x 30 g; values are for the raw seed",
  "Ghee": "FDC 171314 (SR Legacy: Butter, Clarified butter (ghee)), per 100 g x 4.9 g (1 tsp)",
  "Sweet potato, boiled": "FDC 168484 (SR Legacy: Sweet potato, cooked, boiled, without skin), per 100 g x 150 g",
  "Peanuts, roasted": "FDC 172430 (SR Legacy: Peanuts, all types, raw), per 100 g x 30 g; values are for raw peanuts",
  "Beer": "FDC 168746 (SR Legacy: Alcoholic beverage, beer, regular, all), per 100 g x 356 g (12 fl oz can), rounded; kcal include alcohol; a 330 ml can (331 g) is about 7 % less",
  "Whisky, rum or vodka": "FDC 171919 (SR Legacy: Alcoholic beverage, distilled, all (gin, rum, vodka, whiskey) 86 proof), per 100 g x 28 g (30 ml); kcal are alcohol; 80 proof (FDC 174815) gives 65",
  "Wine": "FDC 173190 (SR Legacy: Alcoholic beverage, wine, table, red), per 100 g x 147 g (5 fl oz), rounded; kcal include alcohol",
};

export const SOURCE_OF = {};
for (const [code, names] of [['fssai', FSSAI], ['label_typical', LABEL], ['usda_fdc', USDA], ['own_recipe', RECIPE]]) {
  for (const n of names) SOURCE_OF[n] = code;
}

// Golden foods left out of content because the repo does not state their source. Empty since the drinks got FDC
// records (#824).
export const HELD_BACK = [];

// Drinks whose kcal include alcohol (7 kcal/g), which the 4/4/9 check cannot see: flagged `alcohol: true`, as in eatout.json.
export const ALCOHOLIC = ['Beer', 'Whisky, rum or vodka', 'Wine'];

// Fruit and veg servings (80 g each) per serving: PRODUCE in the prototype.
export const PRODUCE = {
  'Mixed veg sabzi': 1, 'Sprouts salad': 1, 'Fruit bowl': 2, Banana: 1, Apple: 1, Sambar: 0.5, 'Sweet potato, boiled': 1,
};

// Grams logging: ported from `unitGrams` in the prototype, the first "<n> g" in the serving label
// ("100 g" gives 100, "1 medium (30 g atta)" gives 30). Whether a bracketed ingredient weight should
// count is a spec question, not decided here.
// Same pattern as core's `unitGrams` (packages/core/src/food.ts) and the prototype's, so "1,250 g" gives 1250
// (grouped digits, thousands or Indian grouping). No lookbehind. A test keeps the three in step.
export const UNIT_GRAMS_RE = /(?:^|\D)([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d?(?:,\d{2})+,\d{3})\s*g\b|(\d+)\s*g\b/;
export function servingGrams(label) {
  const m = UNIT_GRAMS_RE.exec(String(label));
  const g = m ? Number((m[1] ?? m[2]).replace(/,/g, '')) : 0;
  return g > 0 ? g : null;
}

// Multi-word aliases that the prototype matches as one phrase (foodMatch checks the whole query as a
// substring of the alias string). Everything else in the golden alias string is one word per alias.
export const ALIAS_PHRASES = [
  'fox nut', 'phool makhana', 'lotus seed', 'cottage cheese', 'protein shake', 'flattened rice', 'chana masala',
  'bhuna chana', 'fruit chaat', 'desi ghee', 'sprouted moong', 'anda safedi',
];

export function splitAliases(str) {
  const out = [];
  const words = str.split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const pair = ALIAS_PHRASES.find((p) => p === `${words[i]} ${words[i + 1]}`);
    if (pair) { out.push(pair); i++; } else out.push(words[i]);
  }
  return out;
}

// Deterministic UUID (version 5 layout, SHA-1) from a fixed namespace string and the food name.
export function foodId(name) {
  const h = createHash('sha1').update(`${ID_NAMESPACE}:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

export function importFoods(golden) {
  for (const k of ['foods', 'fibreAndAddedSugarPerServing', 'aliases']) {
    if (!(k in golden)) throw new Error(`golden foods file is missing "${k}"`);
  }
  const fib = golden.fibreAndAddedSugarPerServing;
  const foods = [];
  for (const f of golden.foods) {
    if (HELD_BACK.includes(f.name)) continue;
    const code = SOURCE_OF[f.name];
    if (!code) throw new Error(`${f.name}: no source assigned (add it to SOURCE_OF or HELD_BACK)`);
    const [fibre, sugar] = fib[f.name] ?? [null, null];
    foods.push({
      id: foodId(f.name),
      name: f.name,
      name_hi: null,
      aliases: splitAliases(golden.aliases[f.name] ?? ''),
      ...(ALCOHOLIC.includes(f.name) ? { alcohol: true } : {}),
      serving: { label: f.unit, grams: servingGrams(f.unit) },
      per_serving: {
        kcal: f.kcal, protein_g: f.protein, carbs_g: f.carbs, fibre_g: fibre, added_sugar_g: sugar, fat_g: f.fat,
      },
      fruit_veg_servings: PRODUCE[f.name] ?? 0,
      source: { ...SOURCES[code], reference: (code === 'usda_fdc' && FDC_REFERENCE[f.name]) || SOURCES[code].reference },
      updated_at: UPDATED_AT,
    });
  }
  return { schema_version: 1, source: 'docs/spec/golden/foods.json', foods };
}

export const serialize = (obj) => JSON.stringify(obj, null, 2) + '\n';
